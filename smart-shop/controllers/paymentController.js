const axios = require("axios");
const logger = require("../utils/logger");
const crypto = require("crypto");
const { db, admin } = require("../config/firebase");

// subscription plans
const PLANS = {
  monthly: { amount: 5000, days: 30, label: "Monthly" }, // ₦5,000
  yearly: { amount: 50000, days: 365, label: "Yearly" }, // ₦50,000
};

/**
 * Applies a successful Paystack payment to a vendor's subscription,
 * exactly once per reference — no matter how many times or from which
 * entry point (verify endpoint, callback redirect, webhook) this gets
 * called for the same reference.
 *
 * Uses a Firestore transaction keyed on the payment reference as an
 * idempotency guard: the first caller to successfully create the
 * `processedPayments/{reference}` doc is the one that gets to extend the
 * subscription; every subsequent call for that same reference is a no-op.
 * This prevents a vendor's subscription being double- (or infinitely-)
 * extended by replaying a reference (e.g. reloading the callback URL,
 * or the frontend calling both /verify and the callback for one payment).
 */
const applySubscriptionPayment = async ({ vendorId, plan, days, amount, reference }) => {
  return db.runTransaction(async (tx) => {
    const paymentRef = db.collection("processedPayments").doc(reference);
    const paymentSnap = await tx.get(paymentRef);

    if (paymentSnap.exists) {
      return { alreadyProcessed: true, newExpiry: null };
    }

    const vendorRef = db.collection("vendorProfiles").doc(vendorId);
    const vendorSnap = await tx.get(vendorRef);
    if (!vendorSnap.exists) {
      const err = new Error("VENDOR_NOT_FOUND");
      err.code = "VENDOR_NOT_FOUND";
      throw err;
    }

    const vendorData = vendorSnap.data();
    const now = new Date();
    const currentExpiry = vendorData.subscriptionExpiry?.toDate
      ? vendorData.subscriptionExpiry.toDate()
      : now;

    // if subscription is still active, extend from expiry date; if
    // expired, extend from today
    const baseDate = currentExpiry > now ? currentExpiry : now;
    const newExpiry = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

    tx.set(paymentRef, {
      vendorId,
      plan,
      days,
      amount: amount / 100,
      reference,
      processedAt: admin.firestore.Timestamp.fromDate(new Date()),
    });

        tx.update(vendorRef, {
          subscriptionStatus: "active",
          subscriptionExpiry: admin.firestore.Timestamp.fromDate(newExpiry),
          inactivatedAt: admin.firestore.FieldValue.delete(),
          lastPayment: {
            amount: amount / 100,
            plan,
            paidAt: admin.firestore.Timestamp.fromDate(new Date()),
            reference,
          },
        });

    return { alreadyProcessed: false, newExpiry };
  });
};

const initializeSubscription = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const email = req.user.email;

    const { plan } = req.body;
    if (!plan || !PLANS[plan]) {
      return res
        .status(400)
        .json({ message: "Plan must be 'monthly' or 'yearly'" });
    }

    const selectedPlan = PLANS[plan];

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: selectedPlan.amount * 100, // convert to kobo
        metadata: {
          vendorId,
          plan,
          days: selectedPlan.days,
        },
        callback_url: `${process.env.BASE_URL}/payments/callback`,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    const paystackData = response?.data?.data;
    if (!paystackData) {
      logger.error("Invalid Paystack initialize response:", response?.data);
      return res.status(502).json({
        message: "Unable to start payment right now. Please try again.",
      });
    }

    res.status(200).json({
      message: "Subscription payment initialized",
      paymentUrl: paystackData.authorization_url,
      reference: paystackData.reference,
      plan: selectedPlan.label,
      amount: selectedPlan.amount,
    });
  } catch (error) {
    logger.error("Error initializing subscription:", error);
    res.status(500).json({
      message: "Something went wrong starting your payment. Please try again.",
    });
  }
};

const verifySubscription = async (req, res) => {
  try {
    const { reference } = req.params;

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      },
    );

    const paystackData = response?.data?.data;
    if (!paystackData) {
      logger.error("Invalid Paystack verify response:", response?.data);
      return res.status(502).json({
        message: "Unable to verify payment right now. Please try again.",
      });
    }

    const { status, metadata, amount } = paystackData;

    if (status !== "success") {
      return res.status(400).json({ message: "Payment not successful" });
    }

    const { vendorId, plan, days } = metadata;

    // Security: only let a vendor activate a subscription for their OWN
    // account, even though the metadata itself comes from Paystack (and
    // so can't be forged) — this stops a logged-in vendor from triggering
    // verification for a reference/vendorId pair that isn't theirs.
    if (vendorId !== req.user.id) {
      return res.status(403).json({ message: "This payment does not belong to your account." });
    }

    let result;
    try {
      result = await applySubscriptionPayment({ vendorId, plan, days, amount, reference });
    } catch (err) {
      if (err.code === "VENDOR_NOT_FOUND") {
        return res.status(404).json({ message: "Vendor not found" });
      }
      throw err;
    }

    if (result.alreadyProcessed) {
      // Not an error — just means this reference was already applied
      // (e.g. the callback already handled it). Tell the vendor it's good.
      return res.status(200).json({
        message: "Subscription already active for this payment",
        vendorId,
        plan,
      });
    }

    res.status(200).json({
      message: "Subscription activated successfully",
      vendorId,
      plan,
      newExpiry: result.newExpiry,
    });
  } catch (error) {
    logger.error("Error verifying subscription:", error);
    res.status(500).json({
      message:
        "Something went wrong verifying your payment. Please contact support if you were charged.",
    });
  }
};

const callbackSubscription = async (req, res) => {
  try {
    const { reference } = req.query;

    if (!reference) {
      return res.redirect(
        `${process.env.BASE_URL}/dashboard.html?payment=failed`,
      );
    }

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      },
    );

    const paystackData = response?.data?.data;
    if (!paystackData) {
      logger.error("Invalid Paystack callback response:", response?.data);
      return res.redirect(
        `${process.env.BASE_URL}/dashboard.html?payment=failed`,
      );
    }

    const { status, metadata, amount } = paystackData;

    if (status !== "success") {
      return res.redirect(
        `${process.env.BASE_URL}/dashboard.html?payment=failed`,
      );
    }

    const { vendorId, plan, days } = metadata;

    try {
      await applySubscriptionPayment({ vendorId, plan, days, amount, reference });
    } catch (err) {
      logger.error("Error applying subscription payment in callback:", err);
      return res.redirect(
        `${process.env.BASE_URL}/dashboard.html?payment=failed`,
      );
    }

    // redirect vendor back to dashboard with success (whether this call
    // was the one that applied it, or the webhook/verify already had)
    return res.redirect(
      `${process.env.BASE_URL}/dashboard.html?payment=success`,
    );
  } catch (error) {
    logger.error("Error in payment callback:", error);
    return res.redirect(
      `${process.env.BASE_URL}/dashboard.html?payment=failed`,
    );
  }
};

/**
 * Paystack webhook — the source of truth for payment confirmation.
 * Unlike /verify (requires the vendor to be logged in) and /callback
 * (depends on the vendor's browser completing the redirect), the webhook
 * fires server-to-server whenever Paystack confirms a charge, so a vendor
 * who pays but closes their browser before redirecting still gets
 * activated.
 *
 * Must be registered on a route WITHOUT the global JSON body parser
 * consuming it in a way that changes byte-for-byte content — see
 * paymentRoutes.js for the raw-body wiring this depends on.
 */
const paystackWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-paystack-signature"];
    const secret = process.env.PAYSTACK_SECRET_KEY;

    if (!secret) {
      logger.error("Missing PAYSTACK_SECRET_KEY — cannot verify webhook signature.");
      return res.sendStatus(500);
    }

    const expectedHash = crypto
      .createHmac("sha512", secret)
      .update(req.rawBody)
      .digest("hex");

    // Timing-safe comparison: a plain !== leaks how many leading
    // characters matched via response-time differences, which an
    // attacker can exploit to forge a valid signature byte-by-byte.
    // Buffers must be equal length for timingSafeEqual or it throws —
    // mismatched length is handled as an immediate rejection.
    const signatureBuffer = signature ? Buffer.from(signature, "utf8") : null;
    const expectedBuffer = Buffer.from(expectedHash, "utf8");
    const signatureIsValid =
      signatureBuffer &&
      signatureBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

    if (!signatureIsValid) {
      logger.error("Invalid Paystack webhook signature — rejecting.");
      return res.sendStatus(401);
    }

    const event = JSON.parse(req.rawBody.toString("utf8"));

    if (event.event === "charge.success") {
      const { metadata, amount, reference } = event.data || {};
      const { vendorId, plan, days } = metadata || {};

      if (!vendorId || !days) {
        logger.error("Webhook charge.success missing expected metadata:", metadata);
      } else {
        try {
          await applySubscriptionPayment({ vendorId, plan, days, amount, reference });
        } catch (err) {
          logger.error("Error applying subscription payment from webhook:", err);
          // Still 200 — Paystack will retry on non-2xx, and retrying won't
          // help if this was e.g. a deleted vendor. Log for manual review.
        }
      }
    }

    // Always acknowledge receipt so Paystack doesn't retry unnecessarily.
    return res.sendStatus(200);
  } catch (error) {
    logger.error("Error handling Paystack webhook:", error);
    return res.sendStatus(500);
  }
};

module.exports = {
  initializeSubscription,
  verifySubscription,
  callbackSubscription,
  paystackWebhook,
};
