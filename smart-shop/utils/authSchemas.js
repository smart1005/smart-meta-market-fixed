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
  displayName: z.string().trim().min(2).max(20).optional(),
  phone: z.string().trim().min(1, "Phone number is required."),
  businessName: z
    .string()
    .trim()
    .min(1, "Business name is required.")
    .optional(),
  vendorType: z
    .enum(["product", "service"], {
      errorMap: () => ({
        message: "vendorType must be 'product' or 'service'.",
      }),
    })
    .optional(),
  state: z.string().trim().min(1, "State is required.").optional(),
  lga: z.string().trim().min(1, "LGA is required.").optional(),
});

const createAdminSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters."),
  name: z.string().trim().optional(),
  phone: z.string().trim().min(1, "Phone number is required."),
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
