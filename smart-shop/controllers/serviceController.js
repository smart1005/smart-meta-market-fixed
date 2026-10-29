const { db } = require("../config/firebase");
const logger = require("../utils/logger");
const cloudinary = require("cloudinary").v2;
const { validateServicePayload } = require("../utils/validators");
const { visibleUntilFor } = require("../utils/visibility");

const extractPublicIdFromUrl = (url) => {
  if (!url || typeof url !== "string") return null;
  const cleanUrl = url.split("?")[0].split("#")[0];
  const match = cleanUrl.match(
    /\/smart-shop\/services\/([^/]+)\.[a-zA-Z0-9]+$/,
  );
  return match ? `smart-shop/services/${match[1]}` : null;
};

const deleteCloudinaryImage = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    logger.error("Error deleting image from Cloudinary:", error.message);
  }
};

const getUploadedImageUrl = (file) => file?.secure_url || file?.path || null;

const getUploadedImageUrls = (req) => {
  const files = [];

  if (Array.isArray(req.files?.images)) {
    files.push(...req.files.images);
  }
  if (Array.isArray(req.files?.["images[]"])) {
    files.push(...req.files["images[]"]);
  }
  if (Array.isArray(req.files?.image)) {
    files.push(...req.files.image);
  }
  if (req.file) {
    files.push(req.file);
  }

  return files.map((file) => getUploadedImageUrl(file)).filter(Boolean);
};

const normalizeSkills = (skills) => {
  if (skills === undefined || skills === null || skills === "") {
    return [];
  }

  if (Array.isArray(skills)) {
    return skills
      .map((skill) => (typeof skill === "string" ? skill.trim() : ""))
      .filter((skill) => skill !== "");
  }

  if (typeof skills === "string") {
    return skills
      .split(",")
      .map((skill) => skill.trim())
      .filter((skill) => skill !== "");
  }

  return [];
};

const normalizeRequestBody = (body) => {
  if (!body) return body;

  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key === "skills[]" ? "skills" : key,
      value,
    ]),
  );
};

const addService = async (req, res) => {
  try {
    const payload = normalizeRequestBody(req.body);

    const validationError = validateServicePayload(payload);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const { title, jobTitle, description, price, category, skills } = payload;
    const serviceTitle = (jobTitle || title || "").trim();
    const imageUrls = getUploadedImageUrls(req);
    // determine category from jobTitle when possible
    let computedCategory = category;
    if (serviceTitle) {
      try {
        const snapshot = await db
          .collection("jobTitles")
          .where("titles", "array-contains", serviceTitle)
          .limit(1)
          .get();
        if (!snapshot.empty) {
          computedCategory = snapshot.docs[0].data().category;
        }
      } catch (err) {
        logger.error("Error fetching job title category:", err.message);
      }
    }

    const serviceData = {
      title: serviceTitle,
      jobTitle: serviceTitle,
      description: description || "",
      category: computedCategory || "",
      imageUrl: imageUrls[0] || null,
      imageUrls,
      skills: normalizeSkills(skills),
      vendorId: req.user.id,
      vendorName: req.user.name,
      createdAt: new Date(),
    };

    if (price !== undefined && price !== null && price !== "") {
      serviceData.price = Number(price);
    }

    const profileSnap = await db
      .collection("vendorProfiles")
      .doc(req.user.id)
      .get();
    serviceData.visibleUntil = visibleUntilFor(req.user);
    serviceData.vendorLocation = profileSnap.data()?.location || null;

    const serviceRef = await db.collection("services").add(serviceData);

    res.status(201).json({
      message: "Service added successfully",
      id: serviceRef.id,
    });
  } catch (error) {
    logger.error("Error adding service:", error);
    res.status(500).json({
      message: "Something went wrong adding your service. Please try again.",
    });
  }
};

const getServices = async (req, res) => {
  try {
    const { category, vendorId, cursor } = req.query;
    // default is high for now so the current browse page keeps working;
    // lower it to 24 when the frontend gets a "load more" button
    const pageSize = Math.min(parseInt(req.query.limit, 10) || 200, 200);
    let query = db.collection("services");

    if (category) query = query.where("category", "==", category);

    if (vendorId) {
      // a vendor's own list (dashboard/storefront): no visibility filter
      query = query.where("vendorId", "==", vendorId);
    } else {
      // public browse: only listings whose owner is subscribed, paginated
      query = query
        .where("visibleUntil", ">", new Date())
        .orderBy("visibleUntil", "desc")
        .limit(pageSize + 1);

      if (cursor) {
        const cursorDoc = await db.collection("services").doc(cursor).get();
        if (cursorDoc.exists) query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.get();
    let docs = snapshot.docs;
    let nextCursor = null;

    if (!vendorId && docs.length > pageSize) {
      docs = docs.slice(0, pageSize);
      nextCursor = docs[docs.length - 1].id;
    }

    const services = docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    res.status(200).json({ services, nextCursor });
  } catch (error) {
    logger.error("Error fetching services:", error);
    res.status(500).json({
      message: "Unable to load services right now. Please try again.",
    });
  }
};

const getServiceById = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.collection("services").doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ message: "Service not found" });
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    logger.error("Error fetching service:", error);
    res.status(500).json({
      message: "Unable to load this service right now. Please try again.",
    });
  }
};

const updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const serviceDoc = await db.collection("services").doc(id).get();
    if (!serviceDoc.exists) {
      return res.status(404).json({ message: "Service not found" });
    }

    const service = serviceDoc.data();

    if (
      !["admin", "superAdmin"].includes(req.user.role) &&
      service.vendorId !== req.user.id
    ) {
      return res
        .status(403)
        .json({ message: "You can only update your own services" });
    }

    const payload = normalizeRequestBody(req.body);

    const validationError = validateServicePayload(payload, true);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const updates = { ...payload };
    const updateTitle =
      payload.jobTitle !== undefined ? payload.jobTitle : payload.title;
    if (updateTitle !== undefined) {
      updates.title = updateTitle.trim();
      updates.jobTitle = updates.title;
    }

    if (updates.skills !== undefined) {
      updates.skills = normalizeSkills(updates.skills);
    }

    delete updates.vendorId;
    delete updates.vendorName;
    delete updates.createdAt;
    delete updates.imageUrl;
    delete updates.imageUrls;

    if (updates.price !== undefined) {
      updates.price = Number(updates.price);
    }

    const uploadedUrls = getUploadedImageUrls(req);
    if (uploadedUrls.length > 0) {
      updates.imageUrls = uploadedUrls;
      updates.imageUrl = uploadedUrls[0];
    }

    await db.collection("services").doc(id).update(updates);
    res.status(200).json({ message: "Service updated successfully" });
  } catch (error) {
    logger.error("Error updating service:", error);
    res.status(500).json({
      message: "Something went wrong updating your service. Please try again.",
    });
  }
};

const deleteService = async (req, res) => {
  try {
    const { id } = req.params;
    const serviceDoc = await db.collection("services").doc(id).get();
    if (!serviceDoc.exists) {
      return res.status(404).json({ message: "Service not found" });
    }

    const service = serviceDoc.data();
    if (
      !["admin", "superAdmin"].includes(req.user.role) &&
      service.vendorId !== req.user.id
    ) {
      return res
        .status(403)
        .json({ message: "You can only delete your own services" });
    }

    // clean up images from Cloudinary
    if (Array.isArray(service.imageUrls) && service.imageUrls.length > 0) {
      await Promise.all(
        service.imageUrls.map((url) =>
          deleteCloudinaryImage(extractPublicIdFromUrl(url)),
        ),
      );
    }

    await db.collection("services").doc(id).delete();
    res.status(200).json({ message: "Service deleted successfully" });
  } catch (error) {
    logger.error("Error deleting service:", error);
    res.status(500).json({
      message: "Something went wrong deleting your service. Please try again.",
    });
  }
};

const getJobTitles = async (req, res) => {
  try {
    const snapshot = await db.collection("jobTitles").get();
    const jobTitles = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json({ jobTitles });
  } catch (error) {
    logger.error("Error fetching job titles:", error);
    res.status(500).json({
      message: "Unable to load job titles right now. Please try again.",
    });
  }
};

module.exports = {
  addService,
  getServices,
  getServiceById,
  updateService,
  deleteService,
  getJobTitles,
  visibleUntilFor,
};
