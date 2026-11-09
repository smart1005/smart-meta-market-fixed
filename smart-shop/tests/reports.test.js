jest.mock("../config/firebase", () => require("./helpers/fakeFirestore").firebaseMock);
jest.mock("../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const fake = require("./helpers/fakeFirestore");
const reports = require("../controllers/reportController");

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

const user = (id) => ({ id, role: "user", name: id });
const admin = { id: "adm", role: "admin" };

beforeEach(() =>
  fake.reset({
    vendorProfiles: { V: { businessName: "V Store", vendorType: "product", visibleUntil: fake.daysFromNow(9) } },
    jobs: { J: { ownerId: "poster", title: "Fix my site", description: "details", visibleUntil: fake.daysFromNow(9) } },
    reviews: { V_rev: { vendorId: "V", reviewerId: "rev", rating: 1, comment: "rude" } },
    products: { P: { vendorId: "V", name: "Shoe" } },
    services: { S: { vendorId: "V", title: "Cleaning" } },
    reports: {},
  }),
);

const report = (reporter, body) => call(reports.createReport, { user: reporter, body });
const valid = (over = {}) => ({ targetType: "vendor", targetId: "V", reason: "scam", details: "took my money", ...over });

describe("filing a report", () => {
  test.each([
    ["vendor", "V", "V"],
    ["job", "J", "poster"],
    ["review", "V_rev", "rev"],
    ["product", "P", "V"],
    ["service", "S", "V"],
  ])("can report a %s, and the owner is recorded for moderators", async (targetType, targetId, owner) => {
    const res = await report(user("u1"), valid({ targetType, targetId }));
    expect(res.code).toBe(201);
    const saved = fake.store.reports.get(`${targetType}_${targetId}_u1`);
    expect(saved).toMatchObject({ status: "open", reporterId: "u1", targetOwnerId: owner, reason: "scam" });
  });

  test("the reporter is told nothing about counts or outcomes", async () => {
    const res = await report(user("u1"), valid());
    expect(Object.keys(res.body)).toEqual(["message"]);
  });

  test.each([
    ["unknown type", { targetType: "user" }],
    ["no type", { targetType: undefined }],
    ["bad reason", { reason: "dislike" }],
    ["no reason", { reason: undefined }],
    ["path-like id", { targetId: "a/b" }],
    ["details too long", { details: "x".repeat(501) }],
  ])("rejects %s with 400", async (_n, over) => {
    const res = await report(user("u1"), valid(over));
    expect(res.code).toBe(400);
    expect(fake.store.reports.size).toBe(0);
  });

  test("reporting something that does not exist is 404", async () => {
    expect((await report(user("u1"), valid({ targetId: "nope" }))).code).toBe(404);
  });

  test("you cannot report your own content", async () => {
    expect((await report(user("V"), valid())).code).toBe(403); // own store
    expect((await report(user("poster"), valid({ targetType: "job", targetId: "J" }))).code).toBe(403); // own job
    expect((await report(user("rev"), valid({ targetType: "review", targetId: "V_rev" }))).code).toBe(403); // own review
  });

  test("the same person cannot report the same thing twice (409)", async () => {
    await report(user("u1"), valid());
    expect((await report(user("u1"), valid())).code).toBe(409);
    expect(fake.store.reports.size).toBe(1);
  });

  test("at most 10 reports per person per day (429)", async () => {
    for (let i = 0; i < 10; i++) fake.store.products.set(`p${i}`, { vendorId: "V", name: `P${i}` });
    for (let i = 0; i < 10; i++) {
      expect((await report(user("u1"), valid({ targetType: "product", targetId: `p${i}` }))).code).toBe(201);
    }
    expect((await report(user("u1"), valid())).code).toBe(429);
    expect((await report(user("u2"), valid())).code).toBe(201); // other people unaffected
  });

  test("a report alone never hides or suspends anything", async () => {
    const before = fake.store.vendorProfiles.get("V").visibleUntil;
    for (const id of ["a", "b", "c", "d", "e"]) await report(user(id), valid());
    expect(fake.store.vendorProfiles.get("V").visibleUntil).toBe(before);
    expect(fake.store.products.has("P")).toBe(true);
  });
});

describe("the moderation queue (admins)", () => {
  beforeEach(async () => {
    await report(user("a"), valid({ reason: "scam" }));
    fake.store.reports.get("vendor_V_a").createdAt = fake.daysFromNow(-3);
    await report(user("b"), valid({ reason: "spam" }));
    fake.store.reports.get("vendor_V_b").createdAt = fake.daysFromNow(-2);
    await report(user("a"), valid({ targetType: "job", targetId: "J", reason: "fake_listing" }));
    fake.store.reports.get("job_J_a").createdAt = fake.daysFromNow(-1);
  });

  test("lists newest first and shows how many reports each target has", async () => {
    const res = await call(reports.getReports, { user: admin });
    expect(res.body.reports.map((r) => r.id)).toEqual(["job_J_a", "vendor_V_b", "vendor_V_a"]);
    const vendorReport = res.body.reports.find((r) => r.id === "vendor_V_a");
    expect(vendorReport.targetReportCount).toBe(2);
  });

  test("filters by status and type, and pages", async () => {
    fake.store.reports.get("vendor_V_a").status = "dismissed";
    expect((await call(reports.getReports, { user: admin, query: { status: "dismissed" } })).body.reports).toHaveLength(1);
    expect((await call(reports.getReports, { user: admin, query: { targetType: "job" } })).body.reports).toHaveLength(1);

    const p1 = await call(reports.getReports, { user: admin, query: { limit: "2" } });
    expect(p1.body.reports).toHaveLength(2);
    const p2 = await call(reports.getReports, { user: admin, query: { limit: "2", cursor: p1.body.nextCursor } });
    expect(p2.body.reports).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
  });

  test("detail shows what was reported, or null if it was already deleted", async () => {
    const detail = await call(reports.getReport, { user: admin, params: { id: "vendor_V_a" } });
    expect(detail.body.target).toEqual({ name: "V Store", vendorType: "product" });
    expect(detail.body.targetReportCount).toBe(2);

    fake.store.jobs.delete("J");
    const gone = await call(reports.getReport, { user: admin, params: { id: "job_J_a" } });
    expect(gone.body.target).toBeNull();
  });

  test("an admin records the outcome with a note and their id", async () => {
    const res = await call(reports.updateReport, { user: admin, params: { id: "vendor_V_a" }, body: { status: "actioned", note: "Vendor suspended" } });
    expect(res.code).toBe(200);
    expect(fake.store.reports.get("vendor_V_a")).toMatchObject({ status: "actioned", adminNote: "Vendor suspended", resolvedBy: "adm" });
  });

  test("reopening clears the resolution; bad statuses are rejected", async () => {
    await call(reports.updateReport, { user: admin, params: { id: "vendor_V_a" }, body: { status: "dismissed" } });
    await call(reports.updateReport, { user: admin, params: { id: "vendor_V_a" }, body: { status: "open" } });
    expect(fake.store.reports.get("vendor_V_a")).not.toHaveProperty("resolvedBy");

    expect((await call(reports.updateReport, { user: admin, params: { id: "vendor_V_a" }, body: { status: "banned" } })).code).toBe(400);
    expect((await call(reports.updateReport, { user: admin, params: { id: "nope" }, body: { status: "open" } })).code).toBe(404);
  });
});

describe("who can reach which report route", () => {
  const { restrictTo } = require("../middleware/authMiddleware");
  const router = require("../routes/reportRoutes");

  const routeRoles = (method, path) => {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    return layer.route.stack.map((s) => s.handle);
  };

  test("every queue route is wrapped in an admin-only guard, and filing is user-only", () => {
    const roles = (method, path) => {
      // run the guard with each role and see who passes
      const guard = routeRoles(method, path)[1];
      const passes = (role) => {
        let ok = false;
        guard({ user: { role, vendorType: null } }, { status: () => ({ json: () => {} }) }, () => (ok = true));
        return ok;
      };
      return { user: passes("user"), admin: passes("admin"), superAdmin: passes("superAdmin") };
    };
    expect(roles("get", "/")).toEqual({ user: false, admin: true, superAdmin: true });
    expect(roles("get", "/:id")).toEqual({ user: false, admin: true, superAdmin: true });
    expect(roles("patch", "/:id")).toEqual({ user: false, admin: true, superAdmin: true });
    expect(roles("post", "/")).toEqual({ user: true, admin: false, superAdmin: false });
    expect(typeof restrictTo).toBe("function");
  });
});
