/**
 * The shim, against its oracle.
 *
 * Every assertion here runs twice: once on real better-sqlite3 and once on the
 * WASM shim. The oracle is not "what I think better-sqlite3 does", it is
 * better-sqlite3, so a wrong belief about the library fails the suite on the
 * first run rather than shipping into the demo.
 *
 *   node --experimental-strip-types --test demo/sqlite.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import initSqlJs from 'sql.js'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { wrapSqlJs, type ShimDb } from './sqlite.ts'

const require = createRequire(import.meta.url)

const SQL = await initSqlJs({
  wasmBinary: readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')),
})

type Open = () => ShimDb

const IMPLS: [string, Open][] = [
  ['better-sqlite3', () => new Database(':memory:') as unknown as ShimDb],
  ['sql.js shim', () => wrapSqlJs(new SQL.Database())],
]

/** Every case is written once and run against both. */
function both(name: string, body: (db: ShimDb, impl: string) => void) {
  for (const [impl, open] of IMPLS) {
    test(`${name} [${impl}]`, () => {
      const db = open()
      try {
        body(db, impl)
      } finally {
        db.close()
      }
    })
  }
}

const seed = (db: ShimDb) =>
  db.exec(`
    CREATE TABLE person (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, score REAL, note TEXT);
    INSERT INTO person (name, score, note) VALUES ('ada', 1.5, NULL);
    INSERT INTO person (name, score, note) VALUES ('grace', 2.5, 'hopper');
  `)

/* ------------------------------------------------------------ statements */

both('exec runs several statements and returns nothing useful', (db) => {
  seed(db)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM person').get() as any).n, 2)
})

both('get returns a plain row object', (db) => {
  seed(db)
  const row = db.prepare('SELECT id, name, score, note FROM person WHERE name = ?').get('grace')
  assert.deepEqual(row, { id: 2, name: 'grace', score: 2.5, note: 'hopper' })
})

both('get returns undefined when nothing matches', (db) => {
  seed(db)
  assert.equal(db.prepare('SELECT * FROM person WHERE name = ?').get('nobody'), undefined)
})

both('all returns every row, in query order', (db) => {
  seed(db)
  const rows = db.prepare('SELECT name FROM person ORDER BY name DESC').all() as any[]
  assert.deepEqual(rows, [{ name: 'grace' }, { name: 'ada' }])
})

both('all returns an empty array rather than undefined', (db) => {
  seed(db)
  assert.deepEqual(db.prepare('SELECT * FROM person WHERE id > 99').all(), [])
})

both('run reports changes and the last rowid', (db) => {
  seed(db)
  const r = db.prepare('INSERT INTO person (name, score) VALUES (?, ?)').run('linus', 3)
  assert.equal(r.changes, 1)
  assert.equal(Number(r.lastInsertRowid), 3)
})

both('run reports the number of rows an UPDATE touched', (db) => {
  seed(db)
  assert.equal(db.prepare('UPDATE person SET score = score + 1').run().changes, 2)
  assert.equal(db.prepare('UPDATE person SET score = 0 WHERE id = 1').run().changes, 1)
  assert.equal(db.prepare('UPDATE person SET score = 0 WHERE id = 99').run().changes, 0)
})

both('an ignored insert changes nothing', (db) => {
  seed(db)
  db.exec('CREATE TABLE tag (k TEXT PRIMARY KEY)')
  assert.equal(db.prepare('INSERT OR IGNORE INTO tag (k) VALUES (?)').run('a').changes, 1)
  assert.equal(db.prepare('INSERT OR IGNORE INTO tag (k) VALUES (?)').run('a').changes, 0)
})

both('a prepared statement is reusable with different parameters', (db) => {
  seed(db)
  const stmt = db.prepare('SELECT name FROM person WHERE id = ?')
  assert.deepEqual(stmt.get(1), { name: 'ada' })
  assert.deepEqual(stmt.get(2), { name: 'grace' })
  assert.equal(stmt.get(3), undefined)
  assert.deepEqual(stmt.get(1), { name: 'ada' })
})

both('named parameters bind from a bare-keyed object', (db) => {
  seed(db)
  const row = db
    .prepare('SELECT name FROM person WHERE score >= @min AND name <> @name')
    .get({ min: 1, name: 'ada' })
  assert.deepEqual(row, { name: 'grace' })
})

both('NULL comes back as null, not undefined', (db) => {
  seed(db)
  assert.deepEqual(db.prepare('SELECT note FROM person WHERE id = 1').get(), { note: null })
})

both('a REAL survives the end of the double', (db) => {
  db.exec('CREATE TABLE big (v REAL)')
  db.prepare('INSERT INTO big (v) VALUES (?)').run(1e300)
  assert.equal((db.prepare('SELECT v FROM big').get() as any).v, 1e300)
})

/* ---------------------------------------------------------- transactions */

both('a transaction commits and hands back what the body returned', (db) => {
  seed(db)
  const out = db.transaction(() => {
    db.prepare('INSERT INTO person (name) VALUES (?)').run('linus')
    return 'done'
  })()
  assert.equal(out, 'done')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM person').get() as any).n, 3)
})

both('a transaction rolls back on a throw, and rethrows', (db) => {
  seed(db)
  assert.throws(
    () =>
      db.transaction(() => {
        db.prepare('INSERT INTO person (name) VALUES (?)').run('linus')
        throw new Error('nope')
      })(),
    /nope/,
  )
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM person').get() as any).n, 2)
})

both('a transaction takes the arguments it is called with', (db) => {
  seed(db)
  const add = db.transaction((name: string) => {
    db.prepare('INSERT INTO person (name) VALUES (?)').run(name)
    return name.toUpperCase()
  })
  assert.equal(add('linus'), 'LINUS')
  assert.deepEqual(db.prepare('SELECT name FROM person WHERE id = 3').get(), { name: 'linus' })
})

both('transactions nest, and the inner one can roll back alone', (db) => {
  seed(db)
  db.transaction(() => {
    db.prepare('INSERT INTO person (name) VALUES (?)').run('outer')
    try {
      db.transaction(() => {
        db.prepare('INSERT INTO person (name) VALUES (?)').run('inner')
        throw new Error('inner fails')
      })()
    } catch {
      /* swallowed on purpose: the outer work must survive */
    }
  })()
  const names = (db.prepare('SELECT name FROM person ORDER BY id').all() as any[]).map((r) => r.name)
  assert.deepEqual(names, ['ada', 'grace', 'outer'])
})

/* --------------------------------------------------------------- pragmas */

both('foreign keys can be switched on, and then bite', (db) => {
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE parent (id INTEGER PRIMARY KEY);
    CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE);
    INSERT INTO parent (id) VALUES (1);
    INSERT INTO child (id, parent_id) VALUES (1, 1);
  `)
  assert.throws(() => db.prepare('INSERT INTO child (id, parent_id) VALUES (?, ?)').run(2, 99))
  db.prepare('DELETE FROM parent WHERE id = ?').run(1)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM child').get() as any).n, 0)
})

both('the pragmas openDb sets are all accepted', (db) => {
  for (const p of ['journal_mode = WAL', 'foreign_keys = ON', 'busy_timeout = 5000', 'optimize']) {
    db.pragma(p)
  }
})

/* ------------------------------------- the SQL the migrations actually use */

both('JSON functions are compiled in', (db) => {
  db.exec(`CREATE TABLE s (j TEXT NOT NULL DEFAULT '{}')`)
  db.prepare('INSERT INTO s (j) VALUES (?)').run('{"a":1,"b":2}')
  db.prepare(
    `UPDATE s SET j = json_set(CASE WHEN json_valid(j) THEN j ELSE '{}' END, '$.c', 3)`,
  ).run()
  db.prepare(`UPDATE s SET j = json_remove(j, '$.a', '$.b')`).run()
  assert.equal((db.prepare('SELECT j FROM s').get() as any).j, '{"c":3}')
  assert.equal((db.prepare(`SELECT json_extract(j, '$.c') AS c FROM s`).get() as any).c, 3)
  assert.equal((db.prepare(`SELECT json_array('x') AS a`).get() as any).a, '["x"]')
})

both('a column can be dropped, which migration 017 needs', (db) => {
  db.exec('CREATE TABLE t (a INTEGER, b INTEGER)')
  db.prepare('INSERT INTO t (a, b) VALUES (?, ?)').run(1, 2)
  db.exec('ALTER TABLE t DROP COLUMN b')
  assert.deepEqual(db.prepare('SELECT * FROM t').get(), { a: 1 })
})

both('ANALYZE runs, which migration 014 ends with', (db) => {
  seed(db)
  db.exec('CREATE INDEX idx_person_name ON person(name); ANALYZE;')
})

both('window-free aggregates and CASE sums behave', (db) => {
  seed(db)
  const row = db
    .prepare('SELECT SUM(CASE WHEN score >= 2 THEN 1 ELSE 0 END) AS deep FROM person')
    .get()
  assert.deepEqual(row, { deep: 1 })
})

/* ---------------------------------------------------------- loud failure */

test('the shim refuses anything it has not implemented', () => {
  const db = wrapSqlJs(new SQL.Database()) as any
  assert.throws(() => db.pluck(), /not implemented/i)
  assert.throws(() => db.backup(), /not implemented/i)
  db.exec('CREATE TABLE t (a)')
  assert.throws(() => db.prepare('SELECT * FROM t').iterate(), /not implemented/i)
  assert.throws(() => db.prepare('SELECT * FROM t').pluck(), /not implemented/i)
  db.close()
})

test('the shim can be handed a database that already exists', () => {
  const disk = new Database(':memory:')
  disk.exec("CREATE TABLE t (a TEXT); INSERT INTO t (a) VALUES ('kept')")
  const bytes = disk.serialize()
  disk.close()

  const db = wrapSqlJs(new SQL.Database(new Uint8Array(bytes)))
  assert.deepEqual(db.prepare('SELECT a FROM t').get(), { a: 'kept' })
  db.close()
})
