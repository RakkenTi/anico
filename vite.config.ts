import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The client is built into dist/client and served by the Node server in
// server/; /api is proxied to it during development.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: {
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: true } },
  },
})
