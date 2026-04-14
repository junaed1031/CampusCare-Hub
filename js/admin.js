import { db } from "./firebase.js";
import { bindLogoutButtons, ensureAuthenticated, formatDate, setText, showAlert, statusBadge } from "./common.js";
import { addDoc, collection, deleteDoc, doc, getDocs, getDocsFromCache, limit, orderBy, query, serverTimestamp, updateDoc, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let staffCache = null;
let complaintItems = [];

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function staffNameById(staffList) {
  const map = new Map();
  (staffList || []).forEach((s) => {
    const key = s?.id || s?.uid;
    if (key) map.set(key, s?.name || s?.email || key);
  });
  return map;
}

async function openDetails(id) {
  const item = complaintItems.find((c) => c.id === id);
  if (!item) return;

  const staff = await getStaffMembers().catch(() => []);
  const staffMap = staffNameById(staff);
  const assignedLabel = item.assignedTo ? (staffMap.get(item.assignedTo) || item.assignedTo) : "Unassigned";

  await window.Swal.fire({
    title: "Complaint Details",
    html: `
      <div class="space-y-3 text-left">
        <div><p class="text-xs font-semibold text-slate-500">Title</p><p class="mt-1 font-semibold text-slate-900">${safeText(item.title || "Untitled")}</p></div>
        <div><p class="text-xs font-semibold text-slate-500">Description</p><p class="mt-1 text-slate-700 whitespace-pre-wrap">${safeText(item.description || "-")}</p></div>
        <div class="grid grid-cols-2 gap-3">
          <div><p class="text-xs font-semibold text-slate-500">Category</p><p class="mt-1 text-slate-700">${safeText(item.category || "-")}</p></div>
          <div><p class="text-xs font-semibold text-slate-500">Status</p><p class="mt-1 text-slate-700">${safeText(item.status || "open")}</p></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><p class="text-xs font-semibold text-slate-500">Assigned To</p><p class="mt-1 text-slate-700">${safeText(assignedLabel)}</p></div>
          <div><p class="text-xs font-semibold text-slate-500">Created</p><p class="mt-1 text-slate-700">${safeText(formatDate(item.createdAt))}</p></div>
        </div>
      </div>
    `,
    confirmButtonColor: "#0f766e",
    confirmButtonText: "Close"
  });
}

async function getStaffMembers(forceRefresh = false) {
  if (!forceRefresh && Array.isArray(staffCache)) {
    return staffCache;
  }

  const q = query(collection(db, "users"), where("role", "==", "staff"));
  try {
    const cached = await getDocsFromCache(q);
    if (cached?.docs?.length) {
      staffCache = cached.docs.map((d) => ({ id: d.id, ...d.data() }));
      // background refresh
      getDocs(q)
        .then((snap) => {
          staffCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        })
        .catch(() => {});
      return staffCache;
    }
  } catch {
    // ignore cache miss
  }

  const snap = await getDocs(q);
  staffCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return staffCache;
}

async function loadStaff() {
  const select = document.getElementById("assignedTo");
  if (!select) return;
  const staff = await getStaffMembers();
  select.innerHTML = '<option value="">Unassigned</option>' + staff.map((s) => `<option value="${s.id || s.uid}">${s.name} (${s.email})</option>`).join("");
}

async function loadCategories() {
  const list = document.getElementById("categoryList");
  const catsFromSnap = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  let cats = [];
  let renderedFromCache = false;
  try {
    const cached = await getDocsFromCache(query(collection(db, "categories")));
    if (cached?.docs?.length) {
      cats = catsFromSnap(cached);
      renderedFromCache = true;
    }
  } catch {
    // ignore
  }

  if (!renderedFromCache) {
    const snap = await getDocs(collection(db, "categories"));
    cats = catsFromSnap(snap);
  } else {
    getDocs(collection(db, "categories"))
      .then((snap) => {
        const freshCats = catsFromSnap(snap);
        const filter = document.getElementById("complaintCategoryFilter");
        if (filter) {
          filter.innerHTML = '<option value="">All categories</option>' + freshCats.map((c) => `<option value="${c.categoryName}">${c.categoryName}</option>`).join("");
        }
        const listEl = document.getElementById("categoryList");
        if (listEl) {
          listEl.innerHTML = freshCats.length ? freshCats.map((c) => `<li class="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"><span>${c.categoryName}</span><button data-del="${c.id}" class="text-sm font-semibold text-rose-600">Delete</button></li>`).join("") : '<li class="text-sm text-slate-500">No categories.</li>';
          listEl.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
            await deleteDoc(doc(db, "categories", b.dataset.del));
            await loadCategories();
          }));
        }
      })
      .catch(() => {});
  }
  if (list) {
    list.innerHTML = cats.length ? cats.map((c) => `<li class="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"><span>${c.categoryName}</span><button data-del="${c.id}" class="text-sm font-semibold text-rose-600">Delete</button></li>`).join("") : '<li class="text-sm text-slate-500">No categories.</li>';
    list.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      await deleteDoc(doc(db, "categories", b.dataset.del));
      await loadCategories();
    }));
  }
  const filter = document.getElementById("complaintCategoryFilter");
  if (filter) {
    filter.innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option value="${c.categoryName}">${c.categoryName}</option>`).join("");
  }
}

async function loadComplaints() {
  const rows = document.getElementById("complaintRows");
  if (!rows) return;
  const filter = document.getElementById("complaintCategoryFilter")?.value || "";
  const staff = await getStaffMembers().catch(() => []);
  const staffMap = staffNameById(staff);

  const snap = await getDocs(query(collection(db, "complaints"), orderBy("createdAt", "desc"), limit(100)));
  complaintItems = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  let items = complaintItems;
  if (filter) items = items.filter((c) => c.category === filter);
  setText("totalComplaints", String(items.length));
  setText("openComplaints", String(items.filter((c) => String(c.status || "").includes("open")).length));
  setText("assignedComplaints", String(items.filter((c) => c.assignedTo).length));
  setText("resolvedComplaints", String(items.filter((c) => String(c.status || "").includes("resolve")).length));
  if (!items.length) {
    rows.innerHTML = '<tr><td class="px-4 py-6 text-center text-slate-500" colspan="6">No complaints.</td></tr>';
    return;
  }
  rows.innerHTML = items.map((c) => {
    const assignedLabel = c.assignedTo ? (staffMap.get(c.assignedTo) || c.assignedTo) : "Unassigned";
    return `<tr class="border-b border-slate-200">
      <td class="px-4 py-4 font-semibold text-slate-900">${c.title || "Untitled"}</td>
      <td class="px-4 py-4 text-slate-600">${c.category || "-"}</td>
      <td class="px-4 py-4 text-slate-600">${assignedLabel}</td>
      <td class="px-4 py-4"><span class="${statusBadge(c.status)}">${c.status || "open"}</span></td>
      <td class="px-4 py-4 text-slate-600">${formatDate(c.createdAt)}</td>
      <td class="px-4 py-4">
        <div class="flex flex-wrap gap-2">
          <button data-view="${c.id}" class="rounded-lg bg-teal-600 px-3 py-2 text-sm font-bold text-white hover:bg-teal-700">Details</button>
          <button data-edit="${c.id}" class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-700">Update</button>
        </div>
      </td>
    </tr>`;
  }).join("");
  rows.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEditor(b.dataset.edit)));
  rows.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => openDetails(b.dataset.view)));
}

async function openEditor(id) {
  const staff = await getStaffMembers();
  const result = await window.Swal.fire({
    title: "Update Complaint",
    html: `<div class="space-y-3 text-left"><select id="status" class="form-select"><option value="open">open</option><option value="in progress">in progress</option><option value="resolved">resolved</option><option value="closed">closed</option></select><select id="assigned" class="form-select"><option value="">Unassigned</option>${staff.map((s) => `<option value="${s.id || s.uid}">${s.name}</option>`).join("")}</select></div>`,
    showCancelButton: true,
    confirmButtonColor: "#0f766e",
    confirmButtonText: "Save",
    preConfirm: () => ({ status: document.getElementById("status").value, assignedTo: document.getElementById("assigned").value })
  });
  if (result.isConfirmed) {
    await updateDoc(doc(db, "complaints", id), result.value);
    showAlert("Success", "Complaint updated!");
    await loadComplaints();
  }
}

async function init() {
  bindLogoutButtons();
  const profile = await ensureAuthenticated(["admin"]);
  if (!profile) return;
  setText("profileName", profile.name);
  setText("profileEmail", profile.email);
  setText("profileRole", profile.role);
  setText("dashboardGreeting", `Hello, ${profile.name}`);
  try {
    await Promise.all([loadStaff(), loadCategories(), loadComplaints()]);
  } catch (error) {
    showAlert("Error", error.message || "Failed to load");
  }
  const categoryForm = document.getElementById("categoryForm");
  if (categoryForm) {
    categoryForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(categoryForm);
      const name = String(data.get("categoryName") || "").trim();
      if (name) {
        try {
          await addDoc(collection(db, "categories"), { categoryName: name, createdAt: serverTimestamp() });
          categoryForm.reset();
          showAlert("Success", "Category added!");
          await loadCategories();
        } catch (error) {
          showAlert("Error", error.message || "Failed to add");
        }
      }
    });
  }
  const filter = document.getElementById("complaintCategoryFilter");
  if (filter) {
    filter.addEventListener("change", loadComplaints);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
