const { db, admin } = require("../config/firebase");
const logger = require("../utils/logger");
const cloudinary = require("cloudinary").v2;
const { buildLocationData } = require("../utils/LocationLookup");
const {
  isGenuinelyActive,
  filterGenuinelyActive,
} = require("../utils/vendorSubscription");

const MAX_PORTFOLIO_IMAGES = 10;
const MAX_CERTIFICATION_IMAGES = 5;

const extractPublicIdFromUrl = (url) => {
  if (!url || typeof url !== "string") return null;
  const cleanUrl = url.split("?")[0].split("#")[0];
  const match = cleanUrl.match(/\/([^/]+)\.[a-zA-Z0-9]+$/);
  if (match) {
    let folder = "portfolio";
    if (cleanUrl.includes("/profiles/")) folder = "profiles";
    else if (cleanUrl.includes("/certifications/")) folder = "certifications";
    else if (cleanUrl.includes("/portfolio/")) folder = "portfolio";
    return `smart-shop/${folder}/${match[1]}`;
  }
  return null;
};

const deleteCloudinaryImage = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    logger.error("Error deleting image from Cloudinary:", error.message);
  }
};

const getUploadedUrl = (file) => file?.secure_url || file?.path || null;

const updateVendorProfile = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const vendorDoc = await db.collection("vendorProfiles").doc(vendorId).get();
    const vendorData = vendorDoc.data();

    const { whatsapp, availability, certification, about } = req.body;

    const updates = {};
    if (whatsapp) updates.whatsapp = whatsapp;

    if (availability) {
      let parsedAvailability = availability;
      if (typeof parsedAvailability === "string") {
        try {
          parsedAvailability = JSON.parse(parsedAvailability);
        } catch (err) {
          parsedAvailability = availability;
        }
      }
      if (parsedAvailability && typeof parsedAvailability === "object") {
        updates.availability = parsedAvailability;
      }
    }

    if (certification) updates.certification = certification;
    if (about) {
      if (about.length > 70) {
        return res
          .status(400)
          .json({ message: "About must be 70 characters or fewer" });
      }
      updates.about = about;
    }

    // NOTE: location is intentionally NOT handled here. Vendors must use
    // updateVendorLocation (state + LGA picker) so coordinates/geohash stay
    // consistent with the Nigeria LGA dataset instead of accepting arbitrary
    // free-text city/state values.

    // profile picture — single image, replace old one
    const profileImageFile = req.files?.profileImage?.[0] || req.file;
    if (profileImageFile) {
      const profileImageUrl = getUploadedUrl(profileImageFile);
      if (profileImageUrl) {
        if (vendorData?.profileImage) {
          const oldPublicId = extractPublicIdFromUrl(vendorData.profileImage);
          deleteCloudinaryImage(oldPublicId); // fire-and-forget: don't block the response on Cloudinary cleanup
        }
        updates.profileImage = profileImageUrl;
      }
    }

    // certification images — capped batch replace
    const certificationFiles = req.files?.certificationImages || [];
    if (certificationFiles.length > 0) {
      const newCertUrls = certificationFiles
        .map(getUploadedUrl)
        .filter(Boolean);

      if (newCertUrls.length > MAX_CERTIFICATION_IMAGES) {
        return res.status(400).json({
          message: `Maximum ${MAX_CERTIFICATION_IMAGES} certification images allowed`,
        });
      }

      if (newCertUrls.length > 0) {
        if (vendorData?.certificationImages?.length) {
          for (const oldUrl of vendorData.certificationImages) {
            const oldPublicId = extractPublicIdFromUrl(oldUrl);
            deleteCloudinaryImage(oldPublicId); // fire-and-forget: don't block the response on Cloudinary cleanup
          }
        }
        updates.certificationImages = newCertUrls;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No update fields provided" });
    }

    await db.collection("vendorProfiles").doc(vendorId).update(updates);

    res.status(200).json({
      message: "Profile updated successfully",
    });
  } catch (error) {
    logger.error("Error updating vendor profile:", error);
    res.status(500).json({
      message: "Something went wrong updating your profile. Please try again.",
    });
  }
};

// ── Update Vendor Location (state + LGA picker) ──
const updateVendorLocation = async (req, res) => {
  try {
    const { state, lga } = req.body;

    if (!state || !lga) {
      return res.status(400).json({ message: "State and LGA are required." });
    }

    const locationData = buildLocationData(state, lga);
    if (!locationData) {
      return res.status(400).json({
        message:
          "Invalid state/LGA combination. Please select from the provided list.",
      });
    }

    await db.collection("vendorProfiles").doc(req.user.id).update({
      location: locationData,
    });

    res.status(200).json({
      message: "Location updated successfully",
      location: locationData,
    });
  } catch (error) {
    logger.error("Error updating vendor location:", error);
    res.status(500).json({
      message: "Something went wrong updating your location. Please try again.",
    });
  }
};

const getVendorProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const [userDoc, vendorProfileDoc] = await Promise.all([
      db.collection("users").doc(id).get(),
      db.collection("vendorProfiles").doc(id).get(),
    ]);

    if (!userDoc.exists || !vendorProfileDoc.exists) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    const user = userDoc.data();
    const vendorProfile = vendorProfileDoc.data();

    if (user.role !== "vendor" || !isGenuinelyActive(id, vendorProfile)) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    // don't expose sensitive/internal fields
    const { password, ...publicUser } = user;
    const { subscriptionExpiry, lastPayment, ...publicVendorProfile } =
      vendorProfile;

    res.status(200).json({
      vendor: { id, ...publicUser, ...publicVendorProfile },
    });
  } catch (error) {
    logger.error("Error fetching vendor profile:", error);
    res.status(500).json({
      message:
        "Unable to load this vendor's profile right now. Please try again.",
    });
  }
};

const getVendors = async (req, res) => {
  try {
    // vendorProfiles only ever contains vendor docs, so this single
    // equality filter replaces the old two-field (role + status) query on
    // users — and needs no composite index.
    const profileSnapshot = await db
      .collection("vendorProfiles")
      .where("subscriptionStatus", "==", "active")
      .get();

    if (profileSnapshot.empty) {
      return res.status(200).json({ vendors: [] });
    }

    const genuinelyActiveDocs = filterGenuinelyActive(profileSnapshot.docs);

    if (genuinelyActiveDocs.length === 0) {
      return res.status(200).json({ vendors: [] });
    }

    const vendorIds = genuinelyActiveDocs.map((doc) => doc.id);
    const userRefs = vendorIds.map((id) => db.collection("users").doc(id));
    const userDocs = await db.getAll(...userRefs);
    const usersById = new Map(
      userDocs.filter((d) => d.exists).map((d) => [d.id, d.data()]),
    );

    const vendors = genuinelyActiveDocs
      .filter((doc) => usersById.has(doc.id))
      .map((doc) => {
        const { lastPayment, subscriptionExpiry, ...publicProfile } =
          doc.data();
        const { password, ...publicUser } = usersById.get(doc.id);
        return { id: doc.id, ...publicUser, ...publicProfile };
      });

    res.status(200).json({ vendors });
  } catch (error) {
    logger.error("Error fetching vendors:", error);
    res.status(500).json({
      message: "Unable to load vendors right now. Please try again.",
    });
  }
};

const updateVendorStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { subscriptionStatus } = req.body;

    if (!["active", "inactive", "suspended"].includes(subscriptionStatus)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const vendorDoc = await db.collection("vendorProfiles").doc(id).get();
    if (!vendorDoc.exists) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    const statusUpdate = { subscriptionStatus };
    if (subscriptionStatus === "inactive") {
      statusUpdate.inactivatedAt = new Date();
    } else if (subscriptionStatus === "active") {
      statusUpdate.inactivatedAt = admin.firestore.FieldValue.delete();
    }

    await db.collection("vendorProfiles").doc(id).update(statusUpdate);

    res
      .status(200)
      .json({ message: `Vendor status updated to ${subscriptionStatus}` });
  } catch (error) {
    logger.error("Error updating vendor status:", error);
    res.status(500).json({
      message: "Something went wrong updating vendor status. Please try again.",
    });
  }
};

const addPortfolioImages = async (req, res) => {
  try {
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      return res.status(400).json({ message: "No images uploaded" });
    }

    const validImages = req.files.filter(
      (file) => file?.secure_url || file?.path,
    );
    if (validImages.length === 0) {
      return res.status(400).json({ message: "No valid images to upload" });
    }

    const imageUrls = validImages
      .map((file) => file?.secure_url || file?.path)
      .filter(Boolean);

    const vendorDoc = await db
      .collection("vendorProfiles")
      .doc(req.user.id)
      .get();
    const existingImages = vendorDoc.data().portfolioImages || [];

    if (existingImages.length + imageUrls.length > MAX_PORTFOLIO_IMAGES) {
      return res.status(400).json({
        message: `Portfolio can hold a maximum of ${MAX_PORTFOLIO_IMAGES} images. You currently have ${existingImages.length} — delete some before adding more.`,
      });
    }

    await db
      .collection("vendorProfiles")
      .doc(req.user.id)
      .update({
        portfolioImages: [...existingImages, ...imageUrls],
      });

    res.status(200).json({
      message: "Portfolio images uploaded successfully",
      images: imageUrls,
    });
  } catch (error) {
    logger.error("Error uploading portfolio images:", error);
    res.status(500).json({
      message: "Something went wrong uploading your images. Please try again.",
    });
  }
};

const removePortfolioImage = async (req, res) => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ message: "imageUrl is required" });
    }

    const vendorDoc = await db
      .collection("vendorProfiles")
      .doc(req.user.id)
      .get();
    const existingImages = vendorDoc.data().portfolioImages || [];

    if (!existingImages.includes(imageUrl)) {
      return res
        .status(404)
        .json({ message: "Image not found in your portfolio" });
    }

    const updatedImages = existingImages.filter((url) => url !== imageUrl);

    const publicId = extractPublicIdFromUrl(imageUrl);
    deleteCloudinaryImage(publicId); // fire-and-forget: don't block the response on Cloudinary cleanup

    await db
      .collection("vendorProfiles")
      .doc(req.user.id)
      .update({ portfolioImages: updatedImages });

    res.status(200).json({
      message: "Portfolio image removed successfully",
      portfolioImages: updatedImages,
    });
  } catch (error) {
    logger.error("Error removing portfolio image:", error);
    res.status(500).json({
      message: "Something went wrong removing that image. Please try again.",
    });
  }
};

module.exports = {
  updateVendorProfile,
  updateVendorLocation,
  getVendorProfile,
  getVendors,
  updateVendorStatus,
  addPortfolioImages,
  removePortfolioImage,
};
