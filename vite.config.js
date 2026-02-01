import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/wx-geo": {
        target: "https://geocoding-api.open-meteo.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/wx-geo/, ""),
      },
    },
  },
});
