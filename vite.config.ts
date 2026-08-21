import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// One source of truth for the version: package.json, which is also what the
// release tag and the published image tag are cut from.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// The client is built into dist/client and served by the Node server in
// server/; /api is proxied to it during development.
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: {
    proxy: {
      '/api': {
        // ANICO_API lets a dev client point at an instance on another port.
        target: process.env.ANICO_API ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
