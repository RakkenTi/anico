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
 * Cards one press actually deals: granted card by card, laid out on screen,
 * added to the collection.
 *
 * Pack sizes run away by design -- that is the entire point of an incremental
 * -- so at some point a pack stops being a thing you look at and becomes a
 * number. Everything past this is opened by the machine and appraised (see
 * `server/game.ts`), which keeps a pull O(200) in database writes however many
 * millions of cards it nominally holds.
 */
export const MAX_DEALT = 200

/** Packs laid side by side on screen. The rest of a pull is appraised. */
export const MAX_STACKS = 6

/**
 * Cards drawn behind the top of a stack.
 *
 * Purely a render budget: a two-hundred-card stack used to mount two hundred
 * cards, each with an image and a foil frame, of which four are visible. On a
 * phone that is the difference between a pack opening and a slideshow.
 */
export const STACK_RENDER_DEPTH = 25

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
/** Cards a second, at rest and per level of Swift Hands. */
export const BASE_CARD_RATE = 4
export const CARD_RATE_STEP = 4

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
    blurb: 'Cards come out of a pack faster. Big packs need this.',
    baseCost: 8_000,
    growth: 1.9,
    effect: (l) => `${cardRate(l)} cards per second`,
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

/** Cards a second the hands can actually manage. */
export function cardRate(level: number): number {
  return BASE_CARD_RATE + CARD_RATE_STEP * lv(level)
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
