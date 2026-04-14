import { getAuthState, waitForAuthReady, logoutUser } from "./auth-state.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

let logoutInProgress = false;

// Show alerts
export function showAlert(title, text, icon = "info") {
  if (window.Swal) {
    return window.Swal.fire({ title, text, icon, confirmButtonColor: "#0f766e" });
  }
  window.alert(`${title}: ${text}`);
}

// Handle logout
export async function handleLogout() {
  if (logoutInProgress) return;
  logoutInProgress = true;

  try {
    await logoutUser();
  } catch (error) {
    console.error("Logout failed:", error);
  }

  logoutInProgress = false;
  window.location.href = "/index.html";
}

// Bind logout buttons
export function bindLogoutButtons() {
  document.querySelectorAll("[data-logout]").forEach((btn) => {
    if (btn.dataset.logoutBound === "1") return;
    btn.dataset.logoutBound = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      handleLogout();
    });
  });
}

// Get current profile (instant, no I/O)
export function getCurrentUserProfile() {
  return getAuthState().profile;
}

// Ensure authenticated
export async function ensureAuthenticated(allowedRoles = []) {
  const state = await waitForAuthReady();

  if (!state.isAuthenticated) {
    window.location.href = "/index.html";
    return null;
  }

  if (allowedRoles.length && !allowedRoles.includes(state.profile.role)) {
    redirectByRole(state.profile.role);
    return null;
  }

  return state.profile;
}

// Redirect based on role
export function redirectByRole(role) {
  const routes = {
    student: "/student-dashboard.html",
    admin: "/admin-dashboard.html",
    staff: "/staff-dashboard.html"
  };
  window.location.replace(routes[role] || "/index.html");
}

// Configure navigation for role
export function configureNavigationForRole() {
  const profile = getAuthState().profile;
  if (!profile) return;

  const navMap = {
    student: { dashboard: "/student-dashboard.html", submit: "/submit-complaint.html", complaints: "/student-complaints.html", profile: "/student-profile.html" },
    staff: { dashboard: "/staff-dashboard.html", complaints: "/staff-complaints.html", profile: "/staff-profile.html" },
    admin: { dashboard: "/admin-dashboard.html", complaints: "/admin-complaints.html", profile: "/admin-profile.html" }
  };

  const links = navMap[profile.role];
  const allNavLinks = document.querySelectorAll("[data-role-nav]");
  allNavLinks.forEach((link) => {
    link.hidden = true;
  });

  if (links) {
    Object.entries(links).forEach(([key, href]) => {
      document.querySelectorAll(`[data-nav="${key}"]`).forEach((el) => {
        el.href = href;
        el.hidden = false;
      });
    });
  }

  bindLogoutButtons();
}

// Set text
export function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// Status badge
export function statusBadge(status) {
  const norm = String(status || "open").toLowerCase();
  if (norm.includes("progress")) return "badge badge-progress";
  if (norm.includes("resolve")) return "badge badge-resolved";
  if (norm.includes("close")) return "badge badge-closed";
  return "badge badge-open";
}

// Format date
export function formatDate(value) {
  if (!value) return "-";
  const date = value.toDate ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
