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
  RARITY_MIN,
  SERIES_MILESTONES,
  COIN_BASE_MEAN,
  PACK_COST_PER_CARD,
  coinAmount,
  dailyAmount,
  duplicateCompensation,
  packCost,
  rarityOf,
  rollCoinDrop,
  MAX_STARS,
  stackValue,
  starsFor,
} from '../src/game/economy.js'
import {
  BADGE_DEFS,
  EMPTY_BADGES,
  badgeCost,
  BADGE_MAX,
  badgeUnlocked,
  computeEffects,
  type BadgeKey,
  type Badges,
} from '../src/game/badges.js'
import {
  EMPTY_UPGRADES,
  dealtFor,
  UPGRADE_DEFS,
  upgradeCost,
  upgradeMaxed,
  type UpgradeKey,
  type Upgrades,
} from '../src/game/upgrades.js'
import {
  drawAboveValue,
  drawFromPool,
  drawFromSeries,
  getCharacter,
  type PoolPick,
} from './catalog.js'
import {
  ROUTES,
  WAYPOINTS,
  routePay,
  waypointsPassed,
  type Expedition,
  type Works,
} from '../src/game/industry.js'
import {
  COMMISSION_BONUS,
  COMMISSION_SLOTS,
  DEPTH_BY_TIER,
  MAX_CAST,
  MIN_CAST,
  MUSTER_FACES,
  RAID_BOARD,
  contractPresses,
  contractWork,
  demandFor,
  fitTier,
  type Contract,
  type Musterer,
  type Pinned,
} from '../src/game/contracts.js'
import { autoSellFloor, instancePool, sanitizeSettings, type ServerSettings } from './rules.js'
import { streamsFor } from './bus.js'
import type { Player } from './auth.js'

const HOUR = 3_600_000
/**
 * How rare a wish is.
 *
 * Per card, per open wish. It used to be 2.5% each, which is a coin flip in a
 * forty-card pack and a certainty in a hundred -- a wishlist was a way of
 * ordering Mythics rather than hoping for one. At a twentieth of that, and with
 * at most one wish granted per summon, a wish is the thing you tell somebody
 * about: roughly one pack of a hundred in seven with three wishes pinned, and
 * one in two once the badges that improve the odds are paid for.
 */
const WISH_BASE_CHANCE = 0.0005
const WISH_CHANCE_CAP = 0.006
/**
 * How much of a pull the Automaton is credited with while the tab is closed.
 *
 * A weighted average of what recent pulls were actually worth, kept per
 * player, rather than a re-simulation: the machine cannot draw cards nobody is
 * there to be dealt, so what it does out there is open packs and sell them.
 * The average is the honest price of that -- it tracks every upgrade the
 * player has bought without the server having to replay a million rolls.
 */
const YIELD_SMOOTHING = 0.3
/** Sandbox bulk summons, which answer to nothing else. */
const SANDBOX_MAX_DRAW = 100

export class GameError extends Error {}
const fail = (msg: string): never => {
  throw new GameError(msg)
}

/**
 * Note that the collection changed.
 *
 * Other devices are pushed a snapshot without the collection in it -- it can
 * be five figures of cards and most updates do not touch it -- so this is how
 * one that happens to be looking at the collection knows to fetch it again.
 */
/**
 * How many distinct characters a player holds.
 *
 * Cached against `collection_rev`, which is bumped by `touchCollection`
 * whenever a claim is written or sold -- so the cache is exactly as fresh as
 * the collection it counts, and it costs one map lookup on the hot path.
 *
 * Worth caching because the hot path is `snapshot`, which the Automaton
 * reaches several times a second, and counting is not free at end-game size:
 * `COUNT(*)` over sixty-five thousand claims measures 2.33ms, against a
 * snapshot the previous release got down to 0.5ms. Expeditions gate on roster
 * size, so the number has to be in every snapshot; it does not have to be
 * counted in every snapshot.
 *
 * One process per instance (ADR 0001), so a module-level map is the whole
 * cache. Nothing else writes this database.
 */
const reachCache = new Map<number, { rev: number; n: number }>()

function reachOf(db: DB, playerId: number, rev: number): number {
  const hit = reachCache.get(playerId)
  if (hit && hit.rev === rev) return hit.n
  const n = (
    db.prepare('SELECT COUNT(*) AS n FROM claims WHERE player_id = ?').get(playerId) as { n: number }
  ).n
  reachCache.set(playerId, { rev, n })
  return n
}

function touchCollection(db: DB, playerId: number): void {
  db.prepare('UPDATE player_state SET collection_rev = collection_rev + 1 WHERE player_id = ?').run(
    playerId,
  )
}

/**
 * Spend credits, or refuse.
 *
 * Conditional in SQL rather than checked and then written. Requests are
 * serialised today -- one process, synchronous SQLite -- so a read followed by
 * a write cannot interleave, but this does not depend on that being true
 * forever, and two devices pressing buy at the same moment is now an ordinary
 * thing rather than a curiosity.
 */
function spend(db: DB, playerId: number, amount: number): boolean {
  if (amount <= 0) return true
  return (
    db
      .prepare('UPDATE player_state SET credits = credits - ? WHERE player_id = ? AND credits >= ?')
      .run(amount, playerId, amount).changes > 0
  )
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
  /** The Automaton is switched on, and keeps running with the tab closed. */
  auto_spin: number
  /** When it was last settled: a real pull, or the last time it was read. */
  auto_at: number
  /** Smoothed net credits one pull is worth to this player. */
  auto_yield: number
  /** Character ids the last summon queued for auto-sell. */
  pending_sell_json: string | null
  /** Bumped whenever this player's claims change, so other devices can tell. */
  collection_rev: number
  /** Spare fractions waiting to become scrap: see ADR 0014. */
  spares: number
  scrip: number
  renown: number
  renown_json: string
  /** Scrap in the yard, waiting for the Factory's belt. */
  scrap: number
  /** The series Called Shot is pointed at. */
  aim_series: string | null
  /** Smoothed spares one pull is worth, so time away fills the tank too. */
  auto_spares: number
}

interface RollSessionEntry {
  char: PoolPick
  owned: boolean
  wished: boolean
  compensation: number
  /** Set when this card joined a stack: the star that stack now carries. */
  stars?: number
  /** Set when the auto-sell setting has this card down to be sold. */
  willSell?: boolean
}
/**
 * One summon's results, in flight.
 *
 * Purely a working set now: `takeAll` marks up the entries it grants and
 * `autoSell` reads them back. It used to be written to the database and read
 * again by a claim call that arrived later, which is what the claim button
 * needed and nothing needs any more.
 */
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
function loadoutOf(row: StateRow): {
  badges: Badges
  upgrades: Upgrades
  fx: ReturnType<typeof computeEffects>
} {
  const badges: Badges = { ...EMPTY_BADGES, ...JSON.parse(row.badges_json) }
  const upgrades: Upgrades = { ...EMPTY_UPGRADES, ...JSON.parse(row.upgrades_json || '{}') }
  return { badges, upgrades, fx: computeEffects(badges, upgrades) }
}

/**
 * What one card is worth to this player, right now.
 *
 * Every faucet outside the summon is quoted against this rather than in flat
 * credits, and it is the whole reason the works stay relevant across twenty
 * orders of magnitude (ADR 0014): a contract worth "four thousand credits" is
 * a fortune at ten thousand and invisible at a quadrillion, while one worth
 * "eight hundred presses" is the same size of prize at either end.
 *
 * `auto_yield` is already a smoothed average of what a press nets this player,
 * with every badge, every upgrade and the size of the instance's pool baked
 * in. Per card is that over the pull it came from.
 */
function creditsPerCard(row: StateRow, fx: ReturnType<typeof computeEffects>): number {
  const cards = Math.max(1, fx.cardsPerPull)
  // Before the first pull there is no average yet, so fall back to what the
  // shop itself prices a card at. Otherwise a new player's works read zero and
  // look broken rather than empty.
  return row.auto_yield > 0 ? row.auto_yield / cards : PACK_COST_PER_CARD
}


export interface OwnedCharacter extends PoolPick {
  claimedAt: number
  /** Kept on purpose: never auto-sold, and never picked up by a bulk sale. */
  locked: boolean
  /** How many of this character the player holds. */
  copies: number
  /** The star the stack has merged to, one per doubling. */
  stars: number
  /** What the whole stack fetches, stars and Appraisal included. */
  stackValue: number
}

function collectionOf(db: DB, playerId: number, sellMult: number, mergeMult: number): OwnedCharacter[] {
  const rows = db
    .prepare(
      `SELECT c.*, cl.claimed_at, cl.credit_value AS claimed_value, cl.copies, cl.stars, cl.locked
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
    locked: !!r.locked,
    copies: r.copies,
    stars: r.stars,
    stackValue: Math.round(stackValue(r.claimed_value, r.copies, r.stars, mergeMult) * sellMult),
  }))
}

/**
 * Add one copy to a stack and merge it as far as it will go.
 *
 * Merging is not a thing a player does; it is what a second copy *means*. The
 * star is derived from the count rather than stored as a separate currency, so
 * a stack can never disagree with itself about how many copies it took.
 */
function addCopy(
  db: DB,
  playerId: number,
  characterId: number,
  maxStars: number,
): { stars: number; merged: boolean; spare: number } {
  const row = db
    .prepare('SELECT copies, stars FROM claims WHERE player_id = ? AND character_id = ?')
    .get(playerId, characterId) as { copies: number; stars: number } | undefined
  if (!row) return { stars: 0, merged: false, spare: 0 }
  /*
   * A **spare** is what a deep stack sheds, and how much it sheds is how deep
   * it is: a copy is worth as much scrap as the stack it lands on is full.
   *
   * This used to be all or nothing at twelve merges, and all or nothing was
   * the wrong shape by a wide margin. Every card in a pull is a *distinct*
   * character -- `roll` deals against a `used` set -- so one press adds at
   * most one copy to any one stack, and four thousand copies of one character
   * means four thousand presses that happened to include them. Against a warm
   * catalog and a thousand dealt cards that is 4096 x 80,000 / 1,000 =
   * 327,680 presses, about a hundred and thirty-six hours, before the first
   * spare ever fell. And because every character in the pool grows at exactly
   * the same rate, a whole collection crossed the line within a few hundred
   * presses of itself: a hundred and thirty-six hours of nothing followed by a
   * thousand spares a press. A cliff, not a curve, and the flat part of it is
   * where a player sits looking at 0 / 900 wondering what they did wrong.
   *
   * Fractional yield fixes the shape without moving either end of it. A stack
   * at the cap still sheds a whole spare per copy, so the end-game rate --
   * about one Scrip a press -- is exactly what it was. Below that the rate
   * doubles every star and every star takes twice as long as the last, so
   * Scrip earned grows with the square of time spent: accelerating, always
   * paying something, never paying for nothing.
   *
   * The line is fixed at twelve rather than at the player's own cap. Tying it
   * to the cap meant buying Deeper Merges cut the yield until every stack had
   * doubled again -- a hundred hours at end-game rates -- so the strongest
   * line in the tree throttled the economy that pays for it. A stack still
   * stops growing at its own cap; it just keeps shedding.
   */
  const spare = Math.min(1, row.copies / Math.pow(2, MAX_STARS))
  if (row.copies >= Math.pow(2, maxStars)) return { stars: row.stars, merged: false, spare }
  const copies = row.copies + 1
  const stars = starsFor(copies, maxStars)
  db.prepare(
    'UPDATE claims SET copies = ?, stars = ? WHERE player_id = ? AND character_id = ?',
  ).run(copies, stars, playerId, characterId)
  return { stars, merged: stars > row.stars, spare }
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
  /** How wide a net every roll on this instance casts. Set by the admin. */
  poolSize: number
  /** Bumped whenever the player's claims change. A device holding a stale
   *  collection refetches when this moves. */
  collectionRev: number
  /** Cards a pack deals, or 0 while the shop has not unlocked them yet. */
  packSize: number
  /** Packs torn at a single press. */
  packsPerPull: number
  /** Cards one press draws, ceiling applied. */
  cardsPerPull: number
  /** What one press costs: every card in the pull. */
  packPrice: number
  /** Milliseconds between automatic pulls, or 0 while the Automaton is unbought. */
  autoSpinMs: number
  /** The Automaton is switched on. Kept on the server so it survives a closed tab. */
  autoSpin: boolean
  /** Cards a second the opening animation manages (Swift Hands). */
  cardRate: number
  lastDailyAt: number
  dailyStreak: number
  totalRolls: number
  totalClaims: number
  badges: Badges
  upgrades: Upgrades
  settings: ServerSettings
  wishes: PoolPick[]
  /** Everything the works are doing right now (ADR 0014). */
  works: Works
  /** What one card is worth to this player: every payout is quoted against it. */
  creditsPerCard: number
  /** The series Called Shot is pointed at. */
  aimSeries: string | null
  board: { raids: Contract[]; commissions: Pinned[] }
  collection?: OwnedCharacter[]
  /** What the machine did while nobody was watching. Absent when it did nothing. */
  offline?: { pulls: number; credits: number; minutes: number }
  serverNow: number
}

export function snapshot(db: DB, player: Player, withCollection = false): Snapshot {
  const row = loadState(db, player.id)
  const settings: ServerSettings = JSON.parse(row.settings_json)
  const { badges, upgrades, fx } = loadoutOf(row)
  const size = packSizeFor(fx, !!player.sandbox_of)
  const perCard = creditsPerCard(row, fx)
  return {
    username: player.username,
    isAdmin: !!player.is_admin,
    sandbox: !!player.sandbox_of,
    sandboxAllowed: !!player.sandbox,
    credits: row.credits,
    poolSize: instancePool(db),
    collectionRev: row.collection_rev,
    packSize: size,
    packsPerPull: player.sandbox_of ? 1 : fx.packsPerPull,
    cardsPerPull: player.sandbox_of ? size : fx.cardsPerPull,
    packPrice: player.sandbox_of ? 0 : packCost(fx.cardsPerPull),
    autoSpinMs: player.sandbox_of ? 0 : fx.autoSpinMs,
    autoSpin: !!row.auto_spin,
    cardRate: fx.cardRate,
    lastDailyAt: row.last_daily_at,
    dailyStreak: row.daily_streak,
    totalRolls: row.total_rolls,
    totalClaims: row.total_claims,
    badges,
    upgrades,
    settings,
    wishes: wishesOf(db, player.id),
    works: {
      spares: Math.floor(row.spares),
      sparesPerScrap: fx.sparesPerScrap,
      sparesPerPull: row.auto_spares,
      scrap: Math.floor(row.scrap),
      belt: fx.belt,
      scrapWorth: fx.scrapWorth,
      // What the belt paid over one press at the current rate, which is the
      // number the Factory quotes. Derived rather than stored: it is a rate,
      // and a rate read off the last press is a rate that lies after an
      // upgrade is bought.
      factoryRate: Math.floor(Math.min(row.scrap, fx.belt) * perCard * fx.scrapWorth),
      reach: reachOf(db, player.id, row.collection_rev),
      caravans: fx.caravans,
      out: expeditionsOf(db, player.id),
    },
    creditsPerCard: perCard,
    aimSeries: row.aim_series,
    // Read rather than filled: `snapshot` is reached several times a second by
    // the Automaton, and topping the board up is a random pick over a
    // collection. The board only changes when somebody acts on it.
    board: boardOf(db, player.id, perCard, fx.cardsPerPull),
    collection: withCollection ? collectionOf(db, player.id, fx.sellMult, fx.mergeMult) : undefined,
    serverNow: Date.now(),
  }
}

export function fullState(db: DB, player: Player): Snapshot {
  // The one call every client makes on boot, which is exactly when the
  // Automaton's night's work should be counted and handed over.
  const away = settleOffline(db, player)
  // And the one place the board is topped up without the player asking.
  fillBoard(db, player.id)
  const snap = snapshot(db, player, true)
  return away ? { ...snap, offline: away } : snap
}

/**
 * Pay the Automaton for the time nobody was connected.
 *
 * It cannot deal cards to an empty room, so what it does out there is open
 * packs and sell them: `auto_yield` is a smoothed average of what a pull has
 * recently been worth to this player, and the machine is paid that per pull at
 * a fraction of its normal rate, for as many hours as Offline Earnings bought.
 * No cards are granted, nothing is drawn, and the whole settlement is three
 * multiplications -- a player who leaves for a week does not cost the instance
 * a week of rolls when they come back.
 *
 * "Away" means the whole account, not one tab. An account with a phone still
 * streaming is being played, however idle that phone is, so the clock only
 * runs from the moment the last device disconnects.
 */
export function settleOffline(
  db: DB,
  player: Player,
): { pulls: number; credits: number; minutes: number } | null {
  if (player.sandbox_of) return null
  const row = loadState(db, player.id)
  const { fx } = loadoutOf(row)
  const now = Date.now()
  const stamp = () =>
    db.prepare('UPDATE player_state SET auto_at = ? WHERE player_id = ?').run(now, player.id)
  if (!row.auto_spin || fx.autoSpinMs <= 0 || fx.offlineRate <= 0 || row.auto_yield <= 0) {
    stamp()
    return null
  }
  // Somebody is connected right now, so the account is not away. Move the
  // clock up rather than paying for time another device spent playing.
  if (streamsFor(player.id) > 0) {
    stamp()
    return null
  }
  const since = row.auto_at > 0 ? row.auto_at : now
  const elapsed = Math.min(Math.max(0, now - since), fx.offlineHours * HOUR)
  const period = fx.autoSpinMs / fx.offlineRate
  const pulls = Math.floor(elapsed / period)
  if (pulls <= 0) {
    // Not even one pull's worth: leave the clock where it is so the minutes
    // that have passed still count towards the next one.
    return null
  }
  const credits = Math.floor(pulls * row.auto_yield)
  if (credits <= 0) {
    stamp()
    return null
  }
  db.prepare(
    `UPDATE player_state SET credits = credits + ?, total_rolls = total_rolls + ?, auto_at = ?
      WHERE player_id = ?`,
  ).run(credits, pulls, now, player.id)
  /*
   * The tank fills while nobody is watching.
   *
   * Spares accrue away at the same rate they accrue present, so being away
   * never costs anything -- what it costs is the board, which only the player
   * or a machine on an open device ever plays (ADR 0013).
   */
  /*
   * The works run out there too, at the rate they run in here.
   *
   * Being away has never cost anything in this game and it does not start now:
   * spares accrue, the Press mills them, and the Factory's belt melts what it
   * can reach. The one thing that does not happen is a caravan moving, because
   * a caravan moves when you press and nobody was pressing.
   */
  press(db, player.id, pulls * row.auto_spares, fx, false)
  runFactory(db, player.id, pulls, fx, creditsPerCard(row, fx))
  return { pulls, credits, minutes: Math.round(elapsed / 60_000) }
}

/**
 * A device arrived, and it is the only one.
 *
 * Settles whatever the machine earned while the account had nobody connected,
 * then starts the clock again. Returns the payout so it can be pushed to the
 * device that just turned up rather than appearing silently in the balance.
 */
export function markOnline(db: DB, player: Player): Snapshot | null {
  const away = settleOffline(db, player)
  db.prepare('UPDATE player_state SET auto_at = ? WHERE player_id = ?').run(Date.now(), player.id)
  if (!away) return null
  return { ...snapshot(db, player), offline: away }
}

/** The last device left. Offline time runs from here. */
export function markOffline(db: DB, player: Player): void {
  db.prepare('UPDATE player_state SET auto_at = ? WHERE player_id = ?').run(Date.now(), player.id)
}

/** Switch the machine on or off. Stored server-side so a closed tab keeps it. */
export function setAutoSpin(db: DB, player: Player, on: boolean): Snapshot {
  const away = on ? null : settleOffline(db, player)
  db.prepare('UPDATE player_state SET auto_spin = ?, auto_at = ? WHERE player_id = ?').run(
    on ? 1 : 0,
    Date.now(),
    player.id,
  )
  const snap = snapshot(db, player, !!away)
  return away ? { ...snap, offline: away } : snap
}

/* -------------------------------------------------------------------- roll */

export interface RollResult {
  char: PoolPick
  owned: boolean
  wished: boolean
  compensation: number
  /** The star of the stack this card joined, if it joined one. */
  stars?: number
  /** Queued by the auto-sell setting: sold when the next summon starts. */
  willSell?: boolean
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
  /** Packs to tear. Zero is the free single card; more is capped at Both Hands. */
  packsWanted: number,
): {
  results: RollResult[]
  pack: boolean
  /** Stacks laid side by side on screen, each its own wrapper. */
  packCount: number
  /** Cards in each of those stacks that are dealt as real cards. */
  perPack: number
  /** Cards each of those packs actually holds: the number on the wrapper. */
  heldPerPack: number
  claimed: number
  bonus: number
  coins: number
  /** Cards this summon queued for auto-sell, to be sold when the next one starts. */
  queued: number
  /** Cards the *previous* summon's queue just sold, and what they fetched. */
  swept: number
  sweptFor: number
  merged: number
  /** Anything worth saying out loud about what was granted. */
  notes: string[]
  /** Copies past what a stack can still merge, milled on arrival. */
  spares: number
  /** Scrap the Press got out of them. */
  scrap: number
  /** Credits the Factory and the caravans paid on the back of this press. */
  melted: number
  /** Cards the pull held beyond what it dealt: opened by the machine, not seen. */
  hidden: number
  /** What those cards were appraised for. */
  hiddenFor: number
  snapshot: Snapshot
} {
  const row = loadState(db, player.id)
  const settings: ServerSettings = JSON.parse(row.settings_json)
  const { fx } = loadoutOf(row)
  const sandbox = !!player.sandbox_of
  const wanted = Math.max(0, Math.floor(packsWanted))
  const multi = wanted >= 1
  const packSize = packSizeFor(fx, sandbox)

  let total = 1
  let price = 0
  let packs = 1
  if (multi) {
    if (packSize <= 0) {
      fail('Packs are locked. The Sapphire badge in the shop opens them.')
    }
    if (sandbox) {
      total = SANDBOX_MAX_DRAW
    } else {
      // One pack or all of them, and never more than Both Hands has bought.
      packs = Math.max(1, Math.min(wanted, fx.packsPerPull))
      total = packSize * packs
      price = packCost(total)
      // A pack is what credits are for. The single summon is always free, so an
      // empty purse is never a dead end -- it just means selling something first.
      if (row.credits < price) {
        fail(`This pull costs ${price.toLocaleString()} credits. Sell something first.`)
      }
    }
  }
  // Sandbox bulk stays a plain spread: it is for looking at a hundred cards at
  // once, and a sealed wrapper is the opposite of that.
  const pack = multi && !sandbox

  /*
   * How much of the pull is actually dealt.
   *
   * Pack sizes compound without a ceiling, which is the point of the shop, so
   * past a few hundred cards a pull stops being something you look at. How much
   * of it you do look at is decided by Open Speed: six seconds of cards a
   * second, floored so nobody deals less than a couple of hundred and capped so
   * a spread is still a thing on a screen. The rest is opened by the machine
   * and appraised into credits at what the dealt cards averaged -- otherwise a
   * pull of a million cards would be a million rows written, a million images
   * mounted, and the same answer.
   */
  const budget = dealtFor(total, fx.cardRate, fx.maxDealt)
  const packCount = pack ? Math.min(packs, fx.maxStacks) : 1
  const perPack = pack
    ? Math.max(1, Math.min(packSize, Math.floor(budget / packCount)))
    : Math.min(total, budget)
  const dealt = pack ? packCount * perPack : perPack
  const overflow = Math.max(0, total - dealt)

  const ownedIds = new Set(
    (db.prepare('SELECT character_id FROM claims WHERE player_id = ?').all(player.id) as any[]).map(
      (r) => r.character_id as number,
    ),
  )
  const wishes = wishesOf(db, player.id)
  const openWishes = wishes.filter((w) => !ownedIds.has(w.id))

  const owner = settings.skipOwned ? player.id : null
  // The pool belongs to the instance, not the player: see `instancePool`.
  const poolSize = instancePool(db)
  const pool = drawFromPool(db, dealt, settings.rollGender, poolSize, owner)
  /*
   * Called Shot: a share of the pull comes from the series the player named.
   *
   * Spliced into the front of the pool rather than replacing it, so a pull is
   * still mostly the catalog. This is the only way in the game to collect on
   * purpose, and it exists because a raid asks for a series by name -- without
   * it the answer to "go and get more Frieren" is "keep pressing and hope".
   */
  if (fx.aimShare > 0 && row.aim_series) {
    const aimed = drawFromSeries(db, row.aim_series, Math.floor(dealt * fx.aimShare))
    if (aimed.length > 0) pool.unshift(...aimed)
  }
  if (pool.length === 0) {
    fail('The catalog has no characters matching your filters yet. Give the first crawl a minute.')
  }

  const results: RollResult[] = []
  const used = new Set<number>()
  let totalComp = 0
  let coinFound = 0
  let wishGranted = false

  for (let i = 0; i < dealt; i++) {
    let char: PoolPick | undefined
    let wished = false
    const stillOpen = wishGranted ? [] : openWishes.filter((w) => !used.has(w.id))
    const wishChance = Math.min(
      WISH_CHANCE_CAP * fx.wishChanceMult,
      stillOpen.length * WISH_BASE_CHANCE * fx.wishChanceMult,
    )
    if (stillOpen.length > 0 && Math.random() < wishChance) {
      char = stillOpen[Math.floor(Math.random() * stillOpen.length)]
      wished = true
      // One to a summon. Without this a big pack rolls the dice a hundred
      // times and empties the whole wishlist in one go.
      wishGranted = true
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

  // The Emerald guarantee, honoured pack by pack: every wrapper on screen
  // promises its own floor, because a promise that only covers the first of
  // four packs is not the promise the badge printed.
  if (pack && fx.guaranteeValue > 0 && fx.guaranteeCount > 0) {
    const walls = Array.from({ length: packCount }, (_, g) => [
      g * perPack,
      Math.min(results.length, (g + 1) * perPack),
    ])
    // Every wrapper's top-up, drawn together and only for what they are
    // actually short: a lucky pull still costs nothing.
    const short = walls.reduce((n, [from, to]) => n + shortfall(results, from, to, fx), 0)
    const lucky =
      short > 0
        ? guaranteePool(db, short, fx, settings, poolSize, owner, results.map((r) => r.char.id))
        : []
    for (const [from, to] of walls) {
      totalComp += guarantee(results, lucky, from, to, fx, ownedIds, wishes)
    }
  }

  /*
   * What the pull was worth beyond what it dealt.
   *
   * The dealt cards are the sample: the packs behind them came out of the same
   * pool, so their average is the honest price of the rest. Coins are settled
   * the same way, at their expected rate rather than a million dice rolls.
   */
  const avgValue =
    results.length > 0 ? results.reduce((n, r) => n + r.char.creditValue, 0) / results.length : 0
  const hiddenFor = Math.floor(overflow * avgValue * fx.sellMult)
  if (overflow > 0) {
    coinFound += Math.floor(
      overflow *
        Math.min(1, BASE_COIN_CHANCE + fx.coinChanceBonus) *
        COIN_BASE_MEAN *
        fx.coinValueMult,
    )
  }

  // Sapphire IV and VI: every pack turns coins up, whatever the per-card
  // chance did, and every pack in the pull counts -- not just the ones dealt.
  if (pack && fx.packCoins > 0) {
    for (let i = 0; i < packs * fx.packCoins; i++) coinFound += coinAmount(fx.coinValueMult)
  }
  const session: RollSession = { at: Date.now(), results }

  /*
   * What one press is worth, smoothed.
   *
   * Recorded on every real pack pull and read by `settleOffline`, so the
   * Automaton's night shift is paid at this player's actual rate: every badge,
   * every upgrade and the size of their own pool are already in the number.
   */
  const grossIfSold = total * avgValue * fx.sellMult
  const pullYield = Math.max(0, grossIfSold + coinFound - price)
  const now = Date.now()

  const opened = db.transaction(() => {
    // The last summon's queue is settled first: everything the player did not
    // lock while they were looking at it.
    const swept = sweepAutoSell(db, player, row, fx)
    // The price comes off first and on its own terms: another device may have
    // spent the balance between this request being read and this line running.
    if (!spend(db, player.id, price)) {
      fail(`This pull costs ${price.toLocaleString()} credits. Sell something first.`)
    }
    db.prepare(
      `UPDATE player_state SET credits = credits + ?, total_rolls = total_rolls + ?
        WHERE player_id = ?`,
    ).run(totalComp + coinFound + hiddenFor, results.length, player.id)
    if (pack) {
      db.prepare(
        `UPDATE player_state SET auto_yield = auto_yield * ? + ? * ?, auto_at = ?
          WHERE player_id = ?`,
      ).run(1 - YIELD_SMOOTHING, pullYield, YIELD_SMOOTHING, now, player.id)
    }
    // Remember what was already in the collection: takeAll marks everything it
    // hands over as owned, which would otherwise erase the difference between
    // a new card and a duplicate.
    const wasOwned = results.map((r) => r.owned)
    /*
     * Everything a summon turns up is granted, single card or hundredth pack.
     *
     * A pack always worked this way; the single summon asked for a button
     * press, which meant a free card could be lost to a closed tab and -- the
     * reason this changed -- that auto-sell never saw it. Auto-sell reads what
     * a player owns, and a card nobody had claimed was not owned yet, so the
     * one summon that is free and unlimited was the one it ignored.
     */
    const seriesPaid: Record<string, number> = JSON.parse(row.series_paid_json)
    const r = takeAll(db, player, session, fx, seriesPaid)
    results.forEach((entry, i) => {
      if (!wasOwned[i]) entry.fresh = true
    })
    db.prepare(
      `UPDATE player_state SET credits = credits + ?, total_claims = total_claims + ?,
              series_paid_json = ? WHERE player_id = ?`,
    ).run(r.bonus, r.claimed, JSON.stringify(seriesPaid), player.id)
    const queued = queueAutoSell(db, player, settings, session)
    /*
     * The works, on the back of the press that fed them.
     *
     * All three in one transaction and in this order: the Press mills what the
     * pull just shed, the Factory melts what the belt can reach, and every
     * caravan takes one step. A press is the unit the whole industry is
     * denominated in, so a press is where all of it happens.
     */
    const { scrap } = press(db, player.id, r.spares, fx, pack)
    const melt = runFactory(db, player.id, 1, fx, creditsPerCard(row, fx))
    const walked = walkCaravans(db, player.id, 1)
    touchCollection(db, player.id)
    return { ...r, ...swept, queued, scrap, melted: melt.paid + walked }
  })()

  return {
    results,
    pack,
    packCount,
    perPack,
    heldPerPack: pack ? packSize : perPack,
    claimed: opened.claimed,
    bonus: opened.bonus,
    coins: coinFound,
    queued: opened.queued,
    swept: opened.swept,
    sweptFor: opened.sweptFor,
    merged: opened.merged,
    // Wishes fulfilled, series sets completed, the Emerald dowry. A handful at
    // most: a pack of a hundred should not arrive with a hundred toasts.
    notes: opened.notes.slice(0, 4),
    /** Spare fractions this pull shed, milled on arrival (ADR 0014). */
    spares: opened.spares,
    /** Scrap the Press got out of them. */
    scrap: opened.scrap,
    /** Credits the Factory and the caravans paid on the back of this press. */
    melted: opened.melted,
    hidden: overflow,
    hiddenFor,
    /*
     * Without the collection.
     *
     * A pull used to answer with everything the player owns, which by the time
     * packs are worth pulling is thousands of characters, each with artwork,
     * aliases and covers: a megabyte and climbing, rebuilt and re-sent on every
     * press, and the Automaton presses several times a second. It was the
     * slowest part of a summon by a distance and nothing on the summon screen
     * reads it. The revision counter still moves, so the collection screen
     * knows to ask for a fresh copy the moment somebody looks at it.
     */
    snapshot: snapshot(db, player),
  }
}

/**
 * The tiers a guarantee falls through, best first.
 *
 * Never below Rare: at that point the promise is "a card", which is what a
 * pack is anyway.
 */
const GUARANTEE_LADDER = [
  RARITY_MIN.mythic,
  RARITY_MIN.legendary,
  RARITY_MIN.epic,
  RARITY_MIN.rare,
]

/**
 * What the wrappers are topped up from, drawn once for the whole pull.
 *
 * There are eleven Mythic characters in existence. The tier starts around
 * twenty-six thousand favourites and the most-favourited character alive has
 * forty-three thousand, so it is eleven people, not eleven per catalog.
 * Emerald VI asks for three a wrapper and Extra Packs puts twenty-four
 * wrappers on the screen, which is a promise of seventy-two against a supply
 * of eleven: the first four wrappers took every Mythic in the world and the
 * other twenty got nothing, every pull, for good.
 *
 * The promise is kept at the best tier the catalog can still supply instead --
 * Mythic while they last, then Legendary, then Epic -- so every wrapper is
 * topped up with something. Shuffled afterwards, because which wrapper the
 * Mythics land in should not be a fact anybody can learn.
 */
function guaranteePool(
  db: DB,
  want: number,
  fx: ReturnType<typeof computeEffects>,
  settings: ServerSettings,
  poolSize: number,
  owner: number | null,
  dealt: number[],
): PoolPick[] {
  const taken: PoolPick[] = []
  const exclude = [...dealt]
  for (const floor of GUARANTEE_LADDER) {
    if (taken.length >= want) break
    // Never above what the badge promised: Emerald I does not quietly deal
    // Mythics because the catalog happens to have some.
    if (floor > fx.guaranteeValue) continue
    const got = drawAboveValue(
      db,
      floor,
      settings.rollGender,
      poolSize,
      exclude,
      owner,
      want - taken.length,
    )
    // Each rung includes the one above it, so what is already taken has to be
    // excluded or the Mythics come back around as Legendaries.
    for (const c of got) {
      taken.push(c)
      exclude.push(c.id)
    }
  }
  for (let i = taken.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[taken[i], taken[j]] = [taken[j], taken[i]]
  }
  return taken
}

/** How many cards a wrapper is short of the floor its badge printed. */
function shortfall(
  results: RollResult[],
  from: number,
  to: number,
  fx: ReturnType<typeof computeEffects>,
): number {
  let good = 0
  for (let i = from; i < to; i++) if (results[i].char.creditValue >= fx.guaranteeValue) good++
  return Math.max(0, Math.min(fx.guaranteeCount, to - from) - good)
}

/**
 * Make one pack keep its promise.
 *
 * Applied to the dealt cards rather than to the pool they came from, because a
 * wish can barge in after the draw and take the guaranteed card's place --
 * checking the pool would promise a Legendary and hand over nine commons and a
 * wish. It swaps the weakest cards rather than adding any, so a guarantee never
 * quietly makes a pack bigger; it never displaces a wish that came true, which
 * is the one card in a pack somebody was actually waiting for; and it is
 * skipped when the catalog holds nobody good enough, because an instance an
 * hour into its first crawl owes nobody a Mythic.
 *
 * Returns the change in duplicate compensation the swaps caused.
 */
function guarantee(
  results: RollResult[],
  /** The pull's guaranteed cards, drawn together. Taken from as needed. */
  lucky: PoolPick[],
  from: number,
  to: number,
  fx: ReturnType<typeof computeEffects>,
  ownedIds: Set<number>,
  wishes: PoolPick[],
): number {
  let delta = 0
  // A top-up from further down the ladder does not itself clear the promised
  // floor, so without this the next pass would pick it as the worst card in
  // the wrapper and swap it straight back out.
  const filled = new Set<number>()
  for (let n = shortfall(results, from, to, fx); n > 0; n--) {
    let worst = -1
    for (let i = from; i < to; i++) {
      if (results[i].wished || filled.has(i)) continue
      if (results[i].char.creditValue >= fx.guaranteeValue) continue
      if (worst < 0 || results[i].char.creditValue < results[worst].char.creditValue) worst = i
    }
    if (worst < 0) return delta
    const pick = lucky[lucky.length - 1]
    if (!pick) return delta
    // A rung or two down the ladder a top-up can be worth less than the card
    // it would replace. Leave it for a wrapper it actually improves.
    if (pick.creditValue <= results[worst].char.creditValue) return delta
    lucky.pop()
    filled.add(worst)
    const owned = ownedIds.has(pick.id)
    const compensation = owned ? duplicateCompensation(pick.creditValue, fx.dupCompMult) : 0
    delta += compensation - results[worst].compensation
    results[worst] = {
      char: pick,
      owned,
      wished: wishes.some((w) => w.id === pick.id),
      compensation,
    }
  }
  return delta
}

/* ------------------------------------------------------------------- claim */

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

/**
 * The Press.
 *
 * Flat per spare, and never by credit value. Paying by value would make
 * feeding spare Mythics the optimal play and a player would shred their best
 * stacks to feed a machine, which is the "send the Mythics" failure wearing an
 * apron. A flat rate denominates the works in *presses*, and a press deals a
 * bounded number of cards however large the pull is, so nothing the credit
 * curve does can inflate the stream the Factory runs on (ADR 0014).
 *
 * The remainder is kept rather than rounded away: a spare that fell short of a
 * whole scrap is still a spare, and losing it would make the rate a lie. That
 * goes for fractions of one too, since a copy sheds as much scrap as its stack
 * is deep -- a collection turning up a third of a spare a press has to be able
 * to reach its first scrap, and rounding every press to nothing would leave it
 * there forever. The snapshot quotes whole spares; the tank keeps what is left.
 */
function press(
  db: DB,
  playerId: number,
  spares: number,
  fx: ReturnType<typeof computeEffects>,
  smooth: boolean,
): { scrap: number } {
  if (spares <= 0 && !smooth) return { scrap: 0 }
  const row = db
    .prepare('SELECT spares FROM player_state WHERE player_id = ?')
    .get(playerId) as { spares: number }
  const pot = row.spares + Math.max(0, spares)
  const scrap = Math.floor(pot / fx.sparesPerScrap)
  db.prepare(
    `UPDATE player_state SET spares = ?, scrap = scrap + ?,
            auto_spares = CASE WHEN ? THEN auto_spares * ? + ? * ? ELSE auto_spares END
      WHERE player_id = ?`,
  ).run(
    pot - scrap * fx.sparesPerScrap,
    scrap,
    smooth ? 1 : 0,
    1 - YIELD_SMOOTHING,
    Math.max(0, spares),
    YIELD_SMOOTHING,
    playerId,
  )
  return { scrap }
}

/**
 * The Factory.
 *
 * Eats scrap off the yard at the belt's rate and pays credits for it. Runs on
 * every press and, through `settleOffline`, on every hour nobody was here --
 * it is the faucet that does not need a hand on the button, which is the whole
 * of how it differs from the summon.
 *
 * Its input is flat and its rate is exponential: the belt can only pull what
 * the Press made, and what a scrap is *worth* is an endless shop line. So the
 * Factory can never outrun the collection that feeds it, and it can always be
 * made worth pouring credits into. That is the shape the second currency was
 * invented to get, reached without inventing one (ADR 0014).
 */
function runFactory(
  db: DB,
  playerId: number,
  presses: number,
  fx: ReturnType<typeof computeEffects>,
  perCard: number,
): { melted: number; paid: number } {
  if (presses <= 0) return { melted: 0, paid: 0 }
  const row = db
    .prepare('SELECT scrap FROM player_state WHERE player_id = ?')
    .get(playerId) as { scrap: number }
  const melted = Math.min(row.scrap, fx.belt * presses)
  if (melted <= 0) return { melted: 0, paid: 0 }
  // `fx.scrapWorth` is already the Foundry's multiple, so the level is spent.
  const paid = Math.floor(melted * perCard * fx.scrapWorth)
  db.prepare(
    'UPDATE player_state SET scrap = scrap - ?, credits = credits + ? WHERE player_id = ?',
  ).run(melted, paid, playerId)
  return { melted, paid }
}

/**
 * Walk every caravan on the road, and pay the waypoints they passed.
 *
 * Distance is counted in presses, not minutes: ADR 0004 took every clock out
 * of this game, and an expedition on a timer is that mistake wearing a hat. A
 * player who closes the tab for a week comes back to a caravan exactly where
 * they left it, and it moves the moment they press again.
 *
 * Waypoints pay themselves along the way so a long route is not five thousand
 * presses of nothing; the last one waits for a hand, because arriving is the
 * part worth watching.
 */
function walkCaravans(db: DB, playerId: number, presses: number): number {
  if (presses <= 0) return 0
  const rows = db
    .prepare('SELECT * FROM expeditions WHERE player_id = ?')
    .all(playerId) as ExpeditionRow[]
  let paid = 0
  for (const e of rows) {
    const route = ROUTES.find((r) => r.key === e.route)
    if (!route) continue
    const walked = Math.min(route.distance, e.walked + presses)
    // The final waypoint is the arrival, and the arrival is collected by hand.
    const passed = Math.min(WAYPOINTS - 1, waypointsPassed(route, walked))
    const owed = passed > e.paid ? Math.floor((e.bounty / WAYPOINTS) * (passed - e.paid)) : 0
    if (walked === e.walked && owed <= 0) continue
    db.prepare('UPDATE expeditions SET walked = ?, paid = ? WHERE id = ?').run(
      walked,
      Math.max(e.paid, passed),
      e.id,
    )
    if (owed > 0) {
      db.prepare('UPDATE player_state SET credits = credits + ? WHERE player_id = ?').run(
        owed,
        playerId,
      )
      paid += owed
    }
  }
  return paid
}

type ExpeditionRow = {
  id: number
  route: string
  walked: number
  paid: number
  bounty: number
}

function expeditionsOf(db: DB, playerId: number): Expedition[] {
  return db
    .prepare('SELECT id, route, walked, paid, bounty FROM expeditions WHERE player_id = ? ORDER BY id')
    .all(playerId) as Expedition[]
}

/** The last series milestone. Past it a series has nothing left to pay. */
const LAST_SERIES_MILESTONE = SERIES_MILESTONES.reduce((n, m) => Math.max(n, m.count), 0)

/** How many of each series a player holds, in one pass over their claims. */
function seriesCounts(db: DB, playerId: number): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT c.series AS series, COUNT(*) AS n FROM claims cl
         JOIN characters c ON c.id = cl.character_id
        WHERE cl.player_id = ? GROUP BY c.series`,
    )
    .all(playerId) as { series: string; n: number }[]
  return new Map(rows.map((r) => [r.series, r.n]))
}

/**
 * Take every unowned card of a summon at once.
 *
 * Must be called inside a transaction: it writes claims, series payouts and
 * the session's own bookkeeping together.
 */
function takeAll(
  db: DB,
  player: Player,
  session: RollSession,
  fx: ReturnType<typeof computeEffects>,
  seriesPaid: Record<string, number>,
): { claimed: number; bonus: number; merged: number; spares: number; notes: string[] } {
  const now = Date.now()
  let claimed = 0
  let bonus = 0
  let merged = 0
  let spares = 0
  const notes: string[] = []
  /*
   * How many of each series the player already holds.
   *
   * A series pays out at three, five and ten of it, and stops. Past the last
   * milestone the count cannot change what anybody is owed, so a collection
   * deep enough to have finished every series it touches never asks -- and
   * when it does ask, it asks once for the whole pull and counts the rest of
   * it in memory.
   *
   * This was a join per new card: claims joined to the catalog, filtered to
   * one series, for every card of the pull that was not already owned. At a
   * pull of a thousand cards against a collection of sixty-five thousand it
   * was eight seconds of a nine-second summon.
   */
  const open = session.results.some(
    (e) => (seriesPaid[e.char.series] ?? 0) < LAST_SERIES_MILESTONE,
  )
  const held = open ? seriesCounts(db, player.id) : null
  for (const entry of session.results) {
    const owns = db
      .prepare('SELECT 1 FROM claims WHERE player_id = ? AND character_id = ?')
      .get(player.id, entry.char.id)
    if (owns) {
      // A duplicate is a copy, not a consolation. It goes on the stack, and if
      // that doubles the stack it merges a star higher.
      const r = addCopy(db, player.id, entry.char.id, fx.maxStars)
      if (r.merged) merged++
      spares += r.spare
      entry.stars = r.stars
      continue
    }
    db.prepare(
      'INSERT INTO claims (player_id, character_id, claimed_at, credit_value) VALUES (?, ?, ?, ?)',
    ).run(player.id, entry.char.id, now, entry.char.creditValue)
    claimed++
    // The row just written counts, same as the query it replaced counted it.
    let inSeries = 0
    if (held) {
      inSeries = (held.get(entry.char.series) ?? 0) + 1
      held.set(entry.char.series, inSeries)
    }
    const paid = payClaimBonuses(entry.char, entry.wished, fx, seriesPaid, inSeries)
    bonus += paid.bonus
    notes.push(...paid.notes)
    entry.owned = true
    entry.compensation = 0
  }
  return { claimed, bonus, merged, spares, notes }
}

/**
 * Queue what the player asked not to be bothered with.
 *
 * Nothing is sold on arrival any more. A card that lands below the auto-sell
 * floor is written down as a candidate and sold when the *next* summon starts,
 * which is the whole gap in which a player can look at a spread and lock
 * anything they want to keep. Selling on arrival meant auto-sell and the lock
 * button could not both exist: by the time you saw the card it was money.
 *
 * Only ever single copies: a stack is the one thing in this game worth
 * holding, so nothing that has started to merge is ever queued, and neither is
 * a wish come true.
 */
function queueAutoSell(
  db: DB,
  player: Player,
  settings: ServerSettings,
  session: RollSession,
): number {
  const floor = autoSellFloor(settings.autoSell)
  const ids = new Set<number>()
  if (floor > 0) {
    for (const entry of session.results) {
      if (entry.wished) continue
      if (entry.char.creditValue >= floor) continue
      entry.willSell = true
      ids.add(entry.char.id)
    }
  }
  db.prepare('UPDATE player_state SET pending_sell_json = ? WHERE player_id = ?').run(
    ids.size > 0 ? JSON.stringify([...ids]) : null,
    player.id,
  )
  return ids.size
}

/**
 * Sell the last summon's queue.
 *
 * Locked characters are skipped and stay skipped -- the queue is a list of
 * candidates, and the lock is checked here rather than when the card landed,
 * so locking something works right up until the moment the next summon starts.
 * So is merging: a card that found a partner in the meantime is a stack now.
 */
function sweepAutoSell(
  db: DB,
  player: Player,
  row: StateRow,
  fx: ReturnType<typeof computeEffects>,
): { swept: number; sweptFor: number } {
  const none = { swept: 0, sweptFor: 0 }
  if (!row.pending_sell_json) return none
  let list: number[] = []
  try {
    list = JSON.parse(row.pending_sell_json)
  } catch {
    list = []
  }
  db.prepare('UPDATE player_state SET pending_sell_json = NULL WHERE player_id = ?').run(player.id)
  if (list.length === 0) return none
  const holes = list.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT character_id, credit_value FROM claims
        WHERE player_id = ? AND locked = 0 AND copies = 1 AND stars = 0
          AND character_id IN (${holes})`,
    )
    .all(player.id, ...list) as { character_id: number; credit_value: number }[]
  if (rows.length === 0) return none
  const total = rows.reduce((n, r) => n + Math.round(r.credit_value * fx.sellMult), 0)
  const sold = rows.map((r) => r.character_id)
  const soldHoles = sold.map(() => '?').join(',')
  db.prepare(`DELETE FROM claims WHERE player_id = ? AND character_id IN (${soldHoles})`).run(
    player.id,
    ...sold,
  )
  db.prepare('UPDATE player_state SET credits = credits + ? WHERE player_id = ?').run(total, player.id)
  return { swept: rows.length, sweptFor: total }
}

/** Keep a character, or stop keeping it. A locked stack is never sold. */
export function setLocked(db: DB, player: Player, characterId: number, locked: boolean): Snapshot {
  const changed = db
    .prepare('UPDATE claims SET locked = ? WHERE player_id = ? AND character_id = ?')
    .run(locked ? 1 : 0, player.id, characterId).changes
  if (changed === 0) fail('You do not own that.')
  touchCollection(db, player.id)
  return snapshot(db, player, true)
}

/* ------------------------------------------------------- economy and timers */

export function claimDaily(db: DB, player: Player): { snapshot: Snapshot; amount: number; streak: number } {
  const row = loadState(db, player.id)
  const { fx } = loadoutOf(row)
  const now = Date.now()
  if (!player.sandbox_of && now - row.last_daily_at < DAILY_INTERVAL_H * HOUR) {
    fail('The daily offering is not ready yet.')
  }
  const streak = now - row.last_daily_at <= DAILY_STREAK_WINDOW_H * HOUR ? row.daily_streak + 1 : 1
  // A hundred credits is a morning's play on day one and a rounding error by
  // the end of the week, so the offering is also quoted in pulls: half a
  // minute of the Automaton's work, whatever that has come to be worth.
  const amount = Math.max(
    dailyAmount(streak, fx.dailyMult),
    Math.floor(row.auto_yield * 30 * fx.dailyMult),
  )
  db.prepare(
    'UPDATE player_state SET credits = credits + ?, last_daily_at = ?, daily_streak = ? WHERE player_id = ?',
  ).run(amount, now, streak, player.id)
  return { snapshot: snapshot(db, player), amount, streak }
}

/**
 * Ids a statement may name at once.
 *
 * SQLite compiles at most 32766 bound parameters into one statement, and a
 * collection outgrows that: selling sixty-five thousand characters asked for a
 * statement SQLite refuses to compile, and because nothing on the way back up
 * distinguished that from any other server error, the answer to "sell my
 * collection" was that nothing happened at all.
 *
 * The last bite is padded with an id no character has, so every bite is the
 * same statement and the query is compiled once instead of once a bite.
 */
const SELL_BITE = 900

function bites(ids: number[]): number[][] {
  const parts: number[][] = []
  for (let i = 0; i < ids.length; i += SELL_BITE) {
    const part = ids.slice(i, i + SELL_BITE)
    while (part.length < SELL_BITE) part.push(-1)
    parts.push(part)
  }
  return parts
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
  const parts = bites(ids)
  const holes = Array(SELL_BITE).fill('?').join(',')
  const find = db.prepare(
    `SELECT character_id, credit_value, copies, stars FROM claims
      WHERE player_id = ? AND locked = 0 AND character_id IN (${holes})`,
  )
  const rows = parts.flatMap((part) => find.all(player.id, ...part)) as {
    character_id: number
    credit_value: number
    copies: number
    stars: number
  }[]
  if (rows.length === 0) fail('Nothing there to sell — locked, or not yours.')
  const { fx } = loadoutOf(loadState(db, player.id))
  // A stack sells whole, at what the merge made it worth. Selling half a stack
  // would mean un-merging it, and a star that can be taken apart again is a
  // currency rather than a keepsake.
  const total = rows.reduce(
    (n, r) => n + Math.round(stackValue(r.credit_value, r.copies, r.stars, fx.mergeMult) * fx.sellMult),
    0,
  )
  // The same bites, and the same `locked = 0`: what is deleted is exactly what
  // was priced, and a locked card that happened to be in the list survives.
  const drop = db.prepare(
    `DELETE FROM claims WHERE player_id = ? AND locked = 0 AND character_id IN (${holes})`,
  )
  db.transaction(() => {
    for (const part of parts) drop.run(player.id, ...part)
    db.prepare('UPDATE player_state SET credits = credits + ? WHERE player_id = ?').run(total, player.id)
    touchCollection(db, player.id)
  })()
  // Without the collection, for the same reason a summon answers without it:
  // what is left of sixty-five thousand characters is megabytes, the revision
  // counter moved, and the collection screen is already asking for a fresh copy.
  return { snapshot: snapshot(db, player), total, sold: rows.length }
}

/* ---------------------------------------------------------------- the board */

/** How many characters of a series the catalog holds. */
function castOf(db: DB, series: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM characters WHERE series = ?').get(series) as { n: number }
  ).n
}

/**
 * How much of a series the player holds at a given depth.
 *
 * Series-first, so it walks the cast of one series and probes the claims key,
 * rather than walking a collection of sixty-five thousand (ADR 0011).
 */
function heldIn(db: DB, playerId: number, series: string, depth: number): number {
  /*
   * Written as an EXISTS over the *catalog* rather than a join, so the series
   * is always the driving table whatever the planner believes. A join here
   * reads identically and was measured at 12.9ms against 0.1ms, because
   * without statistics SQLite drove it from a collection of sixty-five
   * thousand claims instead of from the twenty-five characters of one series.
   */
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM characters c
          WHERE c.series = @series
            AND EXISTS (SELECT 1 FROM claims cl
                         WHERE cl.player_id = @player AND cl.character_id = c.id
                           AND cl.stars >= @depth)`,
      )
      .get({ player: playerId, series, depth }) as { n: number }
  ).n
}

/**
 * A series worth raiding.
 *
 * Mostly somewhere the player already has a foothold, sometimes not: a board
 * of series you are already deep in is answerable and boring, and a board
 * drawn from ten thousand series at random is noise. The minority that reach
 * past what you own are the whole reason the board doubles as a to-do list
 * (ADR 0013).
 */
function pickSeries(db: DB, playerId: number): string | null {
  const claims = (
    db.prepare('SELECT COUNT(*) AS n FROM claims WHERE player_id = ?').get(playerId) as { n: number }
  ).n
  const cat = db.prepare('SELECT MIN(id) AS lo, MAX(id) AS hi FROM characters').get() as {
    lo: number | null
    hi: number | null
  }
  if (cat.lo === null || cat.hi === null) return null

  for (let tries = 0; tries < 8; tries++) {
    /*
     * Mostly a series with a foothold: a demand on a cast you own nothing of
     * can only be answered by pointing Called Shot at it, and Called Shot is
     * six levels deep in a tree this pays for. A few are still worth posting,
     * because `fitTier` puts those on the cheapest rung and they are how a new
     * series gets started.
     */
    const known = claims > 0 && Math.random() < 0.85
    const row = known
      ? claimAt(db, playerId, Math.floor(Math.random() * claims))
      : characterAt(db, cat.lo + Math.floor(Math.random() * (cat.hi - cat.lo + 1)))
    if (!row?.series || row.series === 'Unknown series') continue
    const cast = castOf(db, row.series)
    if (cast >= MIN_CAST && cast <= MAX_CAST) return row.series
  }
  return null
}

type SeriesRow = { series: string } | undefined

/**
 * The player's `nth` claim, counting rather than seeking.
 *
 * This used to seek to a random point in the claims key and take the next row,
 * which is the same pick only if the claims are evenly spread through the
 * catalog's ids -- and they never are. A collection is dense where the player
 * has been collecting and almost empty everywhere else, and a key seek weights
 * a row by the *gap* in front of it, so the sparse end of the catalog won
 * nearly every draw: the board filled with series the player held one
 * character of and `fitTier` had nothing to work with.
 *
 * Counting weights every claim equally, which weights a series by how much of
 * its cast the player actually holds -- exactly the thing a raid asks about.
 * The offset walks the claims primary key, which covers this query, so no row
 * is read to be skipped.
 */
function claimAt(db: DB, playerId: number, nth: number): SeriesRow {
  const row = db
    .prepare(
      'SELECT character_id AS id FROM claims WHERE player_id = ? ORDER BY character_id LIMIT 1 OFFSET ?',
    )
    .get(playerId, nth) as { id: number } | undefined
  if (!row) return undefined
  return db.prepare('SELECT series FROM characters WHERE id = ?').get(row.id) as SeriesRow
}

/** Any catalog entry at or after `from`. */
function characterAt(db: DB, from: number): SeriesRow {
  return db
    .prepare('SELECT series FROM characters WHERE id >= ? ORDER BY id LIMIT 1')
    .get(from) as SeriesRow
}

/**
 * What the player holds in one series at every rung's depth, in one pass.
 *
 * Five `heldIn` calls would answer the same question and cost five b-tree
 * walks of the same cast; the conditional sums walk it once. Driven from
 * `characters` for the reason `heldIn` is: the series is a few dozen rows and
 * the collection is sixty-five thousand.
 */
function depthProfile(db: DB, playerId: number, series: string): number[] {
  const cols = DEPTH_BY_TIER.map(
    (d, i) => `SUM(CASE WHEN cl.stars >= ${d} THEN 1 ELSE 0 END) AS t${i}`,
  ).join(', ')
  const row = db
    .prepare(
      `SELECT ${cols} FROM characters c
         JOIN claims cl ON cl.character_id = c.id AND cl.player_id = @player
        WHERE c.series = @series`,
    )
    .get({ player: playerId, series }) as Record<string, number | null>
  return DEPTH_BY_TIER.map((_, i) => row[`t${i}`] ?? 0)
}

/**
 * The faces that answer a raid: who actually went out.
 *
 * The muster is the whole reason this is a mechanic rather than a ledger
 * entry, and a muster needs bodies. Deepest first, because the stack that took
 * four thousand copies to build is the one worth showing.
 */
function rosterFor(db: DB, playerId: number, series: string, depth: number): Musterer[] {
  return db
    .prepare(
      `SELECT c.id AS id, c.name AS name, c.image AS image, cl.stars AS stars
         FROM characters c
         JOIN claims cl ON cl.character_id = c.id AND cl.player_id = @player
        WHERE c.series = @series AND cl.stars >= @depth
        ORDER BY cl.stars DESC, cl.copies DESC
        LIMIT @limit`,
    )
    .all({ player: playerId, series, depth, limit: MUSTER_FACES }) as Musterer[]
}

/** Post one new contract. Returns false when the catalog cannot fill the board. */
function postRaid(db: DB, playerId: number): boolean {
  const series = pickSeries(db, playerId)
  if (!series) return false
  const cast = castOf(db, series)
  const tier = fitTier(cast, depthProfile(db, playerId, series), Math.random())
  const { breadth, depth } = demandFor(cast, tier)
  // Stored in presses, multiplied out at payout time. See `contractPresses`:
  // a flat credit reward is a fortune at ten thousand and a rounding error at
  // a quadrillion, and this board has to mean something at both ends.
  const presses = contractPresses(contractWork(breadth, depth))
  db.prepare(
    `INSERT INTO raids (player_id, series, breadth, depth, cost, reward, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  ).run(playerId, series, breadth, depth, presses, Date.now())
  return true
}

/**
 * Top the board back up to full.
 *
 * Only ever called when a player has acted on it, or on boot -- never from
 * `snapshot`, which the Automaton reaches several times a second and which has
 * no business running a random pick over a collection.
 */
function fillBoard(db: DB, playerId: number): void {
  for (let guard = 0; guard < RAID_BOARD * 2; guard++) {
    const open = (
      db
        .prepare('SELECT COUNT(*) AS n FROM raids WHERE player_id = ? AND accepted_at IS NULL')
        .get(playerId) as { n: number }
    ).n
    if (open >= RAID_BOARD) return
    if (!postRaid(db, playerId)) return
  }
}

type RaidRow = {
  id: number
  series: string
  breadth: number
  depth: number
  /** Presses this is worth. Multiplied by the player's own rate on the way out. */
  reward: number
  accepted_at: number | null
}

function withHeld(db: DB, playerId: number, r: RaidRow, perCard: number, cards: number): Contract {
  return {
    id: r.id,
    series: r.series,
    breadth: r.breadth,
    depth: r.depth,
    reward: Math.floor(r.reward * perCard * cards),
    held: heldIn(db, playerId, r.series, r.depth),
  }
}

export function boardOf(
  db: DB,
  playerId: number,
  perCard: number,
  cards: number,
): { raids: Contract[]; commissions: Pinned[] } {
  const rows = db
    .prepare('SELECT * FROM raids WHERE player_id = ? ORDER BY id')
    .all(playerId) as RaidRow[]
  const raids: Contract[] = []
  const commissions: Pinned[] = []
  for (const r of rows) {
    if (r.accepted_at === null) raids.push(withHeld(db, playerId, r, perCard, cards))
    else commissions.push({ ...withHeld(db, playerId, r, perCard, cards), acceptedAt: r.accepted_at })
  }
  return { raids, commissions }
}

function raidRow(db: DB, playerId: number, id: number): RaidRow {
  const row = db
    .prepare('SELECT * FROM raids WHERE id = ? AND player_id = ?')
    .get(id, playerId) as RaidRow | undefined
  if (!row) fail('That raid is no longer on the board.')
  return row!
}

/**
 * What answering a demand pays, and who went out to earn it.
 *
 * The roster is not used by any rule -- it is what the muster draws. A payout
 * the player never sees happen is a number in a corner, and the point of this
 * whole page was that summoning has a ritual and this did not.
 */
export interface RaidPayout {
  snapshot: Snapshot
  reward: number
  series: string
  breadth: number
  depth: number
  roster: Musterer[]
}

/**
 * Fulfil a contract.
 *
 * Nothing is gambled and nothing is spent: the board shows what you hold
 * against what it wants, so one you cannot fulfil is refused rather than taken
 * and lost. It used to cost Scrip, which made the board a toll gate on the
 * upgrade tree; it is a goal board now and goals are free to attempt
 * (ADR 0014). What it costs is having built the collection.
 */
export function attemptRaid(db: DB, player: Player, id: number): RaidPayout {
  const row = raidRow(db, player.id, id)
  if (row.accepted_at !== null) fail('That one is pinned. Collect it instead.')
  const held = heldIn(db, player.id, row.series, row.depth)
  if (held < row.breadth) {
    fail(`${row.series} needs ${row.breadth} at ★${row.depth}. You have ${held}.`)
  }
  const state = loadState(db, player.id)
  const { fx } = loadoutOf(state)
  const paid = Math.floor(row.reward * creditsPerCard(state, fx) * fx.cardsPerPull)
  // Read before the delete: after it, the contract has no series to muster from.
  const roster = rosterFor(db, player.id, row.series, row.depth)
  db.transaction(() => {
    db.prepare('UPDATE player_state SET credits = credits + ? WHERE player_id = ?').run(
      paid,
      player.id,
    )
    db.prepare('DELETE FROM raids WHERE id = ?').run(row.id)
    fillBoard(db, player.id)
  })()
  return {
    snapshot: snapshot(db, player),
    reward: paid,
    series: row.series,
    breadth: row.breadth,
    depth: row.depth,
    roster,
  }
}

/**
 * Take a raid on rather than answer it.
 *
 * Only ever one you cannot currently answer, which is what makes the two
 * different: a raid is a test of what you hold and a commission is what you go
 * and get. It costs no Scrip and pays more Renown, and what it costs instead
 * is a slot -- scarcity here is slots, not clocks, because ADR 0004 took every
 * timer out of this game.
 */
export function acceptCommission(db: DB, player: Player, id: number): Snapshot {
  const row = raidRow(db, player.id, id)
  if (row.accepted_at !== null) fail('That one is already taken.')
  const taken = (
    db
      .prepare('SELECT COUNT(*) AS n FROM raids WHERE player_id = ? AND accepted_at IS NOT NULL')
      .get(player.id) as { n: number }
  ).n
  if (taken >= COMMISSION_SLOTS) fail(`All ${COMMISSION_SLOTS} commission slots are full.`)
  if (heldIn(db, player.id, row.series, row.depth) >= row.breadth) {
    fail('You can already answer that one. Raid it.')
  }
  db.transaction(() => {
    db.prepare('UPDATE raids SET accepted_at = ?, reward = ? WHERE id = ?').run(
      Date.now(),
      Math.max(1, Math.round(row.reward * COMMISSION_BONUS)),
      row.id,
    )
    fillBoard(db, player.id)
  })()
  return snapshot(db, player)
}

/** Collect a commission the collection has grown into. */
export function claimCommission(db: DB, player: Player, id: number): RaidPayout {
  const row = raidRow(db, player.id, id)
  if (row.accepted_at === null) fail('That one has not been taken on.')
  const held = heldIn(db, player.id, row.series, row.depth)
  if (held < row.breadth) {
    fail(`${row.series} needs ${row.breadth} at ★${row.depth}. You have ${held}.`)
  }
  const roster = rosterFor(db, player.id, row.series, row.depth)
  db.transaction(() => {
    db.prepare('UPDATE player_state SET renown = renown + ? WHERE player_id = ?').run(
      row.reward,
      player.id,
    )
    db.prepare('DELETE FROM raids WHERE id = ?').run(row.id)
  })()
  return {
    snapshot: snapshot(db, player),
    reward: row.reward,
    series: row.series,
    breadth: row.breadth,
    depth: row.depth,
    roster,
  }
}

/** Give a commission back. The slot is the cost, so this is how you pay it back. */
export function abandonCommission(db: DB, player: Player, id: number): Snapshot {
  const row = raidRow(db, player.id, id)
  if (row.accepted_at === null) fail('That one has not been taken on.')
  db.prepare('DELETE FROM raids WHERE id = ?').run(row.id)
  return snapshot(db, player)
}

/** Point Called Shot at a series, or at nothing. */
export function setAim(db: DB, player: Player, series: string | null): Snapshot {
  const clean = series && series.trim().length > 0 ? series.trim().slice(0, 200) : null
  if (clean && castOf(db, clean) === 0) fail('Nobody from that series is in the catalog.')
  db.prepare('UPDATE player_state SET aim_series = ? WHERE player_id = ?').run(clean, player.id)
  return snapshot(db, player)
}

/**
 * Outfit a caravan and send it down a route.
 *
 * Costs scrap up front and pays credits at the far end, and the whole bounty
 * is fixed here rather than at arrival: a route quoted at a hundred million
 * that pays out at whatever the player's rate happens to be a week later is a
 * route nobody can price. What you were promised is what comes home.
 */
export function sendExpedition(db: DB, player: Player, key: string): Snapshot {
  const route = ROUTES.find((r) => r.key === key)
  if (!route) fail('No such route.')
  const row = loadState(db, player.id)
  const { fx } = loadoutOf(row)
  const out = (
    db.prepare('SELECT COUNT(*) AS n FROM expeditions WHERE player_id = ?').get(player.id) as {
      n: number
    }
  ).n
  if (out >= fx.caravans) {
    fail(`All ${fx.caravans} caravan${fx.caravans === 1 ? '' : 's'} are on the road.`)
  }
  const reach = reachOf(db, player.id, row.collection_rev)
  if (reach < route!.reach) {
    fail(`${route!.name} needs ${route!.reach.toLocaleString()} characters. You hold ${reach.toLocaleString()}.`)
  }
  if (row.scrap < route!.scrap) {
    fail(`${route!.name} costs ${route!.scrap.toLocaleString()} scrap. You have ${Math.floor(row.scrap).toLocaleString()}.`)
  }
  const bounty = routePay(route!, creditsPerCard(row, fx), fx.scrapWorth, fx.outfit)
  db.transaction(() => {
    db.prepare('UPDATE player_state SET scrap = scrap - ? WHERE player_id = ?').run(
      route!.scrap,
      player.id,
    )
    db.prepare(
      'INSERT INTO expeditions (player_id, route, walked, paid, bounty, created_at) VALUES (?, ?, 0, 0, ?, ?)',
    ).run(player.id, route!.key, bounty, Date.now())
  })()
  return snapshot(db, player)
}

/**
 * A hand on the ram.
 *
 * One slam runs the belt for a few presses' worth at once. It spends nothing
 * but the yard, so tapping can never outrun the Press that fills it -- it is
 * the manual assist, the way a swipe helps a pack open. Rate-limited here
 * rather than trusted to the client.
 */
const SLAM_PRESSES = 3
const SLAM_GAP_MS = 110
const lastSlam = new Map<number, number>()

export function slamPress(
  db: DB,
  player: Player,
): { snapshot: Snapshot; melted: number; paid: number } {
  const now = Date.now()
  if (now - (lastSlam.get(player.id) ?? 0) < SLAM_GAP_MS) {
    return { snapshot: snapshot(db, player), melted: 0, paid: 0 }
  }
  lastSlam.set(player.id, now)
  const row = loadState(db, player.id)
  const { fx } = loadoutOf(row)
  const r = runFactory(db, player.id, SLAM_PRESSES, fx, creditsPerCard(row, fx))
  return { snapshot: snapshot(db, player), ...r }
}

/** Bring a caravan home. Only the last waypoint waits for a hand. */
export function collectExpedition(
  db: DB,
  player: Player,
  id: number,
): { snapshot: Snapshot; paid: number; route: string } {
  const e = db
    .prepare('SELECT * FROM expeditions WHERE id = ? AND player_id = ?')
    .get(id, player.id) as (ExpeditionRow & { player_id: number }) | undefined
  if (!e) fail('That caravan is not on the road.')
  const route = ROUTES.find((r) => r.key === e!.route)
  if (!route) fail('That route no longer exists.')
  if (e!.walked < route!.distance) {
    fail(`${route!.name} still has ${Math.ceil(route!.distance - e!.walked).toLocaleString()} presses to go.`)
  }
  // Everything the waypoints have not already handed over.
  const owed = Math.max(0, Math.floor(e!.bounty - (e!.bounty / WAYPOINTS) * e!.paid))
  db.transaction(() => {
    db.prepare('UPDATE player_state SET credits = credits + ? WHERE player_id = ?').run(
      owed,
      player.id,
    )
    db.prepare('DELETE FROM expeditions WHERE id = ?').run(e!.id)
  })()
  return { snapshot: snapshot(db, player), paid: owed, route: route!.name }
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
  if (level >= BADGE_MAX) fail('That badge line is already finished.')
  if (!badgeUnlocked(key, badges)) fail('That badge is still locked.')
  const cost = badgeCost(def!, level + 1, computeEffects(badges, EMPTY_UPGRADES).priceMult)
  const next: Badges = { ...badges, [key]: level + 1 }
  db.transaction(() => {
    if (!spend(db, player.id, cost)) fail('Not enough credits.')
    db.prepare('UPDATE player_state SET badges_json = ? WHERE player_id = ?').run(
      JSON.stringify(next),
      player.id,
    )
  })()
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
  const cost = upgradeCost(def!, level, fx.priceMult)
  const next: Upgrades = { ...upgrades, [key]: level + 1 }
  db.transaction(() => {
    if (!spend(db, player.id, cost)) fail('Not enough credits.')
    db.prepare('UPDATE player_state SET upgrades_json = ? WHERE player_id = ?').run(
      JSON.stringify(next),
      player.id,
    )
  })()
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
              series_paid_json = '{}', auto_spin = 0, auto_at = 0, auto_yield = 0,
              pending_sell_json = NULL, collection_rev = collection_rev + 1
        WHERE player_id = ?`,
    ).run(JSON.stringify(EMPTY_BADGES), JSON.stringify(EMPTY_UPGRADES), player.id)
  })()
  return snapshot(db, player, true)
}

export { rarityOf }
