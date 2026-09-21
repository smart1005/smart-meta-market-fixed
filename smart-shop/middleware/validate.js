// Generic Zod validation middleware.
// Usage: router.post("/route", validate(someSchema), asyncHandler(controller))
// On failure, returns a clean 400 with the first validation error message.
// On success, req.body is replaced with the parsed/coerced data so
// downstream code can trust its shape.
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const firstIssue = result.error.issues[0];
    return res.status(400).json({
      message: firstIssue?.message || "Invalid request data.",
    });
  }

  req.body = result.data;
  next();
};

module.exports = validate;
