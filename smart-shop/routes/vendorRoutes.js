const express = require("express");
const router = express.Router();
const asyncHandler = require("../middleware/asyncHandler");
const { protect, restrictTo } = require("../middleware/authMiddleware");
const { uploadPortfolio, uploadVendorProfile } = require("../config/cloudinary");
const {
  updateVendorProfile,
  updateVendorLocation,
  getVendorProfile,
  getVendors,
  addPortfolioImages,
  updateVendorStatus,
  removePortfolioImage,
  getAllVendorsForAdmin
} = require("../controllers/vendorController");

router.get("/", asyncHandler(getVendors));
router.get("/:id", asyncHandler(getVendorProfile));

router.get(
  "/admin/all",
  protect,
  restrictTo("admin", "superAdmin"),
  asyncHandler(getAllVendorsForAdmin),
);

router.put(
  "/profile",
  protect,
  restrictTo("vendor"),
  uploadVendorProfile.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "certificationImages", maxCount: 5 },
  ]),
  asyncHandler(updateVendorProfile),
);

router.put(
  "/location",
  protect,
  restrictTo("vendor"),
  asyncHandler(updateVendorLocation),
);

router.post(
  "/portfolio",
  protect,
  restrictTo("vendor"),
  uploadPortfolio.array("images", 10),
  asyncHandler(addPortfolioImages),
);

router.delete(
  "/portfolio",
  protect,
  restrictTo("vendor"),
  asyncHandler(removePortfolioImage),
);

router.put(
  "/:id/status",
  protect,
  restrictTo("superAdmin"),
  asyncHandler(updateVendorStatus),
);

module.exports = router;
