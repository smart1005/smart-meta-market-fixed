const express = require("express");
const router = express.Router();
const asyncHandler = require("../middleware/asyncHandler");
const { protect, restrictTo } = require("../middleware/authMiddleware");
const {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
  deleteOrder,
} = require("../controllers/orderController");

router.post("/", protect, asyncHandler(createOrder));
router.get(
  "/",
  protect,
  restrictTo("admin", "superAdmin"),
  asyncHandler(getOrders),
);
router.get("/:id", protect, asyncHandler(getOrderById));
router.put(
  "/:id/status",
  protect,
  restrictTo("admin", "superAdmin"),
  asyncHandler(updateOrderStatus),
);
router.delete(
  "/:id",
  protect,
  restrictTo("admin", "superAdmin"),
  asyncHandler(deleteOrder),
);

module.exports = router;
