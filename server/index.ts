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
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { openDb, purgeSandboxProfiles } from './db.js'
import { purgeExpiredSessions } from './auth.js'
import { createApp } from './routes.js'
import { openBackups, startBackupTimer } from './backups.js'
import { startCrawl, catalogSize } from './catalog.js'

const PORT = Number(process.env.PORT ?? 8080)
const DATA_DIR = process.env.DATA_DIR ?? './data'
const CLIENT_DIR = process.env.CLIENT_DIR ?? './dist/client'
/** Behind a TLS proxy by default; set false for a plain-HTTP LAN instance. */
const COOKIE_SECURE = (process.env.COOKIE_SECURE ?? 'true') !== 'false'
const CRAWL_ON_BOOT = (process.env.CRAWL_ON_BOOT ?? 'true') !== 'false'

const db = openDb(join(DATA_DIR, 'anico.db'))
purgeExpiredSessions(db)
// Sandbox data is temporary by definition, so a restart starts it over.
const dropped = purgeSandboxProfiles(db)
if (dropped > 0) console.log(`[anico] cleared ${dropped} sandbox profile(s)`)
setInterval(() => purgeExpiredSessions(db), 6 * 3_600_000).unref()

// Static client. Hashed assets are immutable; index.html must never be cached
// or an update leaves people on a stale bundle talking to a newer API.
const clientRoot = resolve(CLIENT_DIR)
const indexHtml = existsSync(join(clientRoot, 'index.html'))
  ? readFileSync(join(clientRoot, 'index.html'), 'utf8')
  : null

/*
 * What this instance is serving.
 *
 * The shell, hashed. Every asset it points at is content-addressed by Vite, so
 * a build that changed anything at all changes this string and a build that
 * changed nothing does not -- which is exactly the question a connected tab is
 * asking when it wants to know whether to reload itself.
 */
const BUILD_ID = indexHtml
  ? createHash('sha256').update(indexHtml).digest('hex').slice(0, 12)
  : 'dev'

/*
 * Backups live beside the database, inside DATA_DIR.
 *
 * Which means the bind mount the compose file already sets up: they land in a
 * directory on the host, next to `anico.db`, where they can be rsynced off the
 * box without asking this process for anything.
 */
const backups = openBackups(db, DATA_DIR)
startBackupTimer(backups)

const app = createApp(db, { cookieSecure: COOKIE_SECURE, buildId: BUILD_ID, backups })

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
  console.log(`[anico] build ${BUILD_ID}`)
  const { intervalHours, keep } = backups.config()
  console.log(
    intervalHours > 0
      ? `[anico] backups every ${intervalHours}h, keeping ${keep}, ${backups.list().length} on disk`
      : `[anico] automatic backups are off, ${backups.list().length} on disk`,
  )
  if (CRAWL_ON_BOOT) void startCrawl(db)
})

const shutdown = () => {
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
