/**
 * Periodic backups of the thing that cannot be fetched again.
 *
 * An instance is one SQLite file, and most of it is the catalog: tens of
 * thousands of characters crawled from AniList, identical in every backup and
 * replaceable by waiting a few hours. What is irreplaceable is small -- who
 * plays here, what they hold, what they have bought -- and that is what these
 * files contain. Copying the catalog fifty times over would spend the whole
 * size budget on the one part nobody would miss.
 *
 * A backup is still a real, openable Anico database: the schema is copied
 * whole, and so are the catalog rows any claim or wish points at, with their
 * cover art and alias lists stripped. So a restore onto a bare machine shows
 * every card somebody owns, correctly, while the crawl refills the rest in the
 * background.
 *
 * Everything here is instance-only. The demo has no disk, no admin and nothing
 * worth keeping, so `routes.ts` reaches this through `Config` rather than
 * importing it, and the browser build never sees a line of it.
 */

import Database from 'better-sqlite3'
import { createReadStream, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { getMeta, setMeta, type DB } from './db.js'

export interface BackupConfig {
  /** Hours between automatic backups. Zero switches them off. */
  intervalHours: number
  /** How many to keep at most, oldest pruned first. */
  keep: number
  /** Total bytes the directory may hold before the oldest are pruned. */
  maxBytes: number
}

export interface BackupFile {
  name: string
  at: number
  bytes: number
  /** Taken by the timer, by the admin, or by a restore protecting itself. */
  reason: 'auto' | 'manual' | 'safety'
}

export interface Backups {
  config: () => BackupConfig
  setConfig: (patch: unknown) => BackupConfig
  list: () => BackupFile[]
  take: (reason?: BackupFile['reason']) => BackupFile
  remove: (name: string) => boolean
  /** Absolute path of one backup, or null if the name is not one of ours. */
  pathOf: (name: string) => string | null
  /** One backup as a stream to send, so the HTTP layer never touches a file. */
  open: (name: string) => { body: ReadableStream; bytes: number } | null
  restore: (name: string) => RestoreResult
  /** Total bytes on disk, which is what the size ceiling is measured against. */
  bytes: () => number
}

export interface RestoreResult {
  ok: boolean
  error?: string
  /** The backup taken of the current state before anything was replaced. */
  safety?: string
  players?: number
}

/**
 * Never prune below this, whatever the ceiling says.
 *
 * A size limit that can empty the directory is not a limit, it is a delayed
 * outage: one enormous instance and the last five copies of everybody's
 * collection are gone because a number in Settings was set too low.
 */
export const KEEP_MIN = 5
export const KEEP_MAX = 200

export const DEFAULT_CONFIG: BackupConfig = {
  intervalHours: 6,
  keep: 50,
  maxBytes: 1024 ** 3,
}

const KEY = 'backup_config'
const DIR = 'backups'
/** `anico-2026-08-21T18-40-00Z.db`, sortable, with why it was taken in it. */
const NAME_RE = /^anico-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)-(auto|manual|safety)\.db$/

/**
 * Tables a restore replaces.
 *
 * Player data and nothing else. `meta` and `schema_migrations` are instance
 * facts (how wide the pool is, how far the crawl got, this very config) and
 * rolling them back with somebody's collection would be a surprise. `sessions`
 * is deliberately absent from backups altogether, so a restore signs everybody
 * out rather than reinstating tokens from another week.
 */
const PLAYER_TABLES = ['players', 'player_state', 'claims', 'wishes', 'raids', 'invites', 'invite_uses']

/** Tables copied into a backup: everything real except the catalog and sessions. */
const SKIP = new Set(['characters', 'sessions'])

const stamp = (at: number) => new Date(at).toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z')

const quote = (path: string) => `'${path.replace(/'/g, "''")}'`

function readConfig(db: DB): BackupConfig {
  const raw = getMeta(db, KEY)
  if (!raw) return { ...DEFAULT_CONFIG }
  try {
    return sanitize(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

function sanitize(patch: any): BackupConfig {
  const num = (v: unknown, lo: number, hi: number, fallback: number) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
  }
  return {
    intervalHours: num(patch?.intervalHours, 0, 24 * 7, DEFAULT_CONFIG.intervalHours),
    keep: num(patch?.keep, KEEP_MIN, KEEP_MAX, DEFAULT_CONFIG.keep),
    // A floor, so a fat-fingered zero does not mean "keep nothing". It is
    // deliberately below the smallest option the panel offers: what actually
    // stops the directory emptying itself is KEEP_MIN, not this.
    maxBytes: num(patch?.maxBytes, 8 * 1024 ** 2, 512 * 1024 ** 3, DEFAULT_CONFIG.maxBytes),
  }
}

/**
 * The schema of the live database, statement by statement.
 *
 * Read rather than written down: migrations change these tables, and a backup
 * with a hand-maintained copy of the schema is a backup that stops matching
 * the instance the first time somebody adds a column.
 */
function schemaOf(db: DB): string[] {
  const rows = db
    .prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`)
    .all() as { sql: string }[]
  return rows.map((r) => r.sql)
}

function tablesOf(db: DB): string[] {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[]
  return rows.map((r) => r.name).filter((n) => !SKIP.has(n))
}

export function openBackups(db: DB, dataDir: string, log: (line: string) => void = console.log): Backups {
  const dir = join(dataDir, DIR)
  const dbFile = join(dataDir, 'anico.db')
  mkdirSync(dir, { recursive: true })

  const list = (): BackupFile[] =>
    readdirSync(dir)
      .map((name) => ({ name, match: NAME_RE.exec(name) }))
      .filter((f): f is { name: string; match: RegExpExecArray } => f.match !== null)
      .map((f) => {
        const [, when, reason] = f.match
        // The stamp is an ISO string with its colons swapped for dashes, so
        // the name sorts. Putting them back is more honest than trusting an
        // mtime, which a copy or an rsync will have rewritten.
        const [date, time] = when.split('T')
        return {
          name: f.name,
          at: Date.parse(`${date}T${time.replace(/-/g, ':')}`),
          bytes: statSync(join(dir, f.name)).size,
          reason: reason as BackupFile['reason'],
        }
      })
      // Newest first, which is the order both the panel and the pruner want.
      .sort((a, b) => b.name.localeCompare(a.name))

  const bytes = () => list().reduce((n, f) => n + f.bytes, 0)

  const pathOf = (name: string) => (NAME_RE.test(name) ? join(dir, name) : null)

  /** Stamps already on disk, so two backups in one second do not become one. */
  const taken = new Set(list().map((f) => f.name.slice('anico-'.length, -'.db'.length)))

  /**
   * Write one backup.
   *
   * Built as a new database rather than copied and trimmed: a full copy would
   * mean the catalog on disk twice, briefly, on a box chosen for being small.
   */
  const take = (reason: BackupFile['reason'] = 'manual'): BackupFile => {
    // Two backups of the same kind in the same second would be one file, and
    // the second would silently replace the first. Walk the clock forward
    // rather than adding a counter the name pattern would have to learn.
    let at = Date.now()
    while (taken.has(`${stamp(at)}-${reason}`)) at += 1000
    const name = `anico-${stamp(at)}-${reason}.db`
    taken.add(`${stamp(at)}-${reason}`)
    const finalPath = join(dir, name)
    const tmp = `${finalPath}.part`
    rmSync(tmp, { force: true })

    const out = new Database(tmp)
    try {
      // A throwaway being written once, then renamed into place. No journal to
      // keep and nothing to recover: if this fails, the .part is deleted.
      out.pragma('journal_mode = OFF')
      /*
       * better-sqlite3 enables foreign keys by default, and these rows arrive
       * table by table: a claim lands before its player, and a claim's
       * character may be one of the ones deliberately left behind. The rows
       * were consistent in the database they came from, and the pragma cannot
       * be changed inside a transaction, so it goes here.
       */
      out.pragma('foreign_keys = OFF')
      for (const sql of schemaOf(db)) out.exec(sql)
      out.exec(`ATTACH ${quote(dbFile)} AS src`)
      out.transaction(() => {
        for (const table of tablesOf(db)) {
          out.exec(`INSERT INTO main."${table}" SELECT * FROM src."${table}"`)
        }
        // The cards somebody owns, so a restore onto a bare machine shows a
        // collection rather than a list of numbers. `SELECT *` and then blank
        // the two fat columns, rather than naming the others: a migration that
        // adds a column should not quietly stop being backed up.
        out.exec(
          `INSERT INTO main.characters SELECT * FROM src.characters
            WHERE id IN (SELECT character_id FROM src.claims
                         UNION SELECT character_id FROM src.wishes)`,
        )
        out.exec(`UPDATE main.characters SET covers_json = '[]', aliases_json = '[]'`)
      })()
      out.exec('DETACH src')
    } catch (e) {
      out.close()
      rmSync(tmp, { force: true })
      throw e
    }
    out.close()
    renameSync(tmp, finalPath)

    const file: BackupFile = { name, at: Date.now(), bytes: statSync(finalPath).size, reason }
    prune()
    return file
  }

  /**
   * Bring the directory back inside its limits.
   *
   * Count first, then size, and never past the floor: an admin who sets the
   * ceiling below what one instance weighs still gets `KEEP_MIN` backups.
   */
  const prune = () => {
    const { keep, maxBytes } = readConfig(db)
    let files = list()
    const drop = (file: BackupFile, why: string) => {
      rmSync(join(dir, file.name), { force: true })
      files = files.filter((f) => f.name !== file.name)
      log(`[backup] pruned ${file.name} (${why})`)
    }
    while (files.length > Math.max(KEEP_MIN, keep)) drop(files[files.length - 1], 'over the count')
    let total = files.reduce((n, f) => n + f.bytes, 0)
    while (total > maxBytes && files.length > KEEP_MIN) {
      const oldest = files[files.length - 1]
      total -= oldest.bytes
      drop(oldest, 'over the size ceiling')
    }
  }

  const open = (name: string): { body: ReadableStream; bytes: number } | null => {
    const path = pathOf(name)
    if (!path) return null
    let bytes = 0
    try {
      bytes = statSync(path).size
    } catch {
      return null
    }
    return { body: Readable.toWeb(createReadStream(path)) as ReadableStream, bytes }
  }

  const remove = (name: string): boolean => {
    const path = pathOf(name)
    if (!path) return false
    try {
      statSync(path)
    } catch {
      return false
    }
    rmSync(path, { force: true })
    return true
  }

  /**
   * Put a backup's player data back.
   *
   * Replaces the player tables outright and leaves the instance's own facts
   * alone. Characters the backup carries are added only where the live catalog
   * has never heard of them, so a restore never trades a full character row
   * for the stripped copy in the file.
   */
  const restore = (name: string): RestoreResult => {
    const path = pathOf(name)
    if (!path) return { ok: false, error: 'No such backup.' }
    try {
      statSync(path)
    } catch {
      return { ok: false, error: 'No such backup.' }
    }

    const mine = new Set(
      (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name),
    )
    const theirs = (() => {
      const probe = new Database(path, { readonly: true })
      try {
        return new Set(
          (probe.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name),
        )
      } finally {
        probe.close()
      }
    })()
    // Same schema or nothing. A backup from an older image has tables with
    // different columns, and `INSERT ... SELECT *` across that mismatch either
    // fails loudly or, worse, lines the wrong columns up.
    if (mine.size !== theirs.size || [...mine].some((m) => !theirs.has(m))) {
      return {
        ok: false,
        error: 'That backup was taken on a different version of the schema, so it cannot be restored here.',
      }
    }

    const safety = take('safety')
    // Off for the swap: the tables are emptied and refilled in an order no
    // constraint can be satisfied halfway through, and the backup's own rows
    // were consistent when they were written.
    db.pragma('foreign_keys = OFF')
    try {
      db.exec(`ATTACH ${quote(path)} AS bak`)
      db.transaction(() => {
        for (const table of [...PLAYER_TABLES].reverse()) db.exec(`DELETE FROM main."${table}"`)
        for (const table of PLAYER_TABLES) {
          db.exec(`INSERT INTO main."${table}" SELECT * FROM bak."${table}"`)
        }
        db.exec('INSERT OR IGNORE INTO main.characters SELECT * FROM bak.characters')
        // Every token belonged to the state that was just replaced.
        db.exec('DELETE FROM main.sessions')
      })()
      db.exec('DETACH bak')
    } catch (e) {
      try {
        db.exec('DETACH bak')
      } catch {
        /* it was never attached */
      }
      db.pragma('foreign_keys = ON')
      return { ok: false, error: e instanceof Error ? e.message : 'The restore failed.', safety: safety.name }
    }
    db.pragma('foreign_keys = ON')
    const players = (db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n
    log(`[backup] restored ${name}: ${players} player(s), safety copy ${safety.name}`)
    return { ok: true, safety: safety.name, players }
  }

  return {
    config: () => readConfig(db),
    setConfig: (patch) => {
      const next = sanitize({ ...readConfig(db), ...(patch as object) })
      setMeta(db, KEY, JSON.stringify(next))
      prune()
      return next
    },
    list,
    take,
    remove,
    pathOf,
    open,
    restore,
    bytes,
  }
}

/**
 * Keep taking them.
 *
 * Checked every few minutes rather than scheduled once, so a changed interval
 * takes effect without a restart and an instance that was switched off for a
 * week takes one backup on the way back rather than a week's worth.
 */
export function startBackupTimer(backups: Backups, log: (line: string) => void = console.log): void {
  const TICK = 5 * 60_000
  const beat = () => {
    const { intervalHours } = backups.config()
    if (intervalHours <= 0) return
    const newest = backups.list()[0]
    if (newest && Date.now() - newest.at < intervalHours * 3_600_000) return
    try {
      const file = backups.take('auto')
      log(`[backup] wrote ${file.name} (${(file.bytes / 1048576).toFixed(1)} MB)`)
    } catch (e) {
      log(`[backup] failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  // A beat shortly after boot, not at it: the first seconds belong to the
  // crawl and to whoever was mid-summon when the image was replaced.
  setTimeout(beat, 60_000).unref()
  setInterval(beat, TICK).unref()
}
