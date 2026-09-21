// Ported directly from public/js/browse.js — the actual relevance-scoring
// search logic, unchanged. This is NOT a generic text filter: it scores
// exact matches highest, then substring matches, then queries where every
// word appears somewhere (in any order), then partial word matches — and
// uses distance only to break ties between equally-relevant results.

// ── Relevance Scoring ──
export const getRelevanceScore = (query, text) => {
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
export const getDistanceKm = (from, to) => {
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
export const compareResults = (a, b, customerLocation) => {
  if (b._relevance !== a._relevance) return b._relevance - a._relevance;
  const distA = getDistanceKm(customerLocation, a.vendorLocation);
  const distB = getDistanceKm(customerLocation, b.vendorLocation);
  if (distA !== null && distB !== null) return distA - distB;
  return 0;
};

// ── Score + filter + sort products by a search query ──
export const searchProducts = (products, query, customerLocation) => {
  return products
    .map((p) => ({ ...p, _relevance: getRelevanceScore(query, p.name) }))
    .filter((p) => p._relevance > 0)
    .sort((a, b) => compareResults(a, b, customerLocation));
};

// ── Score + filter + sort services by a search query (checks jobTitle,
// title, and every skill — takes whichever field matches best) ──
export const searchServices = (services, query, customerLocation, selectedCategory) => {
  let filtered = services;
  if (selectedCategory) {
    filtered = filtered.filter((s) => s.category === selectedCategory);
  }
  return filtered
    .map((s) => ({
      ...s,
      _relevance: Math.max(
        getRelevanceScore(query, s.jobTitle),
        getRelevanceScore(query, s.title),
        ...(s.skills || []).map((skill) => getRelevanceScore(query, skill)),
      ),
    }))
    .filter((s) => s._relevance > 0)
    .sort((a, b) => compareResults(a, b, customerLocation));
};
