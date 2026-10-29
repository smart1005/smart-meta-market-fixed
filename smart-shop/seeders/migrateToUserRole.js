require("dotenv").config();
const { db } = require("../config/firebase");
const { visibleUntilFor, syncOwnerVisibility } = require("../utils/visibility");

/**
 * One-time migration: turns every existing vendor into a general user.
 *
 * For each users/{uid} doc with role === "vendor":
 *   - role becomes "user"
 *   - subscriptionStatus / subscriptionExpiry / lastPayment are copied UP
 *     from vendorProfiles/{uid} onto the user doc (account-level subscription)
 *   - the vendorProfiles doc is NOT touched, so products, services,
 *     storefronts and business data stay exactly as they are
 *
 * Customers, admins and superAdmins are never touched.
 * Safe to re-run: vendors already migrated no longer have role "vendor".
 *
 * Default is a DRY RUN (prints only, writes nothing).
 * Usage:
 *   npm run migrate:user-role            (dry run)
 *   npm run migrate:user-role -- --apply (writes changes)
 */
const APPLY = process.argv.includes("--apply");

const run = async () => {
  console.log(APPLY ? "MODE: APPLY (writing changes)" : "MODE: DRY RUN");

  const snap = await db.collection("users").where("role", "==", "vendor").get();
  console.log(`Found ${snap.size} vendor account(s) to migrate.\n`);

  let batch = db.batch();
  let pendingOps = 0;
  let noSubscription = 0;

  for (const doc of snap.docs) {
    const user = doc.data();
    const profileSnap = await db.collection("vendorProfiles").doc(doc.id).get();
    const profile = profileSnap.exists ? profileSnap.data() : {};

    // Prefer the vendor profile's subscription; fall back to the user doc
    const source = profile.subscriptionStatus ? profile : user;

    const update = { role: "user", migratedToUserAt: new Date() };

    if (source.subscriptionStatus) {
      update.subscriptionStatus = source.subscriptionStatus;
      update.subscriptionExpiry = source.subscriptionExpiry || null;
    } else {
      update.subscriptionStatus = "inactive";
      noSubscription++;
    }
    if (source.lastPayment) update.lastPayment = source.lastPayment;

    const visibleUntil = visibleUntilFor({
      subscriptionStatus: update.subscriptionStatus,
      subscriptionExpiry: update.subscriptionExpiry,
    });

    console.log(
      `${doc.id} | ${user.email || "no email"} | profile: ${
        profileSnap.exists ? profile.vendorType || "?" : "MISSING"
      } | status: ${update.subscriptionStatus}`,
    );

    if (APPLY) {
      batch.update(doc.ref, update);
      await syncOwnerVisibility(doc.id, visibleUntil);
      pendingOps++;
      if (pendingOps === 400) {
        await batch.commit();
        batch = db.batch();
        pendingOps = 0;
      }
    }
  }

  if (APPLY && pendingOps > 0) await batch.commit();

  console.log(
    `\nDone. ${snap.size} vendor(s) ${APPLY ? "migrated" : "would be migrated"}.` +
      (noSubscription
        ? ` ${noSubscription} had no subscription data (set to inactive).`
        : ""),
  );
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
