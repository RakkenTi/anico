/**
 * better-sqlite3, as far as the server actually uses it.
 *
 * The whole demo rests on this file. `server/game.ts`, `server/rules.ts` and
 * `server/catalog.ts` never touch a filesystem or a socket -- they operate on a
 * database handle -- so if a handle can be made out of SQLite compiled to WASM,
 * the real rules run unmodified in a browser tab.
 *
 * The surface is seven members, counted across all of `server/`:
 *
 *   database    prepare, transaction, pragma, exec, close
 *   statement   get, all, run
 *
 * Everything else **throws**, by design and loudly. This is a build target, not
 * a fork: the day somebody reaches for `stmt.iterate()` in `game.ts`, the demo
 * must fail to build rather than fail in front of a visitor.
 *
 * Two differences between the libraries are worth knowing about, because both
 * are silent if you get them wrong:
 *
 *   Named parameters. better-sqlite3 takes `{ player: 1 }` for `@player`;
 *   sql.js wants the sigil in the key. Bound both ways here, so a call site
 *   written for one works on the other.
 *
 *   Statement lifetime. sql.js statements hold native memory and are reset
 *   rather than re-prepared, so every read is followed by a reset -- a
 *   statement left mid-scan holds a read lock on its table and the next write
 *   to it fails.
 */

import type { Database as SqlJsDatabase, Statement as SqlJsStatement } from 'sql.js'

/** What better-sqlite3's `.run()` hands back, and all of it that is read. */
export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface ShimStatement {
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): RunResult
}

export interface ShimDb {
  prepare(sql: string): ShimStatement
  transaction<T extends (...args: never[]) => unknown>(fn: T): T
  pragma(source: string): unknown
  exec(sql: string): void
  close(): void
}

const refuse = (what: string): never => {
  throw new Error(
    `demo sqlite shim: ${what} is not implemented. Either stop using it in server/, or implement it here.`,
  )
}

/**
 * Parameters, in the two shapes better-sqlite3 accepts.
 *
 * A lone plain object is a named-parameter bag; anything else is positional.
 * Buffers and arrays are values rather than bags, which is why the check is
 * this specific -- getting it wrong turns a one-element `IN (?)` into a
 * silently empty bind.
 */
function bindingsOf(params: unknown[]): unknown[] | Record<string, unknown> {
  if (params.length !== 1) return params
  const only = params[0]
  if (only === null || typeof only !== 'object') return params
  if (Array.isArray(only) || ArrayBuffer.isView(only)) return params

  const bag: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(only as Record<string, unknown>)) {
    // Both spellings: sql.js matches on the sigil, better-sqlite3 on the bare
    // name, and binding a key the statement does not declare is harmless.
    bag[key] = value
    bag[`@${key}`] = value
    bag[`:${key}`] = value
    bag[`$${key}`] = value
  }
  return bag
}

/**
 * sql.js hands back `null` for SQL NULL and numbers for both INTEGER and REAL,
 * which is what better-sqlite3 does too. Blobs would differ, and the server
 * stores none.
 */
function rowOf(stmt: SqlJsStatement): Record<string, unknown> {
  return stmt.getAsObject() as Record<string, unknown>
}

function statement(db: SqlJsDatabase, sql: string): ShimStatement {
  // Prepared once and kept, the way better-sqlite3's are: `game.ts` prepares
  // inside hot functions and leans on SQLite's own statement cache.
  const stmt = db.prepare(sql)

  const bind = (params: unknown[]) => {
    stmt.reset()
    if (params.length > 0) stmt.bind(bindingsOf(params) as never)
  }

  return {
    get(...params) {
      bind(params)
      const row = stmt.step() ? rowOf(stmt) : undefined
      stmt.reset()
      return row
    },
    all(...params) {
      bind(params)
      const rows: unknown[] = []
      while (stmt.step()) rows.push(rowOf(stmt))
      stmt.reset()
      return rows
    },
    run(...params) {
      bind(params)
      stmt.step()
      stmt.reset()
      const changes = db.getRowsModified()
      return {
        changes,
        // Lazily, because it costs a statement of its own and a pull writes
        // hundreds of rows that nobody asks the rowid of.
        get lastInsertRowid() {
          return Number(db.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0] ?? 0)
        },
      }
    },
    get iterate() {
      return () => refuse('Statement.iterate')
    },
    get pluck() {
      return () => refuse('Statement.pluck')
    },
    get raw() {
      return () => refuse('Statement.raw')
    },
    get columns() {
      return () => refuse('Statement.columns')
    },
  } as ShimStatement
}

/**
 * Wrap an open sql.js database as the handle `server/` expects.
 *
 * Nesting is done with savepoints rather than BEGIN, for the same reason
 * better-sqlite3 does it: a transaction inside a transaction has to be able to
 * roll back its own work without discarding the caller's.
 */
export function wrapSqlJs(raw: SqlJsDatabase): ShimDb {
  let depth = 0

  const db: ShimDb = {
    prepare: (sql) => statement(raw, sql),

    transaction<T extends (...args: never[]) => unknown>(fn: T): T {
      return ((...args: never[]) => {
        const name = `anico_sp_${depth++}`
        raw.run(`SAVEPOINT ${name}`)
        try {
          const out = fn(...args)
          raw.run(`RELEASE ${name}`)
          return out
        } catch (err) {
          raw.run(`ROLLBACK TO ${name}`)
          raw.run(`RELEASE ${name}`)
          throw err
        } finally {
          depth--
        }
      }) as T
    },

    pragma: (source) => raw.exec(`PRAGMA ${source}`),
    exec: (sql) => void raw.run(sql),
    close: () => raw.close(),
  }

  // Anything else better-sqlite3 offers is a hole in this shim, and a hole
  // should sound like one.
  for (const missing of [
    'backup',
    'function',
    'aggregate',
    'table',
    'loadExtension',
    'serialize',
    'defaultSafeIntegers',
    'unsafeMode',
    'pluck',
  ]) {
    Object.defineProperty(db, missing, {
      value: () => refuse(`Database.${missing}`),
      enumerable: false,
    })
  }

  return db
}
