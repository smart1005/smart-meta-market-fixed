const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  const response = {
    message: err.message || "Internal server error",
  };

  if (err.details) {
    response.details = err.details;
  }

  if (err.availableStock !== undefined) {
    response.availableStock = err.availableStock;
  }

  res.status(status).json(response);
};

module.exports = { errorHandler };
