/**
 * The public demo: the whole instance, compiled into a static site.
 *
 * A build target, not a fork. Every rule ships verbatim from `server/`, so a
 * new route or a changed price reaches the demo with no work here. What this
 * config does is arrange for three things the browser cannot otherwise give
 * the server:
 *
 *   node builtins   `server/auth.ts` imports them and the demo never calls
 *                   them, so they are aliased to a module of loud stubs.
 *   a base path      GitHub Pages serves from a subdirectory. Everything the
 *                   client asks for by URL reads `import.meta.env.BASE_URL`.
 *   an entry point   `demo/main.tsx`, which stands the instance up before
 *                   React mounts.
 *
 * Set ANICO_DEMO_BASE to deploy somewhere other than /anico/.
 */

import { cpSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * The sound samples.
 *
 * They live in the instance's own `public/` and are the one asset the client
 * asks for by URL at runtime, so the demo needs a copy beside its own. Copied
 * rather than pointed at, because `publicDir` here belongs to the catalog: a
 * demo build should never be able to ship the instance's service worker.
 */
function copySfx(): Plugin {
  return {
    name: 'anico-demo-sfx',
    apply: 'build',
    closeBundle() {
      const from = here('./public/sfx')
      if (!existsSync(from)) return
      cpSync(from, here('./dist/demo/sfx'), { recursive: true })
    },
  }
}

export default defineConfig({
  base: process.env.ANICO_DEMO_BASE ?? '/anico/',
  root: here('./demo'),
  publicDir: here('./demo/public'),
  plugins: [react(), copySfx()],
  define: {
    __APP_VERSION__: JSON.stringify(`${version}-demo`),
    __DEMO__: 'true',
    // `server/` reads a couple of these on the way past. Nothing in the demo
    // path depends on one, but an undefined `process` is a blank page.
    'process.env': '{}',
  },
  resolve: {
    alias: [
      { find: /^node:crypto$/, replacement: here('./demo/node-stub.ts') },
      { find: /^node:util$/, replacement: here('./demo/node-stub.ts') },
      { find: /^node:fs$/, replacement: here('./demo/node-stub.ts') },
      { find: /^node:path$/, replacement: here('./demo/node-stub.ts') },
      // `server/db.ts` names the driver beside `migrate`, so importing one
      // evaluates the other. The demo opens its database with sql.js instead.
      { find: /^better-sqlite3$/, replacement: here('./demo/no-sqlite.ts') },
    ],
  },
  build: {
    outDir: here('./dist/demo'),
    emptyOutDir: true,
    // The catalog is the payload here, not the code; a source map would be
    // most of the download for a page nobody debugs from the outside.
    sourcemap: false,
  },
})
