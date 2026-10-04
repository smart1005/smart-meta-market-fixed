const express = require("express");
const router = express.Router();
const asyncHandler = require("../middleware/asyncHandler");
const { protect, restrictTo } = require("../middleware/authMiddleware");
const {
  initializeSubscription,
  verifySubscription,
  callbackSubscription,
  flutterwaveWebhook,
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
router.get("/callback", asyncHandler(callbackSubscription)); // This route is for Flutterwave's redirect after payment completion

// Flutterwave webhook — server-to-server, no user auth (verified via the
// verif-hash secret header inside the controller, then re-confirmed against
// Flutterwave's own verify endpoint before anything is trusted). This is the
// reliable source of truth for activating a subscription; /verify and
// /callback are UX conveniences that call the same idempotent apply logic.
router.post("/webhook", asyncHandler(flutterwaveWebhook));

module.exports = router;
