jest.mock("../config/firebase", () => require("./helpers/fakeFirestore").firebaseMock);

const { daysFromNow } = require("./helpers/fakeFirestore");
const {
  TRIAL_DAYS,
  buildTrialSubscription,
  isUserSubscriptionActive,
  toPublicUser,
} = require("../utils/subscription");

describe("isUserSubscriptionActive", () => {
  test("active status with a future expiry is active", () => {
    expect(isUserSubscriptionActive({ subscriptionStatus: "active", subscriptionExpiry: daysFromNow(5) })).toBe(true);
  });

  test("active status with a PAST expiry is NOT active", () => {
    expect(isUserSubscriptionActive({ subscriptionStatus: "active", subscriptionExpiry: daysFromNow(-1) })).toBe(false);
  });

  test.each(["inactive", "suspended", undefined])("status %p is not active even with a future expiry", (status) => {
    expect(isUserSubscriptionActive({ subscriptionStatus: status, subscriptionExpiry: daysFromNow(5) })).toBe(false);
  });

  test("missing expiry or missing user is not active", () => {
    expect(isUserSubscriptionActive({ subscriptionStatus: "active" })).toBe(false);
    expect(isUserSubscriptionActive(null)).toBe(false);
  });

  test("accepts Firestore-style {_seconds} timestamps coming from JSON dates", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(isUserSubscriptionActive({ subscriptionStatus: "active", subscriptionExpiry: future })).toBe(true);
  });
});

describe("buildTrialSubscription", () => {
  test("gives a 90 day active trial", () => {
    const trial = buildTrialSubscription();
    expect(trial.subscriptionStatus).toBe("active");
    expect(trial.onTrial).toBe(true);
    const days = (trial.subscriptionExpiry.toDate() - Date.now()) / 86400000;
    expect(TRIAL_DAYS).toBe(90);
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
  });
});

describe("toPublicUser", () => {
  test("removes password and every billing field but keeps the name", () => {
    const pub = toPublicUser({
      name: "Ada Obi",
      displayName: "Ada",
      password: "x",
      subscriptionStatus: "active",
      subscriptionExpiry: 1,
      lastPayment: {},
      inactivatedAt: 1,
      onTrial: true,
    });
    expect(pub).toEqual({ name: "Ada Obi", displayName: "Ada" });
  });

  test.todo("also strips email and phone once the WhatsApp redirect exists (privacy TODO)");
});
