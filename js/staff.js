import { db } from "./firebase.js";
import { bindLogoutButtons, ensureAuthenticated, formatDate, setText, showAlert, statusBadge } from "./common.js";
import { collection, doc, getDocs, getDocsFromCache, limit, orderBy, query, updateDoc, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let currentProfile = null;
let assignedItems = [];

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function openDetails(id) {
  const item = assignedItems.find((c) => c.id === id);
  if (!item) return;

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
        <div><p class="text-xs font-semibold text-slate-500">Created</p><p class="mt-1 text-slate-700">${safeText(formatDate(item.createdAt))}</p></div>
      </div>
    `,
    confirmButtonColor: "#0f766e",
    confirmButtonText: "Close"
  });
}

async function loadAssigned() {
  const rows = document.getElementById("assignedRows");
  if (!rows) return;

  const q = query(collection(db, "complaints"), where("assignedTo", "==", currentProfile.uid), orderBy("createdAt", "desc"), limit(50));

  const render = (items) => {
    assignedItems = items;
    if (!items.length) {
      rows.innerHTML = '<tr><td class="px-4 py-6 text-center text-slate-500" colspan="5">No assigned complaints.</td></tr>';
      return;
    }
    rows.innerHTML = items.map((c) => `
      <tr class="border-b border-slate-200">
        <td class="px-4 py-4 font-semibold text-slate-900">${c.title || "Untitled"}</td>
        <td class="px-4 py-4 text-slate-600">${c.category || "-"}</td>
        <td class="px-4 py-4"><span class="${statusBadge(c.status)}">${c.status || "open"}</span></td>
        <td class="px-4 py-4 text-slate-600">${formatDate(c.createdAt)}</td>
        <td class="px-4 py-4">
          <div class="flex flex-wrap gap-2">
            <button data-view="${c.id}" class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-700">Details</button>
            <button data-update="${c.id}" class="rounded-lg bg-teal-600 px-3 py-2 text-sm font-bold text-white hover:bg-teal-700">Update</button>
          </div>
        </td>
      </tr>
    `).join("");
    rows.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => openDetails(b.dataset.view)));
    rows.querySelectorAll("[data-update]").forEach((b) => b.addEventListener("click", () => openStatus(b.dataset.update)));
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

async function openStatus(id) {
  const result = await window.Swal.fire({
    title: "Update Status",
    input: "select",
    inputOptions: { open: "open", "in progress": "in progress", resolved: "resolved", closed: "closed" },
    showCancelButton: true,
    confirmButtonColor: "#0f766e",
    confirmButtonText: "Save"
  });
  if (result.isConfirmed) {
    await updateDoc(doc(db, "complaints", id), { status: result.value });
    showAlert("Success", "Status updated!");
    await loadAssigned();
  }
}

async function init() {
  bindLogoutButtons();
  const profile = await ensureAuthenticated(["staff"]);
  if (!profile) return;
  currentProfile = profile;
  setText("profileName", profile.name);
  setText("profileEmail", profile.email);
  setText("profileRole", profile.role);
  setText("dashboardGreeting", `Hello, ${profile.name}`);
  try {
    await loadAssigned();
  } catch (error) {
    showAlert("Error", error.message || "Failed to load");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
