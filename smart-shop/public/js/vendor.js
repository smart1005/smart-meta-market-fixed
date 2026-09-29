let vendorData = null;
let currentTab = "products";

// ── Get Vendor ID from URL ──
const getVendorId = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
};

// ── Switch Tabs ──
const switchVendorTab = (tab) => {
  currentTab = tab;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  document.getElementById(`tab-${tab}`)?.classList.add("active");

  const productsEl = document.getElementById("tab-content-products");
  if (productsEl)
    productsEl.style.display = tab === "products" ? "block" : "none";

  const servicesEl = document.getElementById("tab-content-services");
  if (servicesEl)
    servicesEl.style.display = tab === "services" ? "block" : "none";

  const portfolioEl = document.getElementById("tab-content-portfolio");
  if (portfolioEl)
    portfolioEl.style.display = tab === "portfolio" ? "block" : "none";
};

// ── Render Vendor Page ──
const renderVendorPage = (vendor, collections, services) => {
  const page = document.getElementById("vendor-page");

  const whatsappNumber = vendor.whatsapp || vendor.phone || "";
  const whatsappLink = whatsappNumber
    ? `https://wa.me/${whatsappNumber.replace(/\D/g, "")}`
    : "#";

  const callLink = vendor.phone ? `tel:${vendor.phone}` : "#";

    page.innerHTML = `
    <!-- Vendor Hero -->
    <div class="vendor-hero">
      <img class="vendor-avatar" src="${vendor.profileImage || "https://via.placeholder.com/200x200/2F6FFF/ffffff?text=" + vendor.businessName?.charAt(0)}" alt="${vendor.businessName}" />
    </div>

    <!-- Vendor Info -->
   <div class="vendor-info">
      <h1>${vendor.businessName}</h1>
      <p>${vendor.category || ""} ${vendor.location?.city ? "• 📍 " + vendor.location.city : ""}</p>
      ${vendor.about ? `<p style="margin-top: 8px; font-size: 0.9rem;">${vendor.about}</p>` : ""}
      <!-- Contact Buttons -->
      <div class="contact-buttons">
        ${whatsappNumber ? `<a href="${whatsappLink}" target="_blank" class="whatsapp-btn">💬 WhatsApp</a>` : ""}
        ${vendor.phone ? `<a href="${callLink}" class="call-btn">📞 Call</a>` : ""}
      </div>

      <!-- Availability -->
            ${
              vendor.availability
                ? `
        <div class="card mb-2" style="padding: 12px 16px;">
          <p style="font-size: 0.85rem;">
            🕐 ${vendor.availability.workingHours || ""} 
            ${vendor.availability.workingDays ? "• " + vendor.availability.workingDays : ""}
          </p>
        </div>
      `
                : ""
            }
      ${
        vendor.certification
          ? `
        <div class="card mb-2" style="padding: 12px 16px;">
          <p style="font-size: 0.85rem;">🎓 ${vendor.certification}</p>
        </div>
      `
          : ""
      }

    <!-- Tab Bar -->
      <div class="tab-bar">
        <button class="tab-btn active" id="tab-products" onclick="switchVendorTab('products')">
          🛍️ ${vendor.vendorType === "service" ? "Services" : "Products"}
        </button>
        ${
          vendor.vendorType === "service"
            ? ""
            : `<button class="tab-btn" id="tab-services" onclick="switchVendorTab('services')">
                📁 Collections
              </button>`
        }
        <button class="tab-btn" id="tab-portfolio" onclick="switchVendorTab('portfolio')">
          🖼️ Portfolio
        </button>
      </div>

      <!-- Products / Services Tab -->
      <div id="tab-content-products">
        ${renderProductsOrServices(vendor, services)}
      </div>

      ${
        vendor.vendorType === "service"
          ? ""
          : `<!-- Collections Tab -->
            <div id="tab-content-services" style="display: none;">
              ${renderCollections(collections)}
            </div>`
      }

      <!-- Portfolio Tab -->
      <div id="tab-content-portfolio" style="display: none;">
        ${renderPortfolio(vendor)}
      </div>
    </div>
  `;
};

// ── Render Products or Services ──
const renderProductsOrServices = (vendor, services) => {
  if (vendor.vendorType === "service") {
    if (!services || services.length === 0) {
      return "<p class='text-sub text-center'>No services listed yet</p>";
    }
    return services
      .map(
        (service) => `
      <div class="service-item">
        ${
          service.imageUrl || service.imageUrls?.[0]
            ? `
          <img src="${service.imageUrl || service.imageUrls[0]}" alt="${service.jobTitle}" 
            style="width: 100%; height: 140px; object-fit: cover; border-radius: 8px; margin-bottom: 10px;" />
        `
            : ""
        }
        <h4>${service.jobTitle || service.title}</h4>
        <p>${service.description || ""}</p>
        ${service.price ? `<p class="text-primary" style="font-weight: 700;">From ₦${Number(service.price).toLocaleString()}</p>` : ""}
        <div class="skills-list">
          ${(service.skills || []).map((skill) => `<span class="skill-tag">${skill}</span>`).join("")}
        </div>
      </div>
    `,
      )
      .join("");
  }

  // product vendor — show products
  return `<div class="product-grid" id="vendor-products-grid">
    <div class="spinner"></div>
  </div>`;
};

// ── Render Collections ──
const renderCollections = (collections) => {
  if (!collections || collections.length === 0) {
    return "<p class='text-sub text-center'>No collections yet</p>";
  }

  return collections
    .map(
      (col) => `
    <div class="collection-section">
      <div class="collection-title">📁 ${col.name}</div>
      ${col.description ? `<p style="font-size: 0.85rem; margin-bottom: 12px;">${col.description}</p>` : ""}
      ${
        col.products && col.products.length > 0
          ? `
       <div class="product-grid">
          ${col.products
            .map(
              (item) => `
            <div class="product-item">
              <img src="${item.imageUrl || "https://via.placeholder.com/200x120/1a1a1a/FF6B35?text=No+Image"}" alt="${item.name}" />
              <div class="product-item-body">
                <h4>${item.name}</h4>
                <p class="price">₦${Number(item.price).toLocaleString()}</p>
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
      `
          : "<p class='text-sub'>No products in this collection yet</p>"
      }
    </div>
  `,
    )
    .join("");
};

// ── Render Portfolio ──
const renderPortfolio = (vendor) => {
  const images = vendor.portfolioImages || [];
  if (images.length === 0) {
    return "<p class='text-sub text-center'>No portfolio images yet</p>";
  }
  return `
    <div class="portfolio-grid">
      ${images
        .map(
          (url) => `
        <img src="${url}" alt="Portfolio" />
      `,
        )
        .join("")}
    </div>
  `;
};

// ── Load Vendor Products ──
const loadVendorProducts = async (vendorId) => {
  const grid = document.getElementById("vendor-products-grid");
  if (!grid) return;

  try {
    const data = await getProducts();
    const products = (data.products || []).filter(
      (p) => p.vendorId === vendorId,
    );

    if (products.length === 0) {
      grid.innerHTML =
        "<p class='text-sub text-center'>No products listed yet</p>";
      return;
    }

    grid.innerHTML = products
      .map(
        (product) => `
      <div class="product-item">
        <img src="${product.imageUrl || "https://via.placeholder.com/200x120/1a1a1a/FF6B35?text=No+Image"}" alt="${product.name}" />
        <div class="product-item-body">
          <h4>${product.name}</h4>
          <p class="price">₦${Number(product.price).toLocaleString()}</p>
        </div>
      </div>
    `,
      )
      .join("");
  } catch (error) {
    if (grid)
      grid.innerHTML =
        "<p class='text-sub text-center'>Failed to load products</p>";
  }
};

// ── Init ──
document.addEventListener("DOMContentLoaded", async () => {
  const vendorId = getVendorId();
  if (!vendorId) {
    window.location.href = "browse.html";
    return;
  }

  try {
    const [vendorRes, collectionsRes, servicesRes] = await Promise.all([
      getVendorProfile(vendorId),
      getVendorCollections(vendorId),
      getServices(),
    ]);

    vendorData = vendorRes.vendor;
    const collections = collectionsRes.collections || [];
    const services = (servicesRes.services || []).filter(
      (s) => s.vendorId === vendorId,
    );

    renderVendorPage(vendorData, collections, services);

    // load products if product vendor
    if (vendorData.vendorType !== "service") {
      loadVendorProducts(vendorId);
    }
  } catch (error) {
    document.getElementById("vendor-page").innerHTML =
      "<p class='text-sub text-center mt-3'>Failed to load vendor profile</p>";
  }
});
