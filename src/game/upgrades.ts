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

export type UpgradeKey = 'packs' | 'haste' | 'appraisal' | 'fortune'
export type Upgrades = Record<UpgradeKey, number>

export const EMPTY_UPGRADES: Upgrades = { packs: 0, haste: 0, appraisal: 0, fortune: 0 }

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
    baseCost: 8_000,
    growth: 2.4,
    maxLevel: 7,
    effect: (l) => (l > 0 ? `+${l * PACK_STEP} cards a pack` : 'packs stay as Sapphire left them'),
  },
  {
    key: 'haste',
    name: 'Swift Hands',
    icon: 'hourglass',
    blurb: 'Cards deal and throw faster, which is what makes a hundred-card pack bearable.',
    baseCost: 1_500,
    growth: 1.9,
    maxLevel: 8,
    effect: (l) =>
      l > 0 ? `packs open ${Math.round((1 - hasteMult(l)) * 100)}% faster` : 'packs open at their own pace',
  },
  {
    key: 'appraisal',
    name: 'Appraisal',
    icon: 'dollar',
    blurb: 'Everything you sell, and every duplicate you are compensated for, pays more.',
    baseCost: 1_000,
    growth: 1.6,
    maxLevel: 20,
    effect: (l) => (l > 0 ? `+${l * 5}% on sales and duplicates` : 'cards sell for what they are worth'),
  },
  {
    key: 'fortune',
    name: 'Fortune',
    icon: 'd20',
    blurb: 'Coins fall more often, and are worth more when they do.',
    baseCost: 1_200,
    growth: 1.7,
    maxLevel: 15,
    effect: (l) =>
      l > 0 ? `+${(l * 0.3).toFixed(1)}% coin chance · coins worth +${l * 20}%` : 'coins fall as they fall',
  },
]

/** Deal and throw times are multiplied by this: 10% off, compounding. */
export function hasteMult(level: number): number {
  return Math.pow(0.9, Math.max(0, level))
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
