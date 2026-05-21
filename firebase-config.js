// ═══════════════════════════════════════════════════
//  firebase-config.js
//  Replace these values with your Firebase project config.
//  Found in: Firebase Console → Project Settings → Your Apps
// ═══════════════════════════════════════════════════

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Your deployed Cloud Function base URL
// After deploying functions, run: firebase functions:config:get
// It will look like: https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net
export const FUNCTIONS_BASE_URL = "https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net";
