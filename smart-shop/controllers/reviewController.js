const { db, admin } = require("../config/firebase");
const logger = require("../utils/logger");

const MAX_COMMENT = 500;
const MAX_REPLY = 300;

const now = () => admin.firestore.Timestamp.fromDate(new Date());
const toMs = (v) => (v?.toDate ? v.toDate().getTime() : v ? new Date(v).getTime() : 0);
const isVisible = (data) => toMs(data?.visibleUntil) > Date.now();
const isAdmin = (user) => ["admin", "superAdmin"].includes(user.role);

// What the public may see of a review (never the reviewer's id).
const publicReview = (id, r) => ({
  id,
  rating: r.rating,
  comment: r.comment || "",
  reviewerName: r.reviewerName,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt || null,
  reply: r.reply || null,
});

const parseRating = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

const parseComment = (value) => {
  const comment = String(value || "").trim();
  return comment.length > MAX_COMMENT ? null : comment;
};

// ── Create a review (one per user per vendor) ──
const createReview = async (req, res) => {
  try {
    const vendorId = req.params.id;
    const reviewerId = req.user.id;

    const rating = parseRating(req.body?.rating);
    if (!rating) {
      return res.status(400).json({ message: "Rating must be a whole number from 1 to 5." });
    }
    const comment = parseComment(req.body?.comment);
    if (comment === null) {
      return res.status(400).json({ message: `Your review must be ${MAX_COMMENT} characters or less.` });
    }

    if (vendorId === reviewerId) {
      return res.status(403).json({ message: "You can't review your own store." });
    }

    const profileRef = db.collection("vendorProfiles").doc(vendorId);
    const reviewRef = db.collection("reviews").doc(`${vendorId}_${reviewerId}`);

    const outcome = await db.runTransaction(async (tx) => {
      const [profileSnap, reviewSnap] = await Promise.all([tx.get(profileRef), tx.get(reviewRef)]);

      if (!profileSnap.exists || !isVisible(profileSnap.data())) return { status: 404 };
      if (reviewSnap.exists) return { status: 409 };

      const profile = profileSnap.data();
      tx.set(reviewRef, {
        vendorId,
        reviewerId,
        reviewerName: req.user.displayName || req.user.name || "User",
        rating,
        comment,
        reply: null,
        createdAt: now(),
      });
      tx.update(profileRef, {
        ratingCount: (profile.ratingCount || 0) + 1,
        ratingSum: (profile.ratingSum || 0) + rating,
      });
      return { status: 201 };
    });

    if (outcome.status === 404) {
      return res.status(404).json({ message: "This store is not available." });
    }
    if (outcome.status === 409) {
      return res.status(409).json({ message: "You have already reviewed this vendor. Edit your review instead." });
    }
    res.status(201).json({ message: "Thanks for your review.", id: `${vendorId}_${reviewerId}` });
  } catch (error) {
    logger.error({ err: error }, "Error creating review");
    res.status(500).json({ message: "Unable to save your review right now." });
  }
};

// ── Public list of a vendor's reviews (newest first, paged) ──
const getVendorReviews = async (req, res) => {
  try {
    const vendorId = req.params.id;
    const profileSnap = await db.collection("vendorProfiles").doc(vendorId).get();
    if (!profileSnap.exists || !isVisible(profileSnap.data())) {
      return res.status(404).json({ message: "This store is not available." });
    }

    const pageSize = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    let query = db
      .collection("reviews")
      .where("vendorId", "==", vendorId)
      .orderBy("createdAt", "desc")
      .limit(pageSize + 1);

    if (req.query.cursor) {
      const cursorDoc = await db.collection("reviews").doc(req.query.cursor).get();
      if (cursorDoc.exists) query = query.startAfter(cursorDoc);
    }

    const snap = await query.get();
    let docs = snap.docs;
    let nextCursor = null;
    if (docs.length > pageSize) {
      docs = docs.slice(0, pageSize);
      nextCursor = docs[docs.length - 1].id;
    }

    const profile = profileSnap.data();
    res.status(200).json({
      ratingCount: profile.ratingCount || 0,
      ratingSum: profile.ratingSum || 0,
      reviews: docs.map((d) => publicReview(d.id, d.data())),
      nextCursor,
    });
  } catch (error) {
    logger.error({ err: error }, "Error loading reviews");
    res.status(500).json({ message: "Unable to load reviews right now." });
  }
};

// ── Author edits their own review ──
const updateReview = async (req, res) => {
  try {
    const reviewRef = db.collection("reviews").doc(req.params.id);
    const rating = req.body?.rating === undefined ? undefined : parseRating(req.body.rating);
    const comment = req.body?.comment === undefined ? undefined : parseComment(req.body.comment);

    if (rating === null) {
      return res.status(400).json({ message: "Rating must be a whole number from 1 to 5." });
    }
    if (comment === null) {
      return res.status(400).json({ message: `Your review must be ${MAX_COMMENT} characters or less.` });
    }

    const outcome = await db.runTransaction(async (tx) => {
      const reviewSnap = await tx.get(reviewRef);
      if (!reviewSnap.exists) return { status: 404 };
      const review = reviewSnap.data();
      if (review.reviewerId !== req.user.id) return { status: 403 };

      const profileRef = db.collection("vendorProfiles").doc(review.vendorId);
      const profileSnap = await tx.get(profileRef);

      const changes = { updatedAt: now() };
      if (comment !== undefined) changes.comment = comment;
      if (rating !== undefined && rating !== review.rating) {
        changes.rating = rating;
        if (profileSnap.exists) {
          tx.update(profileRef, {
            ratingSum: (profileSnap.data().ratingSum || 0) - review.rating + rating,
          });
        }
      }
      tx.update(reviewRef, changes);
      return { status: 200 };
    });

    if (outcome.status === 404) return res.status(404).json({ message: "Review not found." });
    if (outcome.status === 403) return res.status(403).json({ message: "You don't have permission to do this" });
    res.status(200).json({ message: "Review updated." });
  } catch (error) {
    logger.error({ err: error }, "Error updating review");
    res.status(500).json({ message: "Unable to update your review right now." });
  }
};

// ── Author or admin deletes a review (ratings are recalculated) ──
const deleteReview = async (req, res) => {
  try {
    const reviewRef = db.collection("reviews").doc(req.params.id);

    const outcome = await db.runTransaction(async (tx) => {
      const reviewSnap = await tx.get(reviewRef);
      if (!reviewSnap.exists) return { status: 404 };
      const review = reviewSnap.data();
      if (review.reviewerId !== req.user.id && !isAdmin(req.user)) return { status: 403 };

      const profileRef = db.collection("vendorProfiles").doc(review.vendorId);
      const profileSnap = await tx.get(profileRef);
      if (profileSnap.exists) {
        const p = profileSnap.data();
        tx.update(profileRef, {
          ratingCount: Math.max((p.ratingCount || 0) - 1, 0),
          ratingSum: Math.max((p.ratingSum || 0) - review.rating, 0),
        });
      }
      tx.delete(reviewRef);
      return { status: 200 };
    });

    if (outcome.status === 404) return res.status(404).json({ message: "Review not found." });
    if (outcome.status === 403) return res.status(403).json({ message: "You don't have permission to do this" });
    res.status(200).json({ message: "Review deleted." });
  } catch (error) {
    logger.error({ err: error }, "Error deleting review");
    res.status(500).json({ message: "Unable to delete this review right now." });
  }
};

// ── The vendor replies to a review of their own store (one reply each) ──
const replyToReview = async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    if (text.length < 1 || text.length > MAX_REPLY) {
      return res.status(400).json({ message: `Your reply must be 1 to ${MAX_REPLY} characters.` });
    }

    const reviewRef = db.collection("reviews").doc(req.params.id);
    const snap = await reviewRef.get();
    if (!snap.exists) return res.status(404).json({ message: "Review not found." });
    if (snap.data().vendorId !== req.user.id) {
      return res.status(403).json({ message: "You don't have permission to do this" });
    }

    await reviewRef.update({ reply: { text, createdAt: now() } });
    res.status(200).json({ message: "Reply posted." });
  } catch (error) {
    logger.error({ err: error }, "Error replying to review");
    res.status(500).json({ message: "Unable to post your reply right now." });
  }
};

const deleteReply = async (req, res) => {
  try {
    const reviewRef = db.collection("reviews").doc(req.params.id);
    const snap = await reviewRef.get();
    if (!snap.exists) return res.status(404).json({ message: "Review not found." });
    if (snap.data().vendorId !== req.user.id && !isAdmin(req.user)) {
      return res.status(403).json({ message: "You don't have permission to do this" });
    }
    await reviewRef.update({ reply: null });
    res.status(200).json({ message: "Reply removed." });
  } catch (error) {
    logger.error({ err: error }, "Error removing reply");
    res.status(500).json({ message: "Unable to remove the reply right now." });
  }
};

module.exports = {
  createReview,
  getVendorReviews,
  updateReview,
  deleteReview,
  replyToReview,
  deleteReply,
};
