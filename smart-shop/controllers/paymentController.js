const axios = require("axios");
const crypto = require("crypto");
const logger = require("../utils/logger");
const { db, admin } = require("../config/firebase");

const FLW_BASE_URL = "https://api.flutterwave.com/v3";

// subscription plans (amounts are whole Naira — Flutterwave does NOT use
// kobo/subunits the way Paystack does)
const PLANS = {
  monthly: { amount: 5000, days: 30, label: "Monthly" }, // ₦5,000
  yearly: { amount: 50000, days: 365, label: "Yearly" }, // ₦50,000
};

/**
 * Generates a unique tx_ref for a new payment. Flutterwave requires the
 * merchant to supply this (Paystack generates its own reference for you),
 * and it must never be reused across two different payments.
 */
const generateTxRef = (vendorId) => `SSM-${vendorId}-${crypto.randomUUID()}`;

/**
 * Confirms a Flutterwave transaction actually matches what we expect
 * before we ever call applySubscriptionPayment — status alone isn't
 * enough. Flutterwave's own docs recommend checking amount and currency
 * too, not just trusting a "successful" status.
 */
const confirmTransactionMatchesExpectation = (flwData, expectedPlan) => {
  if (!flwData) return { ok: false, reason: "No transaction data returned" };
  if (flwData.status !== "successful") {
    return { ok: false, reason: "Transaction not successful" };
  }
  if (flwData.currency !== "NGN") {
    return { ok: false, reason: `Unexpected currency: ${flwData.currency}` };
  }
  if (expectedPlan && Number(flwData.amount) < Number(expectedPlan.amount)) {
    return {
      ok: false,
      reason: `Amount paid (${flwData.amount}) is less than expected (${expectedPlan.amount})`,
    };
  }
  return { ok: true };
};

/**
 * Applies a successful Flutterwave payment to a vendor's subscription,
 * exactly once per tx_ref — no matter how many times or from which
 * entry point (verify endpoint, redirect callback, webhook) this gets
 * called for the same tx_ref.
 *
 * Uses a Firestore transaction keyed on the payment reference as an
 * idempotency guard: the first caller to successfully create the
 * `processedPayments/{txRef}` doc is the one that gets to extend the
 * subscription; every subsequent call for that same tx_ref is a no-op.
 * This prevents a vendor's subscription being double- (or infinitely-)
 * extended by replaying a reference (e.g. reloading the callback URL,
 * or the frontend calling both /verify and the callback for one payment).
 */
const applySubscriptionPayment = async ({
  vendorId,
  plan,
  days,
  amount,
  txRef,
}) => {
  return db.runTransaction(async (tx) => {
    const paymentRef = db.collection("processedPayments").doc(txRef);
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
      amount, // already in Naira — no /100 conversion needed for Flutterwave
      txRef,
      processedAt: admin.firestore.Timestamp.fromDate(new Date()),
    });

    tx.update(vendorRef, {
      subscriptionStatus: "active",
      subscriptionExpiry: admin.firestore.Timestamp.fromDate(newExpiry),
      inactivatedAt: admin.firestore.FieldValue.delete(),
      lastPayment: {
        amount,
        plan,
        paidAt: admin.firestore.Timestamp.fromDate(new Date()),
        reference: txRef,
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
    const txRef = generateTxRef(vendorId);

    const response = await axios.post(
      `${FLW_BASE_URL}/payments`,
      {
        tx_ref: txRef,
        amount: selectedPlan.amount,
        currency: "NGN",
        redirect_url: `${process.env.BASE_URL}/payments/callback`,
        customer: { email },
        meta: {
          vendorId,
          plan,
          days: selectedPlan.days,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    const flwData = response?.data?.data;
    if (!flwData?.link) {
      logger.error("Invalid Flutterwave initialize response:", response?.data);
      return res.status(502).json({
        message: "Unable to start payment right now. Please try again.",
      });
    }

    // record that this payment was started, so an abandoned/failed payment
    // isn't completely invisible — useful for support/reconciliation later
    await db
      .collection("pendingPayments")
      .doc(txRef)
      .set({
        vendorId,
        plan,
        amount: selectedPlan.amount,
        createdAt: admin.firestore.Timestamp.fromDate(new Date()),
      });

    res.status(200).json({
      message: "Subscription payment initialized",
      paymentUrl: flwData.link,
      reference: txRef,
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
      `${FLW_BASE_URL}/transactions/verify_by_reference`,
      {
        params: { tx_ref: reference },
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        },
      },
    );

    const flwData = response?.data?.data;
    if (!flwData) {
      logger.error("Invalid Flutterwave verify response:", response?.data);
      return res.status(502).json({
        message: "Unable to verify payment right now. Please try again.",
      });
    }

    const { meta, amount, tx_ref } = flwData;
    const { vendorId, plan, days } = meta || {};

    const check = confirmTransactionMatchesExpectation(flwData, PLANS[plan]);
    if (!check.ok) {
      logger.error(`Payment verification rejected: ${check.reason}`, {
        tx_ref,
        flwData,
      });
      return res.status(400).json({
        message: "Payment could not be verified. Please contact support.",
      });
    }

    // Security: only let a vendor activate a subscription for their OWN
    // account, even though meta itself comes from our own initialize call
    // (and so can't be forged) — this stops a logged-in vendor from
    // triggering verification for a reference/vendorId pair that isn't theirs.
    if (vendorId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "This payment does not belong to your account." });
    }

    let result;
    try {
      result = await applySubscriptionPayment({
        vendorId,
        plan,
        days,
        amount,
        txRef: tx_ref,
      });
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
    const { tx_ref, status, transaction_id } = req.query;

    if (!tx_ref || !transaction_id) {
      return res.redirect(
        `${process.env.BASE_URL}/dashboard.html?payment=failed`,
      );
    }

    if (status !== "successful" && status !== "completed") {
      return res.redirect(
        `${process.env.BASE_URL}/dashboard.html?payment=failed`,
      );
    }

    // Always re-verify server-side via the transaction ID — never trust
    // the redirect query params alone, they're just the customer's browser
    // telling us what happened, not a confirmed server-to-server fact.
    const response = await axios.get(
      `${FLW_BASE_URL}/transactions/${transaction_id}/verify`,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        },
      },
    );

    const flwData = response?.data?.data;
    const { meta, amount } = flwData || {};
    const { vendorId, plan, days } = meta || {};

    const check = confirmTransactionMatchesExpectation(flwData, PLANS[plan]);
    if (!flwData || flwData.tx_ref !== tx_ref || !check.ok) {
      logger.error(
        `Flutterwave callback verification rejected: ${check.reason || "tx_ref mismatch"}`,
        { tx_ref, flwData },
      );
      return res.redirect(
        `${process.env.BASE_URL}/dashboard.html?payment=failed`,
      );
    }

    try {
      await applySubscriptionPayment({
        vendorId,
        plan,
        days,
        amount,
        txRef: tx_ref,
      });
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
 * Flutterwave webhook — the source of truth for payment confirmation.
 * Unlike /verify (requires the vendor to be logged in) and /callback
 * (depends on the vendor's browser completing the redirect), the webhook
 * fires server-to-server whenever Flutterwave confirms a charge, so a vendor
 * who pays but closes their browser before redirecting still gets
 * activated.
 *
 * IMPORTANT: Flutterwave's webhook signature is NOT cryptographic like
 * Paystack's HMAC — the `verif-hash` header is just a plain secret string
 * you set yourself in the Flutterwave dashboard, compared directly. Because
 * of that weaker guarantee, we treat the webhook body only as a trigger to
 * re-verify server-side via the transaction-verify endpoint, never as proof
 * of payment on its own.
 */
const flutterwaveWebhook = async (req, res) => {
  try {
    const signature = req.headers["verif-hash"];
    const secretHash = process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH;

    if (!secretHash) {
      logger.error(
        "Missing FLUTTERWAVE_WEBHOOK_SECRET_HASH — cannot verify webhook.",
      );
      return res.sendStatus(500);
    }

    // Timing-safe comparison: a plain !== leaks how many leading
    // characters matched via response-time differences, which an
    // attacker could exploit to forge a valid header byte-by-byte.
    // Buffers must be equal length for timingSafeEqual or it throws —
    // mismatched length is handled as an immediate rejection.
    const signatureBuffer = signature ? Buffer.from(signature, "utf8") : null;
    const expectedBuffer = Buffer.from(secretHash, "utf8");
    const signatureIsValid =
      signatureBuffer &&
      signatureBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

    if (!signatureIsValid) {
      logger.error("Invalid Flutterwave webhook signature — rejecting.");
      return res.sendStatus(401);
    }

    const event = JSON.parse(req.rawBody.toString("utf8"));

    if (
      event.event === "charge.completed" &&
      event.data?.status === "successful"
    ) {
      const { id: transactionId, tx_ref } = event.data;

      // Re-verify server-side rather than trusting the webhook body's own
      // amount/meta directly — see function doc comment above.
      const verifyResponse = await axios.get(
        `${FLW_BASE_URL}/transactions/${transactionId}/verify`,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          },
        },
      );

      const flwData = verifyResponse?.data?.data;
      const { meta, amount } = flwData || {};
      const { vendorId, plan, days } = meta || {};

      const check = confirmTransactionMatchesExpectation(flwData, PLANS[plan]);
      if (!flwData || flwData.tx_ref !== tx_ref || !check.ok) {
        logger.error(
          `Flutterwave webhook re-verification rejected: ${check.reason || "tx_ref mismatch"}`,
          { tx_ref, flwData },
        );
        return res.sendStatus(200); // acknowledge receipt regardless
      }

      if (!vendorId || !days) {
        logger.error(
          "Webhook verified transaction missing expected meta:",
          meta,
        );
      } else {
        try {
          await applySubscriptionPayment({
            vendorId,
            plan,
            days,
            amount,
            txRef: tx_ref,
          });
        } catch (err) {
          logger.error(
            "Error applying subscription payment from webhook:",
            err,
          );
          // Still 200 — Flutterwave will retry on non-2xx, and retrying
          // won't help if this was e.g. a deleted vendor. Log for manual review.
        }
      }
    }

    // Always acknowledge receipt so Flutterwave doesn't retry unnecessarily.
    return res.sendStatus(200);
  } catch (error) {
    logger.error("Error handling Flutterwave webhook:", error);
    return res.sendStatus(500);
  }
};

module.exports = {
  confirmTransactionMatchesExpectation,
  initializeSubscription,
  verifySubscription,
  callbackSubscription,
  flutterwaveWebhook,
  applySubscriptionPayment, // exported for testing
};
