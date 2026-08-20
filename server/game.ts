/**
 * The rules, server side.
 *
 * Everything that used to run in the browser store and could therefore be
 * lied about: the daily timer, the economy, what a pack holds and the RNG.
 * The client renders what these functions return and nothing more.
 *
 * A claim snapshots the credit value the player was shown. Favourites only
 * grow, so reading value live from the catalog would quietly inflate old
 * collections and change rarity frames underneath their owner.
 */

import type { DB } from './db.js'
import {
  BASE_COIN_CHANCE,
  DAILY_INTERVAL_H,
  DAILY_STREAK_WINDOW_H,
  SERIES_MILESTONES,
  coinAmount,
  dailyAmount,
  duplicateCompensation,
  packCost,
  rarityOf,
  rollCoinDrop,
} from '../src/game/economy.js'
import {
  BADGE_DEFS,
  EMPTY_BADGES,
  badgeCost,
  badgeUnlocked,
  computeEffects,
  type BadgeKey,
  type Badges,
} from '../src/game/badges.js'
import {
  EMPTY_UPGRADES,
  UPGRADE_DEFS,
  upgradeCost,
  upgradeMaxed,
  type UpgradeKey,
  type Upgrades,
} from '../src/game/upgrades.js'
import { drawAboveValue, drawFromPool, getCharacter, type PoolPick } from './catalog.js'
import { sanitizeSettings, type ServerSettings } from './rules.js'
import type { Player } from './auth.js'

const HOUR = 3_600_000
const WISH_BASE_CHANCE = 0.025
const WISH_CHANCE_CAP = 0.6
/** How long a rolled spread stays claimable. */
const ROLL_SESSION_MS = 30 * 60_000
/** Sandbox bulk summons, which answer to nothing else. */
const SANDBOX_MAX_DRAW = 100

export class GameError extends Error {}
const fail = (msg: string): never => {
  throw new GameError(msg)
}

interface StateRow {
  player_id: number
  credits: number
  last_daily_at: number
  daily_streak: number
  total_rolls: number
  total_claims: number
  badges_json: string
  upgrades_json: string
  settings_json: string
  series_paid_json: string
  roll_session_json: string | null
  pending_coins_json: string | null
}

interface RollSessionEntry {
  char: PoolPick
  owned: boolean
  wished: boolean
  compensation: number
}
interface RollSession {
  at: number
  results: RollSessionEntry[]
}

function loadState(db: DB, playerId: number): StateRow {
  const row = db.prepare('SELECT * FROM player_state WHERE player_id = ?').get(playerId) as
    | StateRow
    | undefined
  if (!row) fail('No game state for this account.')
  return row!
}

/** Badges and upgrades are two columns and one set of effects. */
function loadoutOf(row: StateRow): { badges: Badges; upgrades: Upgrades; fx: ReturnType<typeof computeEffects> } {
  const badges: Badges = { ...EMPTY_BADGES, ...JSON.parse(row.badges_json) }
  const upgrades: Upgrades = { ...EMPTY_UPGRADES, ...JSON.parse(row.upgrades_json || '{}') }
  return { badges, upgrades, fx: computeEffects(badges, upgrades) }
}

export interface OwnedCharacter extends PoolPick {
  claimedAt: number
}

function collectionOf(db: DB, playerId: number): OwnedCharacter[] {
  const rows = db
    .prepare(
      `SELECT c.*, cl.claimed_at, cl.credit_value AS claimed_value
         FROM claims cl JOIN characters c ON c.id = cl.character_id
        WHERE cl.player_id = ? ORDER BY cl.claimed_at DESC`,
    )
    .all(playerId) as any[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nativeName: r.native_name,
    image: r.image,
    gender: r.gender,
    favourites: r.favourites,
    series: r.series,
    // the value at claim time, not today's
    creditValue: r.claimed_value,
    aliases: JSON.parse(r.aliases_json),
    covers: JSON.parse(r.covers_json),
    claimedAt: r.claimed_at,
  }))
}

function wishesOf(db: DB, playerId: number): PoolPick[] {
  const rows = db
    .prepare(
      `SELECT c.* FROM wishes w JOIN characters c ON c.id = w.character_id
        WHERE w.player_id = ? ORDER BY w.created_at`,
    )
    .all(playerId) as any[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nativeName: r.native_name,
    image: r.image,
    gender: r.gender,
    favourites: r.favourites,
    series: r.series,
    creditValue: r.credit_value,
    aliases: JSON.parse(r.aliases_json),
    covers: JSON.parse(r.covers_json),
  }))
}

export interface Snapshot {
  username: string
  isAdmin: boolean
  /** Currently playing the throwaway sandbox profile. */
  sandbox: boolean
  /** Allowed to switch the sandbox on at all. */
  sandboxAllowed: boolean
  credits: number
  /** Cards a pack deals, or 0 while the shop has not unlocked them yet. */
  packSize: number
  /** What that pack costs to open. */
  packPrice: number
  lastDailyAt: number
  dailyStreak: number
  totalRolls: number
  totalClaims: number
  badges: Badges
  upgrades: Upgrades
  settings: ServerSettings
  pendingCoins: { amount: number } | null
  wishes: PoolPick[]
  collection?: OwnedCharacter[]
  serverNow: number
}

export function snapshot(db: DB, player: Player, withCollection = false): Snapshot {
  const row = loadState(db, player.id)
  const settings: ServerSettings = JSON.parse(row.settings_json)
  const { badges, upgrades, fx } = loadoutOf(row)
  const size = packSizeFor(fx, !!player.sandbox_of)
  return {
    username: player.username,
    isAdmin: !!player.is_admin,
    sandbox: !!player.sandbox_of,
    sandboxAllowed: !!player.sandbox,
    credits: row.credits,
    packSize: size,
    packPrice: player.sandbox_of ? 0 : packCost(size),
    lastDailyAt: row.last_daily_at,
    dailyStreak: row.daily_streak,
    totalRolls: row.total_rolls,
    totalClaims: row.total_claims,
    badges,
    upgrades,
    settings,
    pendingCoins: row.pending_coins_json ? JSON.parse(row.pending_coins_json) : null,
    wishes: wishesOf(db, player.id),
    collection: withCollection ? collectionOf(db, player.id) : undefined,
    serverNow: Date.now(),
  }
}

export function fullState(db: DB, player: Player): Snapshot {
  return snapshot(db, player, true)
}

/* -------------------------------------------------------------------- roll */

export interface RollResult {
  char: PoolPick
  owned: boolean
  wished: boolean
  compensation: number
  /**
   * Granted by the pack that just produced it. Distinct from `owned`, which a
   * pack sets on everything it hands over: without this a brand new card and a
   * duplicate would look identical once the wrapper came off.
   */
  fresh?: boolean
}

/**
 * What a pack holds for this player right now.
 *
 * Zero until the shop unlocks packs, which is the whole of the progression:
 * a fresh account summons one card at a time, and Sapphire is what turns that
 * into a sealed pack.
 */
function packSizeFor(fx: ReturnType<typeof computeEffects>, sandbox: boolean): number {
  return sandbox ? SANDBOX_MAX_DRAW : fx.packSize
}

/**
 * Summon a card, or a pack of them.
 *
 * Nothing here is rationed: there is no summon budget and no cooldown, so the
 * only question a summon asks is how many cards the player has earned the
 * right to pull at once. A pack is sealed and every card in it is granted the
 * moment it is rolled; a single summon is one card, still yours to claim or
 * leave.
 */
export function roll(
  db: DB,
  player: Player,
  count: number,
): { results: RollResult[]; pack: boolean; claimed: number; bonus: number; snapshot: Snapshot } {
  const row = loadState(db, player.id)
  const settings: ServerSettings = JSON.parse(row.settings_json)
  const { fx } = loadoutOf(row)
  const sandbox = !!player.sandbox_of
  const wanted = Math.max(1, Math.round(count))
  const multi = wanted > 1
  const packSize = packSizeFor(fx, sandbox)

  let draws = 1
  let price = 0
  if (multi) {
    if (packSize <= 0) {
      fail('Packs are locked. The Sapphire badge in the shop opens them.')
    }
    draws = sandbox ? Math.min(SANDBOX_MAX_DRAW, wanted) : packSize
    price = sandbox ? 0 : packCost(draws)
    // A pack is what credits are for. The single summon is always free, so an
    // empty purse is never a dead end -- it just means selling something first.
    if (row.credits < price) {
      fail(`A pack of ${draws} costs ${price.toLocaleString()} credits. Sell something first.`)
    }
  }
  // Sandbox bulk stays a plain spread: it is for looking at a hundred cards at
  // once, and a sealed wrapper is the opposite of that.
  const pack = multi && !sandbox

  const ownedIds = new Set(
    (db.prepare('SELECT character_id FROM claims WHERE player_id = ?').all(player.id) as any[]).map(
      (r) => r.character_id as number,
    ),
  )
  const wishes = wishesOf(db, player.id)
  const openWishes = wishes.filter((w) => !ownedIds.has(w.id))

  const owner = settings.skipOwned ? player.id : null
  const pool = drawFromPool(db, draws, settings.rollGender, settings.poolSize, owner)
  if (pool.length === 0) {
    fail('The catalog has no characters matching your filters yet. Give the first crawl a minute.')
  }

  const results: RollResult[] = []
  const used = new Set<number>()
  let totalComp = 0
  let coinFound = 0

  for (let i = 0; i < draws; i++) {
    let char: PoolPick | undefined
    let wished = false
    const stillOpen = openWishes.filter((w) => !used.has(w.id))
    const wishChance = Math.min(WISH_CHANCE_CAP, stillOpen.length * WISH_BASE_CHANCE * fx.wishChanceMult)
    if (stillOpen.length > 0 && Math.random() < wishChance) {
      char = stillOpen[Math.floor(Math.random() * stillOpen.length)]
      wished = true
    } else {
      char = pool.find((c) => !used.has(c.id)) ?? pool[i % pool.length]
      wished = wishes.some((w) => w.id === char!.id)
    }
    if (!char) break
    used.add(char.id)
    const owned = ownedIds.has(char.id)
    const compensation = owned ? duplicateCompensation(char.creditValue, fx.dupCompMult) : 0
    totalComp += compensation
    const coin = rollCoinDrop(BASE_COIN_CHANCE + fx.coinChanceBonus, fx.coinValueMult)
    if (coin) coinFound += coin.amount
    results.push({ char, owned, wished, compensation })
  }

  /*
   * The Emerald guarantee.
   *
   * Applied to the dealt cards rather than to the pool they came from, because
   * a wish can barge in after the draw and take the guaranteed card's place --
   * checking the pool would promise a Legendary and hand over nine commons and
   * a wish. It swaps the weakest card rather than adding one, so a guarantee
   * never quietly makes a pack bigger; it never displaces a wish that came
   * true, which is the one card in a pack somebody was actually waiting for;
   * and it is skipped when the catalog holds nobody good enough, because an
   * instance an hour into its first crawl owes nobody a Mythic.
   */
  if (multi && fx.guaranteeValue > 0 && !results.some((r) => r.char.creditValue >= fx.guaranteeValue)) {
    let worst = -1
    for (let i = 0; i < results.length; i++) {
      if (results[i].wished) continue
      if (worst < 0 || results[i].char.creditValue < results[worst].char.creditValue) worst = i
    }
    const lucky =
      worst < 0
        ? null
        : drawAboveValue(
            db,
            fx.guaranteeValue,
            settings.rollGender,
            settings.poolSize,
            results.map((r) => r.char.id),
            owner,
          )
    if (lucky) {
      const owned = ownedIds.has(lucky.id)
      const compensation = owned ? duplicateCompensation(lucky.creditValue, fx.dupCompMult) : 0
      totalComp += compensation - results[worst].compensation
      results[worst] = {
        char: lucky,
        owned,
        wished: wishes.some((w) => w.id === lucky.id),
        compensation,
      }
    }
  }

  // Sapphire IV: a pack always turns one up, whatever the per-card chance did.
  if (multi && fx.packCoin) coinFound += coinAmount(fx.coinValueMult)
  const pendingCoins = coinFound > 0 ? { amount: coinFound } : null
  const session: RollSession = { at: Date.now(), results }

  const opened = db.transaction(() => {
    db.prepare(
      `UPDATE player_state SET credits = credits + ?, total_rolls = total_rolls + ?,
              roll_session_json = ?, pending_coins_json = ?
        WHERE player_id = ?`,
    ).run(
      totalComp - price,
      results.length,
      JSON.stringify(session),
      pendingCoins ? JSON.stringify(pendingCoins) : null,
      player.id,
    )
    if (!pack) return { claimed: 0, bonus: 0 }
    // Remember what was already in the collection: takeAll marks everything it
    // hands over as owned, which would otherwise erase the difference between
    // a new card and a duplicate.
    const wasOwned = results.map((r) => r.owned)
    // The pack's contents are the player's the moment it is rolled, however
    // they choose to open it on screen. Settling it here rather than on an
    // "opened" call means a closed tab or a dropped connection mid-animation
    // cannot cost anyone their cards.
    const seriesPaid: Record<string, number> = JSON.parse(row.series_paid_json)
    const r = takeAll(db, player, session, fx, seriesPaid)
    results.forEach((entry, i) => {
      if (!wasOwned[i]) entry.fresh = true
    })
    db.prepare(
      `UPDATE player_state SET credits = credits + ?, total_claims = total_claims + ?,
              series_paid_json = ?, roll_session_json = ? WHERE player_id = ?`,
    ).run(r.bonus, r.claimed, JSON.stringify(seriesPaid), JSON.stringify(session), player.id)
    return r
  })()

  return {
    results,
    pack,
    claimed: opened.claimed,
    bonus: opened.bonus,
    snapshot: snapshot(db, player, pack),
  }
}

/* ------------------------------------------------------------------- claim */

function readSession(row: StateRow): RollSession {
  if (!row.roll_session_json) fail('Nothing has been rolled yet.')
  const session: RollSession = JSON.parse(row.roll_session_json!)
  if (Date.now() - session.at > ROLL_SESSION_MS) fail('That summon has expired. Roll again.')
  return session
}

function payClaimBonuses(
  char: PoolPick,
  wished: boolean,
  fx: ReturnType<typeof computeEffects>,
  seriesPaid: Record<string, number>,
  collectionSeriesCount: number,
): { bonus: number; notes: string[] } {
  let bonus = 0
  const notes: string[] = []
  if (wished && fx.wishClaimBonus > 0) {
    bonus += fx.wishClaimBonus
    notes.push(`Wish fulfilled! +${fx.wishClaimBonus} credits (Bronze IV)`)
  }
  if (fx.claimPayback > 0) {
    const paid = Math.max(1, Math.round(char.creditValue * fx.claimPayback))
    bonus += paid
    notes.push(`Emerald IV pays the dowry: +${paid} credits`)
  }
  const paid = seriesPaid[char.series] ?? 0
  let seriesBonus = 0
  for (const m of SERIES_MILESTONES) {
    if (collectionSeriesCount >= m.count && paid < m.count) {
      seriesBonus += m.reward
      seriesPaid[char.series] = m.count
    }
  }
  if (seriesBonus > 0) {
    bonus += seriesBonus
    notes.push(`Series set: ${collectionSeriesCount}x ${char.series}, +${seriesBonus} credits!`)
  }
  return { bonus, notes }
}

export function claim(
  db: DB,
  player: Player,
  characterId: number,
): { snapshot: Snapshot; notes: string[] } {
  const row = loadState(db, player.id)
  const { fx } = loadoutOf(row)
  const session = readSession(row)
  const entry = session.results.find((r) => r.char.id === characterId)
  if (!entry) fail('That character was not in your last summon.')
  const already = db
    .prepare('SELECT 1 FROM claims WHERE player_id = ? AND character_id = ?')
    .get(player.id, characterId)
  if (already) fail('You already own that character.')

  const seriesPaid: Record<string, number> = JSON.parse(row.series_paid_json)
  const now = Date.now()
  const notes = db.transaction(() => {
    db.prepare(
      'INSERT INTO claims (player_id, character_id, claimed_at, credit_value) VALUES (?, ?, ?, ?)',
    ).run(player.id, characterId, now, entry!.char.creditValue)
    const inSeries = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM claims cl JOIN characters c ON c.id = cl.character_id
            WHERE cl.player_id = ? AND c.series = ?`,
        )
        .get(player.id, entry!.char.series) as { n: number }
    ).n
    const { bonus, notes } = payClaimBonuses(entry!.char, entry!.wished, fx, seriesPaid, inSeries)
    entry!.owned = true
    entry!.compensation = 0
    db.prepare(
      `UPDATE player_state
          SET credits = credits + ?, total_claims = total_claims + 1, series_paid_json = ?,
              roll_session_json = ?
        WHERE player_id = ?`,
    ).run(bonus, JSON.stringify(seriesPaid), JSON.stringify(session), player.id)
    return notes
  })()

  return { snapshot: snapshot(db, player, true), notes }
}

/**
 * Take every unowned card of a spread at once.
 *
 * Shared by the sandbox's claim-all and by opening a pack, which grants its
 * whole contents. Must be called inside a transaction: it writes claims,
 * series payouts and the session together.
 */
function takeAll(
  db: DB,
  player: Player,
  session: RollSession,
  fx: ReturnType<typeof computeEffects>,
  seriesPaid: Record<string, number>,
): { claimed: number; bonus: number } {
  const now = Date.now()
  let claimed = 0
  let bonus = 0
  for (const entry of session.results) {
    const owns = db
      .prepare('SELECT 1 FROM claims WHERE player_id = ? AND character_id = ?')
      .get(player.id, entry.char.id)
    if (owns) continue
    db.prepare(
      'INSERT INTO claims (player_id, character_id, claimed_at, credit_value) VALUES (?, ?, ?, ?)',
    ).run(player.id, entry.char.id, now, entry.char.creditValue)
    claimed++
    const inSeries = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM claims cl JOIN characters c ON c.id = cl.character_id
            WHERE cl.player_id = ? AND c.series = ?`,
        )
        .get(player.id, entry.char.series) as { n: number }
    ).n
    bonus += payClaimBonuses(entry.char, entry.wished, fx, seriesPaid, inSeries).bonus
    entry.owned = true
    entry.compensation = 0
  }
  return { claimed, bonus }
}

export function claimAll(db: DB, player: Player): { snapshot: Snapshot; claimed: number; bonus: number } {
  if (!player.sandbox_of) fail('Sandbox is not enabled for this account.')
  const row = loadState(db, player.id)
  const { fx } = loadoutOf(row)
  const session = readSession(row)
  const seriesPaid: Record<string, number> = JSON.parse(row.series_paid_json)

  const result = db.transaction(() => {
    const r = takeAll(db, player, session, fx, seriesPaid)
    db.prepare(
      `UPDATE player_state SET credits = credits + ?, total_claims = total_claims + ?,
              series_paid_json = ?, roll_session_json = ? WHERE player_id = ?`,
    ).run(r.bonus, r.claimed, JSON.stringify(seriesPaid), JSON.stringify(session), player.id)
    return r
  })()

  return { snapshot: snapshot(db, player, true), ...result }
}

/* ------------------------------------------------------- economy and timers */

export function collectCoins(db: DB, player: Player): Snapshot {
  const row = loadState(db, player.id)
  if (!row.pending_coins_json) fail('No coins are waiting.')
  const coins = JSON.parse(row.pending_coins_json!) as { amount: number }
  db.prepare(
    'UPDATE player_state SET credits = credits + ?, pending_coins_json = NULL WHERE player_id = ?',
  ).run(coins.amount, player.id)
  return snapshot(db, player)
}

export function claimDaily(db: DB, player: Player): { snapshot: Snapshot; amount: number; streak: number } {
  const row = loadState(db, player.id)
  const { fx } = loadoutOf(row)
  const now = Date.now()
  if (!player.sandbox_of && now - row.last_daily_at < DAILY_INTERVAL_H * HOUR) {
    fail('The daily offering is not ready yet.')
  }
  const streak = now - row.last_daily_at <= DAILY_STREAK_WINDOW_H * HOUR ? row.daily_streak + 1 : 1
  const amount = dailyAmount(streak, fx.dailyMult)
  db.prepare(
    'UPDATE player_state SET credits = credits + ?, last_daily_at = ?, daily_streak = ? WHERE player_id = ?',
  ).run(amount, now, streak, player.id)
  return { snapshot: snapshot(db, player), amount, streak }
}

/**
 * Sell characters back at the value they were claimed at.
 *
 * Any number at once, for anybody. Selling in bulk used to be a sandbox
 * privilege, which meant the one screen where a collection actually gets
 * pruned -- a phone -- was the one place it could only be done one card and
 * one confirmation at a time.
 */
export function sell(db: DB, player: Player, ids: number[]): { snapshot: Snapshot; total: number; sold: number } {
  if (ids.length === 0) fail('Nothing to sell.')
  const placeholders = ids.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT character_id, credit_value FROM claims WHERE player_id = ? AND character_id IN (${placeholders})`)
    .all(player.id, ...ids) as { character_id: number; credit_value: number }[]
  if (rows.length === 0) fail('You do not own that.')
  const { fx } = loadoutOf(loadState(db, player.id))
  const total = rows.reduce((n, r) => n + Math.round(r.credit_value * fx.sellMult), 0)
  db.transaction(() => {
    db.prepare(`DELETE FROM claims WHERE player_id = ? AND character_id IN (${placeholders})`).run(
      player.id,
      ...ids,
    )
    db.prepare('UPDATE player_state SET credits = credits + ? WHERE player_id = ?').run(total, player.id)
  })()
  return { snapshot: snapshot(db, player, true), total, sold: rows.length }
}

export function addWish(db: DB, player: Player, characterId: number): Snapshot {
  const row = loadState(db, player.id)
  const slots = loadoutOf(row).fx.wishSlots
  const have = (
    db.prepare('SELECT COUNT(*) AS n FROM wishes WHERE player_id = ?').get(player.id) as { n: number }
  ).n
  if (have >= slots) fail('No wish slots free. Bronze badges add more.')
  if (!getCharacter(db, characterId)) fail('That character is not in the catalog.')
  db.prepare(
    'INSERT OR IGNORE INTO wishes (player_id, character_id, created_at) VALUES (?, ?, ?)',
  ).run(player.id, characterId, Date.now())
  return snapshot(db, player)
}

export function removeWish(db: DB, player: Player, characterId: number): Snapshot {
  db.prepare('DELETE FROM wishes WHERE player_id = ? AND character_id = ?').run(player.id, characterId)
  return snapshot(db, player)
}

export function buyBadge(db: DB, player: Player, key: BadgeKey): Snapshot {
  const row = loadState(db, player.id)
  const { badges } = loadoutOf(row)
  const def = BADGE_DEFS.find((d) => d.key === key)
  if (!def) fail('No such badge.')
  const level = badges[key]
  if (level >= 4) fail('That badge is already at IV.')
  if (!badgeUnlocked(key, badges)) fail('That badge is still locked.')
  const cost = badgeCost(def!, level + 1, badges.ruby >= 4)
  if (row.credits < cost) fail('Not enough credits.')
  const next: Badges = { ...badges, [key]: level + 1 }
  db.prepare('UPDATE player_state SET credits = credits - ?, badges_json = ? WHERE player_id = ?').run(
    cost,
    JSON.stringify(next),
    player.id,
  )
  return snapshot(db, player)
}

/**
 * Buy the next level of an upgrade line.
 *
 * Unlike a badge there is no prerequisite chart and no top level worth
 * mentioning: the price is the gate, and it triples-ish every time.
 */
export function buyUpgrade(db: DB, player: Player, key: UpgradeKey): Snapshot {
  const row = loadState(db, player.id)
  const { upgrades, fx } = loadoutOf(row)
  const def = UPGRADE_DEFS.find((d) => d.key === key)
  if (!def) fail('No such upgrade.')
  const level = upgrades[key] ?? 0
  if (upgradeMaxed(def!, level)) fail('That upgrade is already at its last level.')
  const cost = upgradeCost(def!, level, fx.priceMult < 1)
  if (row.credits < cost) fail('Not enough credits.')
  const next: Upgrades = { ...upgrades, [key]: level + 1 }
  db.prepare(
    'UPDATE player_state SET credits = credits - ?, upgrades_json = ? WHERE player_id = ?',
  ).run(cost, JSON.stringify(next), player.id)
  return snapshot(db, player)
}

/** Preferences only: who shows up in a roll, and how deep the pool goes. */
export function updateSettings(db: DB, player: Player, patch: unknown): Snapshot {
  const row = loadState(db, player.id)
  const current: ServerSettings = JSON.parse(row.settings_json)
  const next = sanitizeSettings(patch, current)
  db.prepare('UPDATE player_state SET settings_json = ? WHERE player_id = ?').run(
    JSON.stringify(next),
    player.id,
  )
  return snapshot(db, player)
}

/** Sandbox only: the debug credit grant. */
export function grantCredits(db: DB, player: Player, amount: number): Snapshot {
  if (!player.sandbox_of) fail('Sandbox is not enabled for this account.')
  const n = Math.max(0, Math.min(100_000, Math.round(amount)))
  db.prepare('UPDATE player_state SET credits = credits + ? WHERE player_id = ?').run(n, player.id)
  return snapshot(db, player)
}

/** Wipe this player's progress. Never touches anyone else's rows. */
export function resetPlayer(db: DB, player: Player): Snapshot {
  db.transaction(() => {
    db.prepare('DELETE FROM claims WHERE player_id = ?').run(player.id)
    db.prepare('DELETE FROM wishes WHERE player_id = ?').run(player.id)
    db.prepare(
      `UPDATE player_state SET credits = 0, last_daily_at = 0, daily_streak = 0,
              total_rolls = 0, total_claims = 0, badges_json = ?, upgrades_json = ?,
              series_paid_json = '{}', roll_session_json = NULL, pending_coins_json = NULL
        WHERE player_id = ?`,
    ).run(JSON.stringify(EMPTY_BADGES), JSON.stringify(EMPTY_UPGRADES), player.id)
  })()
  return snapshot(db, player, true)
}

export { rarityOf }
