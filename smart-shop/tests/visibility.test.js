jest.mock("../config/firebase", () => require("./helpers/fakeFirestore").firebaseMock);

const fake = require("./helpers/fakeFirestore");
const {
  visibleUntilFor,
  syncOwnerVisibility,
  syncOwnerVisibilityFromAccount,
} = require("../utils/visibility");

describe("visibleUntilFor", () => {
  test("returns the expiry for an active account, null otherwise", () => {
    const expiry = fake.daysFromNow(5);
    expect(visibleUntilFor({ subscriptionStatus: "active", subscriptionExpiry: expiry })).toBe(expiry);
    expect(visibleUntilFor({ subscriptionStatus: "suspended", subscriptionExpiry: expiry })).toBeNull();
    expect(visibleUntilFor({ subscriptionStatus: "active", subscriptionExpiry: fake.daysFromNow(-1) })).toBeNull();
  });
});

describe("syncOwnerVisibility", () => {
  beforeEach(() =>
    fake.reset({
      vendorProfiles: { A: { vendorType: "product" }, B: { vendorType: "product" } },
      products: { p1: { vendorId: "A" }, p2: { vendorId: "A" }, p3: { vendorId: "B" } },
      services: { s1: { vendorId: "A" } },
      users: {},
    }),
  );

  test("stamps the owner's profile and ALL their listings, and nobody else's", async () => {
    const date = fake.daysFromNow(30);
    const count = await syncOwnerVisibility("A", date);

    expect(count).toBe(4); // profile + 2 products + 1 service
    expect(fake.store.vendorProfiles.get("A").visibleUntil).toBe(date);
    expect(fake.store.products.get("p1").visibleUntil).toBe(date);
    expect(fake.store.products.get("p2").visibleUntil).toBe(date);
    expect(fake.store.services.get("s1").visibleUntil).toBe(date);
    expect(fake.store.products.get("p3").visibleUntil).toBeUndefined();
    expect(fake.store.vendorProfiles.get("B").visibleUntil).toBeUndefined();
  });

  test("null hides everything the owner has", async () => {
    await syncOwnerVisibility("A", fake.daysFromNow(30));
    await syncOwnerVisibility("A", null);
    expect(fake.store.products.get("p1").visibleUntil).toBeNull();
    expect(fake.store.vendorProfiles.get("A").visibleUntil).toBeNull();
  });

  test("a user with no vendor profile and no listings just updates nothing", async () => {
    expect(await syncOwnerVisibility("nobody", fake.daysFromNow(5))).toBe(0);
  });

  test("handles owners with more than one batch worth of listings (400 per batch)", async () => {
    const many = {};
    for (let i = 0; i < 950; i++) many[`m${i}`] = { vendorId: "A" };
    fake.store.products = new Map(Object.entries(many));
    const count = await syncOwnerVisibility("A", fake.daysFromNow(1));
    expect(count).toBe(951 + 1); // 950 products + 1 service + profile
    expect(fake.store.products.get("m949").visibleUntil).not.toBeUndefined();
  });
});

describe("syncOwnerVisibilityFromAccount", () => {
  test("an expired account hides listings; a renewed account shows them again", async () => {
    fake.reset({
      users: { A: { subscriptionStatus: "active", subscriptionExpiry: fake.daysFromNow(-1) } },
      vendorProfiles: { A: {} },
      products: { p1: { vendorId: "A", visibleUntil: fake.daysFromNow(5) } },
      services: {},
    });

    await syncOwnerVisibilityFromAccount("A");
    expect(fake.store.products.get("p1").visibleUntil).toBeNull();

    const renewed = fake.daysFromNow(30);
    fake.store.users.set("A", { subscriptionStatus: "active", subscriptionExpiry: renewed });
    await syncOwnerVisibilityFromAccount("A");
    expect(fake.store.products.get("p1").visibleUntil).toBe(renewed);
  });
});
