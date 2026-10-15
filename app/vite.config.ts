import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import pkg from './package.json' with { type: 'json' }

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:8100', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8100', ws: true },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
