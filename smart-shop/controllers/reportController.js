const { db, admin } = require("../config/firebase");
const logger = require("../utils/logger");

const REASONS = ["scam", "fake_listing", "abusive", "inappropriate", "spam", "other"];
const STATUSES = ["open", "reviewed", "dismissed", "actioned"];
const MAX_DETAILS = 500;
const MAX_REPORTS_PER_DAY = 10;

// What can be reported, where it lives, and who owns it.
const TARGETS = {
  vendor: {
    collection: "vendorProfiles",
    owner: (id) => id,
    summary: (d) => ({ name: d.businessName, vendorType: d.vendorType }),
  },
  job: {
    collection: "jobs",
    owner: (_id, d) => d.ownerId,
    summary: (d) => ({ title: d.title, description: d.description }),
  },
  review: {
    collection: "reviews",
    owner: (_id, d) => d.reviewerId,
    summary: (d) => ({ rating: d.rating, comment: d.comment }),
  },
  product: {
    collection: "products",
    owner: (_id, d) => d.vendorId,
    summary: (d) => ({ name: d.name }),
  },
  service: {
    collection: "services",
    owner: (_id, d) => d.vendorId,
    summary: (d) => ({ title: d.title || d.name }),
  },
};

const now = () => admin.firestore.Timestamp.fromDate(new Date());
const toMs = (v) => (v?.toDate ? v.toDate().getTime() : v ? new Date(v).getTime() : 0);

// ── Any signed-in user reports something. A report NEVER hides or suspends anything. ──
const createReport = async (req, res) => {
  try {
    const { targetType, targetId, reason } = req.body || {};
    const reporterId = req.user.id;

    if (!TARGETS[targetType]) {
      return res.status(400).json({ message: "Choose what you are reporting." });
    }
    if (typeof targetId !== "string" || !targetId || targetId.length > 200 || targetId.includes("/")) {
      return res.status(400).json({ message: "Invalid report target." });
    }
    if (!REASONS.includes(reason)) {
      return res.status(400).json({ message: "Choose a reason for your report." });
    }
    const details = String(req.body.details || "").trim();
    if (details.length > MAX_DETAILS) {
      return res.status(400).json({ message: `Details must be ${MAX_DETAILS} characters or less.` });
    }

    const target = TARGETS[targetType];
    const targetSnap = await db.collection(target.collection).doc(targetId).get();
    if (!targetSnap.exists) {
      return res.status(404).json({ message: "We couldn't find what you are reporting." });
    }
    const targetOwnerId = target.owner(targetId, targetSnap.data());

    if (targetOwnerId === reporterId) {
      return res.status(403).json({ message: "You can't report your own content." });
    }

    // simple daily cap so one person can't flood the queue
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await db
      .collection("reports")
      .where("reporterId", "==", reporterId)
      .where("createdAt", ">", since)
      .get();
    if (recent.size >= MAX_REPORTS_PER_DAY) {
      return res.status(429).json({ message: "You've sent many reports today. Please try again tomorrow." });
    }

    try {
      await db
        .collection("reports")
        .doc(`${targetType}_${targetId}_${reporterId}`)
        .create({
          targetType,
          targetId,
          targetOwnerId,
          reporterId,
          reason,
          details,
          status: "open",
          createdAt: now(),
        });
    } catch (createError) {
      if (createError.code === 6) {
        return res.status(409).json({ message: "You have already reported this." });
      }
      throw createError;
    }

    // the reporter learns nothing about counts or outcomes
    res.status(201).json({ message: "Thanks. Your report was received and will be reviewed." });
  } catch (error) {
    logger.error({ err: error }, "Error creating report");
    res.status(500).json({ message: "Unable to send your report right now." });
  }
};

const countForTarget = async (type, id) => {
  const snap = await db
    .collection("reports")
    .where("targetType", "==", type)
    .where("targetId", "==", id)
    .get();
  return snap.size;
};

// ── Admin: the moderation queue ──
const getReports = async (req, res) => {
  try {
    const { status, targetType, cursor } = req.query;
    const pageSize = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    let query = db.collection("reports");
    if (status && STATUSES.includes(status)) query = query.where("status", "==", status);
    if (targetType && TARGETS[targetType]) query = query.where("targetType", "==", targetType);
    query = query.orderBy("createdAt", "desc").limit(pageSize + 1);

    if (cursor) {
      const cursorDoc = await db.collection("reports").doc(cursor).get();
      if (cursorDoc.exists) query = query.startAfter(cursorDoc);
    }

    const snap = await query.get();
    let docs = snap.docs;
    let nextCursor = null;
    if (docs.length > pageSize) {
      docs = docs.slice(0, pageSize);
      nextCursor = docs[docs.length - 1].id;
    }

    const reports = await Promise.all(
      docs.map(async (d) => {
        const r = d.data();
        return {
          id: d.id,
          ...r,
          // many reports against one target = look at it first
          targetReportCount: await countForTarget(r.targetType, r.targetId),
        };
      }),
    );

    res.status(200).json({ reports, nextCursor });
  } catch (error) {
    logger.error({ err: error }, "Error loading reports");
    res.status(500).json({ message: "Unable to load reports right now." });
  }
};

const getReport = async (req, res) => {
  try {
    const snap = await db.collection("reports").doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ message: "Report not found." });

    const report = snap.data();
    const target = TARGETS[report.targetType];
    const targetSnap = await db.collection(target.collection).doc(report.targetId).get();

    res.status(200).json({
      report: { id: snap.id, ...report },
      // null when the content has already been deleted
      target: targetSnap.exists ? target.summary(targetSnap.data()) : null,
      targetReportCount: await countForTarget(report.targetType, report.targetId),
    });
  } catch (error) {
    logger.error({ err: error }, "Error loading report");
    res.status(500).json({ message: "Unable to load this report right now." });
  }
};

// ── Admin records the outcome. Taking action on the content is a separate, deliberate step
//    (suspend the vendor, delete the review/job/listing) using the existing admin tools. ──
const updateReport = async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${STATUSES.join(", ")}.` });
    }
    const note = String(req.body.note || "").trim();
    if (note.length > MAX_DETAILS) {
      return res.status(400).json({ message: `Note must be ${MAX_DETAILS} characters or less.` });
    }

    const ref = db.collection("reports").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ message: "Report not found." });

    const changes = { status, adminNote: note };
    if (status === "open") {
      changes.resolvedBy = admin.firestore.FieldValue.delete();
      changes.resolvedAt = admin.firestore.FieldValue.delete();
    } else {
      changes.resolvedBy = req.user.id;
      changes.resolvedAt = now();
    }
    await ref.update(changes);

    res.status(200).json({ message: `Report marked ${status}.` });
  } catch (error) {
    logger.error({ err: error }, "Error updating report");
    res.status(500).json({ message: "Unable to update this report right now." });
  }
};

module.exports = { createReport, getReports, getReport, updateReport };
