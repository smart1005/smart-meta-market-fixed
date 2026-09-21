require("dotenv").config();
const { db, admin } = require("../config/firebase");

/**
 * One-time bootstrap script: creates the very first superAdmin account.
 *
 * Why this exists: every route that creates an admin/superAdmin
 * (POST /auth/create-admin, /auth/create-superAdmin) correctly requires
 * you to already BE a superAdmin — which means there's no way to create
 * the first one through the API. Run this once, from the command line,
 * to bootstrap that account.
 *
 * Usage:
 *   SUPERADMIN_EMAIL=you@example.com SUPERADMIN_PASSWORD=... npm run seed:superadmin
 *
 * Safe to re-run: exits without creating a duplicate if a superAdmin
 * already exists.
 */
const seedSuperAdmin = async () => {
  try {
    const email = process.env.SUPERADMIN_EMAIL;
    const password = process.env.SUPERADMIN_PASSWORD;
    const name = process.env.SUPERADMIN_NAME || "Super Admin";

    if (!email || !password) {
      console.error(
        "Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD env vars before running this script.",
      );
      process.exit(1);
    }

    const existing = await db
      .collection("users")
      .where("role", "==", "superAdmin")
      .limit(1)
      .get();

    if (!existing.empty) {
      console.log(
        "A superAdmin account already exists — not creating another. " +
          "Use POST /auth/create-superAdmin (logged in as that account) if you need more.",
      );
      process.exit(0);
    }

    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: name,
      emailVerified: true, // bootstrap account — skip the email verification flow
    });

    await db.collection("users").doc(userRecord.uid).set({
      name,
      email,
      role: "superAdmin",
      createdAt: new Date(),
    });

    console.log(
      `SuperAdmin account created successfully: ${email} (${userRecord.uid})`,
    );
    process.exit(0);
  } catch (error) {
    console.error("Error seeding superAdmin:", error.message);
    process.exit(1);
  }
};

seedSuperAdmin();
