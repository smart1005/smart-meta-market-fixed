process.env.FIREBASE_API_KEY = "test-api-key";

jest.mock("../config/firebase", () => require("./helpers/fakeFirestore").firebaseMock);
jest.mock("../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock("axios", () => ({ post: jest.fn().mockResolvedValue({ data: { idToken: "tok" } }) }));

const fake = require("./helpers/fakeFirestore");
const { registerVendor } = require("../controllers/authController");

const makeRes = () => {
  const res = {};
  res.status = jest.fn((c) => ((res.code = c), res));
  res.json = jest.fn((b) => ((res.body = b), res));
  return res;
};

let uidCounter;
const register = async (body) => {
  const res = makeRes();
  await registerVendor({ body }, res);
  return res;
};

const plain = (over = {}) => ({
  email: `user${Math.random().toString(36).slice(2)}@test.com`,
  password: "test1234",
  name: "Ada Obi",
  displayName: "Ada",
  phone: "08055550001",
  ...over,
});

beforeEach(() => {
  uidCounter = 0;
  fake.reset({ users: {}, vendorProfiles: {}, phoneRegistrationLocks: {}, emailRegistrationLocks: {} });
  fake.authMock.createUser.mockReset();
  fake.authMock.createUser.mockImplementation(async () => ({ uid: `uid${++uidCounter}` }));
  fake.authMock.deleteUser.mockClear();
});

describe("registerVendor: plain user signup", () => {
  test("creates a user with role 'user', a 90 day trial, and NO vendor profile", async () => {
    const res = await register(plain());
    expect(res.code).toBe(201);

    const user = fake.store.users.get("uid1");
    expect(user.role).toBe("user");
    expect(user.name).toBe("Ada Obi");
    expect(user.displayName).toBe("Ada");
    expect(user.phoneNormalized).toBe("2348055550001");
    expect(user.subscriptionStatus).toBe("active");
    expect(user.onTrial).toBe(true);
    const days = (user.subscriptionExpiry.toDate() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(89.9);
    expect(fake.store.vendorProfiles.size).toBe(0);
  });

  test("falls back to the full name when no display name is given", async () => {
    await register(plain({ displayName: undefined }));
    expect(fake.store.users.get("uid1").displayName).toBe("Ada Obi");
  });

  test("rejects a missing email or password", async () => {
    expect((await register(plain({ email: undefined }))).code).toBe(400);
    expect((await register(plain({ password: undefined }))).code).toBe(400);
  });
});

describe("registerVendor: optional vendor profile", () => {
  const vendorBody = (over = {}) => plain({ businessName: "PV Store", vendorType: "product", state: "Lagos", lga: "Ikeja", ...over });

  test("creates a vendor profile with visibleUntil and NO subscription fields on it", async () => {
    const res = await register(vendorBody());
    expect(res.code).toBe(201);

    const user = fake.store.users.get("uid1");
    const profile = fake.store.vendorProfiles.get("uid1");
    expect(profile.vendorType).toBe("product");
    expect(profile.businessName).toBe("PV Store");
    expect(profile.visibleUntil).toBe(user.subscriptionExpiry);
    expect(profile).not.toHaveProperty("subscriptionStatus");
    expect(profile).not.toHaveProperty("subscriptionExpiry");
  });

  test("rejects an invalid vendorType, a missing business name, or an invalid location", async () => {
    expect((await register(vendorBody({ vendorType: "both" }))).code).toBe(400);
    expect((await register(vendorBody({ businessName: "" }))).code).toBe(400);
    expect((await register(vendorBody({ state: "Lagos", lga: "Not A Real LGA" }))).code).toBe(400);
    expect(fake.store.users.size).toBe(0);
  });
});

describe("registerVendor: one account per phone number", () => {
  test("rejects a malformed phone number", async () => {
    const res = await register(plain({ phone: "12345" }));
    expect(res.code).toBe(400);
    expect(fake.authMock.createUser).not.toHaveBeenCalled();
  });

  test("stores a lock keyed by the normalized number", async () => {
    await register(plain({ phone: "0805 555 0001" }));
    expect(fake.store.phoneRegistrationLocks.get("2348055550001")).toMatchObject({ uid: "uid1" });
  });

  test.each(["+2348055550001", "2348055550001", "08055550001", "8055550001"])(
    "the same number written as %s is rejected with 409 and nothing is left behind",
    async (variant) => {
      await register(plain({ phone: "08055550001" }));
      const res = await register(plain({ phone: variant }));

      expect(res.code).toBe(409);
      expect(res.body.message).toMatch(/phone number is already registered/i);
      expect(fake.store.users.size).toBe(1); // only the first account
      expect(fake.authMock.deleteUser).toHaveBeenCalledWith("uid2"); // Auth user rolled back
      expect(fake.store.phoneRegistrationLocks.get("2348055550001").uid).toBe("uid1"); // lock still belongs to #1
    },
  );

  test("a different phone number registers fine", async () => {
    await register(plain({ phone: "08055550001" }));
    const res = await register(plain({ phone: "08055550002" }));
    expect(res.code).toBe(201);
    expect(fake.store.users.size).toBe(2);
  });
});
