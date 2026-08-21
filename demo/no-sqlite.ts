/**
 * better-sqlite3, for a bundle that has no disk to put a database on.
 *
 * `server/db.ts` exports both `openDb` (a file, a native module, a WAL) and
 * `migrate` (plain SQL against a handle). The demo wants only the second, but
 * importing it evaluates the module, and the module imports the driver. So the
 * driver is aliased to this: a constructor that exists and refuses.
 *
 * Nothing calls it. `demo/instance.ts` opens its database through sql.js and
 * hands `migrate` the result.
 */

export default class Database {
  constructor() {
    throw new Error(
      'demo build: better-sqlite3 is not available. The demo opens its database with sql.js; see demo/instance.ts.',
    )
  }
}
