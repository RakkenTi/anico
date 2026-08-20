/**
 * Upgrades: the part of the shop that never finishes.
 *
 * Badges are six short ladders with a top rung. Upgrades are the opposite --
 * a handful of lines with no last level, each one costing a fixed multiple of
 * the last. That shape is the whole progression curve: the first few levels
 * are an afternoon's play, the tenth is a week, and the twentieth is a number
 * you look at rather than reach. Nothing is on a cooldown in this game, so the
 * only thing that can pace it is what the next thing costs.
 */

export type UpgradeKey = 'packs' | 'multipack' | 'haste' | 'appraisal' | 'fortune' | 'automaton'
export type Upgrades = Record<UpgradeKey, number>

export const EMPTY_UPGRADES: Upgrades = {
  packs: 0,
  multipack: 0,
  haste: 0,
  appraisal: 0,
  fortune: 0,
  automaton: 0,
}

/** Cards a Deeper Packs level adds. Round numbers: 25 -> 50 -> 75 -> 100. */
export const PACK_STEP = 25
/** Hard ceiling on a pack, so no upgrade can ask a phone to lay out a novel. */
export const MAX_PACK_SIZE = 200

export interface UpgradeDef {
  key: UpgradeKey
  name: string
  icon: string
  /** What the line is for, in one line. */
  blurb: string
  baseCost: number
  /** Each level costs this much more than the one before it. */
  growth: number
  maxLevel: number
  /** What owning `level` of this line does, as the shop says it. */
  effect: (level: number) => string
}

export const UPGRADE_DEFS: UpgradeDef[] = [
  {
    key: 'packs',
    name: 'Deeper Packs',
    icon: 'cards_stack',
    blurb: `Every level adds ${PACK_STEP} cards to a pack, past what Sapphire opened.`,
    baseCost: 40_000,
    growth: 3.2,
    maxLevel: 7,
    effect: (l) => (l > 0 ? `+${l * PACK_STEP} cards a pack` : 'packs stay as Sapphire left them'),
  },
  {
    key: 'multipack',
    name: 'Both Hands',
    icon: 'cards_fan',
    blurb:
      'Tear open more than one pack at a press. The first is dealt on screen; the rest are settled behind it.',
    baseCost: 150_000,
    growth: 3.4,
    maxLevel: 4,
    effect: (l) => `${packsPerPull(l)} pack${packsPerPull(l) === 1 ? '' : 's'} a press`,
  },
  {
    key: 'haste',
    name: 'Swift Hands',
    icon: 'hourglass',
    blurb: 'Cards deal and throw faster, which is what makes a hundred-card pack bearable.',
    baseCost: 4_000,
    growth: 2.4,
    maxLevel: 8,
    effect: (l) =>
      l > 0 ? `packs open ${Math.round((1 - hasteMult(l)) * 100)}% faster` : 'packs open at their own pace',
  },
  {
    key: 'appraisal',
    name: 'Appraisal',
    icon: 'dollar',
    blurb: 'Everything you sell, and every duplicate you are compensated for, pays more.',
    baseCost: 1_500,
    growth: 2.15,
    maxLevel: 18,
    effect: (l) => (l > 0 ? `+${l * 5}% on sales and duplicates` : 'cards sell for what they are worth'),
  },
  {
    key: 'automaton',
    name: 'The Automaton',
    icon: 'gear',
    blurb:
      'Hands the summon button to a machine: it opens packs on its own, as long as you can pay for them.',
    baseCost: 40_000,
    growth: 2.8,
    maxLevel: 5,
    effect: (l) =>
      l > 0
        ? `opens a pack every ${(autoSpinMs(l) / 1000).toFixed(1)}s`
        : 'you press the button yourself',
  },
  {
    key: 'fortune',
    name: 'Fortune',
    icon: 'd20',
    blurb: 'Coins fall more often, and are worth more when they do.',
    baseCost: 2_000,
    growth: 2.15,
    maxLevel: 14,
    effect: (l) =>
      l > 0 ? `+${(l * 0.3).toFixed(1)}% coin chance · coins worth +${l * 20}%` : 'coins fall as they fall',
  },
]

/** Packs torn at once, which is what Both Hands buys. */
export function packsPerPull(level: number): number {
  return 1 + Math.max(0, level)
}

/**
 * Cards a single pull may put on screen.
 *
 * A multi-pack pull past this is granted and summarised rather than dealt: a
 * thousand cards is not a spread, it is a stress test, and the whole point of
 * buying more packs at once is to stop watching them.
 */
export const MAX_DEALT = 200

/**
 * Cards one press may draw, however many packs it holds.
 *
 * The ceiling on how fast the whole economy can run: pack size, packs a press
 * and opening speed all multiply, and without a cap on the product the last
 * upgrades arrive faster than the ones before them, which is the opposite of
 * what a curve should do.
 */
export const MAX_PULL = 300

/** Deal and throw times are multiplied by this: 10% off, compounding. */
export function hasteMult(level: number): number {
  return Math.pow(0.9, Math.max(0, level))
}

/**
 * How often the Automaton pulls, in milliseconds. Zero means it is not bought.
 *
 * The late game is a grind by design -- the last upgrade levels cost millions
 * -- and a grind that needs a human finger on a button is just a worse game.
 * This is the shop admitting it: buy the machine and go and do something else.
 */
export function autoSpinMs(level: number): number {
  if (level <= 0) return 0
  return Math.max(2000, 9000 - 1750 * (level - 1))
}

/**
 * What the next level costs.
 *
 * Exponential on purpose. Linear costs against an income that also grows
 * linearly is a treadmill that never speeds up or slows down; this is the
 * curve that makes the first hour generous and the tenth deliberate.
 */
export function upgradeCost(def: UpgradeDef, currentLevel: number, discounted: boolean): number {
  const raw = def.baseCost * Math.pow(def.growth, currentLevel)
  return Math.round((discounted ? raw * 0.75 : raw) / 10) * 10
}

export function upgradeMaxed(def: UpgradeDef, level: number): boolean {
  return level >= def.maxLevel
}
