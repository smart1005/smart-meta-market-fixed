import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home.jsx";

// Placeholder for now — the real Browse page (with the ported relevance
// search, category filter, and location-based sorting from browse.js) is
// the next page we build.
function ComingSoon({ label }) {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <p className="text-subtext font-body">{label} — coming next</p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/browse" element={<ComingSoon label="Browse" />} />
      <Route path="/vendor/login" element={<ComingSoon label="Vendor login" />} />
      <Route path="/vendor/:id" element={<ComingSoon label="Vendor profile" />} />
      <Route path="/dashboard" element={<ComingSoon label="Vendor dashboard" />} />
    </Routes>
  );
}
