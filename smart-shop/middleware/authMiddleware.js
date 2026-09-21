const { db, admin } = require("../config/firebase");

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token, access denied" });
    }

    const token = authHeader.split(" ")[1];
    const decodedToken = await admin.auth().verifyIdToken(token);

    const userDoc = await db.collection("users").doc(decodedToken.uid).get();

    if (!userDoc.exists) {
      return res.status(401).json({ message: "User not found" });
    }

    const userData = userDoc.data();

    req.user = {
      id: decodedToken.uid,
      email: decodedToken.email,
      role: userData.role,
      name: userData.name,
    };

    next();
  } catch (error) {
    res.status(401).json({ message: "Not authorized", error: error.message });
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "You don't have permission to do this",
      });
    }
    next();
  };
};

const checkSubscription = async (req, res, next) => {
  try {
    // only applies to vendors
    if (req.user.role !== "vendor") return next();

    const vendorDoc = await db.collection("vendorProfiles").doc(req.user.id).get();
    if (!vendorDoc.exists) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    const vendorData = vendorDoc.data();

    if (vendorData.subscriptionStatus !== "active") {
      return res.status(403).json({
        message:
          "Your subscription is inactive. Please pay to continue listing.",
      });
    }

    const now = new Date();
    let expiry = null;
    if (vendorData.subscriptionExpiry) {
      if (typeof vendorData.subscriptionExpiry.toDate === "function") {
        expiry = vendorData.subscriptionExpiry.toDate();
      } else if (vendorData.subscriptionExpiry instanceof Date) {
        expiry = vendorData.subscriptionExpiry;
      } else {
        const parsed = new Date(vendorData.subscriptionExpiry);
        expiry = isNaN(parsed) ? null : parsed;
      }
    }

    if (!expiry || expiry < now) {
      // auto update status to inactive in Firestore only if currently active
      if (vendorData.subscriptionStatus === "active") {
               await db.collection("vendorProfiles").doc(req.user.id).update({
                 subscriptionStatus: "inactive",
                 inactivatedAt: new Date(),
               });
      }
      return res.status(403).json({
        message:
          "Your subscription has expired. Please renew to continue listing.",
      });
    }

    next();
  } catch (error) {
    res.status(500).json({
      message: "Error checking subscription",
      error: error.message,
    });
  }
};

module.exports = { protect, restrictTo, checkSubscription };
