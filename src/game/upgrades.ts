/**
 * Upgrades: the half of the shop that never finishes.
 *
 * This is where an incremental lives or dies. Every line here is a multiplier
 * on something the loop already does, its price is a multiple of the last
 * level, and the multiple is always larger than the gain -- so each level
 * takes a little longer than the one before it and the curve keeps going long
 * after the numbers stop being pronounceable.
 *
 * ## Why the growth numbers are what they are
 *
 * A line whose effect multiplies by `g` per level against a price that
 * multiplies by `c` per level contributes `r = ln g / ln c` to the exponent of
 * the whole economy: spend a balance `S` across the shop and income comes back
 * proportional to `S^R`, where `R` is the sum of every line's `r`. That one
 * number decides whether this is a game or a firework.
 *
 *   R < 1  the balance grows like a polynomial in time. Each order of
 *          magnitude costs more play than the last, which is the entire
 *          feeling an idle game is selling.
 *   R > 1  the balance reaches infinity in *finite time*. Dump everything into
 *          the shop, come back richer than you spent, repeat, and the save is
 *          over in ten minutes.
 *
 * The previous release was R ~ 1.5, and it got there through the Factory: a
 * scrap was worth a fraction of a *whole pull*, and both halves of that
 * fraction -- the Foundry and the belt -- were endless lines. The works are
 * gone (ADR 0015) and what is left is priced so that R lands near 0.74:
 *
 *   Sell Value   x1.18 per level against x2.00   r = 0.24
 *   Pack Size    x1.28 per level against x2.50   r = 0.27
 *   Coin Drops   x1.22 per level against x2.40   r = 0.23
 *
 * Everything else is either capped, additive, or outside the loop that pays
 * for it. Open Speed decides how much of a pull you *see*; Extra Packs adds a
 * wrapper rather than multiplying one; Merge Value pays on a collection you
 * sell rather than on the summon that feeds it.
 *
 * If a new endless line is ever added here, work out its `r` and check the
 * sum. That is the whole review.
 */

import { MAX_STARS } from './economy.js'
import { fmtCount, fmtMult } from './format.js'

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
  /* The board, and the ceilings the summon runs into. */
  | 'depth'
  | 'hands'
  | 'table'
  | 'aim'
  | 'focus'
  | 'autoaim'

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
  focus: 0,
  autoaim: 0,
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
 * is how much of the pull you get to go through.
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
 * pull it is pass the player's own (ADR 0013).
 */
export function dealtFor(total: number, rate: number, cap: number = MAX_DEALT): number {
  const hands = Math.round(Math.max(1, rate) * DEAL_SECONDS)
  return Math.max(1, Math.min(total, Math.max(1, cap), Math.max(MIN_DEALT, hands)))
}

/**
 * The gap between two cards landing, in milliseconds.
 *
 * Lives here rather than in the sound module because the server needs it too:
 * how long a spread takes to deal is the pace of a summon by hand, and a pace
 * enforced only in the browser is not a rule (ADR 0003). `mult` is the Open
 * Speed multiplier, clamped the same way the animation clamps it.
 */
export function dealStepFor(count: number, mult: number): number {
  if (count <= 1) return 0
  const base =
    count <= 20
      ? 70
      : count <= 100
        ? Math.max(12, Math.round(1200 / count))
        : Math.min(12, Math.max(2.8, Math.round((2800 / count) * 10) / 10))
  return base * Math.min(1, Math.max(0.08, mult))
}

/**
 * The longest a pull may take to empty, and the shortest, in seconds.
 *
 * Open Speed buys cards a second and that is what it delivers, until the pack
 * has outgrown the hands entirely (the ceiling) or the hands have outgrown the
 * pack (the floor, so a pull is still something that happens).
 */
export const MAX_OPEN_S = 8
export const MIN_OPEN_S = 0.6

/**
 * How long a pull takes to come out of its wrappers, in milliseconds.
 *
 * `held` is what the pull really holds and `dealt` is what reaches the screen,
 * so each dealt card stands in for `held / dealt` of them and the throws are
 * paced at that share of the real rate. Otherwise a pull of two hundred
 * thousand empties in the time nine hundred should take, and no amount of Open
 * Speed changes it.
 *
 * The animation runs on this and so does the server, which is the point: how
 * long a pack takes to open is the pace of summoning by hand, and a pace only
 * the browser knows is one a reload can throw away.
 */
export function openMsFor(held: number, dealt: number, rate: number): number {
  const shown = Math.max(1, dealt)
  const carries = Math.max(1, Math.max(1, held) / shown)
  const realRate = Math.max(1, rate, Math.max(1, held) / MAX_OPEN_S)
  const dealtRate = Math.min(Math.max(1, realRate / carries), shown / MIN_OPEN_S)
  return Math.round((shown / dealtRate) * 1000)
}

/** Packs laid side by side on screen. Past this the extra packs are appraised. */
export const MAX_STACKS = 24

/**
 * Cards mounted behind the top of a stack, across the whole pull.
 *
 * Ten at most, and fewer when there are many stacks. A pack of two thousand
 * shows ten cards and a counter: the pile pops one off the front and gains one
 * at the back, which is the whole of what anybody can see of a stack anyway.
 */
export const STACK_RENDER_BUDGET = 80
export const STACK_RENDER_MAX = 10
export function stackDepth(stacks: number): number {
  return Math.max(3, Math.min(STACK_RENDER_MAX, Math.floor(STACK_RENDER_BUDGET / Math.max(1, stacks))))
}

/* ------------------------------------------------------------ the ladders */

/**
 * Keys that belong to the board and to the summon's ceilings.
 *
 * Only used to draw a divider in the shop: one flat list of fifteen rows is a
 * list nobody reads to the bottom of. They are still in the same shop, bought
 * with the same credits -- no mechanic here holds another one's upgrades
 * hostage (ADR 0014).
 */
export const LATE_KEYS = new Set<UpgradeKey>(['aim', 'focus', 'autoaim', 'table', 'hands', 'depth'])

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
export const PACK_GROWTH = 1.28
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
    growth: 2.0,
    effect: (l) => `${fmtMult(sellMult(l))} sell value`,
  },
  {
    key: 'haste',
    name: 'Open Speed',
    icon: 'hourglass',
    blurb: 'Cards come out faster, and six seconds of them is how much of a pull you open.',
    baseCost: 8_000,
    growth: 1.9,
    effect: (l) => `${fmtCount(cardRate(l))} cards/sec, ${fmtCount(dealtFor(MAX_DEALT, cardRate(l)))} land`,
  },
  {
    key: 'packs',
    name: 'Pack Size',
    icon: 'cards_stack',
    blurb: 'More cards in every pack. Multiplies, so it never stops mattering.',
    baseCost: 12_000,
    growth: 2.5,
    effect: (l) => (l > 0 ? `${fmtMult(packMult(l))} pack size` : 'base pack size'),
  },
  {
    key: 'fortune',
    name: 'Coin Drops',
    icon: 'd20',
    blurb: 'Coins drop more often and are worth more.',
    baseCost: 8_000,
    growth: 2.4,
    effect: (l) =>
      l > 0
        ? `+${(coinChanceBonus(l) * 100).toFixed(1)}% drop chance, ${fmtMult(coinValueMult(l))} value`
        : 'base coin drops',
  },
  {
    key: 'multipack',
    name: 'Extra Packs',
    icon: 'cards_fan',
    blurb: 'Open several packs at once, side by side.',
    baseCost: 60_000,
    growth: 2.2,
    effect: (l) => `${packsPerPull(l)} pack${packsPerPull(l) === 1 ? '' : 's'} per pull`,
  },
  {
    key: 'alchemy',
    name: 'Merge Value',
    icon: 'flask_full',
    blurb: 'Merged stacks are worth more when you sell them.',
    baseCost: 40_000,
    growth: 2.5,
    effect: (l) => `${fmtMult(stackMult(l))} on a merged stack`,
  },
  {
    key: 'automaton',
    name: 'Auto Summon',
    icon: 'gear',
    blurb: 'Opens packs for you: tears, swipes, and presses again.',
    baseCost: 200_000,
    growth: 2.8,
    maxLevel: 10,
    effect: (l) => (l > 0 ? `1 pull every ${(autoSpinMs(l) / 1000).toFixed(2)}s` : 'not bought'),
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
    effect: (l) => (l > 0 ? `${fmtMult(wishMult(l))} wish chance` : 'base wish chance'),
  },

  /* ---------------------------------------------------- the board and the
   * ceilings the summon runs into.
   *
   * Priced for the player who needs them: a quadrillion credits is somebody
   * who has bought everything above this line twice over, so these do not
   * compete with the early shop. They are what the late shop is *for*.
   *
   * None of them multiply income. Three raise a ceiling the summon has run
   * into, and three point the pull at the contract board -- which is the only
   * thing in the game that makes one particular character worth wanting.
   */
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
    key: 'focus',
    name: 'Split Aim',
    icon: 'cards_fan',
    blurb: 'Aim at several series at once. The aimed share is divided between them.',
    baseCost: 300_000_000,
    growth: 7,
    maxLevel: 5,
    effect: (l) => `${aimSlots(l)} series aimed at once`,
  },
  {
    key: 'autoaim',
    name: 'Auto Aim',
    icon: 'd20',
    blurb: 'Points Called Shot at the contracts you are nearest to finishing, every pull.',
    baseCost: 2_000_000_000,
    growth: 4,
    maxLevel: 1,
    effect: (l) => (l > 0 ? 'aims itself at the closest contracts' : 'you aim by hand'),
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
    blurb: 'A pull deals more real cards, so more of it becomes copies instead of credits.',
    baseCost: 1_000_000_000,
    growth: 12,
    maxLevel: 6,
    effect: (l) => `${fmtCount(maxDealtFor(l))} cards land, the rest appraised`,
  },
  {
    key: 'depth',
    name: 'Deeper Merges',
    icon: 'd20',
    blurb: 'Stacks merge past ★12, which is what the hard contracts ask for.',
    baseCost: 10_000_000_000,
    growth: 20,
    maxLevel: 6,
    effect: (l) => `stacks merge to ★${maxStarsFor(l)}`,
  },
]

/* ------------------------------------------------- the ceilings' own maths */

/** Stars a stack may merge to. */
export function maxStarsFor(level: number): number {
  return MAX_STARS + lv6(level)
}

/**
 * Cards a pull deals.
 *
 * Every dealt card is a claim written, so this is the one line here the server
 * pays for: four hundred more cards a level, not a doubling. It also very
 * slightly lowers credit income -- a dealt duplicate pays a fraction of sell
 * value where an appraised card pays all of it -- for three and a half times
 * the copies, which is the trade the contract board exists to make.
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

/** Series Called Shot may be pointed at simultaneously. */
export function aimSlots(level: number): number {
  return 1 + Math.max(0, Math.min(5, Math.floor(level || 0)))
}

/** Whether the machine is allowed to do the aiming. */
export function autoAimOwned(level: number): boolean {
  return Math.floor(level || 0) > 0
}

const lv6 = (n: number) => Math.max(0, Math.min(6, Math.floor(n || 0)))

/* ------------------------------------------------------------ the numbers */

const lv = (level: number) => Math.max(0, Math.floor(level))

/** How much deeper Pack Size has made a pack. */
export function packMult(level: number): number {
  return Math.pow(PACK_GROWTH, lv(level))
}

/** Packs torn at once, which is what Extra Packs buys. */
export function packsPerPull(level: number): number {
  return 1 + lv(level)
}

/**
 * Cards a second the hands can actually manage.
 *
 * Multiplied, not added to. It decides how much of a pull you actually open,
 * which is why it compounds -- but it is capped by Wider Deal at the top, so
 * it is a line that buys *sight* rather than income.
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
  return Math.pow(1.22, lv(level))
}

/**
 * What a merged stack sells for, over and above its stars.
 *
 * This used to raise the *per star* multiplier, and per star is the one place
 * in this game where a linear-looking number is an exponent: a stack merges to
 * eighteen stars, so `+0.45 a level` was `x1.98 income a level` against a
 * price that only doubled, and the line paid for itself twice over on every
 * rung. It multiplies the finished stack now, which is the same idea priced
 * honestly.
 */
export const STACK_GROWTH = 1.35
export function stackMult(level: number): number {
  return Math.pow(STACK_GROWTH, lv(level))
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
 * level one is correct on paper and terrible in the first ten minutes.
 *
 * The lines that end are left at list price. They buy a *shape* -- a machine
 * that presses the button, a night shift, a crosshair -- and their first level
 * is an unlock rather than a rung.
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

/**
 * Three significant figures, and never below ten.
 *
 * A price the doubles can no longer hold answers `Infinity`, which is the
 * honest answer: that level is unreachable and everything that reads a cost
 * treats it as unaffordable. It used to answer `MAX_SAFE_INTEGER`, which made
 * the most expensive level in the game cost nine quadrillion -- pocket change
 * to anyone who had got that far, and an infinite ladder of free levels.
 */
export function roundCost(raw: number): number {
  if (Number.isNaN(raw)) return Infinity
  if (!Number.isFinite(raw)) return Infinity
  if (raw < 1000) return Math.max(10, Math.round(raw / 10) * 10)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)) - 2)
  const rounded = Math.round(raw / mag) * mag
  return Number.isFinite(rounded) ? rounded : Infinity
}

export function upgradeMaxed(def: UpgradeDef, level: number): boolean {
  return def.maxLevel !== undefined && level >= def.maxLevel
}

/**
 * What buying `count` more levels of a line costs, and how many are actually
 * bought.
 *
 * Every level costs more than the last, so a bulk price is a sum rather than a
 * multiplication, and it stops at whatever comes first: the level cap, the
 * balance, or a price the doubles can no longer hold. The server prices a bulk
 * buy the same way from the same table -- this is what the button says, not
 * what it charges.
 */
export const BULK_MAX = 250

export function bulkCost(
  def: UpgradeDef,
  level: number,
  budget: number,
  want: number | 'max',
  priceMult = 1,
): { levels: number; cost: number } {
  const limit = want === 'max' ? BULK_MAX : Math.max(1, Math.min(BULK_MAX, Math.floor(want)))
  let levels = 0
  let cost = 0
  while (levels < limit) {
    const at = level + levels
    if (upgradeMaxed(def, at)) break
    const next = upgradeCost(def, at, priceMult)
    if (!Number.isFinite(next) || cost + next > budget) break
    cost += next
    levels++
  }
  return { levels, cost }
}

/** The price tag a bulk button wears: what it would cost, affordable or not. */
export function askingPrice(
  def: UpgradeDef,
  level: number,
  want: number | 'max',
  priceMult = 1,
): number {
  if (want === 'max') return upgradeCost(def, level, priceMult)
  return bulkCost(def, level, Infinity, want, priceMult).cost
}
