const { db } = require("../config/firebase");
const { validateOrderPayload } = require("../utils/validators");

const createOrder = async (req, res) => {
  const validationError = validateOrderPayload(req.body);
  if (validationError) {
    const error = new Error(validationError);
    error.status = 400;
    throw error;
  }
  const { productId, quantity, customerAddress } = req.body;
  const orderedQuantity = Number(quantity);
  let orderId;
  let totalPrice;

  await db.runTransaction(async (transaction) => {
    const productRef = db.collection("products").doc(productId);
    const productDoc = await transaction.get(productRef);
    if (!productDoc.exists) {
      const error = new Error("Product not found");
      error.status = 404;
      throw error;
    }
    const product = productDoc.data();
    if (product.stock < orderedQuantity) {
      const error = new Error("Insufficient stock");
      error.status = 400;
      throw error;
    }
    totalPrice = product.price * orderedQuantity;
    const orderRef = db.collection("orders").doc();
    transaction.set(orderRef, {
      productId,
      productName: product.name,
      quantity: orderedQuantity,
      totalPrice,
      vendorId: product.vendorId, // taken from product
      vendorName: product.vendorName, // taken from product
      customerId: req.user.id, // taken from token
      customerName: req.user.name, // taken from token
      customerEmail: req.user.email, // taken from token
      customerAddress,
      status: "pending",
      createdAt: new Date(),
    });
    transaction.update(productRef, {
      stock: product.stock - orderedQuantity,
    });
    orderId = orderRef.id;
  });

  res.status(201).json({
    message: "Order placed successfully",
    orderId,
    totalPrice,
  });
};

const getOrders = async (req, res) => {
  try {
    let query = db.collection("orders");

    // vendor only sees their own orders
    if (req.user.role === "vendor") {
      query = query.where("vendorId", "==", req.user.id);
    }

    // customer only sees their own orders
    if (req.user.role === "customer") {
      query = query.where("customerId", "==", req.user.id);
    }

    const snapshot = await query.get();
    const orders = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json({ orders });
  } catch (error) {
    res.status(500).json({
      message: "Error fetching orders",
      error: error.message,
    });
  }
};

const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.collection("orders").doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ message: "Order not found" });
    }
    const order = doc.data();

    // vendor can only see their own orders
    if (req.user.role === "vendor" && order.vendorId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "You can only view your own orders" });
    }

    // customer can only see their own orders
    if (req.user.role === "customer" && order.customerId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "You can only view your own orders" });
    }

    res.status(200).json({ id: doc.id, ...order });
  } catch (error) {
    res.status(500).json({
      message: "Error fetching order",
      error: error.message,
    });
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = [
      "pending",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    const orderDoc = await db.collection("orders").doc(id).get();
    if (!orderDoc.exists) {
      return res.status(404).json({ message: "Order not found" });
    }
    const order = orderDoc.data();

    // vendor can only update status of their own orders
    if (req.user.role === "vendor" && order.vendorId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "You can only update your own orders" });
    }

    await db.collection("orders").doc(id).update({ status });
    res.status(200).json({ message: "Order status updated successfully" });
  } catch (error) {
    res.status(500).json({
      message: "Error updating order status",
      error: error.message,
    });
  }
};

const deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const orderDoc = await db.collection("orders").doc(id).get();
    if (!orderDoc.exists) {
      return res.status(404).json({ message: "Order not found" });
    }
    await db.collection("orders").doc(id).delete();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({
      message: "Error deleting order",
      error: error.message,
    });
  }
};

module.exports = {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
  deleteOrder,
};
