const express = require("express");
const router = express.Router();
const asyncHandler = require("../middleware/asyncHandler");
const { protect, restrictTo } = require("../middleware/authMiddleware");
const {
  initializeSubscription,
  verifySubscription,
  callbackSubscription,
  paystackWebhook,
} = require("../controllers/paymentController");

router.post(
  "/subscribe",
  protect,
  restrictTo("vendor"),
  asyncHandler(initializeSubscription),
);
router.get(
  "/verify/:reference",
  protect,
  restrictTo("vendor"),
  asyncHandler(verifySubscription),
);
router.get(
  "/callback",
  asyncHandler(callbackSubscription),
); // This route is for Paystack's callback after payment completion

// Paystack webhook — server-to-server, no user auth (verified via HMAC
// signature inside the controller instead). This is the reliable source
// of truth for activating a subscription; /verify and /callback are UX
// conveniences that call the same idempotent apply logic.
router.post("/webhook", asyncHandler(paystackWebhook));

module.exports = router;
