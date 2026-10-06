process.env.FIREBASE_API_KEY = "test-api-key";

const axios = require("axios");
const logger = require("../utils/logger");

axios.post = async () => {
  throw new Error("network error");
};

logger.error = () => {};

const authController = require("../controllers/authController");

describe("authController.forgotPassword", () => {
  test("returns HTTP 500 with a generic failure message when sending the reset email fails", async () => {
    const req = { body: { email: "user@example.com" } };
    const res = {
      status(code) {
        this.code = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
    };

    await authController.forgotPassword(req, res);

    expect(res.code).toBe(500);
    expect(res.payload).toEqual({
      message:
        "Something went wrong sending the password reset link. Please try again.",
    });
  });
});
