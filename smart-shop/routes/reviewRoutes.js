// Mounted at /reviews
const express = require("express");
const router = express.Router();
const asyncHandler = require("../middleware/asyncHandler");
const { protect, restrictTo } = require("../middleware/authMiddleware");
const {
  updateReview,
  deleteReview,
  replyToReview,
  deleteReply,
} = require("../controllers/reviewController");

router.patch("/:id", protect, restrictTo("user"), asyncHandler(updateReview));
router.delete("/:id", protect, restrictTo("user", "admin", "superAdmin"), asyncHandler(deleteReview));
router.post("/:id/reply", protect, restrictTo("vendor"), asyncHandler(replyToReview));
router.delete("/:id/reply", protect, restrictTo("vendor", "admin", "superAdmin"), asyncHandler(deleteReply));

module.exports = router;
