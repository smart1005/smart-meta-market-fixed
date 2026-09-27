require("dotenv").config();
const { admin, db } = require("../config/firebase");

const run = async () => {
  try {
    const email = process.env.RESET_EMAIL;
    const newPassword = process.env.RESET_NEW_PASSWORD;

    if (!email || !newPassword) {
      console.error(
        "Set RESET_EMAIL and RESET_NEW_PASSWORD env vars before running.",
      );
      process.exit(1);
    }

    const userRecord = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(userRecord.uid, { password: newPassword });

    const userDoc = await db.collection("users").doc(userRecord.uid).get();
    const role = userDoc.exists ? userDoc.data().role : "(no users doc found)";

    console.log(
      `Password reset for ${email} (uid: ${userRecord.uid}, role: ${role})`,
    );
    process.exit(0);
  } catch (error) {
    console.error("Reset failed:", error.message);
    process.exit(1);
  }
};

run();
