/**
 * The rules, server side.
 *
 * Everything that used to run in the browser store and could therefore be
 * lied about: roll budgets, claim cooldowns, the daily timer, the economy and
 * the RNG. The client renders what these functions return and nothing more.
 *
 * A claim snapshots the credit value the player was shown. Favourites only
 * grow, so reading value live from the catalog would quietly inflate old
 * collections and change rarity frames underneath their owner.
 */

import type { DB } from './db.js'
import {
  BASE_COIN_CHANCE,
  COIN_TIERS,
  DAILY_INTERVAL_H,
  DAILY_STREAK_WINDOW_H,
  SERIES_MILESTONES,
  dailyAmount,
  duplicateCompensation,
  rarityOf,
  rollCoinDrop,
} from '../src/game/economy.js'
import {
  BADGE_DEFS,
  badgeCost,
  badgeUnlocked,
  computeEffects,
  type BadgeKey,
  type Badges,
} from '../src/game/badges.js'
import { drawFromPool, getCharacter, type PoolPick } from './catalog.js'
import { PACING, sanitizeSettings, type ServerSettings } from './rules.js'

/** Fun mode and sandbox both mean "no timers apply". */
const unpaced = (settings: ServerSettings, player: Player) =>
  settings.mode === 'fun' || !!player.sandbox_of
import type { Player } from './auth.js'

const HOUR = 3_600_000
const WISH_BASE_CHANCE = 0.025
const WISH_CHANCE_CAP = 0.6
/** How long a rolled spread stays claimable. */
const ROLL_SESSION_MS = 30 * 60_000

export const CONSUMABLES = {
  rollRefill: { name: 'Roll Refill', cost: 200 },
  claimReset: { name: 'Claim Incense', cost: 500 },
} as const
export type ConsumableKey = keyof typeof CONSUMABLES

export class GameError extends Error {}
const fail = (msg: string): never => {
  throw new GameError(msg)
}

interface StateRow {
  player_id: number
  credits: number
  rolls_left: number
  rolls_reset_at: number
  next_claim_at: number
  last_multi_at: number
  last_daily_at: number
  daily_streak: number
  last_ritual_at: number
  total_rolls: number
  total_claims: number
  badges_json: string
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
  /**
   * A fun-mode x10 is dealt face down. The cards exist server-side from the
   * moment they are rolled, but only the one index the player turns over is
   * ever sent to them, so the pick stays a pick rather than a lookup.
   */
  covered?: boolean
  revealed?: number
}

function loadState(db: DB, playerId: number): StateRow {
  const row = db.prepare('SELECT * FROM player_state WHERE player_id = ?').get(playerId) as
    | StateRow
    | undefined
  if (!row) fail('No game state for this account.')
  return row!
}

/** The hourly single-summon budget, before badges. */
function rollCapacity(badges: Badges): number {
  return PACING.rollsPerHour + computeEffects(badges).extraRolls
}

/** How long until a cooldown is up, in words an error message can use. */
function waitPhrase(ms: number): string {
  const mins = Math.ceil(ms / 60_000)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} hour${h === 1 ? '' : 's'}` : `${h}h ${m}m`
}

/** Roll budget refill, applied whenever state is touched. */
function applyRefill(db: DB, row: StateRow, badges: Badges): StateRow {
  const now = Date.now()
  if (now < row.rolls_reset_at) return row
  const max = rollCapacity(badges)
  const resetAt = now + PACING.rollResetMinutes * 60_000
  db.prepare('UPDATE player_state SET rolls_left = ?, rolls_reset_at = ? WHERE player_id = ?').run(
    max,
    resetAt,
    row.player_id,
  )
  return { ...row, rolls_left: max, rolls_reset_at: resetAt }
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
  rollsLeft: number
  rollsMax: number
  rollsResetAt: number
  /** When the once-a-day multi summon comes back around. */
  multiReadyAt: number
  multiSize: number
  nextClaimAt: number
  lastDailyAt: number
  dailyStreak: number
  lastRitualAt: number
  totalRolls: number
  totalClaims: number
  badges: Badges
  settings: ServerSettings
  pendingCoins: { tier: string; amount: number } | null
  /** The face-down spread waiting on a pick, if there is one. */
  covered: { count: number; revealed: number | null } | null
  wishes: PoolPick[]
  collection?: OwnedCharacter[]
  serverNow: number
}

/** What the client may know about a face-down spread: how many, and which one is up. */
function coveredOf(row: StateRow): { count: number; revealed: number | null } | null {
  if (!row.roll_session_json) return null
  const session: RollSession = JSON.parse(row.roll_session_json)
  if (!session.covered) return null
  if (Date.now() - session.at > ROLL_SESSION_MS) return null
  return { count: session.results.length, revealed: session.revealed ?? null }
}

export function snapshot(db: DB, player: Player, withCollection = false): Snapshot {
  let row = loadState(db, player.id)
  const settings: ServerSettings = JSON.parse(row.settings_json)
  const badges: Badges = JSON.parse(row.badges_json)
  row = applyRefill(db, row, badges)
  return {
    username: player.username,
    isAdmin: !!player.is_admin,
    sandbox: !!player.sandbox_of,
    sandboxAllowed: !!player.sandbox,
    credits: row.credits,
    rollsLeft: row.rolls_left,
    rollsMax: rollCapacity(badges),
    rollsResetAt: row.rolls_reset_at,
    multiReadyAt: row.last_multi_at + PACING.multiRollIntervalHours * HOUR,
    multiSize: PACING.multiRollSize,
    nextClaimAt: row.next_claim_at,
    lastDailyAt: row.last_daily_at,
    dailyStreak: row.daily_streak,
    lastRitualAt: row.last_ritual_at,
    totalRolls: row.total_rolls,
    totalClaims: row.total_claims,
    badges,
    settings,
    pendingCoins: row.pending_coins_json ? JSON.parse(row.pending_coins_json) : null,
    covered: coveredOf(row),
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
}

/**
 * Summon a spread.
 *
 * Two budgets, deliberately unconnected. A single summon comes out of an
 * hourly allowance the shop can grow; the ×10 spread is its own once-a-day
 * event and costs no hourly rolls, so a day's big pull never eats the rolls
 * someone was saving. Sandbox accounts spend from neither.
 */
export function roll(db: DB, player: Player, count: number): { results: RollResult[]; snapshot: Snapshot } {
  let row = loadState(db, player.id)
  const settings: ServerSettings = JSON.parse(row.settings_json)
  const badges: Badges = JSON.parse(row.badges_json)
  row = applyRefill(db, row, badges)
  const sandbox = !!player.sandbox_of
  const free = unpaced(settings, player)
  const now = Date.now()
  const wanted = Math.max(1, Math.round(count))
  const multi = wanted > 1

  let draws: number
  let spend = 0
  // A fun-mode x10 is dealt face down and only one card is ever turned over,
  // which is what it pays instead of a cooldown.
  const covered = free && multi && !sandbox

  if (sandbox) {
    draws = Math.min(100, wanted)
  } else if (free) {
    draws = multi ? PACING.multiRollSize : 1
  } else if (multi) {
    const readyAt = row.last_multi_at + PACING.multiRollIntervalHours * HOUR
    if (now < readyAt) {
      fail(`Your ×${PACING.multiRollSize} summon returns in ${waitPhrase(readyAt - now)}.`)
    }
    draws = PACING.multiRollSize
  } else {
    if (row.rolls_left <= 0) {
      fail(`You are out of summons. They refill in ${waitPhrase(row.rolls_reset_at - now)}.`)
    }
    draws = 1
    spend = 1
  }

  const fx = computeEffects(badges)
  const ownedIds = new Set(
    (db.prepare('SELECT character_id FROM claims WHERE player_id = ?').all(player.id) as any[]).map(
      (r) => r.character_id as number,
    ),
  )
  const wishes = wishesOf(db, player.id)
  const openWishes = wishes.filter((w) => !ownedIds.has(w.id))

  const pool = drawFromPool(db, draws, settings.rollGender, settings.poolSize, settings.skipOwned ? player.id : null)
  if (pool.length === 0) {
    fail('The catalog has no characters matching your filters yet. Give the first crawl a minute.')
  }

  const results: RollResult[] = []
  const used = new Set<number>()
  let totalComp = 0
  let coinAmount = 0
  let coinBestIdx = -1

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
    // A covered spread pays nothing until a card is turned over: crediting
    // duplicates up front would let a player count the money and deduce what
    // they were dealt without picking.
    if (!covered) totalComp += compensation
    const coin = covered ? null : rollCoinDrop(BASE_COIN_CHANCE + fx.coinChanceBonus, fx.coinUpgrade)
    if (coin) {
      coinAmount += coin.amount
      const tierIdx = COIN_TIERS.findIndex((t) => t.key === coin.tier)
      if (tierIdx > coinBestIdx) coinBestIdx = tierIdx
    }
    results.push({ char, owned, wished, compensation })
  }

  const pendingCoins =
    coinBestIdx >= 0 ? { tier: COIN_TIERS[coinBestIdx].key, amount: coinAmount } : null
  const session: RollSession = { at: Date.now(), results, ...(covered ? { covered: true } : {}) }
  db.prepare(
    `UPDATE player_state SET credits = credits + ?, rolls_left = ?, last_multi_at = ?,
            total_rolls = total_rolls + ?, roll_session_json = ?, pending_coins_json = ?
      WHERE player_id = ?`,
  ).run(
    totalComp,
    row.rolls_left - spend,
    multi && !sandbox && !free ? now : row.last_multi_at,
    results.length,
    JSON.stringify(session),
    pendingCoins ? JSON.stringify(pendingCoins) : null,
    player.id,
  )

  // Face down means face down: the caller gets a count, not a spread.
  return { results: covered ? [] : results, snapshot: snapshot(db, player) }
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
  if (fx.claimPaysValue) {
    bonus += char.creditValue
    notes.push(`Emerald IV pays the dowry: +${char.creditValue} credits`)
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
  const settings: ServerSettings = JSON.parse(row.settings_json)
  const badges: Badges = JSON.parse(row.badges_json)
  const free = unpaced(settings, player)
  if (!free && Date.now() < row.next_claim_at) fail('Your claim is still on cooldown.')

  const session = readSession(row)
  const idx = session.results.findIndex((r) => r.char.id === characterId)
  const entry = session.results[idx]
  if (!entry) fail('That character was not in your last summon.')
  // On a face-down spread only the card actually turned over can be taken;
  // otherwise a player could name any id and claim what they never revealed.
  if (session.covered && session.revealed !== idx) {
    fail('Turn a card over before claiming it.')
  }
  const already = db
    .prepare('SELECT 1 FROM claims WHERE player_id = ? AND character_id = ?')
    .get(player.id, characterId)
  if (already) fail('You already own that character.')

  const fx = computeEffects(badges)
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
              next_claim_at = ?, roll_session_json = ?
        WHERE player_id = ?`,
    ).run(
      bonus,
      JSON.stringify(seriesPaid),
      free ? row.next_claim_at : now + PACING.claimIntervalMinutes * 60_000,
      JSON.stringify(session),
      player.id,
    )
    return notes
  })()

  return { snapshot: snapshot(db, player, true), notes }
}

/**
 * Turn one card of a face-down spread over.
 *
 * The spread was rolled server-side and has been sitting in the session all
 * along; this is what releases a single card of it. One turn per spread, and
 * the duplicate compensation and coin drop that a face-up roll would have paid
 * are settled here instead, on the one card that was actually chosen.
 */
export function flip(
  db: DB,
  player: Player,
  index: number,
): { result: RollResult; snapshot: Snapshot } {
  const row = loadState(db, player.id)
  const badges: Badges = JSON.parse(row.badges_json)
  const session = readSession(row)
  if (!session.covered) fail('That summon is already face up.')
  if (session.revealed !== undefined && session.revealed !== null) {
    fail('You have already turned a card over. Summon again for a new spread.')
  }
  const i = Math.round(index)
  if (!Number.isInteger(i) || i < 0 || i >= session.results.length) fail('No such card.')

  const fx = computeEffects(badges)
  const entry = session.results[i]
  const coin = rollCoinDrop(BASE_COIN_CHANCE + fx.coinChanceBonus, fx.coinUpgrade)
  session.revealed = i

  db.prepare(
    `UPDATE player_state SET credits = credits + ?, roll_session_json = ?, pending_coins_json = ?
      WHERE player_id = ?`,
  ).run(
    entry.compensation,
    JSON.stringify(session),
    coin ? JSON.stringify(coin) : null,
    player.id,
  )
  return { result: entry, snapshot: snapshot(db, player) }
}

/** Sandbox only: claim every unowned card in the current spread. */
export function claimAll(db: DB, player: Player): { snapshot: Snapshot; claimed: number; bonus: number } {
  if (!player.sandbox_of) fail('Sandbox is not enabled for this account.')
  const row = loadState(db, player.id)
  const badges: Badges = JSON.parse(row.badges_json)
  const fx = computeEffects(badges)
  const session = readSession(row)
  const seriesPaid: Record<string, number> = JSON.parse(row.series_paid_json)
  const now = Date.now()

  const result = db.transaction(() => {
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
    db.prepare(
      `UPDATE player_state SET credits = credits + ?, total_claims = total_claims + ?,
              series_paid_json = ?, roll_session_json = ? WHERE player_id = ?`,
    ).run(bonus, claimed, JSON.stringify(seriesPaid), JSON.stringify(session), player.id)
    return { claimed, bonus }
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
  const badges: Badges = JSON.parse(row.badges_json)
  const now = Date.now()
  if (!player.sandbox_of && now - row.last_daily_at < DAILY_INTERVAL_H * HOUR) {
    fail('The daily offering is not ready yet.')
  }
  const streak = now - row.last_daily_at <= DAILY_STREAK_WINDOW_H * HOUR ? row.daily_streak + 1 : 1
  const amount = dailyAmount(streak, computeEffects(badges).dailyMult)
  db.prepare(
    'UPDATE player_state SET credits = credits + ?, last_daily_at = ?, daily_streak = ? WHERE player_id = ?',
  ).run(amount, now, streak, player.id)
  return { snapshot: snapshot(db, player), amount, streak }
}

export function claimRitual(db: DB, player: Player): Snapshot {
  const row = loadState(db, player.id)
  const badges: Badges = JSON.parse(row.badges_json)
  const fx = computeEffects(badges)
  if (!fx.claimResetUnlocked) fail('The Claim Reset ritual is locked.')
  const ready = player.sandbox_of ? 0 : row.last_ritual_at + fx.claimResetHours * HOUR
  if (Date.now() < ready) fail('The ritual is not ready yet.')
  db.prepare('UPDATE player_state SET next_claim_at = 0, last_ritual_at = ? WHERE player_id = ?').run(
    Date.now(),
    player.id,
  )
  return snapshot(db, player)
}

export function sell(db: DB, player: Player, ids: number[], bulk: boolean): { snapshot: Snapshot; total: number; sold: number } {
  if (bulk && !player.sandbox_of) fail('Bulk selling is sandbox only.')
  if (ids.length === 0) fail('Nothing to sell.')
  const placeholders = ids.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT character_id, credit_value FROM claims WHERE player_id = ? AND character_id IN (${placeholders})`)
    .all(player.id, ...ids) as { character_id: number; credit_value: number }[]
  if (rows.length === 0) fail('You do not own that.')
  const total = rows.reduce((n, r) => n + r.credit_value, 0)
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
  const badges: Badges = JSON.parse(row.badges_json)
  const slots = computeEffects(badges).wishSlots
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
  const badges: Badges = JSON.parse(row.badges_json)
  const def = BADGE_DEFS.find((d) => d.key === key)
  if (!def) fail('No such badge.')
  const level = badges[key]
  if (level >= 4) fail('That badge is already at IV.')
  if (!badgeUnlocked(key, badges)) fail('That badge is still locked.')
  const cost = badgeCost(def!, level + 1, badges.ruby >= 4)
  if (row.credits < cost) fail('Not enough credits.')
  const next: Badges = { ...badges, [key]: level + 1 }
  const rollsGain = key === 'sapphire' ? 1 : key === 'ruby' && level === 3 ? 2 : 0
  db.prepare(
    'UPDATE player_state SET credits = credits - ?, badges_json = ?, rolls_left = rolls_left + ? WHERE player_id = ?',
  ).run(cost, JSON.stringify(next), rollsGain, player.id)
  return snapshot(db, player)
}

export function buyConsumable(db: DB, player: Player, key: ConsumableKey): Snapshot {
  const row = loadState(db, player.id)
  const item = CONSUMABLES[key]
  if (!item) fail('No such item.')
  if (row.credits < item.cost) fail('Not enough credits.')
  const badges: Badges = JSON.parse(row.badges_json)
  if (key === 'rollRefill') {
    const max = rollCapacity(badges)
    if (row.rolls_left >= max) fail('Your rolls are already full.')
    db.prepare(
      'UPDATE player_state SET credits = credits - ?, rolls_left = ? WHERE player_id = ?',
    ).run(item.cost, max, player.id)
  } else {
    if (Date.now() >= row.next_claim_at) fail('Your claim is already available.')
    db.prepare(
      'UPDATE player_state SET credits = credits - ?, next_claim_at = 0 WHERE player_id = ?',
    ).run(item.cost, player.id)
  }
  return snapshot(db, player)
}

/** Preferences only: nothing here can change how fast a player plays. */
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
  const now = Date.now()
  db.transaction(() => {
    db.prepare('DELETE FROM claims WHERE player_id = ?').run(player.id)
    db.prepare('DELETE FROM wishes WHERE player_id = ?').run(player.id)
    db.prepare(
      `UPDATE player_state SET credits = 0, rolls_left = ?, rolls_reset_at = ?, next_claim_at = 0,
              last_multi_at = 0, last_daily_at = 0, daily_streak = 0, last_ritual_at = 0,
              total_rolls = 0, total_claims = 0, badges_json = ?, series_paid_json = '{}',
              roll_session_json = NULL, pending_coins_json = NULL
        WHERE player_id = ?`,
    ).run(
      PACING.rollsPerHour,
      now + PACING.rollResetMinutes * 60_000,
      JSON.stringify({ bronze: 0, silver: 0, gold: 0, sapphire: 0, ruby: 0, emerald: 0 }),
      player.id,
    )
  })()
  return snapshot(db, player, true)
}

export { rarityOf }
