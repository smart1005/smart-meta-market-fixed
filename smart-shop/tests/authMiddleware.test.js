jest.mock("../config/firebase", () => require("./helpers/fakeFirestore").firebaseMock);
jest.mock("../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const fake = require("./helpers/fakeFirestore");
const {
  protect,
  restrictTo,
  checkSubscription,
  clearVendorTypeCache,
} = require("../middleware/authMiddleware");

const makeRes = () => {
  const res = {};
  res.status = jest.fn((c) => ((res.code = c), res));
  res.json = jest.fn((b) => ((res.body = b), res));
  return res;
};

describe("restrictTo (roles + vendor-profile based access)", () => {
  const run = (user, ...roles) => {
    const res = makeRes();
    const next = jest.fn();
    restrictTo(...roles)({ user }, res, next);
    return { res, next };
  };

  test("a product vendor passes productVendor and vendor, but not serviceVendor", () => {
    const user = { role: "user", vendorType: "product" };
    expect(run(user, "productVendor").next).toHaveBeenCalled();
    expect(run(user, "vendor").next).toHaveBeenCalled();
    expect(run(user, "serviceVendor").res.code).toBe(403);
  });

  test("a service vendor passes serviceVendor but not productVendor", () => {
    const user = { role: "user", vendorType: "service" };
    expect(run(user, "serviceVendor").next).toHaveBeenCalled();
    expect(run(user, "productVendor").res.code).toBe(403);
  });

  test("a plain user (no vendor profile) is blocked from all vendor access", () => {
    const user = { role: "user", vendorType: null };
    ["vendor", "productVendor", "serviceVendor"].forEach((r) => {
      expect(run(user, r).res.code).toBe(403);
    });
  });

  test("admin passes admin-only routes; a user does not", () => {
    expect(run({ role: "admin" }, "admin", "superAdmin").next).toHaveBeenCalled();
    expect(run({ role: "user" }, "admin", "superAdmin").res.code).toBe(403);
  });

  test("only superAdmin passes a superAdmin-only route", () => {
    expect(run({ role: "admin" }, "superAdmin").res.code).toBe(403);
    expect(run({ role: "superAdmin" }, "superAdmin").next).toHaveBeenCalled();
  });
});

describe("checkSubscription", () => {
  beforeEach(() => fake.reset({ users: { u1: { subscriptionStatus: "active" } } }));

  const run = async (user) => {
    const res = makeRes();
    const next = jest.fn();
    await checkSubscription({ user }, res, next);
    return { res, next };
  };

  test("admins and superAdmins are exempt", async () => {
    expect((await run({ id: "a", role: "admin" })).next).toHaveBeenCalled();
    expect((await run({ id: "a", role: "superAdmin" })).next).toHaveBeenCalled();
  });

  test("an active, unexpired user passes", async () => {
    const { next } = await run({ id: "u1", role: "user", subscriptionStatus: "active", subscriptionExpiry: fake.daysFromNow(10) });
    expect(next).toHaveBeenCalled();
  });

  test("an expired user gets 403 SUBSCRIPTION_REQUIRED and the account is marked inactive", async () => {
    const { res, next } = await run({ id: "u1", role: "user", subscriptionStatus: "active", subscriptionExpiry: fake.daysFromNow(-2) });
    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(403);
    expect(res.body.code).toBe("SUBSCRIPTION_REQUIRED");
    expect(fake.store.users.get("u1").subscriptionStatus).toBe("inactive");
  });

  test("a suspended user is blocked even with a future expiry", async () => {
    const { res } = await run({ id: "u1", role: "user", subscriptionStatus: "suspended", subscriptionExpiry: fake.daysFromNow(10) });
    expect(res.code).toBe(403);
  });
});

describe("protect", () => {
  beforeEach(() => {
    clearVendorTypeCache("p1");
    fake.reset({
      users: { p1: { role: "user", name: "Pat", subscriptionStatus: "active", subscriptionExpiry: fake.daysFromNow(5) } },
      vendorProfiles: { p1: { vendorType: "product" } },
    });
    fake.authMock.verifyIdToken.mockResolvedValue({ uid: "p1", email: "p@x.com" });
  });

  const run = async (header) => {
    const req = { headers: header ? { authorization: header } : {} };
    const res = makeRes();
    const next = jest.fn();
    await protect(req, res, next);
    return { req, res, next };
  };

  test("rejects a request with no token", async () => {
    expect((await run()).res.code).toBe(401);
  });

  test("attaches role, subscription and vendorType to req.user", async () => {
    const { req, next } = await run("Bearer abc");
    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({ id: "p1", role: "user", vendorType: "product", subscriptionStatus: "active" });
  });

  test("rejects a token whose user doc does not exist", async () => {
    fake.authMock.verifyIdToken.mockResolvedValue({ uid: "ghost" });
    expect((await run("Bearer abc")).res.code).toBe(401);
  });

  test("vendorType is cached, and clearVendorTypeCache makes a change show immediately", async () => {
    await run("Bearer abc");
    fake.store.vendorProfiles.set("p1", { vendorType: "service" });

    expect((await run("Bearer abc")).req.user.vendorType).toBe("product"); // cached
    clearVendorTypeCache("p1");
    expect((await run("Bearer abc")).req.user.vendorType).toBe("service"); // fresh
  });
});
