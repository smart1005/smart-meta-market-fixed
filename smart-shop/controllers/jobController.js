const crypto = require("crypto");
const { db, admin } = require("../config/firebase");
const logger = require("../utils/logger");
const { visibleUntilFor } = require("../utils/visibility");

const MAX_OPEN_JOBS = 5; // a closed job is deleted, so every existing job is open
const CONTACT_TOKEN_MINUTES = 10;

const now = () => admin.firestore.Timestamp.fromDate(new Date());
const toMs = (v) => (v?.toDate ? v.toDate().getTime() : v ? new Date(v).getTime() : 0);
const isVisible = (data) => toMs(data?.visibleUntil) > Date.now();

// What the public may see of a job: never who posted it, never a count.
const publicJob = (id, d) => ({
  id,
  title: d.title,
  description: d.description,
  category: d.category,
  budget: d.budget,
  location: d.location || "",
  createdAt: d.createdAt,
});

const parseJobInput = (body, partial = false) => {
  const out = {};
  const has = (k) => body[k] !== undefined;

  if (!partial || has("title")) {
    const title = String(body.title || "").trim();
    if (title.length < 3 || title.length > 100) {
      return { error: "Title must be 3 to 100 characters." };
    }
    out.title = title;
  }
  if (!partial || has("description")) {
    const description = String(body.description || "").trim();
    if (description.length < 10 || description.length > 2000) {
      return { error: "Description must be 10 to 2000 characters." };
    }
    out.description = description;
  }
  if (!partial || has("category")) {
    const category = String(body.category || "").trim();
    if (!category || category.length > 60) {
      return { error: "Choose a category." };
    }
    out.category = category;
  }
  if (!partial || has("budget")) {
    const amount = Number(body.budget?.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
      return { error: "Enter a valid budget amount." };
    }
    out.budget = { amount, negotiable: Boolean(body.budget?.negotiable) };
  }
  if (has("location")) {
    const location = String(body.location || "").trim();
    if (location.length > 150) {
      return { error: "Location must be 150 characters or less." };
    }
    out.location = location; // optional free text (area, "Online", "Remote"...)
  } else if (!partial) {
    out.location = "";
  }
  return { data: out };
};

const createJob = async (req, res) => {
  try {
    const parsed = parseJobInput(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    const mine = await db.collection("jobs").where("ownerId", "==", req.user.id).get();
    if (mine.size >= MAX_OPEN_JOBS) {
      return res.status(409).json({
        message: `You can have at most ${MAX_OPEN_JOBS} open jobs. Close one to post another.`,
      });
    }

    const ref = await db.collection("jobs").add({
      ownerId: req.user.id,
      ...parsed.data,
      rand: Math.random(), // for the shuffled feed later
      visibleUntil: visibleUntilFor(req.user),
      createdAt: now(),
      updatedAt: now(),
    });

    res.status(201).json({
      message: "Job posted.",
      job: { id: ref.id, ...parsed.data },
    });
  } catch (error) {
    logger.error({ err: error }, "Error creating job");
    res.status(500).json({ message: "Unable to post your job right now." });
  }
};

// Public board: only jobs whose owner is currently subscribed. Paged.
const getJobs = async (req, res) => {
  try {
    const { category, cursor } = req.query;
    const pageSize = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    let query = db.collection("jobs");
    if (category) query = query.where("category", "==", category);
    query = query
      .where("visibleUntil", ">", new Date())
      .orderBy("visibleUntil", "desc")
      .limit(pageSize + 1);

    if (cursor) {
      const cursorDoc = await db.collection("jobs").doc(cursor).get();
      if (cursorDoc.exists) query = query.startAfter(cursorDoc);
    }

    const snap = await query.get();
    let docs = snap.docs;
    let nextCursor = null;
    if (docs.length > pageSize) {
      docs = docs.slice(0, pageSize);
      nextCursor = docs[docs.length - 1].id;
    }

    res.status(200).json({
      jobs: docs.map((d) => publicJob(d.id, d.data())),
      nextCursor,
    });
  } catch (error) {
    logger.error({ err: error }, "Error loading jobs");
    res.status(500).json({ message: "Unable to load jobs right now." });
  }
};

const getJobById = async (req, res) => {
  try {
    const snap = await db.collection("jobs").doc(req.params.id).get();
    if (!snap.exists || !isVisible(snap.data())) {
      return res.status(404).json({ message: "This job is no longer available." });
    }
    res.status(200).json({ job: publicJob(snap.id, snap.data()) });
  } catch (error) {
    logger.error({ err: error }, "Error loading job");
    res.status(500).json({ message: "Unable to load this job right now." });
  }
};

// The owner's own jobs (always shown to the owner), with applicant counts.
const getMyJobs = async (req, res) => {
  try {
    const snap = await db.collection("jobs").where("ownerId", "==", req.user.id).get();
    const jobs = await Promise.all(
      snap.docs.map(async (d) => {
        const apps = await db
          .collection("applications")
          .where("jobId", "==", d.id)
          .where("visibleUntil", ">", new Date())
          .get();
        return {
          ...publicJob(d.id, d.data()),
          visible: isVisible(d.data()),
          applicantCount: apps.size, // only the owner ever sees this
        };
      }),
    );
    jobs.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
    res.status(200).json({ jobs });
  } catch (error) {
    logger.error({ err: error }, "Error loading own jobs");
    res.status(500).json({ message: "Unable to load your jobs right now." });
  }
};

const loadOwnJob = async (req, res) => {
  const snap = await db.collection("jobs").doc(req.params.id).get();
  if (!snap.exists) {
    res.status(404).json({ message: "Job not found." });
    return null;
  }
  if (snap.data().ownerId !== req.user.id) {
    res.status(403).json({ message: "You don't have permission to do this" });
    return null;
  }
  return snap;
};

const updateJob = async (req, res) => {
  try {
    const snap = await loadOwnJob(req, res);
    if (!snap) return;

    const parsed = parseJobInput(req.body, true);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    await snap.ref.update({ ...parsed.data, updatedAt: now() });
    res.status(200).json({ message: "Job updated." });
  } catch (error) {
    logger.error({ err: error }, "Error updating job");
    res.status(500).json({ message: "Unable to update your job right now." });
  }
};

// Closing a job DELETES it, together with its applications.
const deleteJob = async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({
        message: "Please confirm. Closing a job permanently deletes it and its applications.",
      });
    }
    const snap = await db.collection("jobs").doc(req.params.id).get();
    if (!snap.exists) {
      return res.status(404).json({ message: "Job not found." });
    }
    const isAdmin = ["admin", "superAdmin"].includes(req.user.role);
    if (snap.data().ownerId !== req.user.id && !isAdmin) {
      return res.status(403).json({ message: "You don't have permission to do this" });
    }

    const apps = await db.collection("applications").where("jobId", "==", snap.id).get();
    const refs = [...apps.docs.map((d) => d.ref), snap.ref];

    for (let i = 0; i < refs.length; i += 400) {
      const batch = db.batch();
      refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }

    res.status(200).json({ message: "Job closed and deleted." });
  } catch (error) {
    logger.error({ err: error }, "Error deleting job");
    res.status(500).json({ message: "Unable to close your job right now." });
  }
};

const applyToJob = async (req, res) => {
  try {
    const jobId = req.params.id;
    const jobSnap = await db.collection("jobs").doc(jobId).get();

    if (!jobSnap.exists || !isVisible(jobSnap.data())) {
      return res.status(404).json({ message: "This job is no longer available." });
    }
    const job = jobSnap.data();

    if (job.ownerId === req.user.id) {
      return res.status(403).json({ message: "You can't apply to your own job." });
    }

    const note = String(req.body?.note || "").trim();
    if (note.length > 300) {
      return res.status(400).json({ message: "Your note must be 300 characters or less." });
    }

    try {
      await db
        .collection("applications")
        .doc(`${jobId}_${req.user.id}`)
        .create({
          jobId,
          jobOwnerId: job.ownerId,
          jobTitle: job.title,
          applicantId: req.user.id,
          applicantDisplayName: req.user.displayName || req.user.name || "Applicant",
          storefrontId: req.user.vendorType ? req.user.id : null,
          note,
          status: "applied",
          visibleUntil: visibleUntilFor(req.user),
          createdAt: now(),
        });
    } catch (createError) {
      if (createError.code === 6) {
        return res.status(409).json({ message: "You have already applied for this job." });
      }
      throw createError;
    }

    res.status(201).json({ message: "Application sent.", applied: true });
  } catch (error) {
    logger.error({ err: error }, "Error applying to job");
    res.status(500).json({ message: "Unable to send your application right now." });
  }
};

// Owner only: who applied (applicants who are currently subscribed).
const getJobApplications = async (req, res) => {
  try {
    const jobSnap = await loadOwnJob(req, res);
    if (!jobSnap) return;

    const snap = await db
      .collection("applications")
      .where("jobId", "==", jobSnap.id)
      .where("visibleUntil", ">", new Date())
      .get();

    const applications = snap.docs
      .map((d) => {
        const a = d.data();
        return {
          id: d.id,
          name: a.applicantDisplayName,
          note: a.note,
          status: a.status,
          storefrontId: a.storefrontId || null,
          createdAt: a.createdAt,
        };
      })
      .sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));

    res.status(200).json({ applications });
  } catch (error) {
    logger.error({ err: error }, "Error loading applications");
    res.status(500).json({ message: "Unable to load applications right now." });
  }
};

// Applicant's own applications (job title and status only).
const getMyApplications = async (req, res) => {
  try {
    const snap = await db
      .collection("applications")
      .where("applicantId", "==", req.user.id)
      .get();

    const docs = snap.docs;
    const jobSnaps = docs.length
      ? await db.getAll(...docs.map((d) => db.collection("jobs").doc(d.data().jobId)))
      : [];

    const applications = docs
      .map((d, i) => ({
        id: d.id,
        jobId: d.data().jobId,
        jobTitle: d.data().jobTitle,
        status: d.data().status,
        createdAt: d.data().createdAt,
        jobAvailable: jobSnaps[i].exists && isVisible(jobSnaps[i].data()),
      }))
      .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));

    res.status(200).json({ applications });
  } catch (error) {
    logger.error({ err: error }, "Error loading own applications");
    res.status(500).json({ message: "Unable to load your applications right now." });
  }
};

const withdrawApplication = async (req, res) => {
  try {
    const ref = db.collection("applications").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ message: "Application not found." });
    }
    if (snap.data().applicantId !== req.user.id) {
      return res.status(403).json({ message: "You don't have permission to do this" });
    }
    await ref.delete();
    res.status(200).json({ message: "Application withdrawn." });
  } catch (error) {
    logger.error({ err: error }, "Error withdrawing application");
    res.status(500).json({ message: "Unable to withdraw right now." });
  }
};

// Poster taps "Contact" on an applicant. We mint a short-lived, single-use code;
// the phone number never appears in the link, the page or this response.
const contactApplicant = async (req, res) => {
  try {
    const appRef = db.collection("applications").doc(req.params.id);
    const appSnap = await appRef.get();

    if (!appSnap.exists) {
      return res.status(404).json({ message: "Application not found." });
    }
    const application = appSnap.data();

    if (application.jobOwnerId !== req.user.id) {
      return res.status(403).json({ message: "You don't have permission to do this" });
    }
    if (!isVisible(application)) {
      return res.status(404).json({ message: "This applicant is no longer available." });
    }

    const applicantSnap = await db.collection("users").doc(application.applicantId).get();
    const phone = applicantSnap.exists ? applicantSnap.data().phoneNormalized : null;
    if (!phone) {
      return res.status(409).json({ message: "This applicant can't be contacted right now." });
    }

    const token = crypto.randomBytes(16).toString("hex");
    await db.collection("contactTokens").doc(token).set({
      applicationId: appSnap.id,
      ownerId: req.user.id,
      phone,
      message: `Hello ${application.applicantDisplayName}, I'm contacting you about your application for "${application.jobTitle}" on Smart Meta Market.`,
      used: false,
      expiresAt: admin.firestore.Timestamp.fromDate(
        new Date(Date.now() + CONTACT_TOKEN_MINUTES * 60 * 1000),
      ),
    });

    await appRef.update({ status: "contacted", contactedAt: now() });

    res.status(200).json({
      contactUrl: `/c/${token}`,
      expiresInMinutes: CONTACT_TOKEN_MINUTES,
    });
  } catch (error) {
    logger.error({ err: error }, "Error creating contact link");
    res.status(500).json({ message: "Unable to open the contact link right now." });
  }
};

const expiredPage = (res, code, text) =>
  res
    .status(code)
    .set("Cache-Control", "no-store")
    .type("html")
    .send(`<p style="font-family:sans-serif;padding:24px">${text}</p>`);

// GET /c/:token : validates the code, then forwards to WhatsApp (single use).
const openContact = async (req, res) => {
  try {
    const ref = db.collection("contactTokens").doc(String(req.params.token));

    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { status: "missing" };
      const data = snap.data();
      if (data.used || toMs(data.expiresAt) <= Date.now()) return { status: "expired" };
      tx.update(ref, { used: true });
      return { status: "ok", data };
    });

    if (outcome.status === "missing") {
      return expiredPage(res, 404, "This link is not valid.");
    }
    if (outcome.status === "expired") {
      return expiredPage(res, 410, "This link has expired. Go back and tap Contact again.");
    }

    res
      .set("Cache-Control", "no-store")
      .set("Referrer-Policy", "no-referrer")
      .redirect(
        302,
        `https://wa.me/${outcome.data.phone}?text=${encodeURIComponent(outcome.data.message)}`,
      );
  } catch (error) {
    logger.error({ err: error }, "Error opening contact link");
    expiredPage(res, 500, "Something went wrong. Please try again.");
  }
};

module.exports = {
  createJob,
  getJobs,
  getJobById,
  getMyJobs,
  updateJob,
  deleteJob,
  applyToJob,
  getJobApplications,
  getMyApplications,
  withdrawApplication,
  contactApplicant,
  openContact,
};
