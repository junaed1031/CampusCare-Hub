import { auth, db } from "./firebase.js";
import { refreshAuthState } from "./auth-state.js";
import { showAlert, redirectByRole } from "./common.js";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const validRoles = new Set(["student", "staff", "admin"]);
const selfServiceRoles = new Set(["student", "staff"]);

function setFormLoading(form, isLoading, buttonLabel) {
  if (!form) return;
  form.setAttribute("aria-busy", isLoading ? "true" : "false");

  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) {
    if (isLoading) {
      if (!submitButton.dataset.originalLabel) {
        submitButton.dataset.originalLabel = submitButton.textContent || "";
      }
      submitButton.textContent = buttonLabel;
      submitButton.classList.add("btn-loading");
      submitButton.disabled = true;
    } else {
      submitButton.textContent = submitButton.dataset.originalLabel || submitButton.textContent;
      submitButton.classList.remove("btn-loading");
      submitButton.disabled = false;
    }
  }

  form.querySelectorAll("input, select, textarea").forEach((el) => {
    el.disabled = !!isLoading;
  });
}

function getErrorMessage(error) {
  const code = String(error?.code || "");
  const messages = {
    "auth/email-already-in-use": "This email is already registered.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/operation-not-allowed": "Email/password sign-in is disabled.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/invalid-login-credentials": "Email or password is incorrect.",
    "auth/user-not-found": "Email or password is incorrect.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/network-request-failed": "Network error. Check your connection."
  };
  return messages[code] || error?.message || "Authentication failed.";
}

async function saveUserProfile(user, name, role) {
  const chosenRole = selfServiceRoles.has(role) ? role : "student";
  await setDoc(doc(db, "users", user.uid), {
    name,
    email: user.email,
    role: chosenRole,
    createdAt: serverTimestamp()
  });
}

export async function registerUser({ name, email, password, role }) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  try {
    await updateProfile(credential.user, { displayName: name });
    await saveUserProfile(credential.user, name, role);
    await sendEmailVerification(credential.user);
    return credential.user;
  } catch (error) {
    await signOut(auth).catch(() => {});
    throw error;
  }
}

export async function loginUser({ email, password }) {
  const credential = await signInWithEmailAndPassword(auth, email, password);

  if (!credential.user.emailVerified) {
    await sendEmailVerification(credential.user).catch(() => {});
    await signOut(auth);
    throw new Error("Please verify your email before logging in. We sent a verification email.");
  }

  // Refresh global auth state with the new profile (single Firestore read)
  const state = await refreshAuthState();
  if (!state.isAuthenticated || !validRoles.has(state.profile.role)) {
    await signOut(auth);
    throw new Error("Account profile missing or invalid. Contact admin.");
  }

  redirectByRole(state.profile.role);
  return credential.user;
}

// Setup auth page
function setupAuthPage() {
  (async () => {
    // Bind login form
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
      loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = loginForm.email?.value?.trim();
        const password = loginForm.password?.value;

        if (!email || !password) {
          showAlert("Error", "Enter email and password");
          return;
        }

        try {
          setFormLoading(loginForm, true, "Logging in…");
          await loginUser({ email, password });
        } catch (error) {
          showAlert("Login Failed", getErrorMessage(error));
        } finally {
          setFormLoading(loginForm, false, "Login");
        }
      });
    }

    // Bind register form
    const registerForm = document.getElementById("registerForm");
    if (registerForm) {
      registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = registerForm.name?.value?.trim();
        const email = registerForm.email?.value?.trim();
        const password = registerForm.password?.value;
        const confirm = registerForm.confirm?.value;
        const role = String(registerForm.role?.value || "student");

        if (!name || !email || !password) {
          showAlert("Error", "All fields are required");
          return;
        }

        if (!confirm) {
          showAlert("Error", "Please confirm your password");
          return;
        }

        if (password !== confirm) {
          showAlert("Error", "Passwords do not match");
          return;
        }

        if (password.length < 6) {
          showAlert("Error", "Password must be at least 6 characters");
          return;
        }

        try {
          setFormLoading(registerForm, true, "Creating account…");
          await registerUser({ name, email, password, role });
          showAlert("Success", "Account created! Check your email to verify.");
          registerForm.reset();
        } catch (error) {
          showAlert("Registration Failed", getErrorMessage(error));
        } finally {
          setFormLoading(registerForm, false, "Register");
        }
      });
    }
  })();
}

// Run on auth pages
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupAuthPage);
} else {
  setupAuthPage();
}
