import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/uploads": "http://localhost:3000",
      "/socket.io": {
        target: "ws://localhost:3000",
        ws: true
      }
    }
  },
  build: {
    outDir: "../back-end/dist/client",
    emptyOutDir: true,
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router-dom")) {
            return "react";
          }
          if (id.includes("node_modules/framer-motion")) return "motion";
          if (id.includes("node_modules/recharts")) return "charts";
          if (id.includes("node_modules/socket.io-client")) return "socket";
          if (id.includes("node_modules")) return "vendor";
        }
      }
    }
  }
});
