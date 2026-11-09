jest.mock("../config/firebase", () => require("./helpers/fakeFirestore").firebaseMock);

const fake = require("./helpers/fakeFirestore");
const { getOrders, getOrderById } = require("../controllers/orderController");

const makeRes = () => {
  const res = {};
  res.status = jest.fn((c) => ((res.code = c), res));
  res.json = jest.fn((b) => ((res.body = b), res));
  return res;
};

describe("orders are private to the vendor who owns them", () => {
  beforeEach(() =>
    fake.reset({
      orders: {
        o1: { vendorId: "A", total: 1 },
        o2: { vendorId: "A", total: 2 },
        o3: { vendorId: "B", total: 3 },
      },
    }),
  );

  test("a user only sees their own orders", async () => {
    const res = makeRes();
    await getOrders({ user: { id: "A", role: "user" } }, res);
    expect(res.body.orders.map((o) => o.id).sort()).toEqual(["o1", "o2"]);
  });

  test("a user with no orders sees none (never everyone's)", async () => {
    const res = makeRes();
    await getOrders({ user: { id: "Z", role: "user" } }, res);
    expect(res.body.orders).toEqual([]);
  });

  test.each(["admin", "superAdmin"])("%s sees every order", async (role) => {
    const res = makeRes();
    await getOrders({ user: { id: "X", role } }, res);
    expect(res.body.orders).toHaveLength(3);
  });

  test("a user cannot open someone else's order", async () => {
    const res = makeRes();
    await getOrderById({ user: { id: "B", role: "user" }, params: { id: "o1" } }, res);
    expect(res.code).toBe(403);
  });

  test("a user can open their own order", async () => {
    const res = makeRes();
    await getOrderById({ user: { id: "A", role: "user" }, params: { id: "o1" } }, res);
    expect(res.code).toBe(200);
  });
});
