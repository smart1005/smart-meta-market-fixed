import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Hero3D from "../components/Hero3D.jsx";
import { categoryIcons } from "../data/categoryIcons.js";
import { getJobTitles, getServices, getProducts } from "../api/client.js";

// small helper — same "pick N at random" behavior as the original
// products.sort(() => Math.random() - 0.5).slice(0, N)
const sample = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);

export default function Home() {
  const navigate = useNavigate();

  const [categories, setCategories] = useState([]);
  const [categoriesState, setCategoriesState] = useState("loading"); // loading | ok | empty | error
  const [servicesScroll, setServicesScroll] = useState([]);
  const [servicesState, setServicesState] = useState("loading");
  const [productsScroll, setProductsScroll] = useState([]);
  const [productsState, setProductsState] = useState("loading");
  const [featured, setFeatured] = useState([]);
  const [featuredState, setFeaturedState] = useState("loading");

  const [productQuery, setProductQuery] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const [heroVisible, setHeroVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setHeroVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const data = await getJobTitles();
        const cats = data.jobTitles || data.categories || [];
        setCategories(cats);
        setCategoriesState(cats.length === 0 ? "empty" : "ok");
      } catch {
        setCategoriesState("error");
      }
    })();

    (async () => {
      try {
        const data = await getServices();
        const services = data.services || [];
        setServicesScroll(sample(services, 10));
        setServicesState(services.length === 0 ? "empty" : "ok");
      } catch {
        setServicesState("error");
      }
    })();

    (async () => {
      try {
        const data = await getProducts();
        const products = data.products || [];
        setProductsScroll(sample(products, 10));
        setProductsState(products.length === 0 ? "empty" : "ok");
        setFeatured(sample(products, 6));
        setFeaturedState(products.length === 0 ? "empty" : "ok");
      } catch {
        setProductsState("error");
        setFeaturedState("error");
      }
    })();
  }, []);

  const searchProducts = () => {
    const q = productQuery.trim();
    if (!q) return;
    navigate(`/browse?type=products&search=${encodeURIComponent(q)}`);
  };

  const searchServices = () => {
    const q = serviceQuery.trim();
    if (!q) return;
    navigate(`/browse?type=services&search=${encodeURIComponent(q)}`);
  };

  return (
    <div className="min-h-screen bg-bg font-body">
      {/* Nav */}
      <nav className="flex items-center justify-between px-5 py-4">
        <div className="text-lg font-bold font-display">
          <span className="text-text">Smart</span>
          <span className="text-primary">Meta</span>
          <span className="text-gold">Market</span>
        </div>
        <button
          onClick={() => navigate("/vendor/login")}
          className="text-sm px-4 py-2 rounded-full font-medium border border-primary text-primary hover:bg-primary hover:text-bg transition-colors"
        >
          Vendor login
        </button>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden h-[420px]">
        <Hero3D />
        <div
          className="absolute inset-0 flex flex-col justify-center px-5"
          style={{
            background: "linear-gradient(180deg, rgba(10,10,10,0.2) 0%, rgba(10,10,10,0.85) 90%)",
            opacity: heroVisible ? 1 : 0,
            transform: heroVisible ? "translateY(0)" : "translateY(16px)",
            transition: "opacity 700ms ease, transform 700ms ease",
          }}
        >
          <h1 className="font-display font-bold text-text text-[2.1rem] leading-tight mb-2 max-w-[20ch]">
            Find a vendor near you. Reach out directly.
          </h1>
          <p className="text-subtext mb-5 max-w-md text-[0.95rem]">
            Browse products and services from local vendors — then contact them straight on WhatsApp, call, or social.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 max-w-lg">
            <input
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchProducts()}
              placeholder="Search products…"
              className="px-4 py-2.5 rounded-full text-sm flex-1 outline-none bg-surface border border-border text-text placeholder:text-subtext"
            />
            <input
              value={serviceQuery}
              onChange={(e) => setServiceQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchServices()}
              placeholder="Search services…"
              className="px-4 py-2.5 rounded-full text-sm flex-1 outline-none bg-surface border border-border text-text placeholder:text-subtext"
            />
            <button
              onClick={() => { searchProducts(); searchServices(); }}
              className="px-6 py-2.5 rounded-full text-sm font-semibold bg-primary text-bg hover:bg-primary-hover transition-colors"
            >
              Search
            </button>
          </div>
        </div>
      </section>

      {/* Category chips */}
      <div className="flex gap-2 px-5 py-4 overflow-x-auto no-scrollbar">
        {categoriesState === "loading" && <span className="text-subtext text-sm">Loading categories…</span>}
        {categoriesState === "empty" && <span className="text-subtext text-sm">No categories yet</span>}
        {categoriesState === "error" && <span className="text-subtext text-sm">Couldn't load categories</span>}
        {categoriesState === "ok" &&
          categories.map((cat) => (
            <button
              key={cat.category}
              onClick={() => navigate(`/browse?type=services&category=${encodeURIComponent(cat.category)}`)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm whitespace-nowrap font-medium bg-surface border border-border text-subtext hover:border-primary hover:text-text transition-colors"
            >
              <span>{categoryIcons[cat.category] || "🔹"}</span>
              <span>{cat.category}</span>
            </button>
          ))}
      </div>

      {/* Services horizontal scroll */}
      <Section title="Services near you">
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
          {servicesState === "loading" && <span className="text-subtext text-sm">Loading…</span>}
          {servicesState === "empty" && <span className="text-subtext text-sm">No services yet</span>}
          {servicesState === "error" && <span className="text-subtext text-sm">Couldn't load services</span>}
          {servicesState === "ok" &&
            servicesScroll.map((service, i) => (
              <div
                key={service.id || i}
                onClick={() => navigate(`/vendor/${service.vendorId}`)}
                className="min-w-[150px] rounded-2xl p-3 bg-surface border border-border cursor-pointer hover:border-primary transition-colors"
              >
                <div className="text-2xl mb-2">{categoryIcons[service.category] || "🔧"}</div>
                <h4 className="font-display font-medium text-sm text-text truncate">{service.jobTitle || service.title}</h4>
                <div className="text-xs text-subtext truncate">by {service.vendorName}</div>
                {service.price && (
                  <div className="text-primary font-semibold text-xs mt-1.5">
                    From ₦{Number(service.price).toLocaleString()}
                  </div>
                )}
              </div>
            ))}
        </div>
      </Section>

      {/* Products horizontal scroll */}
      <Section title="Products near you">
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
          {productsState === "loading" && <span className="text-subtext text-sm">Loading…</span>}
          {productsState === "empty" && <span className="text-subtext text-sm">No products yet</span>}
          {productsState === "error" && <span className="text-subtext text-sm">Couldn't load products</span>}
          {productsState === "ok" &&
            productsScroll.map((product, i) => (
              <div
                key={product.id || i}
                onClick={() => navigate(`/vendor/${product.vendorId}`)}
                className="min-w-[160px] rounded-2xl overflow-hidden bg-surface border border-border cursor-pointer hover:border-primary transition-colors"
              >
                <img
                  src={product.imageUrl || "https://via.placeholder.com/160x120/141414/FF6B35?text=No+Image"}
                  alt={product.name}
                  className="w-full h-24 object-cover"
                />
                <div className="p-3">
                  <h4 className="font-display font-medium text-sm text-text truncate">{product.name}</h4>
                  <div className="text-xs text-subtext truncate">by {product.vendorName}</div>
                  <div className="text-gold font-semibold text-sm mt-1">₦{Number(product.price).toLocaleString()}</div>
                </div>
              </div>
            ))}
        </div>
      </Section>

      {/* Featured grid */}
      <Section title="Featured products">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pb-16">
          {featuredState === "loading" && <span className="text-subtext text-sm">Loading…</span>}
          {featuredState === "empty" && <span className="text-subtext text-sm">No products yet</span>}
          {featuredState === "error" && <span className="text-subtext text-sm">Couldn't load products</span>}
          {featuredState === "ok" &&
            featured.map((product, i) => (
              <div
                key={product.id || i}
                onClick={() => navigate(`/vendor/${product.vendorId}`)}
                className="rounded-2xl overflow-hidden bg-surface border border-border cursor-pointer hover:border-primary hover:-translate-y-1 transition-all"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <img
                  src={product.imageUrl || "https://via.placeholder.com/400x160/141414/FF6B35?text=No+Image"}
                  alt={product.name}
                  className="w-full h-32 object-cover"
                />
                <div className="p-3">
                  <h3 className="font-display font-semibold text-text truncate">{product.name}</h3>
                  <div className="text-xs text-subtext truncate mb-2">by {product.vendorName}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary-hover font-medium">
                      ₦{Number(product.price).toLocaleString()}
                    </span>
                    <span className="text-xs text-subtext">{product.category || ""}</span>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </Section>

      {/* Bottom nav (mobile) */}
      <nav className="fixed bottom-0 left-0 right-0 flex justify-around py-3 bg-surface border-t border-border md:hidden">
        {[
          { label: "Home", path: "/" },
          { label: "Products", path: "/browse?type=products" },
          { label: "Services", path: "/browse?type=services" },
          { label: "Vendor", path: "/vendor/login" },
        ].map((item, i) => (
          <button
            key={item.label}
            onClick={() => navigate(item.path)}
            className="flex flex-col items-center gap-1"
          >
            <div className={`w-5 h-5 rounded-full ${i === 0 ? "bg-primary" : "bg-border"}`} />
            <span className={`text-[10px] ${i === 0 ? "text-primary" : "text-subtext"}`}>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="px-5 py-4">
      <h2 className="font-display font-semibold text-lg text-text mb-3">{title}</h2>
      {children}
    </section>
  );
}
