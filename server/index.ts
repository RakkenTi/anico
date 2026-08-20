/**
 * Instance entry point.
 *
 * One process: the API, the static client, and the catalog crawler. Plain HTTP
 * by design; TLS belongs to the reverse proxy in front of it (Caddy, in the
 * setup this was built for).
 */

import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openDb } from './db.js'
import { purgeExpiredSessions } from './auth.js'
import { createApp } from './routes.js'
import { startCrawl, catalogSize } from './catalog.js'

const PORT = Number(process.env.PORT ?? 8080)
const DATA_DIR = process.env.DATA_DIR ?? './data'
const CLIENT_DIR = process.env.CLIENT_DIR ?? './dist/client'
/** Behind a TLS proxy by default; set false for a plain-HTTP LAN instance. */
const COOKIE_SECURE = (process.env.COOKIE_SECURE ?? 'true') !== 'false'
const CRAWL_ON_BOOT = (process.env.CRAWL_ON_BOOT ?? 'true') !== 'false'

const db = openDb(join(DATA_DIR, 'anico.db'))
purgeExpiredSessions(db)
setInterval(() => purgeExpiredSessions(db), 6 * 3_600_000).unref()

const app = createApp(db, { cookieSecure: COOKIE_SECURE })

// Static client. Hashed assets are immutable; index.html must never be cached
// or an update leaves people on a stale bundle talking to a newer API.
const clientRoot = resolve(CLIENT_DIR)
const indexHtml = existsSync(join(clientRoot, 'index.html'))
  ? readFileSync(join(clientRoot, 'index.html'), 'utf8')
  : null

// The shell is served by us, never by the static middleware, so it always
// carries no-cache: a stale index.html would pair an old bundle with a new API.
app.get('/', (c) =>
  indexHtml
    ? c.html(indexHtml, 200, { 'Cache-Control': 'no-cache' })
    : c.text('Client bundle missing. Run `npm run build`.', 500),
)

app.use(
  '/assets/*',
  serveStatic({
    root: CLIENT_DIR,
    onFound: (_p, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable'),
  }),
)
app.use('/*', serveStatic({ root: CLIENT_DIR }))

// SPA fallback: anything that is not an API call is the app.
app.get('*', (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found.' }, 404)
  if (!indexHtml) return c.text('Client bundle missing. Run `npm run build`.', 500)
  return c.html(indexHtml, 200, { 'Cache-Control': 'no-cache' })
})

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`[anico] listening on http://0.0.0.0:${info.port}`)
  console.log(`[anico] data in ${resolve(DATA_DIR)}, ${catalogSize(db)} characters in the catalog`)
  if (CRAWL_ON_BOOT) void startCrawl(db)
})

const shutdown = () => {
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
