let currentUser = null;
let vendorProfile = null;
let allJobTitles = [];
let myProducts = [];
let myServices = [];
let myCollections = [];

const MAX_PORTFOLIO_IMAGES = 10;
let allStates = [];

// ── Escape HTML to prevent stored XSS from vendor-supplied text ──
const escapeHtml = (str) => {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const updateAboutWordCount = () => {
  const text = document.getElementById("profile-about").value;
  document.getElementById("about-word-count").textContent =
    `${text.length} / 70 characters`;
};

// ── Check Auth State ──
const checkAuth = async () => {
  const token = getToken();
  const user = getUser();

  if (!token || !user) {
    showAuthSection();
    return;
  }

  if (user.role !== "vendor") {
    showToast("This dashboard is for vendors only", "error");
    showAuthSection();
    return;
  }

  currentUser = user;
  await showDashboard();

  // check if returning from payment
  const params = new URLSearchParams(window.location.search);
  const payment = params.get("payment");
  if (payment === "success") {
    showToast("Subscription activated successfully! 🎉");
    // clean URL
    window.history.replaceState({}, "", "dashboard.html");
  } else if (payment === "failed") {
    showToast("Payment failed or was cancelled", "error");
    window.history.replaceState({}, "", "dashboard.html");
  }
};

// ── Show Auth Section ──
const showAuthSection = () => {
  document.getElementById("auth-section").style.display = "block";
  document.getElementById("dashboard-section").style.display = "none";
};

// ── Show Dashboard ──
const showDashboard = async () => {
  document.getElementById("auth-section").style.display = "none";
  document.getElementById("dashboard-section").style.display = "block";

  // load profile first to get correct vendorType
    const profileRes = await getMyVendorProfile();
  if (!profileRes.ok || !profileRes.vendor) {
    showToast(profileRes.message || "Unable to load vendor profile", "error");
    showAuthSection();
    return;
  }
  vendorProfile = profileRes.vendor;

  const vendorType = vendorProfile?.vendorType || currentUser.vendorType;

  document.getElementById("dash-business-name").textContent =
    vendorProfile?.businessName || currentUser.name || "My Store";
  document.getElementById("dash-vendor-type").textContent =
    vendorType === "service" ? "🔧 Service Vendor" : "🛍️ Product Vendor";
  document.getElementById("view-storefront-btn").href =
    `vendor.html?id=${currentUser.id}`;

  // hide irrelevant tab, quick-action button, and stat cards
  if (vendorType === "service") {
    document.getElementById("dtab-products").style.display = "none";
    document.getElementById("qa-add-product").style.display = "none";
    document.getElementById("stat-card-products").style.display = "none";
    document.getElementById("stat-card-collections").style.display = "none";
  } else {
    document.getElementById("dtab-services").style.display = "none";
    document.getElementById("qa-add-service").style.display = "none";
    document.getElementById("stat-card-services").style.display = "none";
  }

  // show inactive banner
  if (vendorProfile?.subscriptionStatus !== "active") {
    showInactiveBanner();
  }

  await loadDashboardData();
};

// ── Load All Dashboard Data ──
const loadDashboardData = async () => {
  try {
    const [productsRes, servicesRes, collectionsRes, profileRes, jobTitlesRes] =
      await Promise.all([
        getProducts(),
        getServices(),
        getVendorCollections(currentUser.id),
        getMyVendorProfile(),
        getJobTitles(),
      ]);

    if (
      !productsRes.ok ||
      !servicesRes.ok ||
      !collectionsRes.ok ||
      !profileRes.ok ||
      !jobTitlesRes.ok
    ) {
      const errorMessage =
        productsRes.message ||
        servicesRes.message ||
        collectionsRes.message ||
        profileRes.message ||
        jobTitlesRes.message ||
        "Unable to load dashboard data";
      showToast(errorMessage, "error");
      return;
    }

    myProducts = (productsRes.products || []).filter(
      (p) => p.vendorId === currentUser.id,
    );
    myServices = (servicesRes.services || []).filter(
      (s) => s.vendorId === currentUser.id,
    );
    myCollections = collectionsRes.collections || [];
    vendorProfile = profileRes.vendor;
    allJobTitles = [];

    const jobTitlesData =
      jobTitlesRes.jobTitles || jobTitlesRes.categories || [];
    jobTitlesData.forEach((cat) => {
      allJobTitles.push(...cat.titles);
    });

    // update stats
    document.getElementById("stat-products").textContent = myProducts.length;
    document.getElementById("stat-services").textContent = myServices.length;
    document.getElementById("stat-collections").textContent =
      myCollections.length;
    document.getElementById("stat-portfolio").textContent = (
      vendorProfile?.portfolioImages || []
    ).length;

    // hide "add service" once the cap is reached (service vendors only)
    const vendorTypeNow = vendorProfile?.vendorType || currentUser.vendorType;
    if (vendorTypeNow === "service") {
      const atServiceCap = myServices.length >= MAX_SERVICES_PER_VENDOR;
      document
        .querySelectorAll("#qa-add-service, #dash-services button.btn-primary")
        .forEach((btn) => {
          btn.style.display = atServiceCap ? "none" : "";
        });
    }

    // update subscription
    updateSubscriptionStatus();

    // prefill profile
    await prefillProfile();

    // render lists
    renderMyProducts();
    renderMyServices();
    populateCollectionSelect();
  } catch (error) {
    showToast("Failed to load dashboard data", "error");
  }
};

// ── Switch Dashboard Tab ──
const switchDashTab = (tab) => {
  const tabs = ["overview", "products", "services", "profile", "subscription"];
  tabs.forEach((t) => {
    document.getElementById(`dash-${t}`).style.display =
      t === tab ? "block" : "none";
    document.getElementById(`dtab-${t}`).classList.toggle("active", t === tab);
  });
};

// ── Auth: Login ──
let loginInFlight = false;

const handleLogin = async () => {
  if (loginInFlight) return; // guards against rapid double-clicks even before the button visually disables
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value.trim();

  if (!email || !password) return showToast("Fill in all fields", "error");

  const btn = document.getElementById("login-btn");
  loginInFlight = true;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Logging in…";

  try {
    const res = await login(email, password);
    if (res.token) {
      if (res.user.role !== "vendor") {
        return showToast("This dashboard is for vendors only", "error");
      }
      setToken(res.token);
      setUser(res.user);
      currentUser = res.user;
      showToast("Login successful!");
      await showDashboard();
    } else {
      showToast(res.error || res.message || "Login failed", "error");
    }
  } finally {
    loginInFlight = false;
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// ── Auth: Register ──
let registerInFlight = false;

const handleRegister = async () => {
  if (registerInFlight) return;
  const name = document.getElementById("reg-name").value.trim();
  const businessName = document.getElementById("reg-business").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const phone = document.getElementById("reg-phone").value.trim();
  const password = document.getElementById("reg-password").value.trim();
  const vendorType = document.getElementById("reg-type").value;
  const state = document.getElementById("reg-state").value;
  const lga = document.getElementById("reg-lga").value;

  if (!name || !businessName || !email || !phone || !password) {
    return showToast("Fill in all required fields", "error");
  }

  if (!state || !lga) {
    return showToast("Select your state and LGA", "error");
  }

  const btn = document.getElementById("register-btn");
  registerInFlight = true;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Creating account…";

  try {
    const res = await registerVendor({
      name,
      businessName,
      email,
      phone,
      password,
      vendorType,
      state,
      lga,
    });

        if (res.vendorId) {
          showToast(
            res.message ||
              "Account created! Please check your email to verify before logging in.",
          );
          showLogin();
        } else {
          showToast(res.error || res.message || "Registration failed", "error");
        }
  } finally {
    registerInFlight = false;
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

const handleForgotPassword = async () => {
  const email = document.getElementById("login-email").value.trim();
  if (!email) return showToast("Type your email above first", "error");
  const res = await forgotPassword(email);
  showToast(res.message || "If that email exists, a reset link has been sent.");
};

// ── Show Login / Register ──
const showLogin = () => {
  document.getElementById("login-form").style.display = "block";
  document.getElementById("register-form").style.display = "none";
};

const showRegister = () => {
  document.getElementById("login-form").style.display = "none";
  document.getElementById("register-form").style.display = "block";
};

// ── Modal ──
const openModal = (id) => {
  document.getElementById(id).classList.add("open");
};

const closeModal = (id) => {
  document.getElementById(id).classList.remove("open");
};

// ── Location: States / LGA Picker ──
const loadStates = async () => {
  try {
    const res = await getStates();
    allStates = res.states || [];
  } catch (error) {
    allStates = [];
  }
};

const populateStateSelect = (selectId) => {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML =
    '<option value="">Select State</option>' +
    allStates
      .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
      .join("");
};

const handleStateChange = async (prefix) => {
  const stateSelect = document.getElementById(`${prefix}-state`);
  const lgaSelect = document.getElementById(`${prefix}-lga`);
  const state = stateSelect.value;

  lgaSelect.innerHTML = '<option value="">Loading...</option>';
  lgaSelect.disabled = true;

  if (!state) {
    lgaSelect.innerHTML = '<option value="">Select State First</option>';
    return;
  }

  try {
    const res = await getLgas(state);
    const lgas = res.lgas || [];
    lgaSelect.innerHTML =
      '<option value="">Select LGA</option>' +
      lgas
        .map(
          (l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`,
        )
        .join("");
    lgaSelect.disabled = false;
  } catch (error) {
    lgaSelect.innerHTML = '<option value="">Failed to load LGAs</option>';
  }
};

// ── Update Location ──
const handleUpdateLocation = async () => {
  const state = document.getElementById("location-state").value;
  const lga = document.getElementById("location-lga").value;

  if (!state || !lga) {
    return showToast("Select both state and LGA", "error");
  }

  const res = await updateVendorLocation({ state, lga });
  if (res.ok) {
    showToast("Location updated!");
    await loadDashboardData();
  } else {
    showToast(res.message || "Failed to update location", "error");
  }
};

// ── Job Title Autocomplete ──
let selectedJobTitles = [];

const searchJobTitles = (query) => {
  const suggestions = document.getElementById("job-title-suggestions");
  if (!query || query.length < 2) {
    suggestions.style.display = "none";
    return;
  }

  const matches = allJobTitles
    .filter(
      (t) =>
        t.toLowerCase().includes(query.toLowerCase()) &&
        !selectedJobTitles.includes(t),
    )
    .slice(0, 8);

  if (matches.length === 0) {
    suggestions.style.display = "none";
    return;
  }

  suggestions.style.display = "block";
  suggestions.innerHTML = matches
    .map((title, index) => {
      const safeTitle = escapeHtml(title);
      return `
    <div
      data-title-index="${index}"
      style="padding: 10px 14px; cursor: pointer; border-bottom: 1px solid var(--border); font-size: 0.9rem;"
    >${safeTitle}</div>
  `;
    })
    .join("");

  // attach listeners instead of inline onmousedown with raw title text
  Array.from(suggestions.children).forEach((el, index) => {
    el.addEventListener("mousedown", () => selectJobTitle(matches[index]));
  });
};

const selectJobTitle = (title) => {
  if (!allJobTitles.includes(title)) {
    showToast("Please select a valid job title from the list", "error");
    return;
  }
  selectedJobTitles = [title];
  renderSelectedTitles();
  document.getElementById("service-title-input").value = "";
  document.getElementById("job-title-suggestions").style.display = "none";
};

const renderSelectedTitles = () => {
  const container = document.getElementById("selected-job-titles");
  container.innerHTML = selectedJobTitles
    .map((title, index) => {
      const safeTitle = escapeHtml(title);
      return `
    <span data-title-index="${index}" style="background: var(--primary); color: white; padding: 4px 10px; border-radius: 20px; font-size: 0.8rem; display: flex; align-items: center; gap: 6px;">
      ${safeTitle}
      <span class="remove-title-btn" style="cursor: pointer; font-size: 1rem;">×</span>
    </span>
  `;
    })
    .join("");

  Array.from(container.querySelectorAll(".remove-title-btn")).forEach(
    (el, index) => {
      el.addEventListener("click", () =>
        removeJobTitle(selectedJobTitles[index]),
      );
    },
  );
};

const removeJobTitle = (title) => {
  selectedJobTitles = selectedJobTitles.filter((t) => t !== title);
  renderSelectedTitles();
};

// ── Add Product ──
const handleAddProduct = async () => {
  if (addProductInFlight) return;

  const name = document.getElementById("product-name").value.trim();
  const price = document.getElementById("product-price").value;
  const stock = document.getElementById("product-stock").value;
  const category = document.getElementById("product-category").value.trim();
  const description = document
    .getElementById("product-description")
    .value.trim();
  const imageFile = document.getElementById("product-image").files[0];
  const collectionValue = document.getElementById("product-collection").value;
  const newCollectionName = document
    .getElementById("product-new-collection-name")
    .value.trim();

  if (!name || !price || !stock) {
    return showToast("Name, price and stock are required", "error");
  }

  if (!collectionValue) {
    return showToast("Select a collection or create a new one", "error");
  }

  if (collectionValue === "__new__" && !newCollectionName) {
    return showToast("Enter a name for the new collection", "error");
  }

  const formData = new FormData();
  formData.append("name", name);
  formData.append("price", price);
  formData.append("stock", stock);
  formData.append("category", category);
  formData.append("description", description);
  if (imageFile) formData.append("image", imageFile);

  if (collectionValue === "__new__") {
    formData.append("newCollectionName", newCollectionName);
  } else {
    formData.append("collectionId", collectionValue);
  }

  addProductInFlight = true;
  const submitBtn = document.querySelector(
    "#add-product-modal button.btn-primary",
  );
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Adding...";
  }

  try {
    const res = await addProduct(formData);

    if (res.id) {
      showToast("Product added successfully!");
      closeModal("add-product-modal");
      await loadDashboardData();
      // clear form
      document.getElementById("product-name").value = "";
      document.getElementById("product-price").value = "";
      document.getElementById("product-stock").value = "";
      document.getElementById("product-category").value = "";
      document.getElementById("product-description").value = "";
      document.getElementById("product-image").value = "";
      document.getElementById("product-collection").value = "";
      document.getElementById("product-new-collection-name").value = "";
      document.getElementById("product-new-collection-name").style.display =
        "none";
    } else {
      showToast(res.message || "Failed to add product", "error");
    }
  } finally {
    addProductInFlight = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Add Product";
    }
  }
};

// ── Add Service ──
const MAX_SERVICES_PER_VENDOR = 3;
let addServiceInFlight = false;

const handleAddService = async () => {
  if (addServiceInFlight) return;

  if (myServices.length >= MAX_SERVICES_PER_VENDOR) {
    return showToast(
      `You can only have ${MAX_SERVICES_PER_VENDOR} services. Edit or delete one first.`,
      "error",
    );
  }

  const skillsRaw = document.getElementById("service-skills").value.trim();
  const description = document
    .getElementById("service-description")
    .value.trim();
  const price = document.getElementById("service-price").value;
  const imageFiles = document.getElementById("service-images").files;

  if (selectedJobTitles.length === 0) {
    return showToast("Select a job title", "error");
  }

  if (!description) {
    return showToast("Description is required", "error");
  }

  const formData = new FormData();
  formData.append("jobTitle", selectedJobTitles[0]);
  formData.append("description", description);
  if (skillsRaw) formData.append("skills", skillsRaw);
  if (price) formData.append("price", price);
  for (const file of imageFiles) {
    formData.append("images", file);
  }

  addServiceInFlight = true;
  const submitBtn = document.querySelector(
    "#add-service-modal button.btn-primary",
  );
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Adding...";
  }

  const res = await addService(formData);

  addServiceInFlight = false;
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Add Service";
  }

  if (res.id) {
    showToast("Service added successfully!");
    closeModal("add-service-modal");
    selectedJobTitles = [];
    renderSelectedTitles();
    document.getElementById("service-title-input").value = "";
    document.getElementById("service-skills").value = "";
    document.getElementById("service-description").value = "";
    document.getElementById("service-price").value = "";
    document.getElementById("service-images").value = "";
    await loadDashboardData();
  } else {
    showToast(res.message || "Failed to add service", "error");
  }
};

// ── Add Collection ──

let addProductInFlight = false;

const handleAddCollection = async () => {
  const name = document.getElementById("collection-name").value.trim();
  const description = document
    .getElementById("collection-description")
    .value.trim();

  if (!name) return showToast("Collection name is required", "error");

  const res = await createCollection({ name, description });
  if (res.id) {
    showToast("Collection created!");
    closeModal("add-collection-modal");
    await loadDashboardData();
    document.getElementById("collection-name").value = "";
    document.getElementById("collection-description").value = "";
  } else {
    showToast(res.message || "Failed to create collection", "error");
  }
};

// ── Render My Products (grouped by collection) ──
const renderMyProducts = () => {
  const list = document.getElementById("my-products-list");

  if (myCollections.length === 0) {
    list.innerHTML =
      "<p class='text-sub text-center'>No collections yet. Create one to start adding products!</p>";
    return;
  }

  list.innerHTML = myCollections
    .map((col) => {
      const safeColName = escapeHtml(col.name);
      const safeColId = escapeHtml(col.id);
      const products = col.products || [];

      const productsHtml =
        products.length > 0
          ? `
        <div style="display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px;">
          ${products
            .map((product) => {
              const safeName = escapeHtml(product.name);
              const safeImage = escapeHtml(
                product.imageUrl ||
                  "https://via.placeholder.com/100x100/1a1a1a/FF6B35?text=No",
              );
              const safePrice = escapeHtml(
                Number(product.price).toLocaleString(),
              );
              return `
            <div style="flex-shrink: 0; width: 110px; text-align: center;">
              <img src="${safeImage}" alt="${safeName}"
                style="width: 100px; height: 100px; object-fit: cover; border-radius: 8px; background: var(--border);" />
              <p style="font-size: 0.75rem; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${safeName}</p>
              <p style="font-size: 0.75rem; color: var(--primary);">₦${safePrice}</p>
              <button class="btn btn-danger btn-sm" data-product-id="${escapeHtml(product.id)}" style="width: 100%; margin-top: 4px;">🗑️</button>
            </div>
          `;
            })
            .join("")}
        </div>
      `
          : "<p class='text-sub' style='font-size: 0.8rem;'>No products in this collection yet.</p>";

      return `
    <div style="margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <h4>📁 ${safeColName}</h4>
        <button class="btn btn-danger btn-sm delete-collection-btn" data-collection-id="${safeColId}">🗑️ Delete Collection</button>
      </div>
      ${productsHtml}
    </div>
  `;
    })
    .join("");

  Array.from(list.querySelectorAll("[data-product-id]")).forEach((btn) => {
    btn.addEventListener("click", () =>
      handleDeleteProduct(btn.getAttribute("data-product-id")),
    );
  });

  Array.from(list.querySelectorAll(".delete-collection-btn")).forEach((btn) => {
    btn.addEventListener("click", () =>
      handleDeleteCollection(btn.getAttribute("data-collection-id")),
    );
  });
};

// ── Render My Services ──
const renderMyServices = () => {
  const list = document.getElementById("my-services-list");
  if (myServices.length === 0) {
    list.innerHTML =
      "<p class='text-sub text-center'>No services yet. Add your first service!</p>";
    return;
  }

  list.innerHTML = myServices
    .map((service) => {
      const title = service.jobTitle || service.title;
      const safeTitle = escapeHtml(title);
      const safeCategory = escapeHtml(service.category || "");
      const safeImage = escapeHtml(
        service.imageUrl ||
          service.imageUrls?.[0] ||
          "https://via.placeholder.com/60x60/1a1a1a/FF6B35?text=No",
      );
      return `
    <div class="item-card">
      <img src="${safeImage}" alt="${safeTitle}" />
      <div class="item-card-body">
        <h4>${safeTitle}</h4>
        <p>${safeCategory}</p>
      </div>
      <div class="item-card-actions">
        <button class="btn btn-danger btn-sm" data-service-id="${escapeHtml(service.id)}">🗑️</button>
      </div>
    </div>
  `;
    })
    .join("");

  Array.from(list.querySelectorAll("[data-service-id]")).forEach((btn) => {
    btn.addEventListener("click", () =>
      handleDeleteService(btn.getAttribute("data-service-id")),
    );
  });
};

// ── Populate Collection Dropdown (Add Product modal) ──
const populateCollectionSelect = () => {
  const select = document.getElementById("product-collection");
  if (!select) return;
  const currentValue = select.value;

  select.innerHTML =
    '<option value="">Select a collection...</option>' +
    myCollections
      .map(
        (c) =>
          `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`,
      )
      .join("") +
    '<option value="__new__">+ Create new collection</option>';

  select.value = currentValue || "";
};

// ── Toggle "new collection name" input ──
const handleCollectionSelectChange = () => {
  const select = document.getElementById("product-collection");
  const newNameInput = document.getElementById("product-new-collection-name");
  newNameInput.style.display = select.value === "__new__" ? "block" : "none";
};

// ── Delete Product ──
const handleDeleteProduct = async (id) => {
  if (!confirm("Delete this product?")) return;
  const res = await deleteProduct(id);
  if (res.ok) {
    showToast("Product deleted");
    await loadDashboardData();
  } else {
    showToast(res.message || "Failed to delete", "error");
  }
};

// ── Delete Service ──
const handleDeleteService = async (id) => {
  if (!confirm("Delete this service?")) return;
  const res = await deleteService(id);
  if (res.ok) {
    showToast("Service deleted");
    await loadDashboardData();
  } else {
    showToast(res.message || "Failed to delete", "error");
  }
};

const handleDeleteCollection = async (id) => {
  if (!confirm("Delete this collection?")) return;
  const res = await deleteCollection(id);
  if (res.ok) {
    showToast("Collection deleted");
    await loadDashboardData();
  } else {
    showToast(res.message || "Failed to delete", "error");
  }
};

// ── Update Profile ──
const handleUpdateProfile = async () => {
  const whatsapp = document.getElementById("profile-whatsapp").value.trim();
  const hours = document.getElementById("profile-hours").value.trim();
  const days = document.getElementById("profile-days").value.trim();
  const cert = document.getElementById("profile-cert").value.trim();
  const about = document.getElementById("profile-about").value.trim();
  const imageFile = document.getElementById("profile-image").files[0];

  if (about.length > 70) {
    return showToast("About must be 70 characters or fewer", "error");
  }

  const formData = new FormData();
  if (whatsapp) formData.append("whatsapp", whatsapp);
  if (about) formData.append("about", about);
    if (hours || days)
      formData.append(
        "availability",
        JSON.stringify({
          workingHours: hours,
          workingDays: days,
        }),
      );
  if (cert) formData.append("certification", cert);
  if (imageFile) formData.append("profileImage", imageFile);

  const res = await updateVendorProfile(formData);
  if (res.ok) {
    showToast("Profile updated!");
    await loadDashboardData();
  } else {
    showToast(res.message || "Failed to update", "error");
  }
};

// ── Portfolio Upload ─–
let portfolioUploadInFlight = false;

const handlePortfolioUpload = async () => {
  if (portfolioUploadInFlight) return;

  const files = document.getElementById("portfolio-images").files;
  if (files.length === 0) return showToast("Select images first", "error");

  const currentCount = (vendorProfile?.portfolioImages || []).length;
  if (currentCount + files.length > MAX_PORTFOLIO_IMAGES) {
    return showToast(
      `Portfolio max is ${MAX_PORTFOLIO_IMAGES} images. You have ${currentCount} — remove some before adding more.`,
      "error",
    );
  }

  const formData = new FormData();
  for (const file of files) {
    formData.append("images", file);
  }

  const btn = document.getElementById("portfolio-upload-btn");
  portfolioUploadInFlight = true;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Uploading…";

  try {
    const res = await addPortfolioImages(formData);
    if (res.message) {
      showToast("Portfolio updated!");
      document.getElementById("portfolio-images").value = "";
      await loadDashboardData();
    } else {
      showToast(res.message || "Failed to upload", "error");
    }
  } finally {
    portfolioUploadInFlight = false;
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// ── Remove Portfolio Image ──
const handleRemovePortfolioImage = async (imageUrl) => {
  if (!confirm("Remove this portfolio image?")) return;

  const res = await removePortfolioImage(imageUrl);
  if (res.message) {
    showToast("Image removed");
    await loadDashboardData();
  } else {
    showToast(res.message || "Failed to remove image", "error");
  }
};

// ── Prefill Profile ──
const prefillProfile = async () => {
  if (!vendorProfile) return;
  if (vendorProfile.whatsapp)
    document.getElementById("profile-whatsapp").value = vendorProfile.whatsapp;
  if (vendorProfile.availability?.workingHours)
    document.getElementById("profile-hours").value =
      vendorProfile.availability.workingHours;
  if (vendorProfile.availability?.workingDays)
    document.getElementById("profile-days").value =
      vendorProfile.availability.workingDays;

  if (vendorProfile.certification)
    document.getElementById("profile-cert").value = vendorProfile.certification;
  if (vendorProfile.about) {
    document.getElementById("profile-about").value = vendorProfile.about;
    updateAboutWordCount();
  }
  // show current location + pre-select dropdowns
  const currentLocationText = document.getElementById("current-location-text");
  if (vendorProfile.location?.state && vendorProfile.location?.lga) {
    currentLocationText.textContent = `Current: ${vendorProfile.location.lga}, ${vendorProfile.location.state}`;
    document.getElementById("location-state").value =
      vendorProfile.location.state;
    await handleStateChange("location");
    document.getElementById("location-lga").value = vendorProfile.location.lga;
  } else {
    currentLocationText.textContent = "No location set yet.";
  }

  // show portfolio with remove buttons
  const portfolio = vendorProfile.portfolioImages || [];
  const portfolioDiv = document.getElementById("current-portfolio");

  if (portfolio.length > 0) {
    portfolioDiv.innerHTML = `
      <h4 style="margin-bottom: 10px;">Current Portfolio (${portfolio.length}/${MAX_PORTFOLIO_IMAGES})</h4>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
        ${portfolio
          .map((url, index) => {
            const safeUrl = escapeHtml(url);
            return `
          <div class="portfolio-thumb-wrap">
            <img src="${safeUrl}" data-portfolio-index="${index}" style="width: 100%; height: 80px; object-fit: cover; border-radius: 8px;" />
            <button class="portfolio-remove-btn" data-portfolio-index="${index}">×</button>
          </div>
        `;
          })
          .join("")}
      </div>
    `;

    Array.from(portfolioDiv.querySelectorAll(".portfolio-remove-btn")).forEach(
      (btn) => {
        const index = Number(btn.getAttribute("data-portfolio-index"));
        btn.addEventListener("click", () =>
          handleRemovePortfolioImage(portfolio[index]),
        );
      },
    );
  } else {
    portfolioDiv.innerHTML = "";
  }
};

// ── Subscription Status ──
const updateSubscriptionStatus = () => {
  if (!vendorProfile) return;

  const status = vendorProfile.subscriptionStatus;
  const expiry = vendorProfile.subscriptionExpiry;

  const statusText = document.getElementById("sub-status-text");
  const expiryText = document.getElementById("sub-expiry-text");
  const badge = document.getElementById("sub-badge");

  statusText.textContent = status === "active" ? "Active" : "Inactive";

  if (expiry) {
    const expiryDate = expiry._seconds
      ? new Date(expiry._seconds * 1000)
      : new Date(expiry);
    expiryText.textContent = `Expires: ${expiryDate.toDateString()}`;
  }

  badge.innerHTML =
    status === "active"
      ? `<span style="background: var(--success); color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem;">✓ Active</span>`
      : `<span style="background: #e74c3c; color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem;">✗ Inactive</span>`;
};

// ── Subscribe ──
const handleSubscribe = async (plan) => {
  showToast("Initializing payment...");
  const res = await initializeSubscription(plan);
  if (res.paymentUrl) {
    window.open(res.paymentUrl, "_blank");
    showToast("Complete payment in the new tab");

    // poll for verification after payment
    setTimeout(async () => {
      const verified = await verifySubscription(res.reference);
      if (verified.message === "Subscription activated successfully") {
        showToast("Subscription activated! 🎉");
        await loadDashboardData();
      }
    }, 30000);
  } else {
    showToast(res.message || "Payment failed", "error");
  }
};

// ── Init ──
document.addEventListener("DOMContentLoaded", async () => {
  await loadStates();
  populateStateSelect("reg-state");
  populateStateSelect("location-state");
  checkAuth();
});

const showInactiveBanner = () => {
  const existing = document.getElementById("inactive-banner");
  if (existing) return;

  const banner = document.createElement("div");
  banner.id = "inactive-banner";
  banner.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 9999;
    background: #1a1a1a;
    border: 1px solid #FF6B35;
    border-radius: 12px;
    padding: 14px 16px;
    max-width: 280px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  `;
  banner.innerHTML = `
    <button id="inactive-banner-close" style="
      position: absolute; top: 8px; right: 10px;
      background: none; border: none; color: #888; 
      font-size: 1.1rem; cursor: pointer;">×</button>
    <p style="color: #fff; font-size: 0.85rem; margin-bottom: 8px; padding-right: 16px;">
      🔔 Subscribe to share your business and services with the world!
    </p>
    <span id="inactive-banner-cta" style="
      color: #FF6B35; font-size: 0.85rem; 
      font-weight: 600; cursor: pointer;">
      Go to Subscription →
    </span>
  `;
  document.body.appendChild(banner);

  document
    .getElementById("inactive-banner-close")
    .addEventListener("click", () => banner.remove());
  document
    .getElementById("inactive-banner-cta")
    .addEventListener("click", () => switchDashTab("subscription"));
};

// expose handlers and utilities to global scope so inline `onclick` attributes work
Object.assign(window, {
  switchDashTab,
  openModal,
  closeModal,
  handleLogin,
  showRegister,
  handleRegister,
  showLogin,
  handleAddProduct,
  handleAddService,
  handleAddCollection,
  handleDeleteProduct,
  handleDeleteService,
  handleDeleteCollection,
  handleUpdateProfile,
  handlePortfolioUpload,
  handleRemovePortfolioImage,
  handleSubscribe,
  handleStateChange,
  handleUpdateLocation,
  searchJobTitles,
  selectJobTitle,
  removeJobTitle,
  handleCollectionSelectChange,
  handleForgotPassword,
  showInactiveBanner,
});
