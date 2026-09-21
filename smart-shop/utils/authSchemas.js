const { z } = require("zod");

const registerSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters."),
  name: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
});

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

const registerVendorSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters."),
  name: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  businessName: z.string().trim().min(1, "Business name is required."),
  vendorType: z.enum(["product", "service"], {
    errorMap: () => ({ message: "vendorType must be 'product' or 'service'." }),
  }),
  state: z.string().trim().min(1, "State is required."),
  lga: z.string().trim().min(1, "LGA is required."),
});

const createAdminSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters."),
  name: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  role: z.enum(["admin", "superAdmin"]).optional(),
});

const createSuperAdminSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters."),
  name: z.string().trim().optional(),
  phone: z.string().trim().optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
});

module.exports = {
  registerSchema,
  loginSchema,
  registerVendorSchema,
  createAdminSchema,
  createSuperAdminSchema,
  forgotPasswordSchema,
};
