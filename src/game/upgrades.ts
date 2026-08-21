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

import { MAX_STARS } from './economy.js'
import { beltRate, caravans, foundryMult, outfitMult, sparesPerScrap } from './industry.js'

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
  /* The works, and the ceilings they used to be locked behind (ADR 0014). */
  | 'depth'
  | 'hands'
  | 'table'
  | 'aim'
  | 'mill'
  | 'foundry'
  | 'belt'
  | 'outfit'
  | 'caravan'

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
  depth: 0,
  hands: 0,
  table: 0,
  aim: 0,
  mill: 0,
  foundry: 0,
  belt: 0,
  outfit: 0,
  caravan: 0,
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

/**
 * Cards this pull lays out, given the hands opening it.
 *
 * The ceiling is a floor: Wider Deal raises it, so callers that know whose
 * pull it is pass the player's own (ADR 0013). A thousand is what it is before
 * anybody has bought any.
 */
export function dealtFor(total: number, rate: number, cap: number = MAX_DEALT): number {
  const hands = Math.round(Math.max(1, rate) * DEAL_SECONDS)
  return Math.max(1, Math.min(total, Math.max(1, cap), Math.max(MIN_DEALT, hands)))
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
export const STACK_RENDER_BUDGET = 80
export const STACK_RENDER_MAX = 10
export function stackDepth(stacks: number): number {
  return Math.max(3, Math.min(STACK_RENDER_MAX, Math.floor(STACK_RENDER_BUDGET / Math.max(1, stacks))))
}

/* ------------------------------------------------------------ the ladders */

/**
 * Keys that belong to the works rather than to the summon.
 *
 * Only used to draw a divider in the shop: eighteen rows in one flat list is a
 * list nobody reads, and these nine arrive together with four new tabs. The
 * point of the divider is that they are *in the same shop* -- the whole
 * complaint that started this was one mechanic's upgrades being locked behind
 * another's (ADR 0014).
 */
export const WORKS_KEYS = new Set<UpgradeKey>([
  'mill',
  'foundry',
  'belt',
  'outfit',
  'caravan',
  'aim',
  'table',
  'hands',
  'depth',
])

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
    effect: (l) => `${fmtCount(cardRate(l))} cards/sec, ${fmtCount(dealtFor(MAX_DEALT, cardRate(l)))} dealt`,
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

  /* ------------------------------------------------------------- the works
   *
   * These five used to be a second currency's shopping list, bought with
   * Renown, which meant the summon's own ceilings -- how deep a stack merges,
   * how many cards a press deals, how many wrappers fit on screen -- were
   * locked behind a different mechanic entirely. One shop, one currency, and
   * no mechanic holds another one's upgrades hostage (ADR 0014).
   *
   * They are priced for the player who needs them. A quadrillion credits is a
   * player who has bought everything above this line twice over, so these do
   * not compete with the early shop; they are what the late shop is *for*, and
   * that was the real complaint behind the second economy.
   */
  {
    key: 'mill',
    name: 'Finer Mill',
    icon: 'gear',
    blurb: 'The Press gets more scrap out of the same spare copies.',
    baseCost: 3_000_000,
    growth: 3.4,
    maxLevel: 6,
    effect: (l) => `${sparesPerScrap(l)} spares a scrap`,
  },
  {
    key: 'foundry',
    name: 'Foundry',
    icon: 'flask_full',
    blurb: 'The Factory pays more for every scrap it melts. Never stops mattering.',
    baseCost: 2_000_000,
    growth: 2.2,
    effect: (l) => `a scrap is worth ${(foundryMult(l) * 100).toFixed(1)}% of a press`,
  },
  {
    key: 'belt',
    name: 'Belt Speed',
    icon: 'cards_stack_high',
    blurb: 'The Factory pulls more scrap through per press. Clears a backlog.',
    baseCost: 5_000_000,
    growth: 2.35,
    effect: (l) => `${fmtCount(Math.round(beltRate(l)))} scrap a press`,
  },
  {
    key: 'outfit',
    name: 'Outfitters',
    icon: 'pouch',
    blurb: 'Every expedition comes home with more.',
    baseCost: 25_000_000,
    growth: 1.9,
    effect: (l) => `${fmtX(outfitMult(l))} bounty`,
  },
  {
    key: 'caravan',
    name: 'Caravans',
    icon: 'campfire',
    blurb: 'More expeditions on the road at the same time.',
    baseCost: 400_000_000,
    growth: 14,
    maxLevel: 3,
    effect: (l) => `${caravans(l)} on the road`,
  },
  {
    key: 'aim',
    name: 'Called Shot',
    icon: 'cards_seek',
    blurb: 'Name a series and a share of every pull is drawn from it.',
    baseCost: 50_000_000,
    growth: 6,
    maxLevel: 6,
    effect: (l) => (l > 0 ? `${Math.round(aimShare(l) * 100)}% of a pull, aimed` : 'no target'),
  },
  {
    key: 'table',
    name: 'Longer Table',
    icon: 'cards_stack',
    blurb: 'More wrappers fit side by side, so Extra Packs starts mattering again.',
    baseCost: 250_000_000,
    growth: 8,
    maxLevel: 6,
    effect: (l) => `${maxStacksFor(l)} wrappers on screen`,
  },
  {
    key: 'hands',
    name: 'Wider Deal',
    icon: 'cards_fan',
    blurb: 'A press deals more real cards, so more of it becomes copies instead of credits.',
    baseCost: 1_000_000_000,
    growth: 12,
    maxLevel: 6,
    effect: (l) => `${fmtCount(maxDealtFor(l))} cards dealt`,
  },
  {
    key: 'depth',
    name: 'Deeper Merges',
    icon: 'd20',
    blurb: 'Stacks merge past ★12. Each star multiplies what the whole stack is worth.',
    baseCost: 10_000_000_000,
    growth: 20,
    maxLevel: 6,
    effect: (l) => `stacks merge to ★${maxStarsFor(l)}`,
  },
]

/* -------------------------------------------------------- the works' maths
 *
 * The ceilings the summon runs into. All five were a separate tree once; what
 * they do is unchanged, only what pays for them.
 */

/** Stars a stack may merge to. */
export function maxStarsFor(level: number): number {
  return MAX_STARS + lv6(level)
}

/**
 * Cards a press deals.
 *
 * Every dealt card is a claim written, so this is the one line here the server
 * pays for: four hundred more cards a level, not a doubling. It also very
 * slightly lowers credit income -- a dealt duplicate pays 16% of sell value
 * where an appraised card pays 100% -- for three and a half times the spares,
 * which is the trade the Press exists to make.
 */
export function maxDealtFor(level: number): number {
  return MAX_DEALT + 400 * lv6(level)
}

export function maxStacksFor(level: number): number {
  return MAX_STACKS + 4 * lv6(level)
}

export function aimShare(level: number): number {
  return lv6(level) === 0 ? 0 : Math.min(0.6, 0.1 * lv6(level))
}

const lv6 = (n: number) => Math.max(0, Math.min(6, Math.floor(n || 0)))

/* ------------------------------------------------------------ the numbers */

/**
 * Short scale, shared by both local formatters.
 *
 * Local because this module is shared with the server and imports nothing.
 * It is the same ladder `src/game/format.ts` uses, kept in step by hand: Open
 * Speed compounds at 1.45 a level and never stops, and the K-only version this
 * replaced printed "91293213913.1K" on the shop row.
 */
const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'UDc', 'DDc', 'TDc']

function scaled(n: number, plainBelow: number): string {
  if (!Number.isFinite(n)) return '\u221e'
  const v = Math.abs(n)
  if (v < plainBelow) return Math.round(v).toLocaleString()
  const tier = Math.floor(Math.log10(v) / 3)
  if (tier >= SUFFIXES.length) {
    const exp = Math.floor(Math.log10(v))
    return `${(v / Math.pow(10, exp)).toFixed(2)}e${exp}`
  }
  const x = v / Math.pow(1000, tier)
  return `${x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2)}${SUFFIXES[tier]}`
}

function fmtCount(n: number): string {
  return scaled(n, 10_000)
}

function fmtX(n: number): string {
  if (n < 10) return `\u00d7${Number(n.toFixed(2))}`
  return `\u00d7${scaled(n, 10_000)}`
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
