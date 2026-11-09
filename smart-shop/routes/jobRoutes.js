const express = require("express");
const router = express.Router();
const asyncHandler = require("../middleware/asyncHandler");
const {
  protect,
  restrictTo,
  checkSubscription,
} = require("../middleware/authMiddleware");
const {
  createJob,
  getJobs,
  getJobById,
  getMyJobs,
  updateJob,
  deleteJob,
  applyToJob,
  getJobApplications,
} = require("../controllers/jobController");

router.get("/", asyncHandler(getJobs));
router.get("/mine", protect, restrictTo("user"), asyncHandler(getMyJobs));
router.post("/", protect, restrictTo("user"), checkSubscription, asyncHandler(createJob));
router.get("/:id", asyncHandler(getJobById));
router.patch("/:id", protect, restrictTo("user"), checkSubscription, asyncHandler(updateJob));
router.delete("/:id", protect, restrictTo("user", "admin", "superAdmin"), asyncHandler(deleteJob));
router.post("/:id/apply", protect, restrictTo("user"), checkSubscription, asyncHandler(applyToJob));
router.get("/:id/applications", protect, restrictTo("user"), asyncHandler(getJobApplications));

module.exports = router;
