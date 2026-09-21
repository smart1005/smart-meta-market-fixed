/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0a",
        surface: "#141414",
        "surface-hover": "#1c1c1c",
        border: "#232323",
        primary: "#FF6B35",
        "primary-hover": "#FF8C5A",
        gold: "#FFD700",
        teal: "#00E6C3",
        text: "#F5F5F0",
        subtext: "#9a9a95",
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
      },
    },
  },
  plugins: [],
};
