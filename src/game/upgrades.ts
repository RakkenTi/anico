/**
 * Upgrades: the half of the shop that never finishes.
 *
 * This is where an incremental lives or dies. Every line here is a multiplier
 * on something the loop already does, its price is a multiple of the last
 * level, and the multiple is always larger than the gain -- so each level
 * takes a little longer than the one before it and the curve keeps going long
 * after the numbers stop being pronounceable. Six of the nine lines have no
 * last level at all; the three that do buy a *shape* rather than a rate, and
 * say so.
 *
 * The previous version stopped: pack sizes were capped at two hundred, the
 * multipliers were "+5% per level" against prices that tripled, and the end of
 * the game arrived somewhere in the millions. Additive effects against
 * exponential prices is a treadmill that grinds to a halt by construction.
 */

export type UpgradeKey =
  | 'packs'
  | 'multipack'
  | 'haste'
  | 'appraisal'
  | 'fortune'
  | 'automaton'
  | 'nightshift'
  | 'alchemy'
  | 'divination'

export type Upgrades = Record<UpgradeKey, number>

export const EMPTY_UPGRADES: Upgrades = {
  packs: 0,
  multipack: 0,
  haste: 0,
  appraisal: 0,
  fortune: 0,
  automaton: 0,
  nightshift: 0,
  alchemy: 0,
  divination: 0,
}

/* --------------------------------------------------------------- ceilings */

/**
 * How much of a pull is actually dealt: granted card by card, laid out on
 * screen, added to the collection. Everything else is appraised (see
 * `server/game.ts`) -- opened by the machine and turned straight into credits.
 *
 * Pack sizes run away by design, so at some point a pack stops being a thing
 * you look at and becomes a number. What decides where that point is, is *how
 * fast your hands are*: Open Speed buys cards a second, and six seconds of them
 * is how much of the pull you get to go through. That is the only reading of
 * the cap that makes the numbers add up -- a pack of ten thousand emptied in
 * five seconds at fifty cards a second never did.
 *
 * It used to be a flat two hundred cards in at most six stacks, which meant
 * every level of Pack Size, Extra Packs and Open Speed past a certain point
 * changed nothing you could see.
 */
export const DEAL_SECONDS = 6
/** Nobody deals less than this, however slow their hands. */
export const MIN_DEALT = 200
/** And nobody deals more, however fast: a spread is still a thing on a screen. */
export const MAX_DEALT = 1_000

/** Cards this pull lays out, given the hands opening it. */
export function dealtFor(total: number, rate: number): number {
  const hands = Math.round(Math.max(1, rate) * DEAL_SECONDS)
  return Math.max(1, Math.min(total, MAX_DEALT, Math.max(MIN_DEALT, hands)))
}

/** Packs laid side by side on screen. Past this the extra packs are appraised. */
export const MAX_STACKS = 24

/**
 * Cards mounted behind the top of a stack, across the whole pull.
 *
 * Ten at most, and fewer when there are many stacks. A pack of two thousand
 * shows ten cards and a counter: the pile pops one off the front and gains one
 * at the back, which is the whole of what anybody can see of a stack anyway.
 * Mounting the real depth would be two thousand images to show four.
 */
export const STACK_RENDER_BUDGET = 120
export const STACK_RENDER_MAX = 10
export function stackDepth(stacks: number): number {
  return Math.max(3, Math.min(STACK_RENDER_MAX, Math.floor(STACK_RENDER_BUDGET / Math.max(1, stacks))))
}

/* ------------------------------------------------------------ the ladders */

export interface UpgradeDef {
  key: UpgradeKey
  name: string
  icon: string
  /** One plain sentence: what buying this does. */
  blurb: string
  baseCost: number
  /** Each level costs this much more than the one before it. */
  growth: number
  /** Absent for the lines that never end. */
  maxLevel?: number
  /** What owning `level` of this line does, as the shop says it. */
  effect: (level: number) => string
}

/** Pack size is multiplied by this per level, not added to. */
export const PACK_GROWTH = 1.3
/** Everything sells for this much more per level of Appraisal. */
export const APPRAISAL_GROWTH = 1.18
/** Cards a second at rest, and what a level of Open Speed multiplies it by. */
export const BASE_CARD_RATE = 4
export const CARD_RATE_GROWTH = 1.45

export const UPGRADE_DEFS: UpgradeDef[] = [
  {
    key: 'appraisal',
    name: 'Sell Value',
    icon: 'dollar',
    blurb: 'Cards and duplicates are worth more when you sell them.',
    baseCost: 6_000,
    growth: 1.95,
    effect: (l) => `${fmtX(sellMult(l))} sell value`,
  },
  {
    key: 'haste',
    name: 'Open Speed',
    icon: 'hourglass',
    blurb: 'Cards come out faster, and six seconds of them is how much of a pull you open.',
    baseCost: 8_000,
    growth: 1.9,
    effect: (l) => `${cardRate(l)} cards/sec, ${fmtCount(dealtFor(MAX_DEALT, cardRate(l)))} dealt`,
  },
  {
    key: 'packs',
    name: 'Pack Size',
    icon: 'cards_stack',
    blurb: 'More cards in every pack. Multiplies, so it never stops mattering.',
    baseCost: 12_000,
    growth: 2.15,
    effect: (l) => (l > 0 ? `${fmtX(packMult(l))} pack size` : 'base pack size'),
  },
  {
    key: 'fortune',
    name: 'Coin Drops',
    icon: 'd20',
    blurb: 'Coins drop more often and are worth more.',
    baseCost: 8_000,
    growth: 2.05,
    effect: (l) =>
      l > 0
        ? `+${(coinChanceBonus(l) * 100).toFixed(1)}% drop chance, ${fmtX(coinValueMult(l))} value`
        : 'base coin drops',
  },
  {
    key: 'multipack',
    name: 'Extra Packs',
    icon: 'cards_fan',
    blurb: 'Open several packs at once, side by side.',
    baseCost: 60_000,
    growth: 2.2,
    effect: (l) => `${packsPerPull(l)} pack${packsPerPull(l) === 1 ? '' : 's'} per press`,
  },
  {
    key: 'alchemy',
    name: 'Merge Value',
    icon: 'flask_full',
    blurb: 'Each star on a merged stack multiplies it by more.',
    baseCost: 40_000,
    growth: 1.95,
    effect: (l) => `${fmtX(mergeMult(l))} per star`,
  },
  {
    key: 'automaton',
    name: 'Auto Summon',
    icon: 'gear',
    blurb: 'Opens packs for you: tears, swipes, and presses again.',
    baseCost: 200_000,
    growth: 2.8,
    maxLevel: 10,
    effect: (l) => (l > 0 ? `1 press every ${(autoSpinMs(l) / 1000).toFixed(2)}s` : 'not bought'),
  },
  {
    key: 'nightshift',
    name: 'Offline Earnings',
    icon: 'campfire',
    blurb: 'Auto Summon keeps earning while the game is closed.',
    baseCost: 300_000,
    growth: 2.6,
    maxLevel: 11,
    effect: (l) =>
      l > 0 ? `${Math.round(offlineRate(l) * 100)}% speed, up to ${offlineHours(l)}h` : 'not bought',
  },
  {
    key: 'divination',
    name: 'Wish Odds',
    icon: 'cards_seek',
    blurb: 'Wishes turn up more often. They stay rare.',
    baseCost: 25_000,
    growth: 2.6,
    maxLevel: 10,
    effect: (l) => (l > 0 ? `${fmtX(wishMult(l))} wish chance` : 'base wish chance'),
  },
]

/* ------------------------------------------------------------ the numbers */

/** Local, because this module is shared with the server and imports nothing. */
function fmtCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n)
}

/** Local, because this module is shared with the server and imports nothing. */
function fmtX(n: number): string {
  if (n < 10) return `×${Number(n.toFixed(2))}`
  if (n < 10_000) return `×${Math.round(n).toLocaleString()}`
  const tier = Math.floor(Math.log10(n) / 3)
  const names = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']
  if (tier >= names.length) return `×1e${Math.floor(Math.log10(n))}`
  return `×${(n / Math.pow(1000, tier)).toFixed(1)}${names[tier]}`
}

const lv = (level: number) => Math.max(0, Math.floor(level))

/** How much deeper Deeper Packs has made a pack. */
export function packMult(level: number): number {
  return Math.pow(PACK_GROWTH, lv(level))
}

/** Packs torn at once, which is what Both Hands buys. */
export function packsPerPull(level: number): number {
  return 1 + lv(level)
}

/**
 * Cards a second the hands can actually manage.
 *
 * Multiplied, not added to. Four more cards a second is everything at level one
 * and nothing at level twenty, and it fell further behind every line it is
 * priced beside: Pack Size multiplies, Sell Value multiplies, and Open Speed
 * was still handing out the same four. It decides how much of a pull you
 * actually open now, which is the other half of why it had to compound.
 */
export function cardRate(level: number): number {
  return Math.round(BASE_CARD_RATE * Math.pow(CARD_RATE_GROWTH, lv(level)))
}

/** Everything sold pays this multiple. */
export function sellMult(level: number): number {
  return Math.pow(APPRAISAL_GROWTH, lv(level))
}

export function coinChanceBonus(level: number): number {
  // Chance saturates; value does not. A coin on every card would just be a
  // second, duller name for the card's own value.
  return Math.min(0.3, 0.003 * lv(level))
}

export function coinValueMult(level: number): number {
  return Math.pow(1.25, lv(level))
}

/** What a star multiplies a stack by, per star. */
export const BASE_MERGE_MULT = 2.6
export function mergeMult(level: number): number {
  return BASE_MERGE_MULT + 0.45 * lv(level)
}

/** Wishes, relative to their base rate. */
export function wishMult(level: number): number {
  return Math.pow(1.6, lv(level))
}

/**
 * How often the Automaton presses, in milliseconds. Zero means unbought.
 *
 * Ends at level ten rather than running to zero: past about a press a second
 * the thing that decides throughput is how fast cards come out of the pack,
 * and a line that keeps taking money for nothing is worse than a line that
 * says it is finished.
 */
export function autoSpinMs(level: number): number {
  if (lv(level) <= 0) return 0
  return Math.max(500, Math.round(9000 * Math.pow(0.82, lv(level) - 1)))
}

/** Fraction of its normal speed the Automaton keeps with the tab closed. */
export function offlineRate(level: number): number {
  if (lv(level) <= 0) return 0
  return Math.min(1, 0.2 + 0.1 * (lv(level) - 1))
}

/** How long it keeps going out there before it stops for the night. */
export function offlineHours(level: number): number {
  if (lv(level) <= 0) return 0
  return Math.min(24, 2 + 2 * lv(level))
}

/**
 * The opening discount.
 *
 * The first rungs of the endless lines cost a fraction of list price, and the
 * fraction fades out by the sixth. An exponential ladder priced honestly from
 * level one is correct on paper and terrible in the first ten minutes: the
 * shop is full of things worth a minute and a half of grinding each, so the
 * opening reads as a wall rather than a hook. This is the ramp on to the
 * curve, and it costs the late game nothing -- by level five the price is the
 * one the ladder always said it was.
 *
 * The three lines that end are left at list price. They buy a *shape* -- a
 * machine that presses the button, a night shift, better odds on a wish --
 * and their first level is an unlock rather than a rung. Discounting those
 * would hand over the whole late game in the first ten minutes, which is the
 * opposite of what a ramp is for.
 */
const OPENING_DISCOUNT = [0.06, 0.12, 0.25, 0.45, 0.7]

/**
 * What the next level costs.
 *
 * Exponential, and always steeper than the effect it buys: that difference is
 * the entire difficulty curve. Rounded to three significant figures, because a
 * price of 4,182,993,110 credits is not more informative than 4.18B and this
 * is the number the shop prints.
 */
export function upgradeCost(def: UpgradeDef, currentLevel: number, priceMult = 1): number {
  const level = lv(currentLevel)
  const opening = def.maxLevel === undefined ? (OPENING_DISCOUNT[level] ?? 1) : 1
  return roundCost(def.baseCost * Math.pow(def.growth, level) * opening * priceMult)
}

/** Three significant figures, and never below ten. */
export function roundCost(raw: number): number {
  if (!Number.isFinite(raw)) return Number.MAX_SAFE_INTEGER
  if (raw < 1000) return Math.max(10, Math.round(raw / 10) * 10)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)) - 2)
  return Math.round(raw / mag) * mag
}

export function upgradeMaxed(def: UpgradeDef, level: number): boolean {
  return def.maxLevel !== undefined && level >= def.maxLevel
}
