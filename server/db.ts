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
