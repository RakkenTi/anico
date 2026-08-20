/**
 * SQLite connection and schema migrations.
 *
 * One file on a volume, inside the app container (ADR 0001). Migrations are
 * plain SQL applied in order and recorded in `schema_migrations`, so an
 * instance can be upgraded by pulling a new image and restarting.
 */

import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type DB = Database.Database

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: '001_init',
    sql: `
    CREATE TABLE players (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      username       TEXT NOT NULL,
      username_lower TEXT NOT NULL UNIQUE,
      password_hash  TEXT NOT NULL,
      is_admin       INTEGER NOT NULL DEFAULT 0,
      sandbox        INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL
    );

    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX idx_sessions_player ON sessions(player_id);

    CREATE TABLE invites (
      code       TEXT PRIMARY KEY,
      created_by INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      used_by    INTEGER REFERENCES players(id) ON DELETE SET NULL,
      used_at    INTEGER
    );

    -- The catalog: a cache in origin, the source rolls draw from in use.
    CREATE TABLE characters (
      id           INTEGER PRIMARY KEY,
      name         TEXT NOT NULL,
      native_name  TEXT,
      image        TEXT NOT NULL,
      gender       TEXT NOT NULL,
      favourites   INTEGER NOT NULL,
      series       TEXT NOT NULL,
      credit_value INTEGER NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      covers_json  TEXT NOT NULL DEFAULT '[]',
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX idx_characters_fav ON characters(favourites DESC);
    CREATE INDEX idx_characters_gender_fav ON characters(gender, favourites DESC);

    -- A claim references the catalog but snapshots what the player was shown
    -- at claim time: favourites only ever grow, and a collection should not
    -- silently inflate underneath its owner.
    CREATE TABLE claims (
      player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      character_id INTEGER NOT NULL REFERENCES characters(id),
      claimed_at   INTEGER NOT NULL,
      credit_value INTEGER NOT NULL,
      PRIMARY KEY (player_id, character_id)
    );
    CREATE INDEX idx_claims_player ON claims(player_id);

    CREATE TABLE wishes (
      player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      character_id INTEGER NOT NULL REFERENCES characters(id),
      created_at   INTEGER NOT NULL,
      PRIMARY KEY (player_id, character_id)
    );

    -- Per-player mutable game state. Badges, settings and series payouts are
    -- small opaque maps read and written whole, so they stay as JSON rather
    -- than becoming tables nothing ever queries by column.
    CREATE TABLE player_state (
      player_id         INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      credits           INTEGER NOT NULL DEFAULT 0,
      rolls_left        INTEGER NOT NULL,
      rolls_reset_at    INTEGER NOT NULL,
      next_claim_at     INTEGER NOT NULL DEFAULT 0,
      last_daily_at     INTEGER NOT NULL DEFAULT 0,
      daily_streak      INTEGER NOT NULL DEFAULT 0,
      last_ritual_at    INTEGER NOT NULL DEFAULT 0,
      total_rolls       INTEGER NOT NULL DEFAULT 0,
      total_claims      INTEGER NOT NULL DEFAULT 0,
      badges_json       TEXT NOT NULL,
      settings_json     TEXT NOT NULL,
      series_paid_json  TEXT NOT NULL DEFAULT '{}',
      roll_session_json TEXT,
      pending_gem_json  TEXT
    );

    CREATE TABLE meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    `,
  },
  {
    name: '002_hourly_pacing',
    sql: `
    -- The x10 spread became an allowance of its own, once a day, tracked apart
    -- from the hourly single-summon budget.
    ALTER TABLE player_state ADD COLUMN last_multi_at INTEGER NOT NULL DEFAULT 0;

    -- Pacing belongs to the instance, not the player. Drop the three keys that
    -- used to let anyone rewrite their own roll and claim rates from settings.
    UPDATE player_state SET settings_json = json_remove(
      settings_json, '$.rollsPerReset', '$.rollResetMinutes', '$.claimIntervalMinutes');

    -- Refill on the next state read, so every player lands on the new hourly
    -- budget at once instead of carrying an old, larger one for an hour.
    UPDATE player_state SET rolls_reset_at = 0;
    `,
  },
  {
    name: '003_modes',
    sql: `
    -- Fun mode is the new default: no cooldowns, and a face-down x10.
    UPDATE player_state
       SET settings_json = json_set(settings_json, '$.mode', 'fun')
     WHERE json_extract(settings_json, '$.mode') IS NULL;
    `,
  },
  {
    name: '004_sandbox_profiles',
    sql: `
    -- Sandbox stops being a mode the account is permanently in and becomes a
    -- permission to enter one. A shadow profile owns its own state, so testing
    -- can never touch the collection someone actually cares about. These rows
    -- are temporary by design and are purged on boot.
    ALTER TABLE players ADD COLUMN sandbox_of INTEGER REFERENCES players(id) ON DELETE CASCADE;
    ALTER TABLE players ADD COLUMN sandbox_active INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX idx_players_sandbox_of ON players(sandbox_of);
    `,
  },
  {
    name: '005_coins',
    sql: `
    -- Gems became coins. The column only ever holds an undelivered drop, so
    -- clearing it costs a player at most one pending pickup and saves carrying
    -- tier keys that no longer exist.
    ALTER TABLE player_state RENAME COLUMN pending_gem_json TO pending_coins_json;
    UPDATE player_state SET pending_coins_json = NULL;
    `,
  },
  {
    name: '006_no_pacing',
    sql: `
    -- Fun is the only mode there is now, so the key that chose between them is
    -- gone, and with it every timer the other mode existed to keep.
    UPDATE player_state SET settings_json = json_remove(settings_json, '$.mode');

    -- The default pool became the whole catalog. Anyone still sitting on the
    -- old default was never asked, so they move with it; a pool somebody
    -- deliberately narrowed is left exactly where they put it.
    UPDATE player_state SET settings_json = json_set(settings_json, '$.poolSize', 1000000)
     WHERE json_extract(settings_json, '$.poolSize') = 10000;

    -- Five columns that only ever held a cooldown. Nothing reads them any more.
    ALTER TABLE player_state DROP COLUMN rolls_left;
    ALTER TABLE player_state DROP COLUMN rolls_reset_at;
    ALTER TABLE player_state DROP COLUMN next_claim_at;
    ALTER TABLE player_state DROP COLUMN last_multi_at;
    ALTER TABLE player_state DROP COLUMN last_ritual_at;

    -- The crawl is a different walk now: several segments instead of one, and
    -- a step counter that no longer means what the old page number meant.
    -- Clearing progress restarts it from the top, which costs one crawl and
    -- nothing else, because every row it writes is an upsert.
    DELETE FROM meta WHERE key IN ('crawl_page', 'crawl_done');
    `,
  },
]

export function openDb(file: string): DB {
  mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`)
  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r: any) => r.name as string),
  )
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
        m.name,
        Date.now(),
      )
    })()
    console.log(`[db] applied migration ${m.name}`)
  }
  return db
}

/**
 * Drop every sandbox profile and its state. Sandbox data is explicitly
 * temporary, so a restart is a clean slate rather than a resurrection: the
 * cascade takes the profile's claims, wishes, sessions and state with it.
 */
export function purgeSandboxProfiles(db: DB): number {
  return db.transaction(() => {
    const n = db.prepare('DELETE FROM players WHERE sandbox_of IS NOT NULL').run().changes
    db.prepare('UPDATE players SET sandbox_active = 0 WHERE sandbox_active = 1').run()
    return n
  })()
}

export function getMeta(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setMeta(db: DB, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}
