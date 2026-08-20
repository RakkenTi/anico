# SQLite in the app container, not a database service

Anico is self-hosted by individuals for a handful of players, and the whole promise is
that `docker compose up` produces a working instance. We store everything in a **SQLite
file on a named volume, inside the single app container**, rather than adding a Postgres
or MySQL service to the compose file. At this write rate — a few players making a handful
of mutations a minute — SQLite in WAL mode is not a compromise, and one service with one
volume is the difference between a compose file people run and one they debug.

## Consequences

- Backups are a file copy, and restores are a file copy back. No dump tooling.
- Writes serialise on a single writer. This is invisible at the intended scale and would
  not be at hundreds of concurrent players; that is the threshold at which this decision
  should be revisited, not sooner.
- The database is only reachable from inside the container, which removes a whole class
  of exposure the owner would otherwise have to think about.
- All access goes through the server process, so a later move to Postgres is a matter of
  swapping the driver and the migration files rather than rewriting callers. Keeping that
  true is worth a little discipline: no SQLite-only SQL where a portable form exists.
