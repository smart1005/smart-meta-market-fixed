/**
 * Tests for applySubscriptionPayment — the Firestore-transaction-based
 * idempotency guard that prevents a payment reference from being replayed
 * to double- or infinitely-extend a vendor's subscription.
 *
 * Firestore is mocked with a minimal in-memory fake rather than a real
 * emulator, so these run fast with no setup.
 */

let store;

const resetStore = (initialVendor) => {
  store = {
    processedPayments: new Map(),
    vendorProfiles: new Map([["vendor-1", { ...initialVendor }]]),
  };
};

const fakeDb = {
  collection: (name) => ({
    doc: (id) => ({ collection: name, id }),
  }),
  runTransaction: async (callback) => {
    const tx = {
      get: async (ref) => {
        const data = store[ref.collection].get(ref.id);
        return { exists: !!data, data: () => data };
      },
      set: (ref, data) => {
        store[ref.collection].set(ref.id, data);
      },
      update: (ref, data) => {
        const existing = store[ref.collection].get(ref.id) || {};
        const merged = { ...existing };
        for (const key of Object.keys(data)) {
          if (data[key] && data[key].__isDeleteField) {
            delete merged[key];
          } else {
            merged[key] = data[key];
          }
        }
        store[ref.collection].set(ref.id, merged);
      },
    };
    return callback(tx);
  },
};

const fakeTimestamp = (date) => ({
  toDate: () => date,
  __isTimestamp: true,
});

jest.mock("../config/firebase", () => ({
  db: fakeDb,
  admin: {
    firestore: {
      Timestamp: {
        fromDate: (date) => fakeTimestamp(date),
      },
      FieldValue: {
        delete: () => ({ __isDeleteField: true }),
      },
    },
  },
}));

const {
  applySubscriptionPayment,
} = require("../controllers/paymentController");

describe("applySubscriptionPayment — idempotency", () => {
  const baseVendor = {
    subscriptionStatus: "inactive",
    subscriptionExpiry: null,
  };

  beforeEach(() => {
    resetStore(baseVendor);
  });

  test("activates a vendor on first payment", async () => {
    const result = await applySubscriptionPayment({
      vendorId: "vendor-1",
      plan: "monthly",
      days: 30,
      amount: 5000,
      txRef: "tx-ref-001",
    });

    expect(result.alreadyProcessed).toBe(false);
    expect(result.newExpiry).toBeInstanceOf(Date);

    const vendor = store.vendorProfiles.get("vendor-1");
    expect(vendor.subscriptionStatus).toBe("active");
    expect(vendor.subscriptionExpiry.toDate()).toEqual(result.newExpiry);

    const payment = store.processedPayments.get("tx-ref-001");
    expect(payment).toBeDefined();
    expect(payment.vendorId).toBe("vendor-1");
  });

  test("replaying the same txRef is a no-op — does NOT extend the subscription again", async () => {
    const first = await applySubscriptionPayment({
      vendorId: "vendor-1",
      plan: "monthly",
      days: 30,
      amount: 5000,
      txRef: "tx-ref-002",
    });

    const vendorAfterFirst = { ...store.vendorProfiles.get("vendor-1") };

    const second = await applySubscriptionPayment({
      vendorId: "vendor-1",
      plan: "monthly",
      days: 30,
      amount: 5000,
      txRef: "tx-ref-002",
    });

    expect(first.alreadyProcessed).toBe(false);
    expect(second.alreadyProcessed).toBe(true);
    expect(second.newExpiry).toBeNull();

    const vendorAfterSecond = store.vendorProfiles.get("vendor-1");
    expect(vendorAfterSecond.subscriptionExpiry.toDate()).toEqual(
      vendorAfterFirst.subscriptionExpiry.toDate(),
    );
  });

  test("a DIFFERENT txRef for the same vendor extends normally (not blocked by the guard)", async () => {
    await applySubscriptionPayment({
      vendorId: "vendor-1",
      plan: "monthly",
      days: 30,
      amount: 5000,
      txRef: "tx-ref-003a",
    });

    const result = await applySubscriptionPayment({
      vendorId: "vendor-1",
      plan: "monthly",
      days: 30,
      amount: 5000,
      txRef: "tx-ref-003b",
    });

    expect(result.alreadyProcessed).toBe(false);
    expect(result.newExpiry).toBeInstanceOf(Date);
  });

  test("extends from current expiry when subscription is still active (not from today)", async () => {
    const futureExpiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    resetStore({
      subscriptionStatus: "active",
      subscriptionExpiry: fakeTimestamp(futureExpiry),
    });

    const result = await applySubscriptionPayment({
      vendorId: "vendor-1",
      plan: "monthly",
      days: 30,
      amount: 5000,
      txRef: "tx-ref-004",
    });

    const expectedExpiry = new Date(
      futureExpiry.getTime() + 30 * 24 * 60 * 60 * 1000,
    );

    expect(
      Math.abs(result.newExpiry.getTime() - expectedExpiry.getTime()),
    ).toBeLessThan(1000);
  });

  test("extends from today when subscription has already expired (not from the stale past expiry)", async () => {
    const pastExpiry = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    resetStore({
      subscriptionStatus: "inactive",
      subscriptionExpiry: fakeTimestamp(pastExpiry),
    });

    const result = await applySubscriptionPayment({
      vendorId: "vendor-1",
      plan: "monthly",
      days: 30,
      amount: 5000,
      txRef: "tx-ref-005",
    });

    const expectedExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    expect(
      Math.abs(result.newExpiry.getTime() - expectedExpiry.getTime()),
    ).toBeLessThan(1000);
  });

  test("throws VENDOR_NOT_FOUND for a non-existent vendor, and does not create a processedPayments record", async () => {
    await expect(
      applySubscriptionPayment({
        vendorId: "no-such-vendor",
        plan: "monthly",
        days: 30,
        amount: 5000,
        txRef: "tx-ref-006",
      }),
    ).rejects.toMatchObject({ code: "VENDOR_NOT_FOUND" });

    expect(store.processedPayments.has("tx-ref-006")).toBe(false);
  });
});