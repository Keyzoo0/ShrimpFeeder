import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import {
  Firestore,
  getFirestore,
  initializeFirestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const rtdb = getDatabase(app);

// Paksa transport long-polling. Mencegah bug WebChannel Firestore
// "INTERNAL ASSERTION FAILED: Unexpected state" yang muncul pada listener
// onSnapshot (mis. di balik proxy/extension atau React StrictMode di dev).
// Bungkus try/catch agar aman terhadap Hot Module Reload (init ganda).
let firestore: Firestore;
try {
  firestore = initializeFirestore(app, {
    experimentalForceLongPolling: true,
  });
} catch {
  firestore = getFirestore(app);
}

export const db = firestore;
export default app;
