/**
 * Bake the demo's catalog.
 *
 * The demo has no crawler: a public page must not point a stranger's browser
 * at AniList's rate limit, and a first sweep takes hours anyway. So the catalog
 * ships as a file, built here by running the real crawler against a throwaway
 * instance and then cutting it down to the characters a demo will ever draw.
 *
 *   node scripts/bake-catalog.mjs [--top 10000] [--out demo/public/catalog.db]
 *
 * The result is a complete Anico database with every migration applied and one
 * table filled: no players, no claims, no sessions. The demo mints its guest on
 * load and plays from there.
 *
 * Regenerate it when the catalog moves. Favourites only grow, so an old asset
 * is not wrong, only out of date about who is popular.
 */

import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const TOP = Number(arg('top', 10_000))
const OUT = resolve(arg('out', 'demo/public/catalog.db'))
const PORT = Number(arg('port', 8097))
/** How long to let the crawler run. It resumes, so a short bake is a small one. */
const MINUTES = Number(arg('minutes', 12))
const DELAY_MS = Number(arg('delay', 1200))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (line) => console.log(`[bake] ${line}`)

if (!existsSync('dist/server/server/index.js')) {
  say('building the server first')
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit' })
}

const dataDir = mkdtempSync(join(tmpdir(), 'anico-bake-'))
const dbPath = join(dataDir, 'anico.db')

say(`crawling for ${MINUTES} minutes at ${DELAY_MS}ms a request`)
const server = spawn(process.execPath, ['dist/server/server/index.js'], {
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    PORT: String(PORT),
    CRAWL_ON_BOOT: 'true',
    CRAWL_DELAY_MS: String(DELAY_MS),
  },
  stdio: 'ignore',
})

const stop = async () => {
  server.kill('SIGTERM')
  await new Promise((r) => server.once('exit', r))
  // SIGTERM checkpoints the write-ahead log, which is what makes the file
  // self-contained enough to ship.
  await wait(400)
}

const deadline = Date.now() + MINUTES * 60_000
let last = 0
while (Date.now() < deadline) {
  await wait(10_000)
  try {
    const db = new Database(dbPath, { readonly: true })
    const n = db.prepare('SELECT COUNT(*) AS n FROM characters').get().n
    db.close()
    if (n !== last) say(`${n.toLocaleString()} characters`)
    last = n
    if (n >= TOP * 1.3) break
  } catch {
    /* the file is not there yet, or a migration is mid-flight */
  }
}
await stop()

if (last === 0) {
  rmSync(dataDir, { recursive: true, force: true })
  throw new Error('the crawl produced nothing. Is AniList reachable?')
}

say(`trimming to the top ${TOP.toLocaleString()} by favourites`)
const db = new Database(dbPath)
db.pragma('journal_mode = DELETE')
db.transaction(() => {
  db.prepare(
    `DELETE FROM characters WHERE id NOT IN (
       SELECT id FROM characters ORDER BY favourites DESC LIMIT ?)`,
  ).run(TOP)
  // Nothing here is anybody's account. A baked catalog that carried one would
  // be a credential in a public asset.
  for (const t of ['claims', 'wishes', 'sessions', 'invites', 'raids', 'player_state', 'players']) {
    db.prepare(`DELETE FROM ${t}`).run()
  }
  /*
   * The pool, pinned in data rather than in code.
   *
   * `instancePool` reads this row and defaults to the whole catalog, which
   * would mean a demo drawing from a top-ten-thousand file as though it were
   * the long tail: every card a household name, and the rarity ladder squashed
   * flat. Pinning it here keeps the demo a build target rather than a branch.
   */
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('pool_size', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(TOP))
})()
db.exec('VACUUM')
db.exec('ANALYZE')
db.close()

mkdirSync(dirname(OUT), { recursive: true })
execFileSync('cp', [dbPath, OUT])
rmSync(dataDir, { recursive: true, force: true })

const check = new Database(OUT, { readonly: true })
const kept = check.prepare('SELECT COUNT(*) AS n FROM characters').get().n
const migrations = check.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n
check.close()

say(`${kept.toLocaleString()} characters, ${migrations} migrations, ${(statSync(OUT).size / 1e6).toFixed(1)} MB`)
say(OUT)
