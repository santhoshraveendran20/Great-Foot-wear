import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// API server the dev proxy forwards to (override with API_TARGET, e.g. for a second test backend)
const API_TARGET = process.env.API_TARGET || "http://localhost:8000"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": API_TARGET,
      "/media": API_TARGET,
    },
  },
})
