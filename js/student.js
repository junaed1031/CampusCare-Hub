import { db } from "./firebase.js";
import { bindLogoutButtons, ensureAuthenticated, formatDate, setText, showAlert, statusBadge } from "./common.js";
import {
  addDoc,
  collection,
  getDocs,
  getDocsFromCache,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let currentProfile = null;

async function loadCategories() {
  const select = document.getElementById("category");
  if (!select) return;
  const catsFromSnap = (snap) => snap.docs.map((d) => d.data().categoryName).filter(Boolean);
  const render = (cats) => {
    select.innerHTML = '<option value="">Select category</option>' + cats.map((c) => `<option value="${c}">${c}</option>`).join("");
  };

  let renderedFromCache = false;
  try {
    const cached = await getDocsFromCache(query(collection(db, "categories")));
    if (cached?.docs?.length) {
      render(catsFromSnap(cached));
      renderedFromCache = true;
    }
  } catch {
    // cache miss is ok
  }

  const fetchFresh = async () => {
    const snap = await getDocs(collection(db, "categories"));
    render(catsFromSnap(snap));
  };

  if (renderedFromCache) {
    fetchFresh().catch(() => {});
    return;
  }

  await fetchFresh();
}

async function loadComplaints() {
  if (!currentProfile) return;
  const rows = document.getElementById("complaintRows");
  if (!rows) return;
  const q = query(collection(db, "complaints"), where("userId", "==", currentProfile.uid), orderBy("createdAt", "desc"), limit(30));

  const render = (items) => {
    setText("totalComplaints", String(items.length));
    setText("inProgressComplaints", String(items.filter((c) => String(c.status || "").includes("progress")).length));
    setText("resolvedComplaints", String(items.filter((c) => String(c.status || "").includes("resolve")).length));
    if (!items.length) {
      rows.innerHTML = '<tr><td class="px-4 py-6 text-center text-slate-500" colspan="5">No complaints yet.</td></tr>';
      return;
    }
    rows.innerHTML = items.map((c) => `
    <tr class="border-b border-slate-200">
      <td class="px-4 py-4 font-semibold text-slate-900">${c.title || "Untitled"}</td>
      <td class="px-4 py-4 text-slate-600">${c.category || "-"}</td>
      <td class="px-4 py-4"><span class="${statusBadge(c.status)}">${c.status || "open"}</span></td>
      <td class="px-4 py-4 text-slate-600">${formatDate(c.createdAt)}</td>
      <td class="px-4 py-4">${String(c.status || "").toLowerCase().includes("resolve") ? `<button data-feedback="${c.id}" class="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700">Give Feedback</button>` : '<span class="text-sm text-slate-400">Pending</span>'}</td>
    </tr>
  `).join("");
    rows.querySelectorAll("[data-feedback]").forEach((btn) => btn.addEventListener("click", () => openFeedback(btn.dataset.feedback)));
  };

  let renderedFromCache = false;
  try {
    const cached = await getDocsFromCache(q);
    if (cached?.docs?.length) {
      render(cached.docs.map((d) => ({ id: d.id, ...d.data() })));
      renderedFromCache = true;
    }
  } catch {
    // ignore
  }

  const fetchFresh = async () => {
    const snap = await getDocs(q);
    render(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  if (renderedFromCache) {
    fetchFresh().catch(() => {});
    return;
  }

  await fetchFresh();
}

async function openFeedback(complaintId) {
  const result = await window.Swal.fire({
    title: "Complaint Feedback",
    html: '<div class="space-y-3 text-left"><textarea id="msg" class="form-textarea" rows="4" placeholder="Your feedback"></textarea><input id="rating" class="form-input" type="number" min="1" max="5" value="5" /></div>',
    showCancelButton: true,
    confirmButtonText: "Submit",
    confirmButtonColor: "#0f766e",
    preConfirm: () => ({ msg: document.getElementById("msg").value, rating: Number(document.getElementById("rating").value || 5) })
  });
  if (result.isConfirmed) {
    await addDoc(collection(db, "feedback"), { complaintId, message: result.value.msg, rating: result.value.rating });
    showAlert("Success", "Feedback submitted!");
    await loadComplaints();
  }
}

async function init() {
  bindLogoutButtons();
  const profile = await ensureAuthenticated(["student"]);
  if (!profile) return;
  currentProfile = profile;
  setText("profileName", profile.name);
  setText("profileEmail", profile.email);
  setText("profileRole", profile.role);
  setText("dashboardGreeting", `Hello, ${profile.name}`);
  try {
    await Promise.all([loadCategories(), loadComplaints()]);
  } catch (error) {
    showAlert("Error", error.message || "Failed to load data");
  }
  const form = document.getElementById("complaintForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      try {
        await addDoc(collection(db, "complaints"), {
          title: String(data.get("title") || "").trim(),
          description: String(data.get("description") || "").trim(),
          category: String(data.get("category") || "").trim(),
          status: "open",
          createdAt: serverTimestamp(),
          assignedTo: "",
          userId: profile.uid
        });
        form.reset();
        showAlert("Success", "Complaint submitted!");
        await loadComplaints();
      } catch (error) {
        showAlert("Error", error.message || "Failed to submit");
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
