require("dotenv").config();
const { db, admin } = require("../config/firebase");

/**
 * One-time migration: backfills vendorProfiles/{uid} for any vendor
 * accounts created before the users/vendorProfiles split.
 *
 * Finds every users/{uid} doc with role === "vendor" that still has
 * business fields sitting on it (businessName, subscriptionStatus, etc.)
 * and copies those fields into a new vendorProfiles/{uid} doc, then
 * strips them off the users doc so it matches the new shape.
 *
 * Safe to re-run: skips any vendor that already has a vendorProfiles doc.
 *
 * Usage: npm run migrate:vendor-profiles
 */
const VENDOR_PROFILE_FIELDS = [
  "businessName",
  "vendorType",
  "location",
  "subscriptionStatus",
  "subscriptionExpiry",
  "lastPayment",
  "whatsapp",
  "availability",
  "certification",
  "about",
  "profileImage",
  "certificationImages",
  "portfolioImages",
];

const migrate = async () => {
  try {
    const usersSnapshot = await db
      .collection("users")
      .where("role", "==", "vendor")
      .get();

    if (usersSnapshot.empty) {
      console.log("No vendor accounts found — nothing to migrate.");
      process.exit(0);
    }

    let migrated = 0;
    let skipped = 0;

    for (const userDoc of usersSnapshot.docs) {
      const uid = userDoc.id;
      const existingProfile = await db
        .collection("vendorProfiles")
        .doc(uid)
        .get();

      if (existingProfile.exists) {
        skipped++;
        continue;
      }

      const userData = userDoc.data();
      const profileData = {};
      const fieldsToRemove = {};

      for (const field of VENDOR_PROFILE_FIELDS) {
        if (userData[field] !== undefined) {
          profileData[field] = userData[field];
          fieldsToRemove[field] = admin.firestore.FieldValue.delete();
        }
      }

      if (Object.keys(profileData).length === 0) {
        // Nothing to migrate for this vendor — maybe already clean, or an
        // incomplete signup. Create an empty-ish profile so checkSubscription
        // etc. don't 404 on them; flag it for manual review.
        console.log(
          `Vendor ${uid} has no legacy business fields on users — creating a minimal vendorProfiles doc for review.`,
        );
        await db
          .collection("vendorProfiles")
          .doc(uid)
          .set({
            subscriptionStatus: "inactive",
            createdAt:
              userData.createdAt ||
              admin.firestore.Timestamp.fromDate(new Date()),
          });
        migrated++;
        continue;
      }

      profileData.createdAt =
        userData.createdAt || admin.firestore.Timestamp.fromDate(new Date());

      await db.collection("vendorProfiles").doc(uid).set(profileData);
      await db.collection("users").doc(uid).update(fieldsToRemove);

      migrated++;
      console.log(`Migrated vendor ${uid}`);
    }

    console.log(
      `Done. Migrated: ${migrated}, already had a profile (skipped): ${skipped}`,
    );
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
};

migrate();
