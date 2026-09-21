const { db } = require("../config/firebase");
const logger = require("../utils/logger");
const cloudinary = require("cloudinary").v2;
const { validateProductPayload } = require("../utils/validators");
const { filterGenuinelyActive } = require("../utils/vendorSubscription");
const MAX_COLLECTIONS_PER_VENDOR = 15;

const extractPublicIdFromUrl = (url) => {
  if (!url || typeof url !== "string") return null;
  const cleanUrl = url.split("?")[0].split("#")[0];
  const match = cleanUrl.match(
    /\/smart-shop\/products\/([^/]+)\.[a-zA-Z0-9]+$/,
  );
  return match ? `smart-shop/products/${match[1]}` : null;
};

const deleteCloudinaryImage = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    logger.error("Error deleting image from Cloudinary:", error.message);
  }
};

const getUploadedImageUrls = (req) => {
  const uploadedFiles = [];

  if (req.files) {
    Object.values(req.files).forEach((files) => {
      if (Array.isArray(files)) {
        uploadedFiles.push(...files);
      }
    });
  }

  if (req.file) {
    uploadedFiles.push(req.file);
  }

  return uploadedFiles
    .map((file) => file?.secure_url || file?.path)
    .filter(Boolean);
};

// Resolves which collection a product belongs to. Either verifies an
// existing collectionId belongs to this vendor, or creates a brand new
// collection on the fly from newCollectionName. Throws on any problem.
const resolveCollection = async (
  vendorId,
  vendorName,
  collectionId,
  newCollectionName,
) => {
  if (collectionId) {
    const doc = await db
      .collection("vendorCollections")
      .doc(collectionId)
      .get();
    if (!doc.exists) {
      throw new Error("Selected collection was not found.");
    }
    if (doc.data().vendorId !== vendorId) {
      throw new Error("You can only use your own collections.");
    }
    return { id: doc.id, name: doc.data().name };
  }

  const trimmedName = (newCollectionName || "").trim();
  if (!trimmedName) {
    throw new Error("Select a collection or name a new one.");
  }

  const existingCount = await db
    .collection("vendorCollections")
    .where("vendorId", "==", vendorId)
    .get();

  if (existingCount.size >= MAX_COLLECTIONS_PER_VENDOR) {
    throw new Error(
      `You've reached the maximum of ${MAX_COLLECTIONS_PER_VENDOR} collections.`,
    );
  }

  const newDoc = await db.collection("vendorCollections").add({
    name: trimmedName,
    description: "",
    vendorId,
    vendorName,
    createdAt: new Date(),
  });

  return { id: newDoc.id, name: trimmedName };
};

const addProduct = async (req, res) => {
  try {
    const payload = Object.fromEntries(
      Object.entries(req.body || {}).filter(([, value]) => value !== undefined),
    );

    const validationError = validateProductPayload(payload);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const {
      name,
      price,
      description,
      stock,
      category,
      collectionId,
      newCollectionName,
    } = payload;

    if (!collectionId && !newCollectionName) {
      return res.status(400).json({
        message:
          "Every product must belong to a collection — pick one or create a new one.",
      });
    }

    let collection;
    try {
      collection = await resolveCollection(
        req.user.id,
        req.user.name,
        collectionId,
        newCollectionName,
      );
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }

    const normalizedPrice = Number(price);
    const normalizedStock = Number(stock);

    const imageUrls = getUploadedImageUrls(req);
    const imageUrl = imageUrls[0] || null;

    const productRef = await db.collection("products").add({
      name,
      price: normalizedPrice,
      description: description ?? "",
      stock: normalizedStock,
      category: category ?? "",
      imageUrl,
      imageUrls,
      vendorId: req.user.id,
      vendorName: req.user.name,
      collectionId: collection.id,
      collectionName: collection.name,
      createdAt: new Date(),
    });
    res.status(201).json({
      message: "Product added successfully",
      id: productRef.id,
      collectionId: collection.id,
    });
  } catch (error) {
    logger.error("Error adding product:", error);
    res.status(500).json({
      message: "Something went wrong adding your product. Please try again.",
    });
  }
};

const getProducts = async (req, res) => {
  try {
    const { category, vendorId } = req.query;
    let query = db.collection("products");

    if (category) query = query.where("category", "==", category);
    if (vendorId) query = query.where("vendorId", "==", vendorId);

    const snapshot = await query.get();
    let products = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // filter out products from inactive vendors, and attach vendor location
    if (!vendorId) {
      const vendorsSnapshot = await db
        .collection("vendorProfiles")
        .where("subscriptionStatus", "==", "active")
        .get();

            const genuinelyActiveDocs = filterGenuinelyActive(
              vendorsSnapshot.docs,
            );

            const activeVendorLocations = new Map(
              genuinelyActiveDocs.map((doc) => [
                doc.id,
                doc.data().location || null,
              ]),
            );

      products = products
        .filter((p) => activeVendorLocations.has(p.vendorId))
        .map((p) => ({
          ...p,
          vendorLocation: activeVendorLocations.get(p.vendorId),
        }));
    }

    res.status(200).json({ products });
  } catch (error) {
    logger.error("Error fetching products:", error);
    res.status(500).json({
      message: "Unable to load products right now. Please try again.",
    });
  }
};

const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.collection("products").doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    logger.error("Error fetching product:", error);
    res.status(500).json({
      message: "Unable to load this product right now. Please try again.",
    });
  }
};

const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const productDoc = await db.collection("products").doc(id).get();
    if (!productDoc.exists) {
      return res.status(404).json({ message: "Product not found" });
    }
    const product = productDoc.data();
    if (req.user.role === "vendor" && product.vendorId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "You can only update your own products" });
    }
    const imageUrls = getUploadedImageUrls(req);
    const nextImageUrls =
      imageUrls.length > 0
        ? imageUrls
        : product.imageUrls || (product.imageUrl ? [product.imageUrl] : []);
    const imageUrl = nextImageUrls[0] || product.imageUrl || null;

    if (imageUrls.length > 0) {
      const oldImageUrls =
        product.imageUrls || (product.imageUrl ? [product.imageUrl] : []);
      if (oldImageUrls.length > 0) {
        Promise.all(
          oldImageUrls.map((url) =>
            deleteCloudinaryImage(extractPublicIdFromUrl(url)),
          ),
        );
      }
    }

    const updateData = Object.fromEntries(
      Object.entries(req.body || {}).filter(([, value]) => value !== undefined),
    );
    delete updateData.imageUrl;
    delete updateData.imageUrls;
    delete updateData.vendorId;
    delete updateData.vendorName;
    delete updateData.createdAt;

    // moving a product to a different (existing) collection
    if (updateData.collectionId !== undefined) {
      try {
        const collection = await resolveCollection(
          req.user.id,
          req.user.name,
          updateData.collectionId,
          null,
        );
        updateData.collectionId = collection.id;
        updateData.collectionName = collection.name;
      } catch (error) {
        return res.status(400).json({ message: error.message });
      }
    }

    if (updateData.description === undefined) updateData.description = "";
    if (updateData.category === undefined) updateData.category = "";
    if (updateData.price !== undefined)
      updateData.price = Number(updateData.price);
    if (updateData.stock !== undefined)
      updateData.stock = Number(updateData.stock);

    await db
      .collection("products")
      .doc(id)
      .update({ ...updateData, imageUrl, imageUrls: nextImageUrls });
    res.status(200).json({ message: "Product updated successfully" });
  } catch (error) {
    logger.error("Error updating product:", error);
    res.status(500).json({
      message: "Something went wrong updating your product. Please try again.",
    });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const productDoc = await db.collection("products").doc(id).get();
    if (!productDoc.exists) {
      return res.status(404).json({ message: "Product not found" });
    }
    const product = productDoc.data();
    if (req.user.role === "vendor" && product.vendorId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "You can only delete your own products" });
    }

    const imageUrls =
      product.imageUrls || (product.imageUrl ? [product.imageUrl] : []);
    if (imageUrls.length > 0) {
      Promise.all(
        imageUrls.map((url) =>
          deleteCloudinaryImage(extractPublicIdFromUrl(url)),
        ),
      );
    }

    await db.collection("products").doc(id).delete();
    res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    logger.error("Error deleting product:", error);
    res.status(500).json({
      message: "Something went wrong deleting your product. Please try again.",
    });
  }
};

module.exports = {
  addProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
};
