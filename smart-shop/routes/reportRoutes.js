// Mounted at /reports
const express = require("express");
const router = express.Router();
const asyncHandler = require("../middleware/asyncHandler");
const { protect, restrictTo } = require("../middleware/authMiddleware");
const {
  createReport,
  getReports,
  getReport,
  updateReport,
} = require("../controllers/reportController");

// any signed-in user can report
router.post("/", protect, restrictTo("user"), asyncHandler(createReport));

// moderation queue: admins only
router.get("/", protect, restrictTo("admin", "superAdmin"), asyncHandler(getReports));
router.get("/:id", protect, restrictTo("admin", "superAdmin"), asyncHandler(getReport));
router.patch("/:id", protect, restrictTo("admin", "superAdmin"), asyncHandler(updateReport));

module.exports = router;
