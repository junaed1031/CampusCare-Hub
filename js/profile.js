import { bindLogoutButtons, ensureAuthenticated, setText } from "./common.js";

const profileRouteByRole = {
  student: "/student-profile.html",
  staff: "/staff-profile.html",
  admin: "/admin-profile.html"
};

async function init() {
  bindLogoutButtons();
  const profile = await ensureAuthenticated([]);
  if (!profile) return;

  const expectedPath = profileRouteByRole[profile.role] || "/index.html";
  if (window.location.pathname !== expectedPath) {
    window.location.replace(expectedPath);
    return;
  }

  setText("profileName", profile.name || "-");
  setText("profileEmail", profile.email || "-");
  setText("profileRole", profile.role || "-");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
