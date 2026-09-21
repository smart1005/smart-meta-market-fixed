let allProducts = [];
let allServices = [];
let currentTab = "products";
let selectedCategory = null;
let customerLocation = null;
let locationRequested = false;

// ── Relevance Scoring ──
const getRelevanceScore = (query, text) => {
  const q = (query || "").toLowerCase().trim();
  const t = (text || "").toLowerCase();
  if (!q) return 1;
  if (t === q) return 4;
  if (t.includes(q)) return 3;
  const queryWords = q.split(/\s+/).filter(Boolean);
  const matchedWords = queryWords.filter((w) => t.includes(w));
  if (matchedWords.length === queryWords.length) return 2;
  if (matchedWords.length > 0) return 1;
  return 0;
};

// ── Distance (Haversine, in km) ──
const getDistanceKm = (from, to) => {
  if (!from || !to || typeof to.lat !== "number" || typeof to.lng !== "number") {
    return null;
  }
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// ── Sort: relevance first, distance only breaks ties ──
const compareResults = (a, b) => {
  if (b._relevance !== a._relevance) return b._relevance - a._relevance;
  const distA = getDistanceKm(customerLocation, a.vendorLocation);
  const distB = getDistanceKm(customerLocation, b.vendorLocation);
  if (distA !== null && distB !== null) return distA - distB;
  return 0;
};

// ── Switch Tabs ──
const switchTab = (tab) => {
  currentTab = tab;

  document.getElementById("products-tab").style.display =
    tab === "products" ? "block" : "none";
  document.getElementById("services-tab").style.display =
    tab === "services" ? "block" : "none";

  document.getElementById("btn-products").className =
    `btn w-full ${tab === "products" ? "btn-primary" : "btn-outline"}`;
  document.getElementById("btn-services").className =
    `btn w-full ${tab === "services" ? "btn-primary" : "btn-outline"}`;

  document.getElementById("browse-search").placeholder =
    tab === "products" ? "Search products..." : "Search services...";
  document.getElementById("browse-search").value = "";

  handleSearch();
};

const requestCustomerLocation = () => {
  if (locationRequested) return;
  locationRequested = true;

  if (!navigator.geolocation) {
    showLocationMessage(
      "Location isn't supported on this device — showing all results.",
    );
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      customerLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      hideLocationMessage();
      handleSearch();
    },
    () => {
      showLocationMessage(
        "Turn on your location to see vendors closer to you.",
      );
    },
  );
};

const showLocationMessage = (text) => {
  const el = document.getElementById("location-message");
  el.textContent = text;
  el.style.display = "block";
};

const hideLocationMessage = () => {
  const el = document.getElementById("location-message");
  el.style.display = "none";
};

// ── Handle Search ──
const handleSearch = () => {
  const query = document
    .getElementById("browse-search")
    .value.toLowerCase()
    .trim();

  if (currentTab === "products") {
    const scored = allProducts
      .map((p) => ({ ...p, _relevance: getRelevanceScore(query, p.name) }))
      .filter((p) => p._relevance > 0);
    scored.sort(compareResults);
    renderProducts(scored);
  } else {
    let filtered = allServices;
    if (selectedCategory) {
      filtered = filtered.filter((s) => s.category === selectedCategory);
    }
    const scored = filtered
      .map((s) => ({
        ...s,
        _relevance: Math.max(
          getRelevanceScore(query, s.jobTitle),
          getRelevanceScore(query, s.title),
          ...(s.skills || []).map((skill) => getRelevanceScore(query, skill)),
        ),
      }))
      .filter((s) => s._relevance > 0);
    scored.sort(compareResults);
    renderServices(scored);
  }
};

// ── Render Products ──
const renderProducts = (products) => {
  const grid = document.getElementById("products-grid");
  const count = document.getElementById("product-count");
  count.textContent = `${products.length} found`;

  if (products.length === 0) {
    grid.innerHTML = "<p class='text-sub text-center'>No products found</p>";
    return;
  }

  grid.innerHTML = products
    .map(
      (product) => `
    <div class="vendor-card" onclick="window.location='vendor.html?id=${product.vendorId}'">
      <img 
        class="vendor-card-image" 
        src="${product.imageUrl || "https://via.placeholder.com/400x160/1a1a1a/FF6B35?text=No+Image"}" 
        alt="${product.name}"
      />
      <div class="vendor-card-body">
        <h3>${product.name}</h3>
        <p>${product.description || ""}</p>
        <div class="vendor-card-meta">
          <span class="vendor-type-badge">₦${Number(product.price).toLocaleString()}</span>
          <span class="vendor-location">by ${product.vendorName}${(() => {
            const dist = getDistanceKm(
              customerLocation,
              product.vendorLocation,
            );
            return dist !== null ? ` • ~${dist.toFixed(1)}km away` : "";
          })()}</span>
        </div>
      </div>
    </div>
  `,
    )
    .join("");
};

// ── Render Services ──
const renderServices = (services) => {
  const grid = document.getElementById("services-grid");
  const count = document.getElementById("service-count");
  count.textContent = `${services.length} found`;

  if (services.length === 0) {
    grid.innerHTML = "<p class='text-sub text-center'>No services found</p>";
    return;
  }

  grid.innerHTML = services
    .map(
      (service) => `
    <div class="vendor-card" onclick="window.location='vendor.html?id=${service.vendorId}'">
      <img 
        class="vendor-card-image" 
        src="${service.imageUrl || service.imageUrls?.[0] || "https://via.placeholder.com/400x160/1a1a1a/FF6B35?text=No+Image"}" 
        alt="${service.jobTitle || service.title}"
      />
      <div class="vendor-card-body">
        <h3>${service.jobTitle || service.title}</h3>
        <p>${service.description || ""}</p>
        <div class="vendor-card-meta">
          <span class="vendor-type-badge">🔧 ${service.category || "Service"}</span>
          <span class="vendor-location">by ${service.vendorName}${(() => {
            const dist = getDistanceKm(
              customerLocation,
              service.vendorLocation,
            );
            return dist !== null ? ` • ~${dist.toFixed(1)}km away` : "";
          })()}</span>
        </div>
      </div>
    </div>
  `,
    )
    .join("");
};

// ── Load Category Filter ──
const loadCategoryFilter = async () => {
  const container = document.getElementById("category-filter");
  try {
    const data = await getJobTitles();
    const categories = data.jobTitles || data.categories || [];

    container.innerHTML = `
      <button 
        class="btn btn-primary" 
        id="cat-all"
        onclick="filterByCategory(null)"
        style="margin-right: 8px; padding: 6px 14px; font-size: 0.8rem; display: inline-block;"
      >All</button>
      ${categories
        .map(
          (cat) => `
        <button 
          class="btn btn-outline" 
          id="cat-${cat.category}"
          onclick="filterByCategory('${cat.category}')"
          style="margin-right: 8px; padding: 6px 14px; font-size: 0.8rem; display: inline-block; white-space: nowrap;"
        >${cat.category}</button>
      `,
        )
        .join("")}
    `;
  } catch (error) {
    container.innerHTML = "";
  }
};

// ── Filter By Category ──
const filterByCategory = (category) => {
  selectedCategory = category;

  // update button styles
  document.querySelectorAll("#category-filter button").forEach((btn) => {
    btn.className = "btn btn-outline";
    btn.style.cssText =
      "margin-right: 8px; padding: 6px 14px; font-size: 0.8rem; display: inline-block; white-space: nowrap;";
  });

  const activeBtn = category
    ? document.getElementById(`cat-${category}`)
    : document.getElementById("cat-all");

  if (activeBtn) {
    activeBtn.className = "btn btn-primary";
    activeBtn.style.cssText =
      "margin-right: 8px; padding: 6px 14px; font-size: 0.8rem; display: inline-block; white-space: nowrap;";
  }

  handleSearch();
};

// ── Load All Data ──
const loadData = async () => {
  try {
    const [productsData, servicesData] = await Promise.all([
      getProducts(),
      getServices(),
    ]);

    allProducts = productsData.products || [];
    allServices = servicesData.services || [];

    renderProducts(allProducts);
    renderServices(allServices);
    loadCategoryFilter();
  } catch (error) {
    showToast("Failed to load data", "error");
  }
};

// ── Check URL Params ──
const checkUrlParams = () => {
  const params = new URLSearchParams(window.location.search);
  const type = params.get("type");
  const search = params.get("search");
  const category = params.get("category");

  if (type === "services") {
    switchTab("services");
    if (category) filterByCategory(category);
  } else {
    switchTab("products");
  }

  if (search) {
    document.getElementById("browse-search").value = search;
    handleSearch();
  }
};

// ── Init ──
document.addEventListener("DOMContentLoaded", async () => {
  await loadData();
  checkUrlParams();
  document.getElementById("browse-search").addEventListener("focus", requestCustomerLocation, { once: true });

  // if arriving with a search already in the URL (e.g. from the homepage or
  // a category link), request location right away instead of waiting for
  // the customer to touch the search bar again
  const params = new URLSearchParams(window.location.search);
  if (params.get("search")) {
    requestCustomerLocation();
  }
});