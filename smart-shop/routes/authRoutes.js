const express = require("express");
const router = express.Router();
const {
  register,
  login,
  createAdmin,
  registerVendor,
  forgotPassword,
  createSuperAdmin,
} = require("../controllers/authController");
const { protect, restrictTo } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const {
  registerSchema,
  loginSchema,
  registerVendorSchema,
  createAdminSchema,
  createSuperAdminSchema,
  forgotPasswordSchema,
} = require("../utils/authSchemas");

// Customer auth
router.post("/register", validate(registerSchema), register);
router.post("/login", validate(loginSchema), login);

// Password recovery
router.post("/forgot-password", validate(forgotPasswordSchema), forgotPassword);

// Vendor registration
router.post("/register-vendor", validate(registerVendorSchema), registerVendor);

// Admin and super admin creation — requires an existing superAdmin
router.post(
  "/create-admin",
  protect,
  restrictTo("superAdmin"),
  validate(createAdminSchema),
  createAdmin,
);
router.post(
  "/create-superAdmin",
  protect,
  restrictTo("superAdmin"),
  validate(createSuperAdminSchema),
  createSuperAdmin,
);

module.exports = router;
