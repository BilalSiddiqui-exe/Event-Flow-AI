import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

const config = window.EVENTFLOW_FIREBASE_CONFIG || {};
const auth = getAuth(initializeApp(config));
const provider = new GoogleAuthProvider();
export const watchAuth = (callback) => onAuthStateChanged(auth, callback);
export const signIn = () => signInWithPopup(auth, provider);
export const logOut = () => signOut(auth);
export const token = () => auth.currentUser?.getIdToken();
