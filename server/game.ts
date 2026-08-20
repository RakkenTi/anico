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
  BASE_GEM_CHANCE,
  DAILY_INTERVAL_H,
  DAILY_STREAK_WINDOW_H,
  GEM_TIERS,
  SERIES_MILESTONES,
  dailyAmount,
  duplicateCompensation,
  rarityOf,
  rollGemDrop,
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
import { sanitizeSettings, type ServerSettings } from './rules.js'
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
  last_daily_at: number
  daily_streak: number
  last_ritual_at: number
  total_rolls: number
  total_claims: number
  badges_json: string
  settings_json: string
  series_paid_json: string
  roll_session_json: string | null
  pending_gem_json: string | null
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

/** Roll budget refill, applied whenever state is touched. */
function applyRefill(db: DB, row: StateRow, settings: ServerSettings, badges: Badges): StateRow {
  const now = Date.now()
  if (now < row.rolls_reset_at) return row
  const max = settings.rollsPerReset + computeEffects(badges).extraRolls
  const resetAt = now + settings.rollResetMinutes * 60_000
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
  sandbox: boolean
  credits: number
  rollsLeft: number
  rollsResetAt: number
  nextClaimAt: number
  lastDailyAt: number
  dailyStreak: number
  lastRitualAt: number
  totalRolls: number
  totalClaims: number
  badges: Badges
  settings: ServerSettings
  pendingGem: { tier: string; amount: number } | null
  wishes: PoolPick[]
  collection?: OwnedCharacter[]
  serverNow: number
}

export function snapshot(db: DB, player: Player, withCollection = false): Snapshot {
  let row = loadState(db, player.id)
  const settings: ServerSettings = JSON.parse(row.settings_json)
  const badges: Badges = JSON.parse(row.badges_json)
  row = applyRefill(db, row, settings, badges)
  return {
    username: player.username,
    isAdmin: !!player.is_admin,
    sandbox: !!player.sandbox,
    credits: row.credits,
    rollsLeft: row.rolls_left,
    rollsResetAt: row.rolls_reset_at,
    nextClaimAt: row.next_claim_at,
    lastDailyAt: row.last_daily_at,
    dailyStreak: row.daily_streak,
    lastRitualAt: row.last_ritual_at,
    totalRolls: row.total_rolls,
    totalClaims: row.total_claims,
    badges,
    settings,
    pendingGem: row.pending_gem_json ? JSON.parse(row.pending_gem_json) : null,
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

export function roll(db: DB, player: Player, count: number): { results: RollResult[]; snapshot: Snapshot } {
  let row = loadState(db, player.id)
  const settings: ServerSettings = JSON.parse(row.settings_json)
  const badges: Badges = JSON.parse(row.badges_json)
  row = applyRefill(db, row, settings, badges)
  const sandbox = !!player.sandbox
  const n = Math.max(1, Math.min(sandbox ? 100 : 10, Math.round(count)))
  if (!sandbox && row.rolls_left <= 0) fail('You are out of rolls.')
  const spend = sandbox ? 0 : Math.min(n, row.rolls_left)
  const draws = sandbox ? n : spend

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
  let gemAmount = 0
  let gemBestIdx = -1

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
    const gem = rollGemDrop(BASE_GEM_CHANCE + fx.gemChanceBonus, fx.gemUpgrade)
    if (gem) {
      gemAmount += gem.amount
      const tierIdx = GEM_TIERS.findIndex((t) => t.key === gem.tier)
      if (tierIdx > gemBestIdx) gemBestIdx = tierIdx
    }
    results.push({ char, owned, wished, compensation })
  }

  const pendingGem = gemBestIdx >= 0 ? { tier: GEM_TIERS[gemBestIdx].key, amount: gemAmount } : null
  const session: RollSession = { at: Date.now(), results }
  db.prepare(
    `UPDATE player_state SET credits = credits + ?, rolls_left = ?, total_rolls = total_rolls + ?,
            roll_session_json = ?, pending_gem_json = ? WHERE player_id = ?`,
  ).run(
    totalComp,
    sandbox ? row.rolls_left : row.rolls_left - spend,
    results.length,
    JSON.stringify(session),
    pendingGem ? JSON.stringify(pendingGem) : null,
    player.id,
  )

  return { results, snapshot: snapshot(db, player) }
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
  const sandbox = !!player.sandbox
  if (!sandbox && Date.now() < row.next_claim_at) fail('Your claim is still on cooldown.')

  const session = readSession(row)
  const entry = session.results.find((r) => r.char.id === characterId)
  if (!entry) fail('That character was not in your last summon.')
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
      sandbox ? row.next_claim_at : now + settings.claimIntervalMinutes * 60_000,
      JSON.stringify(session),
      player.id,
    )
    return notes
  })()

  return { snapshot: snapshot(db, player, true), notes }
}

/** Sandbox only: claim every unowned card in the current spread. */
export function claimAll(db: DB, player: Player): { snapshot: Snapshot; claimed: number; bonus: number } {
  if (!player.sandbox) fail('Sandbox is not enabled for this account.')
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

export function collectGem(db: DB, player: Player): Snapshot {
  const row = loadState(db, player.id)
  if (!row.pending_gem_json) fail('No gem is waiting.')
  const gem = JSON.parse(row.pending_gem_json!) as { amount: number }
  db.prepare(
    'UPDATE player_state SET credits = credits + ?, pending_gem_json = NULL WHERE player_id = ?',
  ).run(gem.amount, player.id)
  return snapshot(db, player)
}

export function claimDaily(db: DB, player: Player): { snapshot: Snapshot; amount: number; streak: number } {
  const row = loadState(db, player.id)
  const badges: Badges = JSON.parse(row.badges_json)
  const now = Date.now()
  if (!player.sandbox && now - row.last_daily_at < DAILY_INTERVAL_H * HOUR) {
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
  const ready = player.sandbox ? 0 : row.last_ritual_at + fx.claimResetHours * HOUR
  if (Date.now() < ready) fail('The ritual is not ready yet.')
  db.prepare('UPDATE player_state SET next_claim_at = 0, last_ritual_at = ? WHERE player_id = ?').run(
    Date.now(),
    player.id,
  )
  return snapshot(db, player)
}

export function sell(db: DB, player: Player, ids: number[], bulk: boolean): { snapshot: Snapshot; total: number; sold: number } {
  if (bulk && !player.sandbox) fail('Bulk selling is sandbox only.')
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
  const settings: ServerSettings = JSON.parse(row.settings_json)
  const badges: Badges = JSON.parse(row.badges_json)
  if (key === 'rollRefill') {
    const max = settings.rollsPerReset + computeEffects(badges).extraRolls
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

export function updateSettings(db: DB, player: Player, patch: unknown): Snapshot {
  const row = loadState(db, player.id)
  const current: ServerSettings = JSON.parse(row.settings_json)
  const next = sanitizeSettings(patch, current)
  const badges: Badges = JSON.parse(row.badges_json)
  const max = next.rollsPerReset + computeEffects(badges).extraRolls
  db.prepare(
    'UPDATE player_state SET settings_json = ?, rolls_left = MIN(rolls_left, ?) WHERE player_id = ?',
  ).run(JSON.stringify(next), max, player.id)
  return snapshot(db, player)
}

/** Sandbox only: the debug credit grant. */
export function grantCredits(db: DB, player: Player, amount: number): Snapshot {
  if (!player.sandbox) fail('Sandbox is not enabled for this account.')
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
    const settings: ServerSettings = JSON.parse(loadState(db, player.id).settings_json)
    db.prepare(
      `UPDATE player_state SET credits = 0, rolls_left = ?, rolls_reset_at = ?, next_claim_at = 0,
              last_daily_at = 0, daily_streak = 0, last_ritual_at = 0, total_rolls = 0, total_claims = 0,
              badges_json = ?, series_paid_json = '{}', roll_session_json = NULL, pending_gem_json = NULL
        WHERE player_id = ?`,
    ).run(
      settings.rollsPerReset,
      now + settings.rollResetMinutes * 60_000,
      JSON.stringify({ bronze: 0, silver: 0, gold: 0, sapphire: 0, ruby: 0, emerald: 0 }),
      player.id,
    )
  })()
  return snapshot(db, player, true)
}

export { rarityOf }
