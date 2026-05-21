// ═══════════════════════════════════════════════════
//  firebase-config.js
//  Replace these values with your Firebase project config.
//  Found in: Firebase Console → Project Settings → Your Apps
// ═══════════════════════════════════════════════════

export const firebaseConfig = {
  apiKey: "AIzaSyB3iLybxwhnRlEVm4Ue4CSGc_tszDXiG8M",
  authDomain: "veterinary-seo-audit-tool.firebaseapp.com",
  projectId: "veterinary-seo-audit-tool",
  storageBucket: "veterinary-seo-audit-tool.firebasestorage.app",
  messagingSenderId: "567401292058",
  appId: "1:567401292058:web:72c48992f21f6a03e44ca3"
  measurementId: "G-F9S42Q8NT8"
};

// Your deployed Cloud Function base URL
// After deploying functions, run: firebase functions:config:get
// It will look like: https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net
export const FUNCTIONS_BASE_URL = "https://us-central1-veterinary-seo-audit-tool.cloudfunctions.net";
