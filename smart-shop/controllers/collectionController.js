const { db } = require("../config/firebase");
const logger = require("../utils/logger");

const MAX_COLLECTIONS_PER_VENDOR = 15;
const UNCATEGORIZED_NAME = "Uncategorized";

// Finds the vendor's "Uncategorized" collection, creating it if it doesn't
// exist yet. Used both for migrating old orphaned products and for
// re-homing products when their collection is deleted.
const getOrCreateUncategorized = async (vendorId, vendorName) => {
  const existing = await db
    .collection("vendorCollections")
    .where("vendorId", "==", vendorId)
    .where("name", "==", UNCATEGORIZED_NAME)
    .limit(1)
    .get();

  if (!existing.empty) {
    return { id: existing.docs[0].id, name: UNCATEGORIZED_NAME };
  }

  const newDoc = await db.collection("vendorCollections").add({
    name: UNCATEGORIZED_NAME,
    description: "Products not yet assigned to a collection",
    vendorId,
    vendorName,
    createdAt: new Date(),
  });

  return { id: newDoc.id, name: UNCATEGORIZED_NAME };
};

const createCollection = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Collection name is required" });
    }

    const existingCount = await db
      .collection("vendorCollections")
      .where("vendorId", "==", req.user.id)
      .get();

    if (existingCount.size >= MAX_COLLECTIONS_PER_VENDOR) {
      return res.status(400).json({
        message: `You've reached the maximum of ${MAX_COLLECTIONS_PER_VENDOR} collections.`,
      });
    }

    const collectionRef = await db.collection("vendorCollections").add({
      name,
      description: description || "",
      vendorId: req.user.id,
      vendorName: req.user.name,
      createdAt: new Date(),
    });

    res.status(201).json({
      message: "Collection created successfully",
      id: collectionRef.id,
    });
  } catch (error) {
    logger.error("Error creating collection:", error);
    res.status(500).json({
      message:
        "Something went wrong creating your collection. Please try again.",
    });
  }
};

const getVendorCollections = async (req, res) => {
  try {
    const { vendorId } = req.params;

    const [collectionsSnapshot, productsSnapshot] = await Promise.all([
      db
        .collection("vendorCollections")
        .where("vendorId", "==", vendorId)
        .get(),
      db.collection("products").where("vendorId", "==", vendorId).get(),
    ]);

    let collections = collectionsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    let products = productsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // self-healing migration: any product with no collectionId gets
    // moved into (a lazily-created) "Uncategorized" collection
    const orphaned = products.filter((p) => !p.collectionId);
    if (orphaned.length > 0) {
      const vendorName = orphaned[0].vendorName;
      const uncategorized = await getOrCreateUncategorized(
        vendorId,
        vendorName,
      );

      const batch = db.batch();
      orphaned.forEach((p) => {
        batch.update(db.collection("products").doc(p.id), {
          collectionId: uncategorized.id,
          collectionName: uncategorized.name,
        });
      });
      await batch.commit();

      // reflect the change in our in-memory copies without re-querying
      products = products.map((p) =>
        p.collectionId
          ? p
          : {
              ...p,
              collectionId: uncategorized.id,
              collectionName: uncategorized.name,
            },
      );
      if (!collections.some((c) => c.id === uncategorized.id)) {
        collections.push({
          id: uncategorized.id,
          name: uncategorized.name,
          description: "Products not yet assigned to a collection",
          vendorId,
          vendorName,
        });
      }
    }

    const result = collections.map((col) => ({
      ...col,
      products: products.filter((p) => p.collectionId === col.id),
    }));

    res.status(200).json({ collections: result });
  } catch (error) {
    logger.error("Error fetching collections:", error);
    res.status(500).json({
      message: "Unable to load collections right now. Please try again.",
    });
  }
};

const deleteCollection = async (req, res) => {
  try {
    const { collectionId } = req.params;

    const collectionDoc = await db
      .collection("vendorCollections")
      .doc(collectionId)
      .get();

    if (!collectionDoc.exists) {
      return res.status(404).json({ message: "Collection not found" });
    }

    const collectionData = collectionDoc.data();
    if (collectionData.vendorId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "You can only delete your own collections" });
    }

    if (collectionData.name === UNCATEGORIZED_NAME) {
      return res
        .status(400)
        .json({ message: "The Uncategorized collection can't be deleted" });
    }

    // re-home any products in this collection into Uncategorized
    const productsSnapshot = await db
      .collection("products")
      .where("collectionId", "==", collectionId)
      .get();

    if (!productsSnapshot.empty) {
      const uncategorized = await getOrCreateUncategorized(
        req.user.id,
        req.user.name,
      );
      const batch = db.batch();
      productsSnapshot.docs.forEach((doc) => {
        batch.update(doc.ref, {
          collectionId: uncategorized.id,
          collectionName: uncategorized.name,
        });
      });
      await batch.commit();
    }

    await db.collection("vendorCollections").doc(collectionId).delete();

    res.status(200).json({ message: "Collection deleted successfully" });
  } catch (error) {
    logger.error("Error deleting collection:", error);
    res.status(500).json({
      message:
        "Something went wrong deleting your collection. Please try again.",
    });
  }
};

module.exports = {
  createCollection,
  getVendorCollections,
  deleteCollection,
};
