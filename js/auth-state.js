import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const validRoles = new Set(["student", "staff", "admin"]);
const CACHE_KEY = "_auth_profile";

let globalAuthState = {
  user: null,
  profile: null,
  isReady: false,
  readyPromise: null,
  readyResolve: null
};

globalAuthState.readyPromise = new Promise((resolve) => {
  globalAuthState.readyResolve = resolve;
});

// Try to read cached profile from sessionStorage
function readProfileCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached && validRoles.has(cached.role) && cached.uid) {
      return cached;
    }
  } catch (e) {
    // Ignore cache errors
  }
  return null;
}

// Write profile to sessionStorage
function writeProfileCache(profile) {
  try {
    if (profile) {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(profile));
    } else {
      sessionStorage.removeItem(CACHE_KEY);
    }
  } catch (e) {
    // Ignore cache errors
  }
}

// Fetch profile from Firestore
async function fetchProfileFromFirestore(user) {
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!validRoles.has(data.role)) return null;
    return {
      uid: user.uid,
      email: user.email,
      name: user.displayName || data.name || "User",
      role: data.role
    };
  } catch (error) {
    console.error("Profile fetch error:", error);
    return null;
  }
}

// Initialize auth listener - runs ONCE at module load
onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) {
      globalAuthState.user = null;
      globalAuthState.profile = null;
      writeProfileCache(null);
      globalAuthState.isReady = true;
      globalAuthState.readyResolve?.();
      return;
    }

    // Check if email is verified
    if (!user.emailVerified) {
      globalAuthState.user = user;
      globalAuthState.profile = null;
      writeProfileCache(null);
      globalAuthState.isReady = true;
      globalAuthState.readyResolve?.();
      return;
    }

    // Try cache first
    let profile = readProfileCache();
    if (profile && profile.uid === user.uid) {
      globalAuthState.user = user;
      globalAuthState.profile = profile;
      globalAuthState.isReady = true;
      globalAuthState.readyResolve?.();
      return;
    }

    // Fetch from Firestore
    profile = await fetchProfileFromFirestore(user);
    if (profile) {
      writeProfileCache(profile);
      globalAuthState.profile = profile;
    }

    globalAuthState.user = user;
    globalAuthState.isReady = true;
    globalAuthState.readyResolve?.();
  } catch (error) {
    console.error("Auth state setup error:", error);
    globalAuthState.isReady = true;
    globalAuthState.readyResolve?.();
  }
});

// Get current auth state (instant, no I/O)
export function getAuthState() {
  return {
    user: globalAuthState.user,
    profile: globalAuthState.profile,
    isAuthenticated: !!globalAuthState.profile
  };
}

// Wait for auth to be ready
export async function waitForAuthReady() {
  if (globalAuthState.isReady) {
    return getAuthState();
  }
  await globalAuthState.readyPromise;
  return getAuthState();
}

// Refresh auth state (e.g., after role change)
export async function refreshAuthState() {
  if (!auth.currentUser) {
    globalAuthState.user = null;
    globalAuthState.profile = null;
    writeProfileCache(null);
    return getAuthState();
  }

  if (!auth.currentUser.emailVerified) {
    globalAuthState.user = auth.currentUser;
    globalAuthState.profile = null;
    writeProfileCache(null);
    globalAuthState.isReady = true;
    globalAuthState.readyResolve?.();
    return getAuthState();
  }

  const profile = await fetchProfileFromFirestore(auth.currentUser);
  if (profile) {
    writeProfileCache(profile);
    globalAuthState.profile = profile;
  } else {
    globalAuthState.profile = null;
    writeProfileCache(null);
  }

  globalAuthState.user = auth.currentUser;
  globalAuthState.isReady = true;
  globalAuthState.readyResolve?.();

  return getAuthState();
}

// Logout
export async function logoutUser() {
  try {
    await signOut(auth);
    globalAuthState.user = null;
    globalAuthState.profile = null;
    writeProfileCache(null);
  } catch (error) {
    console.error("Logout error:", error);
  }
}
