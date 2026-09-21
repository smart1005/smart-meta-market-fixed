const pino = require("pino");

// Pretty-printed in development, plain JSON in production so it's easy to
// ship to a log drain (Render/Railway/any hosted logging service) later.
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true } },
});

module.exports = logger;
