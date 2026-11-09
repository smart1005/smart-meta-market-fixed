// Mounted at /vendors/:id/reviews
const express = require("express");
const router = express.Router({ mergeParams: true });
const asyncHandler = require("../middleware/asyncHandler");
const { protect, restrictTo, checkSubscription } = require("../middleware/authMiddleware");
const { createReview, getVendorReviews } = require("../controllers/reviewController");

router.get("/", asyncHandler(getVendorReviews));
router.post("/", protect, restrictTo("user"), checkSubscription, asyncHandler(createReview));

module.exports = router;
