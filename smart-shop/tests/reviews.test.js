jest.mock("../config/firebase", () => require("./helpers/fakeFirestore").firebaseMock);
jest.mock("../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const fake = require("./helpers/fakeFirestore");
const reviews = require("../controllers/reviewController");
const { removeVendorProfile } = require("../controllers/vendorController");

const makeRes = () => {
  const res = {};
  res.status = jest.fn((c) => ((res.code = c), res));
  res.json = jest.fn((b) => ((res.body = b), res));
  return res;
};
const call = async (handler, req) => {
  const res = makeRes();
  await handler({ body: {}, params: {}, query: {}, ...req }, res);
  return res;
};

const sub = () => ({ subscriptionStatus: "active", subscriptionExpiry: fake.daysFromNow(30) });
const user = (id, extra = {}) => ({ id, name: `${id} Full`, displayName: id, role: "user", vendorType: null, ...sub(), ...extra });
const admin = { id: "adm", role: "admin", name: "Admin" };

const profile = (extra = {}) => ({ vendorType: "service", businessName: "V Store", visibleUntil: fake.daysFromNow(10), ratingCount: 0, ratingSum: 0, ...extra });

beforeEach(() =>
  fake.reset({
    vendorProfiles: { V: profile(), HIDDEN: profile({ visibleUntil: null }) },
    reviews: {},
    products: {},
    services: {},
    vendorCollections: {},
  }),
);

const post = (reviewer, body, vendorId = "V") => call(reviews.createReview, { user: reviewer, params: { id: vendorId }, body });

describe("leaving a review", () => {
  test("saves it and updates the vendor's rating totals", async () => {
    const res = await post(user("a"), { rating: 5, comment: "Great work" });
    expect(res.code).toBe(201);
    expect(fake.store.reviews.get("V_a")).toMatchObject({ rating: 5, comment: "Great work", reviewerName: "a" });
    expect(fake.store.vendorProfiles.get("V")).toMatchObject({ ratingCount: 1, ratingSum: 5 });

    await post(user("b"), { rating: 3 });
    expect(fake.store.vendorProfiles.get("V")).toMatchObject({ ratingCount: 2, ratingSum: 8 });
  });

  test.each([[0], [6], [3.5], ["abc"], [undefined]])("rejects rating %p", async (rating) => {
    const res = await post(user("a"), { rating });
    expect(res.code).toBe(400);
    expect(fake.store.reviews.size).toBe(0);
  });

  test("rejects a comment over 500 characters", async () => {
    expect((await post(user("a"), { rating: 4, comment: "x".repeat(501) })).code).toBe(400);
  });

  test("you cannot review your own store", async () => {
    expect((await post(user("V"), { rating: 5 })).code).toBe(403);
    expect(fake.store.reviews.size).toBe(0);
  });

  test("one review per user per vendor (409), totals unchanged", async () => {
    await post(user("a"), { rating: 5 });
    const again = await post(user("a"), { rating: 1 });
    expect(again.code).toBe(409);
    expect(fake.store.vendorProfiles.get("V")).toMatchObject({ ratingCount: 1, ratingSum: 5 });
  });

  test("you cannot review a hidden or missing vendor", async () => {
    expect((await post(user("a"), { rating: 5 }, "HIDDEN")).code).toBe(404);
    expect((await post(user("a"), { rating: 5 }, "nobody")).code).toBe(404);
  });
});

describe("reading reviews", () => {
  beforeEach(async () => {
    await post(user("a"), { rating: 5, comment: "one" });
    fake.store.reviews.get("V_a").createdAt = fake.daysFromNow(-3);
    await post(user("b"), { rating: 2, comment: "two" });
    fake.store.reviews.get("V_b").createdAt = fake.daysFromNow(-1);
  });

  test("public list shows newest first with totals, and never the reviewer's id", async () => {
    const res = await call(reviews.getVendorReviews, { params: { id: "V" } });
    expect(res.code).toBe(200);
    expect(res.body.ratingCount).toBe(2);
    expect(res.body.ratingSum).toBe(7);
    expect(res.body.reviews.map((r) => r.comment)).toEqual(["two", "one"]);
    expect(JSON.stringify(res.body)).not.toMatch(/reviewerId/);
  });

  test("pages with a cursor", async () => {
    const p1 = await call(reviews.getVendorReviews, { params: { id: "V" }, query: { limit: "1" } });
    expect(p1.body.reviews).toHaveLength(1);
    const p2 = await call(reviews.getVendorReviews, { params: { id: "V" }, query: { limit: "1", cursor: p1.body.nextCursor } });
    expect(p2.body.reviews.map((r) => r.comment)).toEqual(["one"]);
    expect(p2.body.nextCursor).toBeNull();
  });

  test("a hidden vendor's reviews are not available", async () => {
    expect((await call(reviews.getVendorReviews, { params: { id: "HIDDEN" } })).code).toBe(404);
  });

  test("a vendor with no reviews returns zero totals (frontend shows 'New vendor')", async () => {
    fake.store.vendorProfiles.set("NEW", profile());
    const res = await call(reviews.getVendorReviews, { params: { id: "NEW" } });
    expect(res.body).toMatchObject({ ratingCount: 0, ratingSum: 0, reviews: [] });
  });
});

describe("editing and deleting", () => {
  beforeEach(async () => {
    await post(user("a"), { rating: 5, comment: "first" });
    await post(user("b"), { rating: 1 });
  });

  test("the author can change the rating and the totals follow", async () => {
    const res = await call(reviews.updateReview, { user: user("a"), params: { id: "V_a" }, body: { rating: 2, comment: "changed my mind" } });
    expect(res.code).toBe(200);
    expect(fake.store.reviews.get("V_a")).toMatchObject({ rating: 2, comment: "changed my mind" });
    expect(fake.store.vendorProfiles.get("V")).toMatchObject({ ratingCount: 2, ratingSum: 3 });
  });

  test("nobody else can edit it", async () => {
    const res = await call(reviews.updateReview, { user: user("b"), params: { id: "V_a" }, body: { rating: 1 } });
    expect(res.code).toBe(403);
    expect(fake.store.reviews.get("V_a").rating).toBe(5);
  });

  test("the author can delete theirs and totals drop", async () => {
    const res = await call(reviews.deleteReview, { user: user("a"), params: { id: "V_a" } });
    expect(res.code).toBe(200);
    expect(fake.store.reviews.has("V_a")).toBe(false);
    expect(fake.store.vendorProfiles.get("V")).toMatchObject({ ratingCount: 1, ratingSum: 1 });
  });

  test("an admin can delete anyone's review, a stranger cannot", async () => {
    expect((await call(reviews.deleteReview, { user: user("c"), params: { id: "V_a" } })).code).toBe(403);
    expect((await call(reviews.deleteReview, { user: admin, params: { id: "V_a" } })).code).toBe(200);
    expect(fake.store.vendorProfiles.get("V")).toMatchObject({ ratingCount: 1, ratingSum: 1 });
  });

  test("after deleting, the same person may review again", async () => {
    await call(reviews.deleteReview, { user: user("a"), params: { id: "V_a" } });
    expect((await post(user("a"), { rating: 4 })).code).toBe(201);
  });
});

describe("vendor replies", () => {
  beforeEach(async () => {
    await post(user("a"), { rating: 2, comment: "late" });
  });

  test("the reviewed vendor can reply, and the reply shows publicly", async () => {
    const res = await call(reviews.replyToReview, { user: user("V"), params: { id: "V_a" }, body: { text: "Sorry about that!" } });
    expect(res.code).toBe(200);
    const list = await call(reviews.getVendorReviews, { params: { id: "V" } });
    expect(list.body.reviews[0].reply.text).toBe("Sorry about that!");
  });

  test("another vendor cannot reply to it", async () => {
    const res = await call(reviews.replyToReview, { user: user("other"), params: { id: "V_a" }, body: { text: "hi" } });
    expect(res.code).toBe(403);
    expect(fake.store.reviews.get("V_a").reply).toBeNull();
  });

  test("replies are limited to 300 characters and cannot be empty", async () => {
    expect((await call(reviews.replyToReview, { user: user("V"), params: { id: "V_a" }, body: { text: "x".repeat(301) } })).code).toBe(400);
    expect((await call(reviews.replyToReview, { user: user("V"), params: { id: "V_a" }, body: { text: "  " } })).code).toBe(400);
  });

  test("the vendor or an admin can remove the reply", async () => {
    await call(reviews.replyToReview, { user: user("V"), params: { id: "V_a" }, body: { text: "ok" } });
    expect((await call(reviews.deleteReply, { user: user("other"), params: { id: "V_a" } })).code).toBe(403);
    expect((await call(reviews.deleteReply, { user: admin, params: { id: "V_a" } })).code).toBe(200);
    expect(fake.store.reviews.get("V_a").reply).toBeNull();
  });
});

describe("removing a vendor profile", () => {
  test("also deletes that vendor's reviews so a fresh profile starts clean", async () => {
    await post(user("a"), { rating: 5 });
    fake.store.reviews.set("OTHER_a", { vendorId: "OTHER", reviewerId: "a", rating: 3 });
    const res = await call(removeVendorProfile, { user: user("V"), body: { confirm: true } });
    expect(res.code).toBe(200);
    expect([...fake.store.reviews.keys()]).toEqual(["OTHER_a"]);
  });
});
