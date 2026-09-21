const validateProductPayload = (payload) => {
  const { name, price, description, stock } = payload;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return "Product name is required and must be a non-empty string.";
  }

  if (price === undefined || price === null || price === "") {
    return "Product price is required.";
  }

  const parsedPrice = Number(price);
  if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
    return "Product price must be a non-negative number.";
  }

  if (stock === undefined || stock === null || stock === "") {
    return "Product stock is required.";
  }

  const parsedStock = Number(stock);
  if (!Number.isInteger(parsedStock) || parsedStock < 0) {
    return "Product stock must be a non-negative integer.";
  }

  if (
    description !== undefined &&
    description !== null &&
    typeof description !== "string"
  ) {
    return "Product description must be a string.";
  }

  return null;
};

const validateOrderPayload = (payload) => {
  const { productId, quantity, customerAddress } = payload;

  if (!productId || typeof productId !== "string" || productId.trim() === "") {
    return "productId is required and must be a non-empty string.";
  }

  if (quantity === undefined || quantity === null || quantity === "") {
    return "quantity is required.";
  }

  const parsedQuantity = Number(quantity);
  if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
    return "quantity must be a positive integer.";
  }

  if (
    !customerAddress ||
    typeof customerAddress !== "string" ||
    customerAddress.trim() === ""
  ) {
    return "customerAddress is required and must be a non-empty string.";
  }

  return null;
};

const validateServicePayload = (payload, allowPartial = false) => {
  const { title, jobTitle, description, price, category, skills } = payload;
  const serviceTitle = jobTitle !== undefined ? jobTitle : title;

  if (!allowPartial || serviceTitle !== undefined) {
    if (
      !serviceTitle ||
      typeof serviceTitle !== "string" ||
      serviceTitle.trim() === ""
    ) {
      return "Service title is required and must be a non-empty string.";
    }
  }

  if (!allowPartial || description !== undefined) {
    if (description !== undefined && typeof description !== "string") {
      return "Service description must be a string.";
    }
  }

  if (price !== undefined && price !== null && price !== "") {
  const parsedPrice = Number(price);
  if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
    return "Service price must be a non-negative number.";
  }
}

  if (!allowPartial || category !== undefined) {
    if (
      category !== undefined &&
      category !== null &&
      category !== "" &&
      typeof category !== "string"
    ) {
      return "Service category must be a string.";
    }
  }

  if (!allowPartial || skills !== undefined) {
    if (skills !== undefined) {
      const skillsArray = Array.isArray(skills) ? skills : [skills];
      for (const skill of skillsArray) {
        if (typeof skill !== "string" || skill.trim() === "") {
          return "Each service skill must be a non-empty string.";
        }
      }
    }
  }

  return null;
};

module.exports = {
  validateProductPayload,
  validateOrderPayload,
  validateServicePayload,
};
