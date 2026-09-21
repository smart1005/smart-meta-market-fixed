const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// storage for product images
const productStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "smart-shop/products",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 800, height: 800, crop: "limit" }],
  },
});

// storage for portfolio images
const portfolioStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "smart-shop/portfolio",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 1200, height: 800, crop: "limit" }],
  },
});

// storage for vendor profile pictures
const profileStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "smart-shop/profiles",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 400, height: 400, crop: "fill" }],
  },
});

// storage for service images
const serviceStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "smart-shop/services",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 800, height: 600, crop: "limit" }],
  },
});

// storage for vendor certification documents/images.
// Separate from profileStorage: certifications must not be force-cropped
// to a 400x400 square (that's for avatars) and must land in their own
// Cloudinary folder so cleanup logic can tell them apart from profile pics.
const certificationStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "smart-shop/certifications",
    allowed_formats: ["jpg", "jpeg", "png", "webp", "pdf"],
    transformation: [{ width: 1600, height: 1600, crop: "limit" }],
  },
});

// Combined storage for the vendor profile update route, which accepts BOTH
// a profileImage and certificationImages in one multipart request. Routes
// each file to the correct folder/transformation based on its field name,
// since a single multer instance can only have one storage.
const vendorProfileStorage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    if (file.fieldname === "certificationImages") {
      return {
        folder: "smart-shop/certifications",
        allowed_formats: ["jpg", "jpeg", "png", "webp", "pdf"],
        transformation: [{ width: 1600, height: 1600, crop: "limit" }],
      };
    }
    // default: profileImage
    return {
      folder: "smart-shop/profiles",
      allowed_formats: ["jpg", "jpeg", "png", "webp"],
      transformation: [{ width: 400, height: 400, crop: "fill" }],
    };
  },
});

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const uploadProduct = multer({
  storage: productStorage,
  limits: { fileSize: MAX_FILE_SIZE },
});
const uploadPortfolio = multer({
  storage: portfolioStorage,
  limits: { fileSize: MAX_FILE_SIZE },
});
const uploadProfile = multer({
  storage: profileStorage,
  limits: { fileSize: MAX_FILE_SIZE },
});
const uploadService = multer({
  storage: serviceStorage,
  limits: { fileSize: MAX_FILE_SIZE },
});
const uploadCertification = multer({
  storage: certificationStorage,
  limits: { fileSize: MAX_FILE_SIZE },
});
// Use this one on the vendor profile route (handles profileImage +
// certificationImages together, each routed to its correct folder).
const uploadVendorProfile = multer({
  storage: vendorProfileStorage,
  limits: { fileSize: MAX_FILE_SIZE },
});

module.exports = {
  uploadProduct,
  uploadPortfolio,
  uploadProfile,
  uploadService,
  uploadCertification,
  uploadVendorProfile,
};
