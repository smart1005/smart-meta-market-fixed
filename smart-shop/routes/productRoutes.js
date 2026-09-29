const express = require("express");
const router = express.Router();
const asyncHandler = require("../middleware/asyncHandler");
const { uploadProduct } = require("../config/cloudinary");
const {
  protect,
  restrictTo,
  checkSubscription,
} = require("../middleware/authMiddleware");
const {
  addProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
} = require("../controllers/productController");

router.post(
  "/",
  protect,
  restrictTo("vendor"),
  checkSubscription,
  uploadProduct.fields([
    { name: "image", maxCount: 1 },
    { name: "images", maxCount: 10 },
  ]),
  asyncHandler(addProduct),
);
router.get("/", asyncHandler(getProducts));
router.get("/:id", asyncHandler(getProductById));
router.put(
  "/:id",
  protect,
  restrictTo("vendor"),
  checkSubscription,
  uploadProduct.fields([
    { name: "image", maxCount: 1 },
    { name: "images", maxCount: 10 },
  ]),
  asyncHandler(updateProduct),
);

router.delete(
  "/:id",
  protect,
  restrictTo("admin", "superAdmin", "vendor"),
  checkSubscription,
  asyncHandler(deleteProduct),
);

module.exports = router;
