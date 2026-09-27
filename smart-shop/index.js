require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express"); // Import the Express framework
const logger = require("./utils/logger");
const app = express(); // Create an instance of the Express application
app.use(
  express.json({
    // Captures the raw bytes alongside the parsed JSON so the Paystack
    // webhook route can verify its HMAC signature against the exact
    // payload Paystack sent (signature checks fail if you verify against
    // a re-serialized object instead of the original bytes).
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
); // Middleware to parse JSON request bodies

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

const cors = require("cors");
const rateLimit = require("express-rate-limit");

// Lock CORS down to your actual frontend origin in production.
// Set ALLOWED_ORIGIN in your .env once deployed (e.g. https://smartmetamarket.com).
// Falls back to allowing all origins only when ALLOWED_ORIGIN isn't set (local dev).
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(
  cors(
    allowedOrigin ? { origin: allowedOrigin } : {}, // no restriction if not configured yet (dev only)
  ),
);

// Rate limiter for auth routes — prevents brute-force login attempts and
// mass fake account creation. 20 requests per 15 minutes per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    message: "Too many attempts from this device. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const PORT = process.env.PORT || 3000; // Use environment port if available

require("./config/firebase"); // Import Firebase configuration

const productRoutes = require("./routes/productRoutes"); // Import product routes
const orderRoutes = require("./routes/orderRoutes"); // Import order routes
const paymentRoutes = require("./routes/paymentRoutes"); // Import payment routes
const { errorHandler } = require("./middleware/errorHandler"); // Central error handling middleware
const authRoutes = require("./routes/authRoutes"); // Import authentication routes
const serviceRoutes = require("./routes/serviceRoutes"); // Import service routes
const collectionRoutes = require("./routes/collectionRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const locationRoutes = require("./routes/locationRoutes");

app.use("/products", productRoutes); // Use product routes for handling requests to /products
app.use("/orders", orderRoutes); // Use order routes for handling requests to /orders
app.use("/payments", paymentRoutes); // Use payment routes for handling requests to /payments
app.use("/auth", authLimiter, authRoutes); // Use authentication routes, rate-limited
app.use("/services", serviceRoutes); // Use service routes for handling requests to /services
app.use("/collections", collectionRoutes); // Use collection routes for handling requests to /collections
app.use("/vendors", vendorRoutes); // Use vendor routes for handling requests to /vendors
app.use("/locations", locationRoutes); // Use location routes for handling requests to /locations

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "smart-shop" });
});

app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (
    req.path.startsWith("/auth") ||
    req.path.startsWith("/products") ||
    req.path.startsWith("/orders") ||
    req.path.startsWith("/payments") ||
    req.path.startsWith("/services") ||
    req.path.startsWith("/collections") ||
    req.path.startsWith("/vendors") ||
    req.path.startsWith("/locations") ||
    req.path.startsWith("/api")
  ) {
    return next();
  }

  const indexFile = path.join(publicDir, "index.html");
  if (fs.existsSync(indexFile)) {
    return res.sendFile(indexFile);
  }

  next();
});

app.use(errorHandler); // Handle errors in one place

app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`); // Log a message when the server starts successfully
});
