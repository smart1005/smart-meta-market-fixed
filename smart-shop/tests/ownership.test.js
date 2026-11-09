jest.mock("../config/firebase", () => require("./helpers/fakeFirestore").firebaseMock);
jest.mock("../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock("cloudinary", () => ({ v2: { uploader: { destroy: jest.fn().mockResolvedValue({}) } } }));

const fake = require("./helpers/fakeFirestore");
const { addProduct, updateProduct, deleteProduct } = require("../controllers/productController");
const { addService, updateService, deleteService } = require("../controllers/serviceController");

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

const owner = { id: "owner", name: "Owner", role: "user" };
const otherVendor = { id: "other", name: "Other", role: "user" };
const admin = { id: "adm", name: "Admin", role: "admin" };
const superAdmin = { id: "sup", name: "Super", role: "superAdmin" };

describe.each([
  ["product", "products", updateProduct, deleteProduct],
  ["service", "services", updateService, deleteService],
])("%s ownership", (label, collection, update, remove) => {
  beforeEach(() => fake.reset({ [collection]: { item1: { vendorId: "owner", name: "Original" } } }));

  test("another vendor cannot delete it (403) and it still exists", async () => {
    const res = await call(remove, { user: otherVendor, params: { id: "item1" } });
    expect(res.code).toBe(403);
    expect(fake.store[collection].has("item1")).toBe(true);
  });

  test("another vendor cannot edit it (403) and it is unchanged", async () => {
    const res = await call(update, { user: otherVendor, params: { id: "item1" }, body: { name: "Hacked" } });
    expect(res.code).toBe(403);
    expect(fake.store[collection].get("item1").name).toBe("Original");
  });

  test("the owner can delete it", async () => {
    const res = await call(remove, { user: owner, params: { id: "item1" } });
    expect(res.code).toBe(200);
    expect(fake.store[collection].has("item1")).toBe(false);
  });

  test.each([["admin", admin], ["superAdmin", superAdmin]])("%s can delete anyone's %s", async (_n, user) => {
    const res = await call(remove, { user, params: { id: "item1" } });
    expect(res.code).toBe(200);
    expect(fake.store[collection].has("item1")).toBe(false);
  });

  test("deleting something that does not exist returns 404", async () => {
    expect((await call(remove, { user: owner, params: { id: "nope" } })).code).toBe(404);
  });
});

describe("creating listings stamps visibility and location", () => {
  const vendor = (extra = {}) => ({
    id: "v1",
    name: "Vee",
    role: "user",
    subscriptionStatus: "active",
    subscriptionExpiry: fake.daysFromNow(40),
    ...extra,
  });

  beforeEach(() =>
    fake.reset({
      vendorProfiles: { v1: { vendorType: "product", location: { state: "Lagos", lga: "Ikeja" } } },
      products: {},
      services: {},
      vendorCollections: {},
    }),
  );

  test("a new product gets visibleUntil = owner's expiry and the vendor's location", async () => {
    const user = vendor();
    const res = await call(addProduct, {
      user,
      body: { name: "Shoe", price: 5000, description: "test", stock: 3, category: "Fashion", newCollectionName: "Shoes" },
    });
    expect(res.code).toBe(201);
    const saved = fake.store.products.get(res.body.id);
    expect(saved.vendorId).toBe("v1");
    expect(saved.visibleUntil).toBe(user.subscriptionExpiry);
    expect(saved.vendorLocation).toEqual({ state: "Lagos", lga: "Ikeja" });
  });

  test("a product created by an account that is not active is stamped hidden (null)", async () => {
    const res = await call(addProduct, {
      user: vendor({ subscriptionStatus: "suspended" }),
      body: { name: "Shoe", price: 5000, description: "test", stock: 3, category: "Fashion", newCollectionName: "Shoes" },
    });
    expect(res.code).toBe(201);
    expect(fake.store.products.get(res.body.id).visibleUntil).toBeNull();
  });

  test("a new service gets visibleUntil and the vendor's location", async () => {
    fake.store.vendorProfiles.set("v1", { vendorType: "service", location: { state: "Lagos", lga: "Ikeja" } });
    const user = vendor();
    const res = await call(addService, {
      user,
      body: {
        title: "House cleaning",
        description: "Deep cleaning for homes and apartments",
        price: 15000,
        category: "Cleaning",
        skills: ["Deep cleaning", "Laundry"],
      },
    });
    expect(res.code).toBe(201);
    const saved = fake.store.services.get(res.body.id);
    expect(saved.visibleUntil).toBe(user.subscriptionExpiry);
    expect(saved.vendorLocation).toEqual({ state: "Lagos", lga: "Ikeja" });
  });
});
