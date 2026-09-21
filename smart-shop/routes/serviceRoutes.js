const express = require("express");
const router = express.Router();
const asyncHandler = require("../middleware/asyncHandler");
const { uploadService } = require("../config/cloudinary");
const {
  protect,
  restrictTo,
  checkSubscription,
} = require("../middleware/authMiddleware");
const {
  addService,
  getServices,
  getServiceById,
  updateService,
  deleteService,
  getJobTitles,
} = require("../controllers/serviceController");

router.get("/job-titles", asyncHandler(getJobTitles));
router.get("/", asyncHandler(getServices));
router.get("/:id", asyncHandler(getServiceById));
router.post(
  "/",
  protect,
  restrictTo("vendor"),
  checkSubscription,
  uploadService.fields([
    { name: "images", maxCount: 10 },
    { name: "images[]", maxCount: 10 },
    { name: "image", maxCount: 1 },
  ]),
  asyncHandler(addService),
);
router.put(
  "/:id",
  protect,
  restrictTo("vendor"),
  checkSubscription,
  uploadService.fields([
    { name: "images", maxCount: 10 },
    { name: "images[]", maxCount: 10 },
    { name: "image", maxCount: 1 },
  ]),
  asyncHandler(updateService),
);
router.delete(
  "/:id",
  protect,
  restrictTo("vendor", "admin", "superAdmin"),
  asyncHandler(deleteService),
);

module.exports = router;
