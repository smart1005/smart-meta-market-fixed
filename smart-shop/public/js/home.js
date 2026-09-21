// ── 3D Hero Animation ──
const initHero = () => {
  const canvas = document.getElementById("hero-canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.z = 5;

  // floating particles — mix of orange and gold
  const geometry = new THREE.BufferGeometry();
  const count = 1000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 20;

    // alternate between orange and gold
    if (Math.random() > 0.5) {
      colors[i * 3] = 1.0;
      colors[i * 3 + 1] = 0.42;
      colors[i * 3 + 2] = 0.21;
    } else {
      colors[i * 3] = 1.0;
      colors[i * 3 + 1] = 0.84;
      colors[i * 3 + 2] = 0.0;
    }
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.06,
    transparent: true,
    opacity: 0.8,
    vertexColors: true,
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  // floating rings
  const rings = [];
  const ringColors = [0xff6b35, 0xffd700, 0xff8c5a];
  for (let i = 0; i < 3; i++) {
    const ringGeo = new THREE.TorusGeometry(1.5 + i * 0.8, 0.02, 16, 100);
    const ringMat = new THREE.MeshBasicMaterial({
      color: ringColors[i],
      transparent: true,
      opacity: 0.12 - i * 0.02,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.random() * Math.PI;
    ring.rotation.y = Math.random() * Math.PI;
    scene.add(ring);
    rings.push(ring);
  }

  const animate = () => {
    requestAnimationFrame(animate);
    particles.rotation.y += 0.0008;
    particles.rotation.x += 0.0003;
    rings.forEach((ring, i) => {
      ring.rotation.x += 0.002 * (i + 1);
      ring.rotation.y += 0.001 * (i + 1);
    });
    renderer.render(scene, camera);
  };

  animate();

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
};

// ── Category Icons ──
const categoryIcons = {
  Education: "📚",
  Healthcare: "🏥",
  "Legal & Finance": "⚖️",
  "Construction & Skilled Trades": "🔨",
  "Home Services": "🏠",
  Automotive: "🚗",
  Technology: "💻",
  "Beauty & Fashion": "💄",
  Events: "🎉",
  "Business Services": "💼",
  Security: "🔒",
  Agriculture: "🌾",
  "Delivery & Transport": "🚚",
  "Manufacturing & Industrial": "🏭",
  "Creative Arts": "🎨",
  "Fitness & Sports": "💪",
  "Religious & Community": "🙏",
  "Repair Services": "🔧",
  "Real Estate": "🏢",
  "Specialized Services": "⭐",
};

// ── Load Categories as Chips ──
const loadCategories = async () => {
  const container = document.getElementById("category-chips");
  try {
    const data = await getJobTitles();
    const categories = data.jobTitles || data.categories || [];
    if (categories.length === 0) {
      container.innerHTML = "<p class='text-sub'>No categories found</p>";
      return;
    }
    container.innerHTML = categories
      .map(
        (cat) => `
      <div class="category-chip" 
        onclick="window.location='browse.html?type=services&category=${encodeURIComponent(cat.category)}'">
        <span>${categoryIcons[cat.category] || "🔹"}</span>
        <span>${cat.category}</span>
      </div>
    `,
      )
      .join("");
  } catch (error) {
    container.innerHTML = "<p class='text-sub'>Failed to load</p>";
  }
};

// ── Load Services Horizontal Scroll ──
const loadServicesScroll = async () => {
  const container = document.getElementById("services-scroll");
  try {
    const data = await getServices();
    let services = data.services || [];
    if (services.length === 0) {
      container.innerHTML = "<p class='text-sub'>No services yet</p>";
      return;
    }
    services = services.sort(() => Math.random() - 0.5).slice(0, 10);
    container.innerHTML = services
      .map(
        (service) => `
      <div class="service-card" onclick="window.location='vendor.html?id=${service.vendorId}'">
        <div class="service-icon">${categoryIcons[service.category] || "🔧"}</div>
        <h4>${service.jobTitle || service.title}</h4>
        <div class="by">by ${service.vendorName}</div>
        ${service.price ? `<div style="color: var(--primary); font-weight: 700; font-size: 0.85rem; margin-top: 6px;">From ₦${Number(service.price).toLocaleString()}</div>` : ""}
      </div>
    `,
      )
      .join("");
  } catch (error) {
    container.innerHTML = "<p class='text-sub'>Failed to load</p>";
  }
};

// ── Load Products Horizontal Scroll ──
const loadProductsScroll = async () => {
  const container = document.getElementById("products-scroll");
  try {
    const data = await getProducts();
    let products = data.products || [];
    if (products.length === 0) {
      container.innerHTML = "<p class='text-sub'>No products yet</p>";
      return;
    }
    products = products.sort(() => Math.random() - 0.5).slice(0, 10);
    container.innerHTML = products
      .map(
        (product) => `
      <div class="product-card" onclick="window.location='vendor.html?id=${product.vendorId}'">
        <img src="${product.imageUrl || "https://via.placeholder.com/160x120/141414/FF6B35?text=No+Image"}" 
          alt="${product.name}" />
        <div class="product-card-body">
          <h4>${product.name}</h4>
          <div class="by">by ${product.vendorName}</div>
          <div class="price">₦${Number(product.price).toLocaleString()}</div>
        </div>
      </div>
    `,
      )
      .join("");
  } catch (error) {
    container.innerHTML = "<p class='text-sub'>Failed to load</p>";
  }
};

// ── Load Featured Products (big cards) ──
const loadFeaturedProducts = async () => {
  const grid = document.getElementById("featured-grid");
  try {
    const data = await getProducts();
    let products = data.products || [];
    if (products.length === 0) {
      grid.innerHTML = "<p class='text-sub text-center'>No products yet</p>";
      return;
    }
    products = products.sort(() => Math.random() - 0.5).slice(0, 6);
    grid.innerHTML = products
      .map(
        (product) => `
      <div class="vendor-card" onclick="window.location='vendor.html?id=${product.vendorId}'">
        <img class="vendor-card-image"
          src="${product.imageUrl || "https://via.placeholder.com/400x160/141414/FF6B35?text=No+Image"}"
          alt="${product.name}" />
        <div class="vendor-card-body">
          <h3>${product.name}</h3>
          <div class="vendor-by">by ${product.vendorName}</div>
          <div class="vendor-card-meta">
            <span class="vendor-type-badge">₦${Number(product.price).toLocaleString()}</span>
            <span class="vendor-location">${product.category || ""}</span>
          </div>
        </div>
      </div>
    `,
      )
      .join("");
  } catch (error) {
    grid.innerHTML = "<p class='text-sub text-center'>Failed to load</p>";
  }
};

// ── Search ──
const searchProducts = () => {
  const query = document.getElementById("product-search").value.trim();
  if (!query) return showToast("Enter a product to search", "error");
  window.location.href = `browse.html?type=products&search=${encodeURIComponent(query)}`;
};

const searchServices = () => {
  const query = document.getElementById("service-search").value.trim();
  if (!query) return showToast("Enter a service to search", "error");
  window.location.href = `browse.html?type=services&search=${encodeURIComponent(query)}`;
};

// ── Enter Key ──
document.getElementById("product-search").addEventListener("keypress", (e) => {
  if (e.key === "Enter") searchProducts();
});
document.getElementById("service-search").addEventListener("keypress", (e) => {
  if (e.key === "Enter") searchServices();
});

// ── Init ──
document.addEventListener("DOMContentLoaded", () => {
  initHero();
  loadCategories();
  loadServicesScroll();
  loadProductsScroll();
  loadFeaturedProducts();
});
