const { db } = require("../config/firebase");
const logger = require("./logger");

const isGenuinelyActive = (vendorId, profileData) => {
  if (!profileData || profileData.subscriptionStatus !== "active") return false;

  const raw = profileData.subscriptionExpiry;
  const expiry = raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null;
  const now = new Date();

  if (!expiry || isNaN(expiry.getTime()) || expiry < now) {
        db.collection("vendorProfiles")
          .doc(vendorId)
          .update({
            subscriptionStatus: "inactive",
            inactivatedAt: new Date(),
          })
          .catch((err) =>
            logger.error("Failed to self-heal stale vendor status:", err),
          );
    return false;
  }

  return true;
};

const filterGenuinelyActive = (docs) =>
  docs.filter((doc) => isGenuinelyActive(doc.id, doc.data()));

module.exports = { isGenuinelyActive, filterGenuinelyActive };
