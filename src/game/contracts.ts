/**
 * What a contract asks for, and what fulfilling one pays.
 *
 * A contract names a series and asks for a breadth of its cast at a depth of
 * stars. That is the whole of it, and the restraint is the point: an earlier
 * attempt at raiding gave every character a number and the characters stopped
 * mattering, so nothing here may invent a per-character stat -- and, less
 * obviously, nothing here may read credit value either. Credit value *is*
 * favourites and rarity *is* credit value, so a demand scored on value is one
 * whose answer is always "send the eleven Mythics", which is a lookup wearing
 * the costume of a decision.
 *
 * Series is the one attribute a character has with combinatorial structure. A
 * warm catalog holds up to ten thousand of them, and a contract on Frieren is
 * not satisfiable by Levi at any rarity.
 *
 * This was the gateway to the whole upgrade tree once, bought and paid for in
 * currencies of its own. It is a goal board now (ADR 0014): free to attempt,
 * paying credits like everything else, and holding nobody's upgrades hostage.
 * What it is *for* is being the only thing in the game that makes one
 * particular character worth wanting.
 */

export interface Contract {
  id: number
  series: string
  /** Distinct characters of that series it wants. */
  breadth: number
  /** Stars each of them must have merged to. */
  depth: number
  /** Credits it pays. */
  reward: number
  /** How many of the breadth the player currently has at that depth. */
  held: number
}

/**
 * A pinned contract: one you take on rather than fulfil.
 *
 * It names something just past your reach and pays when the collection gets
 * there, so it is a to-do list rather than a test. Slots are few and nothing
 * expires: scarcity is the slot, not a clock, because ADR 0004 removed every
 * timer in the game on the grounds that pacing makes an app you cannot play
 * when you happen to open it.
 */
export interface Pinned extends Contract {
  acceptedAt: number
}

/** Contracts a player may have pinned at once. */
export const COMMISSION_SLOTS = 3
/** Contracts on the board at any moment. Fulfilling one posts its replacement. */
export const RAID_BOARD = 5
/** A pinned contract pays this much more than the one it was cut from. */
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
export const DEPTH_BY_TIER = [0, 2, 5, 8, 11]

export const RAID_TIERS = BREADTH_BY_TIER.length

/** What the board calls a rung, so a row can say how hard it is out loud. */
export const TIER_NAMES = ['Errand', 'Commission', 'Charter', 'Warrant', 'Grand Charter']

/**
 * How much a demand is worth.
 *
 * Breadth times depth, because those are the two halves the mechanic exists to
 * join: breadth is what a collection of sixty-five thousand characters bought,
 * depth is what the millions of spare copies bought, and a raid needs both.
 */
export function contractWork(breadth: number, depth: number): number {
  return Math.max(1, breadth * (depth + 1))
}

/**
 * What fulfilling one is worth, in *presses*.
 *
 * Not in credits: a flat credit number is a fortune at ten thousand and a
 * rounding error at a quadrillion, and this board has to still mean something
 * at both ends. So a contract pays a multiple of what the player's own summon
 * is worth, and the server multiplies it out at payout time against their
 * smoothed credits-per-card. The exponent is above one, so the hard rungs pay
 * better per unit of collection than the easy ones -- about 1.7x across the
 * ladder -- which is enough to make growing a collection the better play
 * without making the easy rungs pointless.
 */
export function contractPresses(work: number): number {
  return Math.max(1, Math.pow(work, 1.15) / 3)
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
export function tierOf(c: Pick<Contract, 'depth'>): number {
  for (let t = RAID_TIERS - 1; t > 0; t--) if (c.depth >= DEPTH_BY_TIER[t]) return t
  return 0
}

export function tierName(c: Pick<Contract, 'depth'>): string {
  return TIER_NAMES[tierOf(c)]
}

/** Whether the collection answers this contract as it stands. */
export function answered(c: Pick<Contract, 'breadth' | 'held'>): boolean {
  return c.held >= c.breadth
}

/**
 * The rung to post next, given what the collection already answers.
 *
 * The board used to draw its difficulty blind -- a random series, then a
 * random rung -- and blind is the wrong shape here. A collection of sixty-five
 * thousand holds one or two characters from most series it touches and holds
 * them at no stars, so a rung drawn at random wanted 55% of a cast at the
 * fifth star and the whole board read as a list of refusals. A board of five
 * "no"s is not a mechanic; it is a wall.
 *
 * So the rung is measured against the collection instead. `top` is the hardest
 * rung the player answers today, and the board posts around it: about a third
 * of rows are payable on sight, most of the rest are one step out, and a few
 * are a stretch. Nothing is made easier -- the demands are the same demands --
 * they are just aimed at where the collection actually is.
 */
export function fitTier(cast: number, heldAt: number[], roll: number): number {
  let top = -1
  for (let t = 0; t < RAID_TIERS; t++) {
    if ((heldAt[t] ?? 0) >= demandFor(cast, t).breadth) top = t
  }
  const step = roll < 0.35 ? 0 : roll < 0.75 ? 1 : 2
  return Math.max(0, Math.min(RAID_TIERS - 1, top + step))
}

/**
 * The faces a muster shows.
 *
 * A raid answered by ninety characters cannot put ninety portraits on screen
 * and does not need to: a rank of twelve reads as "a company went out", and
 * the row already said the real number.
 */
export const MUSTER_FACES = 12

/** One card in a muster: enough to draw a face, and nothing else. */
export interface Musterer {
  id: number
  name: string
  image: string
  stars: number
}
