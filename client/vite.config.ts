import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4821,
    proxy: {
      "/socket.io": {
        target: "http://127.0.0.1:4822",
        ws: true,
      },
      "/health": "http://127.0.0.1:4822",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4821,
  },
});
