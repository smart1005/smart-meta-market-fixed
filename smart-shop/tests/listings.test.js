jest.mock("../config/firebase", () => require("./helpers/fakeFirestore").firebaseMock);
jest.mock("../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock("cloudinary", () => ({ v2: { uploader: { destroy: jest.fn().mockResolvedValue({}) } } }));

const fake = require("./helpers/fakeFirestore");
const { getProducts } = require("../controllers/productController");
const { getServices } = require("../controllers/serviceController");
const { getVendors, getVendorProfile } = require("../controllers/vendorController");

const makeRes = () => {
  const res = {};
  res.status = jest.fn((c) => ((res.code = c), res));
  res.json = jest.fn((b) => ((res.body = b), res));
  return res;
};
const call = async (handler, req) => {
  const res = makeRes();
  await handler({ query: {}, params: {}, ...req }, res);
  return res;
};

// owner A visible, B suspended (null), C expired (past), D never stamped
const listing = (vendorId, visibleUntil) => ({ vendorId, visibleUntil, category: "Fashion", name: vendorId });
const seedListings = () => ({
  A: listing("A", fake.daysFromNow(30)),
  B: listing("B", null),
  C: listing("C", fake.daysFromNow(-3)),
  D: { vendorId: "D", category: "Fashion", name: "D" },
  E: listing("E", fake.daysFromNow(10)),
  F: listing("F", fake.daysFromNow(20)),
});

describe.each([
  ["products", getProducts, "products"],
  ["services", getServices, "services"],
])("public %s listing", (name, handler, key) => {
  beforeEach(() => fake.reset({ products: seedListings(), services: seedListings() }));

  test("shows only listings whose owner is currently visible", async () => {
    const res = await call(handler, {});
    expect(res.code).toBe(200);
    const owners = res.body[key].map((i) => i.vendorId).sort();
    expect(owners).toEqual(["A", "E", "F"]); // not B (suspended), C (expired), D (unstamped)
  });

  test("category filter still applies on top of visibility", async () => {
    fake.store[key].set("G", { ...listing("G", fake.daysFromNow(5)), category: "Cleaning" });
    const res = await call(handler, { query: { category: "Cleaning" } });
    expect(res.body[key].map((i) => i.vendorId)).toEqual(["G"]);
  });

  test("pages through results with nextCursor and no repeats or gaps", async () => {
    const page1 = await call(handler, { query: { limit: "2" } });
    expect(page1.body[key]).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await call(handler, { query: { limit: "2", cursor: page1.body.nextCursor } });
    expect(page2.body[key]).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();

    const all = [...page1.body[key], ...page2.body[key]].map((i) => i.vendorId).sort();
    expect(all).toEqual(["A", "E", "F"]);
  });

  test("a vendor's OWN list is not hidden, even when expired or suspended", async () => {
    for (const owner of ["B", "C"]) {
      const res = await call(handler, { query: { vendorId: owner } });
      expect(res.body[key]).toHaveLength(1);
    }
  });

  test("the public query asks Firestore for visibleUntil > now (fast query, no owner lookups)", async () => {
    await call(handler, {});
    const q = fake.queries.find((x) => x.collection === key);
    expect(q.wheres.some(([f, op]) => f === "visibleUntil" && op === ">")).toBe(true);
    expect(fake.queries.every((x) => x.collection === key)).toBe(true);
  });
});

describe("public vendor list and vendor page", () => {
  beforeEach(() =>
    fake.reset({
      vendorProfiles: {
        A: { businessName: "A Store", vendorType: "product", visibleUntil: fake.daysFromNow(30) },
        B: { businessName: "B Store", vendorType: "product", visibleUntil: null },
        C: { businessName: "C Store", vendorType: "service", visibleUntil: fake.daysFromNow(-1) },
      },
      users: {
        A: { name: "Ada Obi", displayName: "Ada", role: "user", subscriptionStatus: "active", subscriptionExpiry: fake.daysFromNow(30), lastPayment: { amount: 1000 } },
        B: { name: "Bola", role: "user", subscriptionStatus: "suspended", subscriptionExpiry: fake.daysFromNow(30) },
        C: { name: "Chi", role: "user", subscriptionStatus: "active", subscriptionExpiry: fake.daysFromNow(-1) },
      },
    }),
  );

  test("lists only visible vendors", async () => {
    const res = await call(getVendors, {});
    expect(res.body.vendors.map((v) => v.id)).toEqual(["A"]);
  });

  test("never leaks billing fields, and keeps the full name for trust", async () => {
    const res = await call(getVendors, {});
    const vendor = res.body.vendors[0];
    expect(vendor.name).toBe("Ada Obi");
    expect(vendor.displayName).toBe("Ada");
    ["subscriptionStatus", "subscriptionExpiry", "lastPayment", "visibleUntil", "password"].forEach((f) =>
      expect(vendor).not.toHaveProperty(f),
    );
  });

  test("a suspended or expired vendor's page returns 404", async () => {
    expect((await call(getVendorProfile, { params: { id: "B" } })).code).toBe(404);
    expect((await call(getVendorProfile, { params: { id: "C" } })).code).toBe(404);
  });

  test("an active vendor's page loads without billing fields", async () => {
    const res = await call(getVendorProfile, { params: { id: "A" } });
    expect(res.code).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/subscriptionStatus|subscriptionExpiry|lastPayment/);
  });
});
