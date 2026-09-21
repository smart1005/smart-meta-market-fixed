const BASE_URL = "http://localhost:3000";

// ── Token Management ──
const getToken = () => localStorage.getItem("token");
const setToken = (token) => localStorage.setItem("token", token);
const removeToken = () => localStorage.removeItem("token");
const getUser = () => JSON.parse(localStorage.getItem("user") || "null");
const setUser = (user) => localStorage.setItem("user", JSON.stringify(user));
const removeUser = () => localStorage.removeItem("user");

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
// Wrapped in try/catch so a non-JSON response (network error page, unhandled
// 500, proxy error, etc.) doesn't throw an unhandled rejection that silently
// breaks the calling UI flow. Callers can keep checking res.message / res.id / res.token.
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
const login = async (email, password) => {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password }),
  });
  return handleResponse(res);
};

const register = async (data) => {
  const res = await fetch(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
};

const registerVendor = async (data) => {
  const res = await fetch(`${BASE_URL}/auth/register-vendor`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
};

// ── Products ──
const getProducts = async () => {
  const res = await fetch(`${BASE_URL}/products`);
  return handleResponse(res);
};

const getProductById = async (id) => {
  const res = await fetch(`${BASE_URL}/products/${id}`);
  return handleResponse(res);
};

const addProduct = async (formData) => {
  const res = await fetch(`${BASE_URL}/products`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  return handleResponse(res);
};

const updateProduct = async (id, formData) => {
  const res = await fetch(`${BASE_URL}/products/${id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  return handleResponse(res);
};

const deleteProduct = async (id) => {
  const res = await fetch(`${BASE_URL}/products/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res);
};

// ── Services ──
const getServices = async () => {
  const res = await fetch(`${BASE_URL}/services`);
  return handleResponse(res);
};

const getServiceById = async (id) => {
  const res = await fetch(`${BASE_URL}/services/${id}`);
  return handleResponse(res);
};

const getJobTitles = async () => {
  const res = await fetch(`${BASE_URL}/services/job-titles`);
  return handleResponse(res);
};

const addService = async (formData) => {
  const res = await fetch(`${BASE_URL}/services`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  return handleResponse(res);
};

const updateService = async (id, formData) => {
  const res = await fetch(`${BASE_URL}/services/${id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  return handleResponse(res);
};

const deleteService = async (id) => {
  const res = await fetch(`${BASE_URL}/services/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res);
};

// ── Locations ──
const getStates = async () => {
  const res = await fetch(`${BASE_URL}/locations/states`);
  return handleResponse(res);
};

const getLgas = async (state) => {
  const res = await fetch(
    `${BASE_URL}/locations/states/${encodeURIComponent(state)}/lgas`,
  );
  return handleResponse(res);
};

// ── Vendors ──
const getVendors = async () => {
  const res = await fetch(`${BASE_URL}/vendors`);
  return handleResponse(res);
};

const getVendorProfile = async (id) => {
  const res = await fetch(`${BASE_URL}/vendors/${id}`);
  return handleResponse(res);
};

const updateVendorProfile = async (formData) => {
  const res = await fetch(`${BASE_URL}/vendors/profile`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  return handleResponse(res);
};

const addPortfolioImages = async (formData) => {
  const res = await fetch(`${BASE_URL}/vendors/portfolio`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  return handleResponse(res);
};

const updateVendorLocation = async (data) => {
  const res = await fetch(`${BASE_URL}/vendors/location`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
};

const removePortfolioImage = async (imageUrl) => {
  const res = await fetch(`${BASE_URL}/vendors/portfolio`, {
    method: "DELETE",
    headers: authHeaders(),
    body: JSON.stringify({ imageUrl }),
  });
  return handleResponse(res);
};

const updateVendorStatus = async (id, status) => {
  const res = await fetch(`${BASE_URL}/vendors/${id}/status`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ subscriptionStatus: status }),
  });
  return handleResponse(res);
};

// ── Collections ──
const getVendorCollections = async (vendorId) => {
  const res = await fetch(`${BASE_URL}/collections/${vendorId}`);
  return handleResponse(res);
};

const createCollection = async (data) => {
  const res = await fetch(`${BASE_URL}/collections`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
};

const addProductToCollection = async (collectionId, productId) => {
  const res = await fetch(`${BASE_URL}/collections/${collectionId}/products`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ productId }),
  });
  return handleResponse(res);
};

const removeProductFromCollection = async (collectionId, productId) => {
  const res = await fetch(
    `${BASE_URL}/collections/${collectionId}/products/${productId}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    },
  );
  return handleResponse(res);
};

const deleteCollection = async (collectionId) => {
  const res = await fetch(`${BASE_URL}/collections/${collectionId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res);
};

// ── Payments ──
const initializeSubscription = async (plan) => {
  const res = await fetch(`${BASE_URL}/payments/subscribe`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ plan }),
  });
  return handleResponse(res);
};

const verifySubscription = async (reference) => {
  const res = await fetch(`${BASE_URL}/payments/verify/${reference}`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
};

// ── Toast Notification ──
const showToast = (message, type = "success") => {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => {
    toast.className = "toast";
  }, 3000);
};

// ── Logout ──
const logout = () => {
  removeToken();
  removeUser();
  window.location.href = "index.html";
};

// expose a few utilities to the global scope for inline handlers
window.logout = logout;
window.showToast = showToast;
