import { db } from "./firebase.js";
import { bindLogoutButtons, ensureAuthenticated, formatDate, statusBadge, showAlert } from "./common.js";
import { addDoc, collection, getDocs, getDocsFromCache, limit, orderBy, query, serverTimestamp, updateDoc, doc, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let currentProfile = null;
let complaintItems = [];
let staffOptionsCache = null;

function isPerfDebugEnabled() {
  try {
    return localStorage.getItem("cc_debug_perf") === "1";
  } catch {
    return false;
  }
}

function perfLog(label, startedAt) {
  if (!isPerfDebugEnabled() || typeof performance === "undefined") return;
  const delta = performance.now() - startedAt;
  console.info(`[CampusCare] ${label}: ${delta.toFixed(0)}ms`);
}

const complaintsRouteByRole = {
  student: "/student-complaints.html",
  staff: "/staff-complaints.html",
  admin: "/admin-complaints.html"
};

function getActiveCategoryFilter() {
  return document.getElementById("complaintCategoryFilter")?.value || "";
}

function getVisibleComplaints() {
  const filter = getActiveCategoryFilter();
  if (currentProfile?.role === "student" && filter) {
    return complaintItems.filter((item) => item.category === filter);
  }

  return complaintItems;
}

function renderComplaints(items) {
  const rows = document.getElementById("complaintRows");
  if (!rows) return;

  if (!items.length) {
    rows.innerHTML = '<tr><td class="px-4 py-6 text-center text-slate-500" colspan="5">No complaints.</td></tr>';
    return;
  }

  rows.innerHTML = items.map((c) => {
    let action;
    if (currentProfile.role === "admin") {
      action = `<div class="flex flex-wrap gap-2"><button data-details="${c.id}" class="rounded-lg bg-teal-600 px-3 py-2 text-sm font-bold text-white hover:bg-teal-700">Details</button><button data-manage="${c.id}" class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-700">Manage</button></div>`;
    } else if (currentProfile.role === "staff") {
      action = `<div class="flex flex-wrap gap-2"><button data-details="${c.id}" class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-700">Details</button><button data-update="${c.id}" class="rounded-lg bg-teal-600 px-3 py-2 text-sm font-bold text-white hover:bg-teal-700">Update</button></div>`;
    } else {
      action = String(c.status || "").toLowerCase().includes("resolve") ? `<button data-feedback="${c.id}" class="rounded-lg bg-teal-600 px-3 py-2 text-sm font-bold text-white hover:bg-teal-700">Feedback</button>` : '<span class="text-sm text-slate-400">Pending</span>';
    }

    return `<tr class="border-b border-slate-200"><td class="px-4 py-4 font-semibold text-slate-900" data-label="Title">${c.title || "Untitled"}</td><td class="px-4 py-4 text-slate-600" data-label="Category">${c.category || "-"}</td><td class="px-4 py-4" data-label="Status"><span class="${statusBadge(c.status)}">${c.status || "open"}</span></td><td class="px-4 py-4 text-slate-600" data-label="Created">${formatDate(c.createdAt)}</td><td class="px-4 py-4" data-label="Action">${action}</td></tr>`;
  }).join("");

  rows.querySelectorAll("[data-feedback]").forEach((b) => b.addEventListener("click", () => openFeedback(b.dataset.feedback)));
  rows.querySelectorAll("[data-update]").forEach((b) => b.addEventListener("click", () => openStatus(b.dataset.update)));
  rows.querySelectorAll("[data-manage]").forEach((b) => b.addEventListener("click", () => openAdmin(b.dataset.manage)));
  rows.querySelectorAll("[data-details]").forEach((b) => b.addEventListener("click", () => openDetails(b.dataset.details)));
}

function refreshComplaintsView() {
  renderComplaints(getVisibleComplaints());
}

async function getStaffOptions() {
  if (Array.isArray(staffOptionsCache)) {
    return staffOptionsCache;
  }

  const staffSnap = await getDocs(query(collection(db, "users"), where("role", "==", "staff")));
  staffOptionsCache = staffSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return staffOptionsCache;
}

async function loadComplaints() {
  const rows = document.getElementById("complaintRows");
  if (!rows) return;

  let q;
  if (currentProfile.role === "admin") {
    q = query(collection(db, "complaints"), orderBy("createdAt", "desc"), limit(100));
  } else if (currentProfile.role === "staff") {
    q = query(collection(db, "complaints"), where("assignedTo", "==", currentProfile.uid), orderBy("createdAt", "desc"), limit(50));
  } else {
    q = query(collection(db, "complaints"), where("userId", "==", currentProfile.uid), orderBy("createdAt", "desc"), limit(50));
  }

  const startedAt = typeof performance !== "undefined" ? performance.now() : 0;

  let renderedFromCache = false;
  try {
    const cachedSnap = await getDocsFromCache(q);
    if (cachedSnap?.docs?.length) {
      complaintItems = cachedSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      refreshComplaintsView();
      renderedFromCache = true;
      perfLog("Complaints cache render", startedAt);
    }
  } catch {
    // Cache miss is normal on first load.
  }

  const fetchFresh = async () => {
    const snap = await getDocs(q);
    complaintItems = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    refreshComplaintsView();
    perfLog("Complaints fresh fetch", startedAt);
  };

  if (renderedFromCache) {
    fetchFresh().catch((error) => console.warn("Fresh complaints fetch failed:", error));
    return;
  }

  await fetchFresh();
}

async function loadCategories() {
  const filter = document.getElementById("complaintCategoryFilter");
  if (!filter) return;
  const startedAt = typeof performance !== "undefined" ? performance.now() : 0;

  const catsFromSnap = (snap) => snap.docs.map((d) => d.data().categoryName).filter(Boolean);
  const renderCats = (cats) => {
    filter.innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option value="${c}">${c}</option>`).join("");
  };

  let renderedFromCache = false;
  try {
    const cached = await getDocsFromCache(query(collection(db, "categories")));
    if (cached?.docs?.length) {
      renderCats(catsFromSnap(cached));
      renderedFromCache = true;
      perfLog("Categories cache render", startedAt);
    }
  } catch {
    // ignore cache miss
  }

  const fetchFresh = async () => {
    const snap = await getDocs(collection(db, "categories"));
    renderCats(catsFromSnap(snap));
    perfLog("Categories fresh fetch", startedAt);
  };

  if (renderedFromCache) {
    fetchFresh().catch((error) => console.warn("Fresh categories fetch failed:", error));
    return;
  }

  await fetchFresh();
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function openDetails(id) {
  const item = complaintItems.find((c) => c.id === id);
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

async function openFeedback(id) {
  const result = await window.Swal.fire({
    title: "Complaint Feedback",
    html: '<div class="space-y-3 text-left"><textarea id="msg" class="form-textarea" rows="4" placeholder="Your feedback"></textarea><input id="rating" class="form-input" type="number" min="1" max="5" value="5" /></div>',
    showCancelButton: true,
    confirmButtonText: "Submit",
    confirmButtonColor: "#0f766e",
    preConfirm: () => ({ message: document.getElementById("msg").value, rating: Number(document.getElementById("rating").value || 5) })
  });
  if (result.isConfirmed) {
    await addDoc(collection(db, "feedback"), { complaintId: id, message: result.value.message, rating: result.value.rating });
    showAlert("Success", "Feedback submitted!");
  }
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

    const updated = complaintItems.find((item) => item.id === id);
    if (updated) {
      updated.status = result.value;
      refreshComplaintsView();
    }

    showAlert("Success", "Status updated!");
  }
}

async function openAdmin(id) {
  const staff = await getStaffOptions();
  const result = await window.Swal.fire({
    title: "Update Complaint",
    html: `<div class="space-y-3 text-left"><select id="status" class="form-select"><option value="open">open</option><option value="in progress">in progress</option><option value="resolved">resolved</option><option value="closed">closed</option></select><select id="assigned" class="form-select"><option value="">Unassigned</option>${staff.map((s) => `<option value="${s.id}">${s.name || "Staff"}</option>`).join("")}</select></div>`,
    showCancelButton: true,
    confirmButtonColor: "#0f766e",
    confirmButtonText: "Save",
    preConfirm: () => ({ status: document.getElementById("status").value, assignedTo: document.getElementById("assigned").value })
  });
  if (result.isConfirmed) {
    await updateDoc(doc(db, "complaints", id), result.value);

    const updated = complaintItems.find((item) => item.id === id);
    if (updated) {
      updated.status = result.value.status;
      updated.assignedTo = result.value.assignedTo;
      refreshComplaintsView();
    }

    showAlert("Success", "Complaint updated!");
  }
}

async function init() {
  const initStartedAt = typeof performance !== "undefined" ? performance.now() : 0;
  bindLogoutButtons();
  const profile = await ensureAuthenticated([]);
  if (!profile) return;
  currentProfile = profile;
  perfLog("Auth ready", initStartedAt);

  const expectedPath = complaintsRouteByRole[currentProfile.role] || "/index.html";
  if (window.location.pathname !== expectedPath) {
    window.location.replace(expectedPath);
    return;
  }

  const loadingTasks = [loadComplaints()];

  if (currentProfile.role === "student") {
    loadingTasks.push(loadCategories());
  } else {
    const filter = document.getElementById("complaintCategoryFilter");
    if (filter?.parentElement) filter.parentElement.style.display = "none";
  }

  try {
    await Promise.all(loadingTasks);
  } catch (error) {
    showAlert("Error", error.message || "Failed to load");
  }

  perfLog("Page init complete", initStartedAt);
  const filterEl = document.getElementById("complaintCategoryFilter");
  if (filterEl && currentProfile.role === "student") {
    filterEl.addEventListener("change", refreshComplaintsView);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
