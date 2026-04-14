import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD7qgrS_S6S2RkLvlXSkAIHql_cW240QJY",
  authDomain: "campus-care-hub.firebaseapp.com",
  projectId: "campus-care-hub",
  storageBucket: "campus-care-hub.firebasestorage.app",
  messagingSenderId: "329403790169",
  appId: "1:329403790169:web:445b6f9725783887c21248"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Enable offline persistence for faster loads
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === "failed-precondition") {
    console.log("Multiple tabs open");
  } else if (err.code === "unimplemented") {
    console.log("Browser does not support persistence");
  }
});

export { firebaseConfig };
