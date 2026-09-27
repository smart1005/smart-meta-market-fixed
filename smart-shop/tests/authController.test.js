const assert = require("node:assert/strict");

process.env.FIREBASE_API_KEY = "test-api-key";

const axios = require("axios");
const logger = require("../utils/logger");

axios.post = async () => {
  throw new Error("network error");
};

logger.error = () => {};

const authController = require("../controllers/authController");

(async () => {
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

  assert.equal(
    res.code,
    500,
    "Expected password reset failure to return HTTP 500",
  );
  assert.deepEqual(
    res.payload,
    {
      message:
        "Something went wrong sending the password reset link. Please try again.",
    },
    "Expected a failure message when the reset email request fails",
  );

  console.log("authController forgotPassword test passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
