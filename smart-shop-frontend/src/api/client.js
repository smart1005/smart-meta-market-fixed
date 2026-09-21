// Ported directly from public/js/api.js — same functions, same endpoints,
// same behavior (token handling, auto-logout on 401, toast helper removed
// since React will handle UI feedback via component state instead of
// directly touching the DOM).
//
// The ONLY real change: BASE_URL now reads from an environment variable
// instead of being hardcoded to localhost, so this same code works in
// dev AND once deployed. Vite exposes env vars prefixed VITE_ via
// import.meta.env — set VITE_API_BASE_URL in a .env file.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

// ── Token Management ──
export const getToken = () => localStorage.getItem("token");
export const setToken = (token) => localStorage.setItem("token", token);
export const removeToken = () => localStorage.removeItem("token");
export const getUser = () => JSON.parse(localStorage.getItem("user") || "null");
export const setUser = (user) => localStorage.setItem("user", JSON.stringify(user));
export const removeUser = () => localStorage.removeItem("user");

// ── Headers ──
const authHeaders = () => {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const jsonHeaders = () => ({
  "Content-Type": "application/json",
});

// ── Response Handling ──
const handleResponse = async (res) => {
  let data;
  try {
    data = await res.json();
  } catch (error) {
    return {
      status: res.status,
      ok: res.ok,
      statusText: res.statusText,
      message: "Unexpected server response. Please try again.",
      error: error.message,
    };
  }

  if (res.status === 401) {
    removeToken();
    removeUser();
    window.location.href = window.location.pathname;
  }

  return {
    status: res.status,
    ok: res.ok,
    statusText: res.statusText,
    ...data,
  };
};

// ── Auth ──
export const login = async (email, password) => {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password }),
  });
  return handleResponse(res);
};

export const register = async (data) => {
  const res = await fetch(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
};

export const registerVendor = async (data) => {
  const res = await fetch(`${BASE_URL}/auth/register-vendor`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
};

// ── Products ──
export const getProducts = async () => {
  const res = await fetch(`${BASE_URL}/products`);
  return handleResponse(res);
};

export const getProductById = async (id) => {
  const res = await fetch(`${BASE_URL}/products/${id}`);
  return handleResponse(res);
};

export const addProduct = async (formData) => {
  const res = await fetch(`${BASE_URL}/products`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  return handleResponse(res);
};

export const updateProduct = async (id, formData) => {
  const res = await fetch(`${BASE_URL}/products/${id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  return handleResponse(res);
};

export const deleteProduct = async (id) => {
  const res = await fetch(`${BASE_URL}/products/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res);
};

// ── Services ──
export const getServices = async () => {
  const res = await fetch(`${BASE_URL}/services`);
  return handleResponse(res);
};

export const getServiceById = async (id) => {
  const res = await fetch(`${BASE_URL}/services/${id}`);
  return handleResponse(res);
};

export const getJobTitles = async () => {
  const res = await fetch(`${BASE_URL}/services/job-titles`);
  return handleResponse(res);
};

export const addService = async (formData) => {
  const res = await fetch(`${BASE_URL}/services`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  return handleResponse(res);
};

export const updateService = async (id, formData) => {
  const res = await fetch(`${BASE_URL}/services/${id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  return handleResponse(res);
};

export const deleteService = async (id) => {
  const res = await fetch(`${BASE_URL}/services/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res);
};

// ── Locations ──
export const getStates = async () => {
  const res = await fetch(`${BASE_URL}/locations/states`);
  return handleResponse(res);
};

export const getLgas = async (state) => {
  const res = await fetch(
    `${BASE_URL}/locations/states/${encodeURIComponent(state)}/lgas`,
  );
  return handleResponse(res);
};

// ── Vendors ──
export const getVendors = async () => {
  const res = await fetch(`${BASE_URL}/vendors`);
  return handleResponse(res);
};

export const getVendorProfile = async (id) => {
  const res = await fetch(`${BASE_URL}/vendors/${id}`);
  return handleResponse(res);
};

export const updateVendorProfile = async (formData) => {
  const res = await fetch(`${BASE_URL}/vendors/profile`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  return handleResponse(res);
};

export const addPortfolioImages = async (formData) => {
  const res = await fetch(`${BASE_URL}/vendors/portfolio`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  return handleResponse(res);
};

export const updateVendorLocation = async (data) => {
  const res = await fetch(`${BASE_URL}/vendors/location`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
};

export const removePortfolioImage = async (imageUrl) => {
  const res = await fetch(`${BASE_URL}/vendors/portfolio`, {
    method: "DELETE",
    headers: authHeaders(),
    body: JSON.stringify({ imageUrl }),
  });
  return handleResponse(res);
};

export const updateVendorStatus = async (id, status) => {
  const res = await fetch(`${BASE_URL}/vendors/${id}/status`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ subscriptionStatus: status }),
  });
  return handleResponse(res);
};

// ── Collections ──
export const getVendorCollections = async (vendorId) => {
  const res = await fetch(`${BASE_URL}/collections/${vendorId}`);
  return handleResponse(res);
};

export const createCollection = async (data) => {
  const res = await fetch(`${BASE_URL}/collections`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
};

export const addProductToCollection = async (collectionId, productId) => {
  const res = await fetch(`${BASE_URL}/collections/${collectionId}/products`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ productId }),
  });
  return handleResponse(res);
};

export const removeProductFromCollection = async (collectionId, productId) => {
  const res = await fetch(
    `${BASE_URL}/collections/${collectionId}/products/${productId}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    },
  );
  return handleResponse(res);
};

export const deleteCollection = async (collectionId) => {
  const res = await fetch(`${BASE_URL}/collections/${collectionId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res);
};

// ── Payments ──
export const initializeSubscription = async (plan) => {
  const res = await fetch(`${BASE_URL}/payments/subscribe`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ plan }),
  });
  return handleResponse(res);
};

export const verifySubscription = async (reference) => {
  const res = await fetch(`${BASE_URL}/payments/verify/${reference}`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
};

// ── Logout ──
export const logout = () => {
  removeToken();
  removeUser();
  window.location.href = "/";
};
