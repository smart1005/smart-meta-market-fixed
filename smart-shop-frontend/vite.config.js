import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds to ../smart-shop/public-dist so Express can serve it directly
// (see index.js) — one deployment, no separate frontend host.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../smart-shop/public-dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
