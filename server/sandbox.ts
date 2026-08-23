/**
 * Putting a profile at a stage of the game.
 *
 * The sandbox used to be a hundred-card spread with a quarter of a million
 * credits, which was the whole game in the version that shipped it and is now
 * the first ten minutes of one. Testing the late game meant playing to it.
 *
 * A stage writes badges, upgrades, credits and a collection onto a profile and
 * then gets out of the way: nothing about a seeded profile is special
 * afterwards, and the summon it presses is the summon everyone else presses.
 * That is the point, and it is what the old `SANDBOX_MAX_DRAW` got wrong -- a
 * sandbox with rules of its own tests the sandbox.
 *
 * `scripts/stress.mjs` seeds the same way for the same reason, so both call
 * this rather than each keeping a ladder that drifts from the other.
 */

import { BADGE_MAX, EMPTY_BADGES, type Badges } from '../src/game/badges.js'
import type { StageSpec } from '../src/game/sandbox.js'
import { EMPTY_UPGRADES, type Upgrades } from '../src/game/upgrades.js'
import type { DB } from './db.js'

/**
 * Write a shop onto a profile: every badge, and the upgrades the stage names.
 *
 * `auto_spin` goes off with it. It is stored per account and adopted on
 * sign-in, so an Automaton left running would be pressing the button over the
 * top of whatever the stage was seeded to look at.
 */
export function seedStage(db: DB, playerId: number, spec: StageSpec): void {
  const bought = spec.packs > 0 || spec.haste > 0
  const badges: Badges = bought
    ? { bronze: BADGE_MAX, silver: BADGE_MAX, gold: BADGE_MAX, sapphire: BADGE_MAX, ruby: BADGE_MAX, emerald: BADGE_MAX }
    : { ...EMPTY_BADGES }
  const upgrades: Upgrades = {
    ...EMPTY_UPGRADES,
    packs: spec.packs,
    multipack: spec.multipack,
    haste: spec.haste,
    table: spec.table ?? 2,
    hands: spec.hands ?? 2,
    depth: spec.depth ?? 1,
    ...(bought
      ? { appraisal: 40, fortune: 10, aim: 3, focus: 2, autoaim: 1, automaton: 10, nightshift: 11, alchemy: 20, divination: 10 }
      : {}),
  }
  // Clamped to what a double holds exactly: credits is an integer column, and a
  // stage that seeds past 2^53 seeds a number the client cannot add to.
  const credits = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(spec.credits ?? 0)))
  db.prepare(
    `UPDATE player_state SET badges_json = ?, upgrades_json = ?, credits = ?, auto_spin = 0
      WHERE player_id = ?`,
  ).run(JSON.stringify(badges), JSON.stringify(upgrades), credits, playerId)
  /*
   * A fresh board.
   *
   * A contract is posted against the collection as it stood when it was
   * posted, so a board written before the stage was applied stays on the wall
   * one step out of reach of a collection that has since quadrupled, and
   * nothing on it is ever answerable.
   */
  db.prepare('DELETE FROM raids WHERE player_id = ?').run(playerId)
}

/**
 * Fill a collection up to `n` characters.
 *
 * Topped up rather than reset, so stocking twice deepens rather than starts
 * over. Claims are spread across the catalog rather than clustered, because
 * both the pool draw and the series count read them.
 *
 * Two thirds of them merged deep, and how deep is the caller's business: the
 * contract board asks for a breadth of a series at a depth of stars, so a
 * collection of singles answers nothing and no payable row would ever render.
 */
export function stockClaims(
  db: DB,
  playerId: number,
  n: number,
  copies = 4096,
): { before: number; after: number } {
  const count = () =>
    (db.prepare('SELECT COUNT(*) AS n FROM claims WHERE player_id = ?').get(playerId) as { n: number }).n
  const before = count()
  /*
   * Real characters, drawn from the catalog most-favourited first.
   *
   * They used to be invented -- ids 1000 upward with a made-up value -- which
   * worked only because the stress harness seeds a catalog at exactly those
   * ids. Against a real one it is a foreign key violation, and a collection of
   * characters the catalog has never heard of is no good for testing anyway:
   * the pool draw, the series count and every contract read these rows.
   */
  const rows = db
    .prepare('SELECT id, credit_value FROM characters ORDER BY favourites DESC, id LIMIT ?')
    .all(Math.max(0, Math.round(n))) as { id: number; credit_value: number }[]
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO claims (player_id, character_id, claimed_at, credit_value, copies, stars)
     VALUES (?,?,?,?,?,?)`,
  )
  const now = Date.now()
  const stars = Math.floor(Math.log2(Math.max(1, copies)))
  db.transaction(() => {
    rows.forEach((r, i) => {
      const deep = i % 3 !== 2
      stmt.run(playerId, r.id, now - i * 1000, r.credit_value, deep ? copies : 3, deep ? stars : 1)
    })
  })()
  const after = count()
  /* Claims written behind the game's back still have to count: the contract
     board opens on `total_claims`, and a profile holding sixty-five thousand
     characters the counter has never heard of is a state no real player can
     be in. */
  db.prepare('UPDATE player_state SET total_claims = MAX(total_claims, ?) WHERE player_id = ?')
    .run(after, playerId)
  db.prepare('UPDATE player_state SET collection_rev = collection_rev + 1 WHERE player_id = ?')
    .run(playerId)
  return { before, after }
}

/** Empty a collection without touching the shop. */
export function clearClaims(db: DB, playerId: number): void {
  db.transaction(() => {
    db.prepare('DELETE FROM claims WHERE player_id = ?').run(playerId)
    db.prepare('DELETE FROM wishes WHERE player_id = ?').run(playerId)
    db.prepare(
      `UPDATE player_state SET total_claims = 0, series_paid_json = '{}',
              collection_rev = collection_rev + 1 WHERE player_id = ?`,
    ).run(playerId)
  })()
}
