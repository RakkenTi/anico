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
 *   a base path      The deploy is a custom domain, so the site is the root of
 *                   it. Everything the client asks for by URL reads
 *                   `import.meta.env.BASE_URL`, so a project-pages deployment
 *                   at /anico/ is one environment variable away.
 *   an entry point   `demo/main.tsx`, which stands the instance up before
 *                   React mounts.
 *
 * Set ANICO_DEMO_BASE to deploy under a subdirectory instead.
 */

import { cpSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

function copyPublic(asset: string): Plugin {
  return {
    name: `anico-demo-copy-${asset}`,
    apply: 'build',
    closeBundle() {
      const from = here(join('public', asset))
      if (!existsSync(from)) return
      cpSync(from, here(join('dist/demo', asset)), { recursive: true })
    },
  }
}

export default defineConfig({
  base: process.env.ANICO_DEMO_BASE ?? '/',
  root: here('./demo'),
  publicDir: here('./demo/public'),
  plugins: [react(), copyPublic('sfx'), copyPublic('anico.svg')],
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
