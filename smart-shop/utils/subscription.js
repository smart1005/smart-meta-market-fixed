const { admin } = require("../config/firebase");

// Account-level subscription rules (replaces vendor-level subscriptions)
const TRIAL_DAYS = 90; // 3 months free for every new user
const SUBSCRIPTION_DAYS = 30; // each payment buys 30 days
const SUBSCRIPTION_PRICE_NGN = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const toDate = (raw) =>
  raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null;

// Fields stored on users/{uid} when an account is created
const buildTrialSubscription = () => ({
  subscriptionStatus: "active",
  subscriptionExpiry: admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + TRIAL_DAYS * DAY_MS),
  ),
  onTrial: true,
});

// True only when status is "active" AND the expiry date is still in the future.
// Pure check: it reads data and changes nothing.
const isUserSubscriptionActive = (userData) => {
  if (!userData || userData.subscriptionStatus !== "active") return false;
  const expiry = toDate(userData.subscriptionExpiry);
  return !!expiry && !isNaN(expiry.getTime()) && expiry > new Date();
};

const PRIVATE_USER_FIELDS = [
  "password",
  "subscriptionStatus",
  "subscriptionExpiry",
  "lastPayment",
  "inactivatedAt",
  "onTrial",
  "migratedToUserAt",
];

// A copy of the user doc that is safe to show publicly
const toPublicUser = (userData) => {
  const copy = { ...userData };
  PRIVATE_USER_FIELDS.forEach((f) => delete copy[f]);
  return copy;
};

module.exports = {
  toPublicUser,
  TRIAL_DAYS,
  SUBSCRIPTION_DAYS,
  SUBSCRIPTION_PRICE_NGN,
  buildTrialSubscription,
  isUserSubscriptionActive,
};
