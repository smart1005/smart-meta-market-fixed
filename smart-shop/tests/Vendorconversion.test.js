jest.mock(
  "../config/firebase",
  () => require("./helpers/fakeFirestore").firebaseMock,
);
jest.mock("../utils/logger", () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}));
jest.mock("cloudinary", () => ({
  v2: { uploader: { destroy: jest.fn().mockResolvedValue({}) } },
}));

const fake = require("./helpers/fakeFirestore");
const {
  becomeVendor,
  removeVendorProfile,
} = require("../controllers/vendorController");
const { protect } = require("../middleware/authMiddleware");

const makeRes = () => {
  const res = {};
  res.status = jest.fn((c) => ((res.code = c), res));
  res.json = jest.fn((b) => ((res.body = b), res));
  return res;
};
const call = async (handler, req) => {
  const res = makeRes();
  await handler({ body: {}, ...req }, res);
  return res;
};

const user = () => ({
  id: "u1",
  role: "user",
  subscriptionStatus: "active",
  subscriptionExpiry: fake.daysFromNow(40),
});
const body = (over = {}) => ({
  vendorType: "product",
  businessName: "Ada Store",
  state: "Lagos",
  lga: "Ikeja",
  ...over,
});

beforeEach(() =>
  fake.reset({
    vendorProfiles: {},
    products: {},
    services: {},
    vendorCollections: {},
    users: { u1: { role: "user" } },
  }),
);

describe("becomeVendor", () => {
  test("creates a vendor profile with the chosen type, location and visibleUntil", async () => {
    const u = user();
    const res = await call(becomeVendor, { user: u, body: body() });
    expect(res.code).toBe(201);
    const profile = fake.store.vendorProfiles.get("u1");
    expect(profile).toMatchObject({
      vendorType: "product",
      businessName: "Ada Store",
    });
    expect(profile.location).toBeTruthy();
    expect(profile.visibleUntil).toBe(u.subscriptionExpiry);
    expect(profile).not.toHaveProperty("subscriptionStatus");
  });

  test("a service vendor can be created too", async () => {
    const res = await call(becomeVendor, {
      user: user(),
      body: body({ vendorType: "service" }),
    });
    expect(res.code).toBe(201);
    expect(fake.store.vendorProfiles.get("u1").vendorType).toBe("service");
  });

  test("cannot become a vendor twice (409) and the type cannot be changed this way", async () => {
    await call(becomeVendor, { user: user(), body: body() });
    const res = await call(becomeVendor, {
      user: user(),
      body: body({ vendorType: "service" }),
    });
    expect(res.code).toBe(409);
    expect(fake.store.vendorProfiles.get("u1").vendorType).toBe("product");
  });

  test.each([
    ["bad type", { vendorType: "both" }],
    ["no type", { vendorType: undefined }],
    ["short name", { businessName: "A" }],
    ["no location", { state: undefined }],
    ["fake LGA", { lga: "Not A Real LGA" }],
  ])("rejects %s with 400 and creates nothing", async (_n, over) => {
    const res = await call(becomeVendor, { user: user(), body: body(over) });
    expect(res.code).toBe(400);
    expect(fake.store.vendorProfiles.size).toBe(0);
  });

  test("the vendor-type cache is cleared so access works immediately", async () => {
    fake.authMock.verifyIdToken.mockResolvedValue({
      uid: "u1",
      email: "a@b.com",
    });
    const asUser = async () => {
      const req = { headers: { authorization: "Bearer t" } };
      await protect(req, makeRes(), jest.fn());
      return req.user.vendorType;
    };
    expect(await asUser()).toBeNull(); // cached as "not a vendor"
    await call(becomeVendor, { user: user(), body: body() });
    expect(await asUser()).toBe("product"); // visible right away
  });
});

describe("removeVendorProfile", () => {
  const seed = () =>
    fake.reset({
      vendorProfiles: {
        u1: { vendorType: "product" },
        u2: { vendorType: "service" },
      },
      products: {
        p1: { vendorId: "u1" },
        p2: { vendorId: "u1" },
        p3: { vendorId: "u2" },
      },
      services: { s1: { vendorId: "u2" } },
      vendorCollections: { c1: { vendorId: "u1" }, c2: { vendorId: "u2" } },
      users: { u1: { role: "user" } },
    });

  test("requires explicit confirmation", async () => {
    seed();
    const res = await call(removeVendorProfile, { user: user(), body: {} });
    expect(res.code).toBe(400);
    expect(fake.store.vendorProfiles.has("u1")).toBe(true);
  });

  test("deletes the profile and ALL of that vendor's listings, and nobody else's", async () => {
    seed();
    const res = await call(removeVendorProfile, {
      user: user(),
      body: { confirm: true },
    });
    expect(res.code).toBe(200);
    expect(fake.store.vendorProfiles.has("u1")).toBe(false);
    expect([...fake.store.products.keys()]).toEqual(["p3"]);
    expect([...fake.store.vendorCollections.keys()]).toEqual(["c2"]);
    expect(fake.store.vendorProfiles.has("u2")).toBe(true);
    expect(fake.store.services.has("s1")).toBe(true);
    expect(fake.store.users.has("u1")).toBe(true); // the account itself stays
  });

  test("a non-vendor gets 404", async () => {
    seed();
    const res = await call(removeVendorProfile, {
      user: { ...user(), id: "nobody" },
      body: { confirm: true },
    });
    expect(res.code).toBe(404);
  });

  test("after removal the user can become the OTHER type", async () => {
    seed();
    await call(removeVendorProfile, { user: user(), body: { confirm: true } });
    const res = await call(becomeVendor, {
      user: user(),
      body: body({ vendorType: "service" }),
    });
    expect(res.code).toBe(201);
    expect(fake.store.vendorProfiles.get("u1").vendorType).toBe("service");
  });
});
