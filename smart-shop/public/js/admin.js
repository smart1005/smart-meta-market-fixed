let allVendors = [];
let allProducts = [];
let allServices = [];

// ── Check Auth ──
const checkAdminAuth = () => {
  const token = getToken();
  const user = getUser();

  if (!token || !user) {
    showAuthGate();
    return;
  }

  if (user.role !== "superAdmin" && user.role !== "admin") {
    showToast("Access denied — admins only", "error");
    showAuthGate();
    return;
  }

  showAdminPanel();
};

const showAuthGate = () => {
  document.getElementById("auth-gate").style.display = "flex";
  document.getElementById("admin-panel").style.display = "none";
};

const showAdminPanel = () => {
  document.getElementById("auth-gate").style.display = "none";
  document.getElementById("admin-panel").style.display = "block";
  loadAllData();
};

// ── Admin Login ──
let adminLoginInFlight = false;

const handleAdminLogin = async () => {
  if (adminLoginInFlight) return;
  const email = document.getElementById("admin-email").value.trim();
  const password = document.getElementById("admin-password").value.trim();

  if (!email || !password) return showToast("Fill in all fields", "error");

  const btn = document.getElementById("admin-login-btn");
  adminLoginInFlight = true;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Logging in…";

  try {
    const res = await login(email, password);
    if (res.token) {
      if (res.user.role !== "superAdmin" && res.user.role !== "admin") {
        return showToast("Access denied — admins only", "error");
      }
      setToken(res.token);
      setUser(res.user);
      showToast("Login successful!");
      showAdminPanel();
    } else {
      showToast(res.error || res.message || "Login failed", "error");
    }
  } finally {
    adminLoginInFlight = false;
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

const handleAdminLogout = () => {
  logout();
};

// ── Switch Tabs ──
const switchAdminTab = (tab) => {
  const tabs = ["overview", "vendors", "products", "services"];
  tabs.forEach((t) => {
    document.getElementById(`admin-${t}`).style.display =
      t === tab ? "block" : "none";
    document.getElementById(`atab-${t}`).classList.toggle("active", t === tab);
  });
};

// ── Load All Data ──
const loadAllData = async () => {
  try {
    const [vendorsRes, productsRes, servicesRes] = await Promise.all([
      getAdminVendors(),
      getProducts(),
      getServices(),
    ]);

    allVendors = vendorsRes.vendors || [];
    allProducts = productsRes.products || [];
    allServices = servicesRes.services || [];

    updateOverview();
    renderVendors(allVendors);
    renderProducts(allProducts);
    renderServices(allServices);
  } catch (error) {
    showToast("Failed to load data", "error");
  }
};

// ── Overview ──
const updateOverview = () => {
  document.getElementById("total-vendors").textContent = allVendors.length;
  document.getElementById("active-vendors").textContent = allVendors.filter(
    (v) => v.subscriptionStatus === "active",
  ).length;
  document.getElementById("total-products").textContent = allProducts.length;
  document.getElementById("total-services").textContent = allServices.length;

  // recent payments
  const paymentsTable = document.getElementById("payments-table");
  const vendorsWithPayments = allVendors
    .filter((v) => v.lastPayment)
    .sort((a, b) => {
      const aDate = a.lastPayment?.paidAt?._seconds || 0;
      const bDate = b.lastPayment?.paidAt?._seconds || 0;
      return bDate - aDate;
    });

  if (vendorsWithPayments.length === 0) {
    paymentsTable.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--subtext);">No payments yet</td></tr>`;
    return;
  }

  paymentsTable.innerHTML = vendorsWithPayments
    .map((v) => {
      const paidAt = v.lastPayment?.paidAt?._seconds
        ? new Date(v.lastPayment.paidAt._seconds * 1000).toDateString()
        : "Unknown";
      return `
      <tr>
        <td>${v.businessName || v.name}</td>
        <td>${v.lastPayment?.plan || "-"}</td>
        <td>₦${Number(v.lastPayment?.amount || 0).toLocaleString()}</td>
        <td>${paidAt}</td>
      </tr>
    `;
    })
    .join("");
};

// ── Render Vendors ──
const renderVendors = (vendors) => {
  const table = document.getElementById("vendors-table");
  if (vendors.length === 0) {
    table.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--subtext);">No vendors found</td></tr>`;
    return;
  }

  table.innerHTML = vendors
    .map((vendor) => {
      const expiry = vendor.subscriptionExpiry?._seconds
        ? new Date(vendor.subscriptionExpiry._seconds * 1000).toDateString()
        : "N/A";

      const statusClass =
        vendor.subscriptionStatus === "active"
          ? "status-active"
          : vendor.subscriptionStatus === "suspended"
            ? "status-suspended"
            : "status-inactive";

      return `
      <tr>
        <td>
          <div style="font-weight:600;">${vendor.businessName || vendor.name}</div>
          <div style="font-size:0.75rem; color:var(--subtext);">${vendor.email}</div>
        </td>
        <td>${vendor.vendorType === "service" ? "🔧 Service" : "🛍️ Product"}</td>
        <td><span class="status-badge ${statusClass}">${vendor.subscriptionStatus}</span></td>
        <td style="font-size:0.8rem;">${expiry}</td>
        <td>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <a href="vendor.html?id=${vendor.id}" target="_blank" 
              class="btn btn-outline btn-sm" style="font-size:0.75rem; padding:4px 10px;">
              View
            </a>
            ${
              vendor.subscriptionStatus !== "active"
                ? `
              <button class="btn btn-primary btn-sm" style="font-size:0.75rem;"
                onclick="handleVendorStatus('${vendor.id}', 'active')">
                Activate
              </button>
            `
                : `
              <button class="btn btn-danger btn-sm" style="font-size:0.75rem;"
                onclick="handleVendorStatus('${vendor.id}', 'suspended')">
                Suspend
              </button>
            `
            }
          </div>
        </td>
      </tr>
    `;
    })
    .join("");
};

// ── Render Products ──
const renderProducts = (products) => {
  const table = document.getElementById("products-table");
  if (products.length === 0) {
    table.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--subtext);">No products found</td></tr>`;
    return;
  }

  table.innerHTML = products
    .map(
      (product) => `
    <tr>
      <td>
        <div style="display:flex; align-items:center; gap:10px;">
          <img src="${product.imageUrl || "https://via.placeholder.com/40x40/1a1a1a/FF6B35?text=No"}" 
            style="width:40px; height:40px; border-radius:6px; object-fit:cover;" />
          <span>${product.name}</span>
        </div>
      </td>
      <td style="font-size:0.8rem;">${product.vendorName || "-"}</td>
      <td>₦${Number(product.price).toLocaleString()}</td>
      <td>${product.stock}</td>
      <td>
        <button class="btn btn-danger btn-sm" style="font-size:0.75rem;"
          onclick="handleDeleteProduct('${product.id}')">
          🗑️ Delete
        </button>
      </td>
    </tr>
  `,
    )
    .join("");
};

// ── Render Services ──
const renderServices = (services) => {
  const table = document.getElementById("services-table");
  if (services.length === 0) {
    table.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--subtext);">No services found</td></tr>`;
    return;
  }

  table.innerHTML = services
    .map(
      (service) => `
    <tr>
      <td>${service.jobTitle || service.title}</td>
      <td style="font-size:0.8rem;">${service.vendorName || "-"}</td>
      <td style="font-size:0.8rem;">${service.category || "-"}</td>
      <td>
        <button class="btn btn-danger btn-sm" style="font-size:0.75rem;"
          onclick="handleDeleteService('${service.id}')">
          🗑️ Delete
        </button>
      </td>
    </tr>
  `,
    )
    .join("");
};

// ── Vendor Status ──
const handleVendorStatus = async (id, status) => {
  const action = status === "active" ? "activate" : "suspend";
  if (!confirm(`Are you sure you want to ${action} this vendor?`)) return;

  const res = await updateVendorStatus(id, status);

  if (res.message) {
    showToast(`Vendor ${action}ed successfully`);
    await loadAllData();
  } else {
    showToast("Failed to update vendor status", "error");
  }
};

// ── Delete Product ──
const handleDeleteProduct = async (id) => {
  if (!confirm("Delete this product? This cannot be undone.")) return;
  const res = await deleteProduct(id);
  if (res.message) {
    showToast("Product deleted");
    await loadAllData();
  } else {
    showToast("Failed to delete product", "error");
  }
};

// ── Delete Service ──
const handleDeleteService = async (id) => {
  if (!confirm("Delete this service? This cannot be undone.")) return;
  const res = await deleteService(id);
  if (res.message) {
    showToast("Service deleted");
    await loadAllData();
  } else {
    showToast("Failed to delete service", "error");
  }
};

// ── Search Filters ──
const filterVendors = (query) => {
  const filtered = allVendors.filter(
    (v) =>
      v.businessName?.toLowerCase().includes(query.toLowerCase()) ||
      v.email?.toLowerCase().includes(query.toLowerCase()),
  );
  renderVendors(filtered);
};

const filterProducts = (query) => {
  const filtered = allProducts.filter(
    (p) =>
      p.name?.toLowerCase().includes(query.toLowerCase()) ||
      p.vendorName?.toLowerCase().includes(query.toLowerCase()),
  );
  renderProducts(filtered);
};

const filterServices = (query) => {
  const filtered = allServices.filter(
    (s) =>
      s.jobTitle?.toLowerCase().includes(query.toLowerCase()) ||
      s.vendorName?.toLowerCase().includes(query.toLowerCase()),
  );
  renderServices(filtered);
};

// ── Init ──
document.addEventListener("DOMContentLoaded", () => {
  checkAdminAuth();
});
