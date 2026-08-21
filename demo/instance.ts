/**
 * An Anico instance, running in the tab.
 *
 * Everything a server does except be a server: the same Hono app, the same
 * rules, the same migrations, over SQLite compiled to WASM. Nothing in
 * `server/game.ts` knows the difference, which is the whole design -- a new
 * route or a changed price reaches the demo with no work here.
 *
 * Three things are different, and all three are deliberate:
 *
 *   No accounts.   One guest player, minted on load, resolved for every
 *                  request through `Config.resolvePlayer`.
 *   No stream.     A tab cannot race itself, and every mutating route already
 *                  returns the authoritative snapshot in its own response
 *                  body, so the live stream is redundant here.
 *   No disk.       The database is bytes in memory. A refresh is a new
 *                  visitor, which is what a public demo should be.
 */

import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { EMPTY_BADGES } from '../src/game/badges'
import { EMPTY_UPGRADES } from '../src/game/upgrades'
import { migrate, type DB } from '../server/db'
import { createApp } from '../server/routes'
import { DEFAULT_SETTINGS } from '../server/rules'
import type { Player } from '../server/auth'
import { wrapSqlJs } from './sqlite'

/** Where the prebaked catalog lives, relative to the deployed base path. */
const CATALOG = `${import.meta.env.BASE_URL}catalog.db`

/**
 * What the guest starts with.
 *
 * An instance starts at zero and the first pack is 1,350 credits away, which
 * is about thirty free summons: three or four minutes of pressing a button and
 * selling what it hands you. That is the right opening for a game somebody
 * chose to install and the wrong one for a page somebody clicked on -- a demo
 * gets a minute of attention, and it should spend it on the pack tearing open
 * rather than on the grind that pays for one.
 *
 * Enough for every badge worth seeing, Auto Summon, and a few levels of the
 * lines that compound. Not enough to reach the end of anything.
 */
const GUEST_CREDITS = 500_000

const GUEST: Player = {
  id: 1,
  username: 'guest',
  // Never an admin: it is what hides the instance panel, the sandbox and the
  // catalog crawl without a line of demo-only UI code.
  is_admin: 0,
  sandbox: 0,
  sandbox_of: null,
  sandbox_active: 0,
}

async function openDemoDb(): Promise<DB> {
  const [SQL, catalog] = await Promise.all([
    initSqlJs({ locateFile: () => wasmUrl }),
    fetch(CATALOG).then((r) => {
      if (!r.ok) throw new Error(`the catalog did not load (${r.status})`)
      return r.arrayBuffer()
    }),
  ])

  const raw = new SQL.Database(new Uint8Array(catalog))
  const db = wrapSqlJs(raw) as unknown as DB
  db.pragma('foreign_keys = ON')
  // The asset is baked by the real `openDb`, so this is normally a no-op. It
  // runs anyway: a stale catalog checked into the build should catch up rather
  // than fail at the first query against a column it has never heard of.
  migrate(db, () => {})
  return db
}

/** Give the guest an account, unless a previous call already did. */
function seatGuest(db: DB): void {
  const seated = db.prepare('SELECT 1 FROM players WHERE id = ?').get(GUEST.id)
  if (seated) return
  db.transaction(() => {
    db.prepare(
      `INSERT INTO players (id, username, username_lower, password_hash, is_admin, sandbox, created_at)
       VALUES (?, ?, ?, '', 0, 0, ?)`,
    ).run(GUEST.id, GUEST.username, GUEST.username, Date.now())
    db.prepare(
      `INSERT INTO player_state (player_id, credits, badges_json, upgrades_json, settings_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      GUEST.id,
      GUEST_CREDITS,
      JSON.stringify(EMPTY_BADGES),
      JSON.stringify(EMPTY_UPGRADES),
      JSON.stringify(DEFAULT_SETTINGS),
    )
  })()
}

export interface DemoInstance {
  fetch: (path: string, init?: RequestInit) => Promise<Response>
}

export async function startInstance(): Promise<DemoInstance> {
  const db = await openDemoDb()
  seatGuest(db)

  const app = createApp(db, {
    // No cookies are set or read, so the flag has nothing to do; false keeps it
    // honest about the fact that this is not a session.
    cookieSecure: false,
    resolvePlayer: () => GUEST,
  })

  return {
    fetch: (path, init) =>
      app.fetch(new Request(new URL(`/api${path}`, location.origin), init as RequestInit)),
  }
}
