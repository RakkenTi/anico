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
  COIN_BASE_MEAN,
  coinAmount,
  dailyAmount,
  duplicateCompensation,
  packCost,
  rarityOf,
  rollCoinDrop,
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
  MAX_STACKS,
  dealtFor,
  UPGRADE_DEFS,
  upgradeCost,
  upgradeMaxed,
  type UpgradeKey,
  type Upgrades,
} from '../src/game/upgrades.js'
import { drawAboveValue, drawFromPool, getCharacter, type PoolPick } from './catalog.js'
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
function loadoutOf(row: StateRow): { badges: Badges; upgrades: Upgrades; fx: ReturnType<typeof computeEffects> } {
  const badges: Badges = { ...EMPTY_BADGES, ...JSON.parse(row.badges_json) }
  const upgrades: Upgrades = { ...EMPTY_UPGRADES, ...JSON.parse(row.upgrades_json || '{}') }
  return { badges, upgrades, fx: computeEffects(badges, upgrades) }
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
function addCopy(db: DB, playerId: number, characterId: number): { stars: number; merged: boolean } {
  const row = db
    .prepare('SELECT copies, stars FROM claims WHERE player_id = ? AND character_id = ?')
    .get(playerId, characterId) as { copies: number; stars: number } | undefined
  if (!row) return { stars: 0, merged: false }
  const copies = row.copies + 1
  const stars = starsFor(copies)
  db.prepare(
    'UPDATE claims SET copies = ?, stars = ? WHERE player_id = ? AND character_id = ?',
  ).run(copies, stars, playerId, characterId)
  return { stars, merged: stars > row.stars }
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
    collection: withCollection ? collectionOf(db, player.id, fx.sellMult, fx.mergeMult) : undefined,
    serverNow: Date.now(),
  }
}

export function fullState(db: DB, player: Player): Snapshot {
  // The one call every client makes on boot, which is exactly when the
  // Automaton's night's work should be counted and handed over.
  const away = settleOffline(db, player)
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
  const budget = dealtFor(total, fx.cardRate)
  const packCount = pack ? Math.min(packs, MAX_STACKS) : 1
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
    for (let g = 0; g < packCount; g++) {
      totalComp += guarantee(
        db,
        results,
        g * perPack,
        Math.min(results.length, (g + 1) * perPack),
        fx,
        settings,
        poolSize,
        owner,
        ownedIds,
        wishes,
      )
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
    touchCollection(db, player.id)
    return { ...r, ...swept, queued }
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
    hidden: overflow,
    hiddenFor,
    snapshot: snapshot(db, player, true),
  }
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
  db: DB,
  results: RollResult[],
  from: number,
  to: number,
  fx: ReturnType<typeof computeEffects>,
  settings: ServerSettings,
  poolSize: number,
  owner: number | null,
  ownedIds: Set<number>,
  wishes: PoolPick[],
): number {
  let delta = 0
  const need = Math.min(fx.guaranteeCount, to - from)
  for (let n = 0; n < need; n++) {
    const good = []
    for (let i = from; i < to; i++) if (results[i].char.creditValue >= fx.guaranteeValue) good.push(i)
    if (good.length > n) continue
    let worst = -1
    for (let i = from; i < to; i++) {
      if (results[i].wished) continue
      if (results[i].char.creditValue >= fx.guaranteeValue) continue
      if (worst < 0 || results[i].char.creditValue < results[worst].char.creditValue) worst = i
    }
    if (worst < 0) return delta
    const lucky = drawAboveValue(
      db,
      fx.guaranteeValue,
      settings.rollGender,
      poolSize,
      results.map((r) => r.char.id),
      owner,
    )
    if (!lucky) return delta
    const owned = ownedIds.has(lucky.id)
    const compensation = owned ? duplicateCompensation(lucky.creditValue, fx.dupCompMult) : 0
    delta += compensation - results[worst].compensation
    results[worst] = {
      char: lucky,
      owned,
      wished: wishes.some((w) => w.id === lucky.id),
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
): { claimed: number; bonus: number; merged: number; notes: string[] } {
  const now = Date.now()
  let claimed = 0
  let bonus = 0
  let merged = 0
  const notes: string[] = []
  for (const entry of session.results) {
    const owns = db
      .prepare('SELECT 1 FROM claims WHERE player_id = ? AND character_id = ?')
      .get(player.id, entry.char.id)
    if (owns) {
      // A duplicate is a copy, not a consolation. It goes on the stack, and if
      // that doubles the stack it merges a star higher.
      const r = addCopy(db, player.id, entry.char.id)
      if (r.merged) merged++
      entry.stars = r.stars
      continue
    }
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
    const paid = payClaimBonuses(entry.char, entry.wished, fx, seriesPaid, inSeries)
    bonus += paid.bonus
    notes.push(...paid.notes)
    entry.owned = true
    entry.compensation = 0
  }
  return { claimed, bonus, merged, notes }
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
    .prepare(
      `SELECT character_id, credit_value, copies, stars FROM claims
        WHERE player_id = ? AND locked = 0 AND character_id IN (${placeholders})`,
    )
    .all(player.id, ...ids) as
    | { character_id: number; credit_value: number; copies: number; stars: number }[]
  if (rows.length === 0) fail('Nothing there to sell — locked, or not yours.')
  const { fx } = loadoutOf(loadState(db, player.id))
  // A stack sells whole, at what the merge made it worth. Selling half a stack
  // would mean un-merging it, and a star that can be taken apart again is a
  // currency rather than a keepsake.
  const total = rows.reduce(
    (n, r) => n + Math.round(stackValue(r.credit_value, r.copies, r.stars, fx.mergeMult) * fx.sellMult),
    0,
  )
  const sold = rows.map((r) => r.character_id)
  const soldHoles = sold.map(() => '?').join(',')
  db.transaction(() => {
    db.prepare(`DELETE FROM claims WHERE player_id = ? AND character_id IN (${soldHoles})`).run(
      player.id,
      ...sold,
    )
    db.prepare('UPDATE player_state SET credits = credits + ? WHERE player_id = ?').run(total, player.id)
    touchCollection(db, player.id)
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
