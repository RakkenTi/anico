/**
 * What a raid asks for, and what answering one is worth.
 *
 * A raid names a series and asks for a breadth of its cast at a depth of
 * stars. That is the whole of it, and the restraint is the point (ADR 0013):
 * an earlier attempt at raiding gave every character a number and the
 * characters stopped mattering, so nothing here may invent a per-character
 * stat -- and, less obviously, nothing here may read credit value either.
 * Credit value *is* favourites and rarity *is* credit value, so a raid scored
 * on value is a raid whose answer is always "send the eleven Mythics", which
 * is a lookup wearing the costume of a decision.
 *
 * Series is the one attribute a character has with combinatorial structure. A
 * warm catalog holds up to ten thousand of them, and a raid on Frieren is not
 * satisfiable by Levi at any rarity.
 */

export interface Raid {
  id: number
  series: string
  /** Distinct characters of that series the raid wants. */
  breadth: number
  /** Stars each of them must have merged to. */
  depth: number
  /** Scrip it costs to attempt. */
  cost: number
  /** Renown it pays. */
  reward: number
  /** How many of the breadth the player currently has at that depth. */
  held: number
}

/**
 * A commission is a raid you accept rather than answer.
 *
 * It names something just past your reach and pays when the collection gets
 * there, so it is the first to-do list this game has had since the shop ran
 * out. Slots are few and nothing expires: scarcity is the slot, not a clock,
 * because ADR 0004 removed every timer in the game on the grounds that pacing
 * makes an app you cannot play when you happen to open it.
 */
export interface Commission extends Raid {
  acceptedAt: number
}

/** Commissions a player may hold at once. */
export const COMMISSION_SLOTS = 3
/** Raids on the board at any moment. Answering one generates its replacement. */
export const RAID_BOARD = 5
/** A commission pays this much more than the raid it was cut from. */
export const COMMISSION_BONUS = 2.5

/**
 * Series small enough to be worth naming and big enough to be an ask.
 *
 * A two-character series is not a raid, and a two-hundred-character one asks
 * for a month of collecting in a single row.
 */
export const MIN_CAST = 5
export const MAX_CAST = 60

/** The fraction of a series' cast each rung of difficulty asks for. */
const BREADTH_BY_TIER = [0.25, 0.4, 0.55, 0.7, 0.85]
/** And the stars it wants them at. */
const DEPTH_BY_TIER = [0, 2, 5, 8, 11]

export const RAID_TIERS = BREADTH_BY_TIER.length

/** What the board calls a rung, so a row can say how hard it is out loud. */
export const TIER_NAMES = ['Sortie', 'Raid', 'Siege', 'Vigil', 'Reckoning']

/**
 * How much a demand is worth.
 *
 * Breadth times depth, because those are the two halves the mechanic exists to
 * join: breadth is what a collection of sixty-five thousand characters bought,
 * depth is what the millions of spare copies bought, and a raid needs both.
 */
export function raidWork(breadth: number, depth: number): number {
  return Math.max(1, breadth * (depth + 1))
}

/**
 * Scrip to attempt, Renown to answer.
 *
 * Cost is linear in the work and the reward is very slightly steeper, so a
 * harder raid pays a little better per Scrip than an easy one -- about 1.7x
 * across the whole ladder. Enough to make growing a collection the better
 * play, not enough to make the easy rungs pointless.
 */
export function raidCost(work: number): number {
  const raw = 3 * work
  return raw < 100 ? Math.max(10, Math.round(raw / 5) * 5) : Math.round(raw / 10) * 10
}

export function raidReward(work: number): number {
  return Math.max(1, Math.round(Math.pow(work, 1.15) / 12))
}

/** The demand one rung of difficulty makes of a series with this much cast. */
export function demandFor(cast: number, tier: number): { breadth: number; depth: number } {
  const t = Math.max(0, Math.min(RAID_TIERS - 1, Math.floor(tier)))
  return {
    breadth: Math.max(1, Math.min(cast, Math.ceil(cast * BREADTH_BY_TIER[t]))),
    depth: DEPTH_BY_TIER[t],
  }
}

/** Which rung a demand reads as, for the row's label. */
export function tierOf(raid: Pick<Raid, 'depth'>): number {
  for (let t = RAID_TIERS - 1; t > 0; t--) if (raid.depth >= DEPTH_BY_TIER[t]) return t
  return 0
}

export function tierName(raid: Pick<Raid, 'depth'>): string {
  return TIER_NAMES[tierOf(raid)]
}

/** Whether the collection answers this raid as it stands. */
export function answered(raid: Pick<Raid, 'breadth' | 'held'>): boolean {
  return raid.held >= raid.breadth
}
