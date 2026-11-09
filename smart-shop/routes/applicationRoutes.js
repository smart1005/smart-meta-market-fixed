const express = require("express");
const router = express.Router();
const asyncHandler = require("../middleware/asyncHandler");
const {
  protect,
  restrictTo,
  checkSubscription,
} = require("../middleware/authMiddleware");
const {
  getMyApplications,
  contactApplicant,
  withdrawApplication,
} = require("../controllers/jobController");

router.get("/mine", protect, restrictTo("user"), asyncHandler(getMyApplications));
router.post("/:id/contact", protect, restrictTo("user"), checkSubscription, asyncHandler(contactApplicant));
router.delete("/:id", protect, restrictTo("user"), asyncHandler(withdrawApplication));

module.exports = router;
