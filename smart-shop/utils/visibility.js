const { db } = require("../config/firebase");
const { isUserSubscriptionActive } = require("./subscription");

// Everything an owner publishes carries `visibleUntil` (the owner's
// subscription expiry). Add "jobs" and "vendorCollections" here when they
// are built, and the same sync will cover them.
const LISTING_COLLECTIONS = ["products", "services"];
const BATCH_SIZE = 400;

// The value to stamp on listings: expiry date if the account is active,
// otherwise null (null = hidden everywhere).
const visibleUntilFor = (userData) =>
  isUserSubscriptionActive(userData) ? userData.subscriptionExpiry : null;

// Stamps visibleUntil on the owner's vendor profile and all their listings.
const syncOwnerVisibility = async (uid, visibleUntil) => {
  const refs = [];

  const profileRef = db.collection("vendorProfiles").doc(uid);
  const profileSnap = await profileRef.get();
  if (profileSnap.exists) refs.push(profileRef);

  for (const name of LISTING_COLLECTIONS) {
    const snap = await db.collection(name).where("vendorId", "==", uid).get();
    snap.docs.forEach((d) => refs.push(d.ref));
  }

  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    refs
      .slice(i, i + BATCH_SIZE)
      .forEach((ref) =>
        batch.update(ref, { visibleUntil: visibleUntil || null }),
      );
    await batch.commit();
  }

  return refs.length;
};

// Convenience: reads the user's account, then syncs from it.
const syncOwnerVisibilityFromAccount = async (uid) => {
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) return 0;
  return syncOwnerVisibility(uid, visibleUntilFor(userSnap.data()));
};

module.exports = {
  visibleUntilFor,
  syncOwnerVisibility,
  syncOwnerVisibilityFromAccount,
};
