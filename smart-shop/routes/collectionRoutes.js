const express = require("express");
const router = express.Router();
const asyncHandler = require("../middleware/asyncHandler");
const { protect, restrictTo } = require("../middleware/authMiddleware");
const {
  createCollection,
  getVendorCollections,
  deleteCollection,
} = require("../controllers/collectionController");

router.post("/", protect, restrictTo("vendor"), asyncHandler(createCollection));
router.get("/:vendorId", asyncHandler(getVendorCollections));
router.delete(
  "/:collectionId",
  protect,
  restrictTo("vendor"),
  asyncHandler(deleteCollection),
);

module.exports = router;
