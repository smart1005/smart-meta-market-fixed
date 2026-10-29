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

// ── Pick a diverse, randomized selection across vendors ──
const pickDiverseRandom = (items, count, vendorKeyFn) => {
  const groups = {};
  items.forEach((item) => {
    const key = vendorKeyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  // shuffle each vendor's own items, and shuffle the vendor order itself
  const vendorIds = Object.keys(groups).sort(() => Math.random() - 0.5);
  vendorIds.forEach((id) => groups[id].sort(() => Math.random() - 0.5));

  const result = [];
  let round = 0;
  while (result.length < count) {
    let addedThisRound = false;
    for (const id of vendorIds) {
      if (groups[id][round]) {
        result.push(groups[id][round]);
        addedThisRound = true;
        if (result.length === count) break;
      }
    }
    if (!addedThisRound) break; // every vendor's items exhausted
    round++;
  }

  return result;
};

const PLACEHOLDER_IMG =
  "https://via.placeholder.com/400x160/141414/FF6B35?text=No+Image";

// ── Load Categories as Chips (name only, no emoji) ──
const loadCategories = async () => {
  const container = document.getElementById("category-chips");
  if (!container) return;
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
        data-category="${escapeHtml(cat.category)}"
        onclick="goToCategory(this.dataset.category)">
        <span>${escapeHtml(cat.category)}</span>
      </div>
    `,
      )
      .join("");
  } catch (error) {
    container.innerHTML = "<p class='text-sub'>Failed to load</p>";
  }
};

// ── Featured Services (listing) ──
const loadServicesScroll = async () => {
  const container = document.getElementById("services-scroll");
  if (!container) return;
  try {
    const data = await getServices();
    let services = data.services || [];
    if (services.length === 0) {
      container.innerHTML = "<p class='text-sub'>No services yet</p>";
      return;
    }
    services = pickDiverseRandom(services, 10, (s) => s.vendorId);
    container.innerHTML = services
      .map(
        (service) => `
      <div class="service-card"
        data-vendor="${escapeHtml(service.vendorId)}"
        onclick="goToVendor(this.dataset.vendor)">
        <h4>${escapeHtml(service.jobTitle || service.title)}</h4>
        <div class="by">by ${escapeHtml(service.vendorName)}</div>
        ${service.price ? `<div style="color: var(--primary); font-weight: 700; font-size: 0.85rem; margin-top: 6px;">From ₦${Number(service.price).toLocaleString()}</div>` : ""}
      </div>
    `,
      )
      .join("");
  } catch (error) {
    container.innerHTML = "<p class='text-sub'>Failed to load</p>";
  }
};

// ── Featured Products (listing) ──
const loadProductsScroll = async () => {
  const container = document.getElementById("products-scroll");
  if (!container) return;
  try {
    const data = await getProducts();
    let products = data.products || [];
    if (products.length === 0) {
      container.innerHTML = "<p class='text-sub'>No products yet</p>";
      return;
    }
    products = pickDiverseRandom(products, 10, (p) => p.vendorId);
    container.innerHTML = products
      .map((product) => {
        const img = product.imageUrl || PLACEHOLDER_IMG;
        return `
      <div class="product-card">
        <img src="${escapeHtml(img)}"
          alt="${escapeHtml(product.name)}"
          data-img="${escapeHtml(img)}"
          onclick="event.stopPropagation(); openImageLightbox(this.dataset.img)" />
        <div class="product-card-body"
          data-vendor="${escapeHtml(product.vendorId)}"
          onclick="goToVendor(this.dataset.vendor)">
          <h4>${escapeHtml(product.name)}</h4>
          <div class="by">by ${escapeHtml(product.vendorName)}</div>
          <div class="price">₦${Number(product.price).toLocaleString()}</div>
        </div>
      </div>
    `;
      })
      .join("");
  } catch (error) {
    container.innerHTML = "<p class='text-sub'>Failed to load</p>";
  }
};


// ── Top Picks: constant, slow, right-to-left slide ──
const renderTopProductCard = (product) => {
  const img = product.imageUrl || PLACEHOLDER_IMG;
  return `
    <div class="marquee-item">
      <div class="vendor-card">
        <img class="vendor-card-image"
          src="${escapeHtml(img)}"
          alt="${escapeHtml(product.name)}"
          data-img="${escapeHtml(img)}"
          onclick="event.stopPropagation(); openImageLightbox(this.dataset.img)" />
        <div class="vendor-card-body"
          data-vendor="${escapeHtml(product.vendorId)}"
          onclick="goToVendor(this.dataset.vendor)">
          <h3>${escapeHtml(product.name)}</h3>
          <div class="vendor-by">by ${escapeHtml(product.vendorName)}</div>
          <div class="vendor-card-meta">
            <span class="vendor-type-badge">₦${Number(product.price).toLocaleString()}</span>
            <span class="vendor-location">${escapeHtml(product.category || "")}</span>
          </div>
        </div>
      </div>
    </div>
  `;
};

const renderTopServiceCard = (service) => {
  const img = service.imageUrl || service.imageUrls?.[0] || PLACEHOLDER_IMG;
  return `
    <div class="marquee-item">
      <div class="vendor-card">
        <img class="vendor-card-image"
          src="${escapeHtml(img)}"
          alt="${escapeHtml(service.jobTitle || service.title)}"
          data-img="${escapeHtml(img)}"
          onclick="event.stopPropagation(); openImageLightbox(this.dataset.img)" />
        <div class="vendor-card-body"
          data-vendor="${escapeHtml(service.vendorId)}"
          onclick="goToVendor(this.dataset.vendor)">
          <h3>${escapeHtml(service.jobTitle || service.title)}</h3>
          <div class="vendor-by">by ${escapeHtml(service.vendorName)}</div>
          <div class="vendor-card-meta">
            <span class="vendor-type-badge">${escapeHtml(service.category || "Service")}</span>
          </div>
        </div>
      </div>
    </div>
  `;
};

// Fills a track with cards twice over, so the CSS animation can slide
// exactly half the track and loop with no visible jump.
const buildMarquee = (track, items, renderFn, secondsPerItem = 3) => {
  // too few items to loop nicely: just show them still
  if (items.length < 4) {
    track.classList.add("marquee-static");
    track.innerHTML = items.map(renderFn).join("");
    return;
  }
  let half = [...items];
  while (half.length < 8) half = half.concat(items);
  track.classList.remove("marquee-static");
  track.style.animationDuration = `${half.length * secondsPerItem}s`;
  track.innerHTML = [...half, ...half].map(renderFn).join("");
};

const loadTopProducts = async () => {
  const track = document.getElementById("top-products-track");
  if (!track) return;
  try {
    const data = await getProducts();
    let products = data.products || [];
    if (products.length === 0) {
      track.innerHTML = "<p class='text-sub text-center'>No products yet</p>";
      return;
    }
    products = pickDiverseRandom(products, 8, (p) => p.vendorId);
    buildMarquee(track, products, renderTopProductCard);
  } catch (error) {
    track.innerHTML = "<p class='text-sub text-center'>Failed to load</p>";
  }
};

const loadTopServices = async () => {
  const track = document.getElementById("top-services-track");
  if (!track) return;
  try {
    const data = await getServices();
    let services = data.services || [];
    if (services.length === 0) {
      track.innerHTML = "<p class='text-sub text-center'>No services yet</p>";
      return;
    }
    services = pickDiverseRandom(services, 8, (s) => s.vendorId);
    buildMarquee(track, services, renderTopServiceCard);
  } catch (error) {
    track.innerHTML = "<p class='text-sub text-center'>Failed to load</p>";
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
  loadTopProducts();
  loadTopServices();
});
