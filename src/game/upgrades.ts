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
  /** What the line is for, in one line. */
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
    name: 'Appraisal',
    icon: 'dollar',
    blurb: 'Everything you sell, and every duplicate you are compensated for, pays more.',
    baseCost: 6_000,
    growth: 1.95,
    effect: (l) => `cards sell for ${fmtX(sellMult(l))} their worth`,
  },
  {
    key: 'haste',
    name: 'Swift Hands',
    icon: 'hourglass',
    blurb: 'How fast cards actually come out of a pack, which is what a big pack costs you.',
    baseCost: 8_000,
    growth: 1.9,
    effect: (l) => `${cardRate(l)} cards a second`,
  },
  {
    key: 'packs',
    name: 'Deeper Packs',
    icon: 'cards_stack',
    blurb: 'Every level makes a pack half again as deep. Compounds, and never stops.',
    baseCost: 12_000,
    growth: 2.15,
    effect: (l) => (l > 0 ? `packs are ${fmtX(packMult(l))} as deep` : 'packs stay as Sapphire left them'),
  },
  {
    key: 'fortune',
    name: 'Fortune',
    icon: 'd20',
    blurb: 'Coins fall more often, and are worth a great deal more when they do.',
    baseCost: 8_000,
    growth: 2.05,
    effect: (l) =>
      l > 0
        ? `+${(coinChanceBonus(l) * 100).toFixed(1)}% coin chance · coins worth ${fmtX(coinValueMult(l))}`
        : 'coins fall as they fall',
  },
  {
    key: 'multipack',
    name: 'Both Hands',
    icon: 'cards_fan',
    blurb: 'Tear open several packs at once, side by side, each with its own wrapper.',
    baseCost: 60_000,
    growth: 2.2,
    effect: (l) => `${packsPerPull(l)} pack${packsPerPull(l) === 1 ? '' : 's'} a press`,
  },
  {
    key: 'alchemy',
    name: 'Alchemy',
    icon: 'flask_full',
    blurb: 'Every star a stack has merged to multiplies it further. The reason to keep anything.',
    baseCost: 40_000,
    growth: 1.95,
    effect: (l) => `each star is worth ${fmtX(mergeMult(l))} the stack`,
  },
  {
    key: 'automaton',
    name: 'The Automaton',
    icon: 'gear',
    blurb:
      'Hands the button to a machine: it tears, swipes and presses again, as long as you can pay.',
    baseCost: 100_000,
    growth: 2.8,
    maxLevel: 10,
    effect: (l) =>
      l > 0 ? `presses every ${(autoSpinMs(l) / 1000).toFixed(2)}s` : 'you press the button yourself',
  },
  {
    key: 'nightshift',
    name: 'Night Shift',
    icon: 'campfire',
    blurb: 'The Automaton keeps working with the tab closed, at a fraction of its speed.',
    baseCost: 300_000,
    growth: 2.6,
    maxLevel: 11,
    effect: (l) =>
      l > 0
        ? `${Math.round(offlineRate(l) * 100)}% speed while away, up to ${offlineHours(l)}h`
        : 'the machine stops when you close the tab',
  },
  {
    key: 'divination',
    name: 'Divination',
    icon: 'cards_seek',
    blurb: 'Wishes come true more often. Still rare, deliberately: a wish is a cheat code.',
    baseCost: 25_000,
    growth: 2.6,
    maxLevel: 10,
    effect: (l) => (l > 0 ? `wishes ${fmtX(wishMult(l))} as likely` : 'wishes are as rare as they come'),
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
 * What the next level costs.
 *
 * Exponential, and always steeper than the effect it buys: that difference is
 * the entire difficulty curve. Rounded to three significant figures, because a
 * price of 4,182,993,110 credits is not more informative than 4.18B and this
 * is the number the shop prints.
 */
export function upgradeCost(def: UpgradeDef, currentLevel: number, priceMult = 1): number {
  const raw = def.baseCost * Math.pow(def.growth, lv(currentLevel)) * priceMult
  return roundCost(raw)
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
