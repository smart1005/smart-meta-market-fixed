jest.mock("../config/firebase", () => require("./helpers/fakeFirestore").firebaseMock);
jest.mock("../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const fake = require("./helpers/fakeFirestore");
const jobs = require("../controllers/jobController");
const { syncOwnerVisibility } = require("../utils/visibility");

const makeRes = () => {
  const res = { headers: {} };
  res.status = jest.fn((c) => ((res.code = c), res));
  res.json = jest.fn((b) => ((res.body = b), res));
  res.set = jest.fn((k, v) => ((res.headers[k] = v), res));
  res.type = jest.fn(() => res);
  res.send = jest.fn((b) => ((res.body = b), res));
  res.redirect = jest.fn((c, url) => ((res.code = c), (res.location = url), res));
  return res;
};
const call = async (handler, req) => {
  const res = makeRes();
  await handler({ body: {}, params: {}, query: {}, ...req }, res);
  return res;
};

const active = (extra = {}) => ({ subscriptionStatus: "active", subscriptionExpiry: fake.daysFromNow(30), ...extra });
const owner = () => ({ id: "owner", name: "Olu Owner", displayName: "Olu", role: "user", vendorType: null, ...active() });
const worker = (over = {}) => ({ id: "worker", name: "Wale Worker", displayName: "Wale", role: "user", vendorType: null, ...active(), ...over });

const validJob = (over = {}) => ({
  title: "Proofread my 60 page PDF",
  description: "Need someone to proofread a 60 page PDF report carefully.",
  category: "Proofreading",
  budget: { amount: 15000, negotiable: true },
  ...over,
});

const seedJob = (id, ownerId, visibleUntil = fake.daysFromNow(10), extra = {}) => ({
  ownerId,
  title: `Job ${id}`,
  description: "A description that is long enough",
  category: "Proofreading",
  budget: { amount: 1000, negotiable: false },
  location: "",
  visibleUntil,
  createdAt: fake.daysFromNow(-1),
  ...extra,
});

beforeEach(() =>
  fake.reset({
    users: {
      owner: { displayName: "Olu", phoneNormalized: "2348011111111" },
      worker: { displayName: "Wale", phoneNormalized: "2348022222222" },
    },
    jobs: {},
    applications: {},
    contactTokens: {},
  }),
);

describe("posting jobs", () => {
  test("creates an open job stamped with the owner's visibility, and never echoes the owner id", async () => {
    const u = owner();
    const res = await call(jobs.createJob, { user: u, body: validJob() });
    expect(res.code).toBe(201);
    expect(res.body.job).not.toHaveProperty("ownerId");
    const saved = fake.store.jobs.get(res.body.job.id);
    expect(saved.ownerId).toBe("owner");
    expect(saved.visibleUntil).toBe(u.subscriptionExpiry);
    expect(typeof saved.rand).toBe("number");
    expect(saved.location).toBe(""); // optional
  });

  test("location is optional free text", async () => {
    const res = await call(jobs.createJob, { user: owner(), body: validJob({ location: "Online, any area" }) });
    expect(fake.store.jobs.get(res.body.job.id).location).toBe("Online, any area");
  });

  test.each([
    ["short title", { title: "ab" }],
    ["short description", { description: "too short" }],
    ["no category", { category: "" }],
    ["zero budget", { budget: { amount: 0 } }],
    ["text budget", { budget: { amount: "lots" } }],
    ["huge location", { location: "x".repeat(151) }],
  ])("rejects %s", async (_n, over) => {
    const res = await call(jobs.createJob, { user: owner(), body: validJob(over) });
    expect(res.code).toBe(400);
    expect(fake.store.jobs.size).toBe(0);
  });

  test("a user can have at most 5 open jobs", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await call(jobs.createJob, { user: owner(), body: validJob() })).code).toBe(201);
    }
    const res = await call(jobs.createJob, { user: owner(), body: validJob() });
    expect(res.code).toBe(409);
    expect(fake.store.jobs.size).toBe(5);
  });
});

describe("the public job board", () => {
  beforeEach(() => {
    fake.store.jobs.set("a", seedJob("a", "owner", fake.daysFromNow(30), { applicantCount: 9 }));
    fake.store.jobs.set("b", seedJob("b", "owner", null)); // owner suspended
    fake.store.jobs.set("c", seedJob("c", "owner", fake.daysFromNow(-2))); // expired
    fake.store.jobs.set("d", seedJob("d", "other", fake.daysFromNow(20), { category: "Design" }));
  });

  test("lists only jobs whose owner is currently subscribed", async () => {
    const res = await call(jobs.getJobs, {});
    expect(res.body.jobs.map((j) => j.id).sort()).toEqual(["a", "d"]);
  });

  test("never shows who posted a job or how many applied", async () => {
    const res = await call(jobs.getJobs, {});
    res.body.jobs.forEach((j) => {
      expect(j).not.toHaveProperty("ownerId");
      expect(j).not.toHaveProperty("applicantCount");
      expect(j).not.toHaveProperty("visibleUntil");
    });
  });

  test("filters by category and pages with a cursor", async () => {
    const design = await call(jobs.getJobs, { query: { category: "Design" } });
    expect(design.body.jobs.map((j) => j.id)).toEqual(["d"]);

    const p1 = await call(jobs.getJobs, { query: { limit: "1" } });
    expect(p1.body.jobs).toHaveLength(1);
    const p2 = await call(jobs.getJobs, { query: { limit: "1", cursor: p1.body.nextCursor } });
    expect(p2.body.jobs).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
  });

  test("a single job page is public, but hidden jobs return 404", async () => {
    expect((await call(jobs.getJobById, { params: { id: "a" } })).code).toBe(200);
    expect((await call(jobs.getJobById, { params: { id: "b" } })).code).toBe(404);
    expect((await call(jobs.getJobById, { params: { id: "nope" } })).code).toBe(404);
  });
});

describe("editing and closing (deleting) jobs", () => {
  beforeEach(() => {
    fake.store.jobs.set("j1", seedJob("j1", "owner"));
    fake.store.jobs.set("j2", seedJob("j2", "other"));
    fake.store.applications.set("j1_worker", { jobId: "j1", applicantId: "worker" });
    fake.store.applications.set("j2_worker", { jobId: "j2", applicantId: "worker" });
  });

  test("the owner can edit; someone else gets 403", async () => {
    const ok = await call(jobs.updateJob, { user: owner(), params: { id: "j1" }, body: { title: "New title here" } });
    expect(ok.code).toBe(200);
    expect(fake.store.jobs.get("j1").title).toBe("New title here");

    const bad = await call(jobs.updateJob, { user: worker(), params: { id: "j1" }, body: { title: "Hacked title" } });
    expect(bad.code).toBe(403);
  });

  test("closing needs confirmation and then deletes the job AND its applications", async () => {
    expect((await call(jobs.deleteJob, { user: owner(), params: { id: "j1" }, body: {} })).code).toBe(400);
    expect(fake.store.jobs.has("j1")).toBe(true);

    const res = await call(jobs.deleteJob, { user: owner(), params: { id: "j1" }, body: { confirm: true } });
    expect(res.code).toBe(200);
    expect(fake.store.jobs.has("j1")).toBe(false);
    expect(fake.store.applications.has("j1_worker")).toBe(false);
    expect(fake.store.jobs.has("j2")).toBe(true); // other jobs untouched
    expect(fake.store.applications.has("j2_worker")).toBe(true);
  });

  test("an admin can delete any job (moderation), applications included", async () => {
    const res = await call(jobs.deleteJob, { user: { id: "adm", role: "admin" }, params: { id: "j1" }, body: { confirm: true } });
    expect(res.code).toBe(200);
    expect(fake.store.jobs.has("j1")).toBe(false);
    expect(fake.store.applications.has("j1_worker")).toBe(false);
  });

  test("nobody else can close your job", async () => {
    const res = await call(jobs.deleteJob, { user: worker(), params: { id: "j1" }, body: { confirm: true } });
    expect(res.code).toBe(403);
    expect(fake.store.jobs.has("j1")).toBe(true);
  });
});

describe("applying", () => {
  beforeEach(() => fake.store.jobs.set("j1", seedJob("j1", "owner")));

  test("records the application with the note and the applicant's display name", async () => {
    const u = worker();
    const res = await call(jobs.applyToJob, { user: u, params: { id: "j1" }, body: { note: "I proofread for a living." } });
    expect(res.code).toBe(201);
    const app = fake.store.applications.get("j1_worker");
    expect(app).toMatchObject({ note: "I proofread for a living.", applicantDisplayName: "Wale", status: "applied", jobOwnerId: "owner" });
    expect(app.visibleUntil).toBe(u.subscriptionExpiry);
    expect(app.storefrontId).toBeNull();
  });

  test("a vendor applicant carries a storefront id", async () => {
    await call(jobs.applyToJob, { user: worker({ vendorType: "service" }), params: { id: "j1" }, body: {} });
    expect(fake.store.applications.get("j1_worker").storefrontId).toBe("worker");
  });

  test("cannot apply to your own job (403)", async () => {
    expect((await call(jobs.applyToJob, { user: owner(), params: { id: "j1" }, body: {} })).code).toBe(403);
  });

  test("cannot apply twice (409) and the first note is kept", async () => {
    await call(jobs.applyToJob, { user: worker(), params: { id: "j1" }, body: { note: "first" } });
    const again = await call(jobs.applyToJob, { user: worker(), params: { id: "j1" }, body: { note: "second" } });
    expect(again.code).toBe(409);
    expect(fake.store.applications.get("j1_worker").note).toBe("first");
  });

  test("a note over 300 characters is rejected", async () => {
    const res = await call(jobs.applyToJob, { user: worker(), params: { id: "j1" }, body: { note: "x".repeat(301) } });
    expect(res.code).toBe(400);
  });

  test("cannot apply to a hidden or missing job", async () => {
    fake.store.jobs.set("hidden", seedJob("hidden", "owner", null));
    expect((await call(jobs.applyToJob, { user: worker(), params: { id: "hidden" }, body: {} })).code).toBe(404);
    expect((await call(jobs.applyToJob, { user: worker(), params: { id: "nope" }, body: {} })).code).toBe(404);
  });

  test("an applicant can withdraw their own application only", async () => {
    await call(jobs.applyToJob, { user: worker(), params: { id: "j1" }, body: {} });
    expect((await call(jobs.withdrawApplication, { user: owner(), params: { id: "j1_worker" } })).code).toBe(403);
    expect((await call(jobs.withdrawApplication, { user: worker(), params: { id: "j1_worker" } })).code).toBe(200);
    expect(fake.store.applications.has("j1_worker")).toBe(false);
  });
});

describe("what the poster and applicant see", () => {
  beforeEach(() => {
    fake.store.jobs.set("j1", seedJob("j1", "owner"));
    fake.store.applications.set("j1_w1", { jobId: "j1", jobOwnerId: "owner", jobTitle: "Job j1", applicantId: "w1", applicantDisplayName: "Ann", note: "Hi", status: "applied", storefrontId: "w1", visibleUntil: fake.daysFromNow(5), createdAt: fake.daysFromNow(-2) });
    fake.store.applications.set("j1_w2", { jobId: "j1", jobOwnerId: "owner", jobTitle: "Job j1", applicantId: "w2", applicantDisplayName: "Bob", note: "", status: "applied", storefrontId: null, visibleUntil: null, createdAt: fake.daysFromNow(-1) }); // expired applicant
    fake.store.applications.set("j1_worker", { jobId: "j1", jobOwnerId: "owner", jobTitle: "Job j1", applicantId: "worker", applicantDisplayName: "Wale", note: "", status: "applied", visibleUntil: fake.daysFromNow(5), createdAt: fake.daysFromNow(-3) });
  });

  test("only the owner can list applicants, and expired applicants are hidden", async () => {
    expect((await call(jobs.getJobApplications, { user: worker(), params: { id: "j1" } })).code).toBe(403);
    const res = await call(jobs.getJobApplications, { user: owner(), params: { id: "j1" } });
    expect(res.body.applications.map((a) => a.name)).toEqual(["Wale", "Ann"]); // oldest first, Bob hidden
  });

  test("applicant lists never leak phone numbers or user ids", async () => {
    const res = await call(jobs.getJobApplications, { user: owner(), params: { id: "j1" } });
    expect(JSON.stringify(res.body)).not.toMatch(/phone|2348|applicantId/);
  });

  test("my jobs shows the applicant count, my applications shows status only", async () => {
    const mine = await call(jobs.getMyJobs, { user: owner() });
    expect(mine.body.jobs[0].applicantCount).toBe(2); // Ann + Wale (Bob expired)

    const apps = await call(jobs.getMyApplications, { user: worker() });
    expect(apps.body.applications).toHaveLength(1);
    expect(apps.body.applications[0]).toMatchObject({ jobTitle: "Job j1", status: "applied", jobAvailable: true });
    expect(apps.body.applications[0]).not.toHaveProperty("jobOwnerId");
  });

  test("the owner still sees their own job while their subscription is expired", async () => {
    fake.store.jobs.set("j1", seedJob("j1", "owner", null));
    const mine = await call(jobs.getMyJobs, { user: owner() });
    expect(mine.body.jobs[0]).toMatchObject({ id: "j1", visible: false });
    const apps = await call(jobs.getMyApplications, { user: worker() });
    expect(apps.body.applications[0].jobAvailable).toBe(false);
  });
});

describe("contact: the number never appears in a link", () => {
  beforeEach(() => {
    fake.store.jobs.set("j1", seedJob("j1", "owner"));
    fake.store.applications.set("j1_worker", { jobId: "j1", jobOwnerId: "owner", jobTitle: "Proofread PDF", applicantId: "worker", applicantDisplayName: "Wale", note: "", status: "applied", visibleUntil: fake.daysFromNow(5), createdAt: fake.daysFromNow(-1) });
  });

  const mint = () => call(jobs.contactApplicant, { user: owner(), params: { id: "j1_worker" } });

  test("the poster gets a short code link, with no phone number anywhere in the response", async () => {
    const res = await mint();
    expect(res.code).toBe(200);
    expect(res.body.contactUrl).toMatch(/^\/c\/[0-9a-f]{32}$/);
    expect(JSON.stringify(res.body)).not.toMatch(/2348|wa\.me/);
    expect(fake.store.applications.get("j1_worker").status).toBe("contacted");
  });

  test("only the job owner can mint a link", async () => {
    const res = await call(jobs.contactApplicant, { user: worker(), params: { id: "j1_worker" } });
    expect(res.code).toBe(403);
    expect(fake.store.contactTokens.size).toBe(0);
  });

  test("an applicant whose subscription lapsed can no longer be contacted", async () => {
    fake.store.applications.get("j1_worker").visibleUntil = null;
    expect((await mint()).code).toBe(404);
  });

  test("opening the link forwards to WhatsApp with a job message, once only", async () => {
    const { contactUrl } = (await mint()).body;
    const token = contactUrl.split("/c/")[1];

    const first = await call(jobs.openContact, { params: { token } });
    expect(first.code).toBe(302);
    expect(first.location).toMatch(/^https:\/\/wa\.me\/2348022222222\?text=/);
    expect(decodeURIComponent(first.location)).toContain("Proofread PDF");
    expect(first.headers["Cache-Control"]).toBe("no-store");

    const second = await call(jobs.openContact, { params: { token } });
    expect(second.code).toBe(410); // single use
    expect(second.location).toBeUndefined();
  });

  test("expired and unknown codes never forward anywhere", async () => {
    const { contactUrl } = (await mint()).body;
    const token = contactUrl.split("/c/")[1];
    fake.store.contactTokens.get(token).expiresAt = fake.daysFromNow(-1);
    expect((await call(jobs.openContact, { params: { token } })).code).toBe(410);
    expect((await call(jobs.openContact, { params: { token: "deadbeef" } })).code).toBe(404);
  });
});

describe("expiry hides jobs and applications automatically", () => {
  test("syncOwnerVisibility covers jobs (as owner) and applications (as applicant)", async () => {
    fake.store.jobs.set("mine", seedJob("mine", "u1", fake.daysFromNow(9)));
    fake.store.jobs.set("theirs", seedJob("theirs", "u2", fake.daysFromNow(9)));
    fake.store.applications.set("a1", { applicantId: "u1", visibleUntil: fake.daysFromNow(9) });
    fake.store.applications.set("a2", { applicantId: "u2", visibleUntil: fake.daysFromNow(9) });
    fake.store.vendorProfiles = new Map();
    fake.store.products = new Map();
    fake.store.services = new Map();

    await syncOwnerVisibility("u1", null);

    expect(fake.store.jobs.get("mine").visibleUntil).toBeNull();
    expect(fake.store.applications.get("a1").visibleUntil).toBeNull();
    expect(fake.store.jobs.get("theirs").visibleUntil).not.toBeNull();
    expect(fake.store.applications.get("a2").visibleUntil).not.toBeNull();
  });
});
