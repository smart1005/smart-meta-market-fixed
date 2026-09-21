const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const admin = require("firebase-admin");

let serviceAccount;

try {
  serviceAccount = require("../serviceAccountKey.json");
} catch (error) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    throw new Error(
      "Missing Firebase Admin credentials. Add serviceAccountKey.json or set FIREBASE_SERVICE_ACCOUNT_JSON.",
    );
  }
}

initializeApp({
  credential: cert(serviceAccount),
  projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
});

const db = getFirestore();

module.exports = { db, admin };
