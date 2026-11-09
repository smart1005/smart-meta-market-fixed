const { db, admin } = require("../config/firebase");
const { isUserSubscriptionActive } = require("../utils/subscription");

const ADMIN_ROLES = ["admin", "superAdmin"];

// Cache of uid -> vendorType, so protect() doesn't read vendorProfiles on every request.
// Entries expire after 60 seconds. Call clearVendorTypeCache(uid) whenever a
// vendor profile is created or deleted (Step 5), so changes show immediately.
const VENDOR_TYPE_TTL_MS = 60 * 1000;
const VENDOR_TYPE_CACHE_MAX = 5000;
const vendorTypeCache = new Map();

const getVendorType = async (uid) => {
  const hit = vendorTypeCache.get(uid);
  if (hit && hit.expires > Date.now()) return hit.value;

  const snap = await db.collection("vendorProfiles").doc(uid).get();
  const value = snap.exists ? snap.data().vendorType || null : null;

  if (vendorTypeCache.size >= VENDOR_TYPE_CACHE_MAX) vendorTypeCache.clear();
  vendorTypeCache.set(uid, { value, expires: Date.now() + VENDOR_TYPE_TTL_MS });
  return value;
};

const clearVendorTypeCache = (uid) => vendorTypeCache.delete(uid);

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token, access denied" });
    }

    const token = authHeader.split(" ")[1];
    const decodedToken = await admin.auth().verifyIdToken(token);

        const [userDoc, vendorType] = await Promise.all([
          db.collection("users").doc(decodedToken.uid).get(),
          getVendorType(decodedToken.uid),
        ]);

    if (!userDoc.exists) {
      return res.status(401).json({ message: "User not found" });
    }

    const userData = userDoc.data();

    req.user = {
      id: decodedToken.uid,
      email: decodedToken.email,
      role: userData.role,
      name: userData.name,
      displayName: userData.displayName,
      subscriptionStatus: userData.subscriptionStatus,
      subscriptionExpiry: userData.subscriptionExpiry,
      // "product" | "service" | null (null = not a vendor)
      vendorType: vendorType,
    };

    next();
  } catch (error) {
    res.status(401).json({ message: "Not authorized", error: error.message });
  }
};

// Real roles: "user", "admin", "superAdmin".
// Virtual roles (decided by the vendor profile, not the role field):
//   "vendor"        -> has any vendor profile
//   "productVendor" -> vendor profile of type product
//   "serviceVendor" -> vendor profile of type service
const hasAccess = (user, required) => {
  if (required === "vendor") return !!user.vendorType;
  if (required === "productVendor") return user.vendorType === "product";
  if (required === "serviceVendor") return user.vendorType === "service";
  return user.role === required;
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.some((r) => hasAccess(req.user, r))) {
      return res.status(403).json({
        message: "You don't have permission to do this",
      });
    }
    next();
  };
};

// Account-level subscription: applies to every user, admins are exempt.
const checkSubscription = async (req, res, next) => {
  try {
    if (ADMIN_ROLES.includes(req.user.role)) return next();
    if (isUserSubscriptionActive(req.user)) return next();

    // self-heal: mark expired accounts inactive
    if (req.user.subscriptionStatus === "active") {
      await db.collection("users").doc(req.user.id).update({
        subscriptionStatus: "inactive",
        inactivatedAt: new Date(),
      });
    }

    return res.status(403).json({
      message: "Your subscription has expired. Please subscribe to continue.",
      code: "SUBSCRIPTION_REQUIRED",
    });
  } catch (error) {
    res.status(500).json({
      message: "Error checking subscription",
      error: error.message,
    });
  }
};

module.exports = { protect, restrictTo, checkSubscription, clearVendorTypeCache };
