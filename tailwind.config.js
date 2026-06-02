/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#070b13",
        midnight: "#0b1220",
        panel: "#111a2a",
        cyan: "#21f1e7",
        amber: "#ffb84d"
      },
      fontFamily: {
        display: ["Syne", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      boxShadow: {
        glow: "0 0 70px rgba(33, 241, 231, 0.22)",
        amber: "0 0 70px rgba(255, 184, 77, 0.16)"
      }
    }
  },
  plugins: []
};
