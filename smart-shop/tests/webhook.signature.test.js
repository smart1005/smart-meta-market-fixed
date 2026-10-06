/**
 * Tests for flutterwaveWebhook's signature verification — the gate that
 * decides whether an incoming webhook request is trusted at all.
 *
 * Unlike Paystack's HMAC, Flutterwave's verif-hash is a plain secret
 * string comparison, so these tests specifically confirm:
 *   - a correct secret is accepted
 *   - a wrong secret is rejected with 401, and crucially never reaches
 *     the point of re-verifying/applying a payment
 *   - a missing header is rejected the same way
 *   - a missing server-side secret fails closed (500), not open
 *
 * axios and the Firestore config are both mocked so these run in
 * isolation, with no real network or database calls.
 */

jest.mock("axios");
const axios = require("axios");

jest.mock("../utils/logger", () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}));

let store;
const resetStore = () => {
  store = {
    processedPayments: new Map(),
    vendorProfiles: new Map([
      [
        "vendor-1",
        { subscriptionStatus: "inactive", subscriptionExpiry: null },
      ],
    ]),
  };
};

const fakeTimestamp = (date) => ({ toDate: () => date, __isTimestamp: true });

const fakeDb = {
  collection: (name) => ({ doc: (id) => ({ collection: name, id }) }),
  runTransaction: async (callback) => {
    const tx = {
      get: async (ref) => {
        const data = store[ref.collection].get(ref.id);
        return { exists: !!data, data: () => data };
      },
      set: (ref, data) => store[ref.collection].set(ref.id, data),
      update: (ref, data) => {
        const existing = store[ref.collection].get(ref.id) || {};
        store[ref.collection].set(ref.id, { ...existing, ...data });
      },
    };
    return callback(tx);
  },
};

jest.mock("../config/firebase", () => ({
  db: fakeDb,
  admin: {
    firestore: {
      Timestamp: { fromDate: (date) => fakeTimestamp(date) },
      FieldValue: { delete: () => ({ __isDeleteField: true }) },
    },
  },
}));

const { flutterwaveWebhook } = require("../controllers/paymentController");

const SECRET = "test-webhook-secret-hash-123";

const makeReq = (bodyObj, signature) => ({
  headers: signature !== undefined ? { "verif-hash": signature } : {},
  rawBody: Buffer.from(JSON.stringify(bodyObj)),
});

const makeRes = () => ({
  sendStatus: jest.fn(),
});

const samplePayload = {
  event: "charge.completed",
  data: {
    id: 12345,
    tx_ref: "SSM-vendor-1-abc123",
    status: "successful",
    amount: 5000,
    currency: "NGN",
    meta: { vendorId: "vendor-1", plan: "monthly", days: 30 },
  },
};

describe("flutterwaveWebhook — signature verification", () => {
  const originalSecret = process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH;

  beforeEach(() => {
    resetStore();
    axios.get.mockReset();
    process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH = SECRET;
  });

  afterAll(() => {
    process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH = originalSecret;
  });

  test("rejects with 401 when the signature header is missing entirely", async () => {
    const req = makeReq(samplePayload, undefined);
    const res = makeRes();

    await flutterwaveWebhook(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("rejects with 401 when the signature is wrong — and never calls Flutterwave to re-verify", async () => {
    const req = makeReq(samplePayload, "definitely-the-wrong-secret");
    const res = makeRes();

    await flutterwaveWebhook(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    // the critical assertion: a bad signature must short-circuit BEFORE
    // any Flutterwave API call or Firestore write is attempted
    expect(axios.get).not.toHaveBeenCalled();
    expect(store.processedPayments.size).toBe(0);
  });

  test("rejects with 401 for a signature of the wrong length (not just wrong content)", async () => {
    const req = makeReq(samplePayload, "short");
    const res = makeRes();

    await flutterwaveWebhook(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("fails closed with 500 if the server has no secret configured — never silently accepts everything", async () => {
    delete process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH;
    const req = makeReq(samplePayload, "anything-at-all");
    const res = makeRes();

    await flutterwaveWebhook(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(500);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("accepts a correct signature, re-verifies with Flutterwave, and activates the subscription", async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        data: {
          status: "successful",
          currency: "NGN",
          amount: 5000,
          tx_ref: samplePayload.data.tx_ref,
          meta: samplePayload.data.meta,
        },
      },
    });

    const req = makeReq(samplePayload, SECRET);
    const res = makeRes();

    await flutterwaveWebhook(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(axios.get).toHaveBeenCalledTimes(1);

    const vendor = store.vendorProfiles.get("vendor-1");
    expect(vendor.subscriptionStatus).toBe("active");
    expect(
      store.processedPayments.get(samplePayload.data.tx_ref),
    ).toBeDefined();
  });

  test("a correct signature but a failed re-verification does NOT activate the subscription", async () => {
    // simulates Flutterwave's own verify endpoint disagreeing with the
    // webhook body — e.g. amount tampering or a stale/replayed webhook
    axios.get.mockResolvedValueOnce({
      data: {
        data: {
          status: "failed",
          currency: "NGN",
          amount: 5000,
          tx_ref: samplePayload.data.tx_ref,
          meta: samplePayload.data.meta,
        },
      },
    });

    const req = makeReq(samplePayload, SECRET);
    const res = makeRes();

    await flutterwaveWebhook(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(200); // still acks receipt
    const vendor = store.vendorProfiles.get("vendor-1");
    expect(vendor.subscriptionStatus).toBe("inactive"); // but NOT activated
    expect(store.processedPayments.size).toBe(0);
  });
});
