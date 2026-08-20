/**
 * Credit economy.
 *
 * A character's credit value derives from its AniList popularity
 * (favourites count) on a power curve: the most-favourited characters
 * land around 850-900 credits, mid-tier around 100-300, and obscure
 * ones bottom out near 20.
 */
export function creditValue(favourites: number): number {
  const v = Math.round(15 + 7 * Math.pow(Math.max(favourites, 0), 0.45))
  return Math.min(v, 1500)
}

/* ---------------------------------------------------------------- rarity */

export interface Rarity {
  key: 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'
  name: string
  kanji: string
}

/* `kanji` kept as the field name; values are now plain tier letters. */
const RARITIES: (Rarity & { min: number })[] = [
  { key: 'mythic', name: 'Mythic', kanji: 'M', min: 700 },
  { key: 'legendary', name: 'Legendary', kanji: 'L', min: 450 },
  { key: 'epic', name: 'Epic', kanji: 'E', min: 250 },
  { key: 'rare', name: 'Rare', kanji: 'R', min: 100 },
  { key: 'common', name: 'Common', kanji: 'C', min: 0 },
]

export function rarityOf(value: number): Rarity {
  return RARITIES.find((r) => value >= r.min) ?? RARITIES[RARITIES.length - 1]
}

/**
 * The credit value a rarity starts at. Badges that promise "a Legendary or
 * better" need a number to draw against, and taking it from the same table
 * the frames come from means a promise and a frame can never disagree.
 */
export const RARITY_MIN: Record<Rarity['key'], number> = RARITIES.reduce(
  (acc, r) => ({ ...acc, [r.key]: r.min }),
  {} as Record<Rarity['key'], number>,
)

/** Display names, for prose that names a tier rather than framing a card. */
export const RARITY_NAMES: Record<Rarity['key'], string> = RARITIES.reduce(
  (acc, r) => ({ ...acc, [r.key]: r.name }),
  {} as Record<Rarity['key'], string>,
)

/* ----------------------------------------------------------------- coins */

/**
 * A coin.
 *
 * There used to be nine of them -- copper, bronze, silver, electrum, gold,
 * rose gold, platinum, mythril, solar -- drawn from a weighted ladder. Nobody
 * could tell electrum from mythril, or say which was worth more, so the ladder
 * was nine names for "some credits". One coin now, worth a band of credits
 * that the Fortune upgrade widens.
 */
export const COIN_BASE_MIN = 20
export const COIN_BASE_MAX = 110

/**
 * Base chance for a coin to drop alongside a roll.
 *
 * One summon in fifty, down from one in twenty-five. A drop that lands on
 * every other pack is scenery; this one is an event, and it is worth more
 * when it happens.
 */
export const BASE_COIN_CHANCE = 0.02

/** Roll for a coin. `chance` is the final probability, `valueMult` its worth. */
export function rollCoinDrop(chance: number, valueMult: number): { amount: number } | null {
  if (Math.random() >= chance) return null
  return { amount: coinAmount(valueMult) }
}

export function coinAmount(valueMult: number): number {
  const roll = COIN_BASE_MIN + Math.random() * (COIN_BASE_MAX - COIN_BASE_MIN)
  return Math.max(1, Math.round(roll * valueMult))
}

/* ------------------------------------------------------------- constants */

/** Credit compensation rate for rolling a character you already own. */
export const DUPLICATE_RATE = 0.1

/**
 * What a pack costs, per card in it.
 *
 * Packs used to be free, which meant credits had nothing to do but pile up
 * until the shop was finished -- about ten minutes' work. A pack is the thing
 * credits are *for* now: it costs less than the cards inside are worth, so
 * opening one and selling what you do not want is the loop, and every upgrade
 * is paid for out of that margin.
 */
export const PACK_COST_PER_CARD = 12

export function packCost(size: number): number {
  return Math.max(0, Math.round(size * PACK_COST_PER_CARD))
}

export function duplicateCompensation(value: number, mult: number): number {
  return Math.max(1, Math.round(value * DUPLICATE_RATE * mult))
}

/** Daily shrine offering: base amount, +10 per consecutive day up to +60. */
export const DAILY_BASE = 100
export const DAILY_STREAK_STEP = 10
export const DAILY_STREAK_CAP = 6
/** Hours between daily offerings, and the window that keeps a streak alive. */
export const DAILY_INTERVAL_H = 20
export const DAILY_STREAK_WINDOW_H = 48

export function dailyAmount(streak: number, mult: number): number {
  const bonus = DAILY_STREAK_STEP * Math.min(Math.max(streak - 1, 0), DAILY_STREAK_CAP)
  return (DAILY_BASE + bonus) * mult
}

/** One-time credit awards for collecting N characters of the same series. */
export const SERIES_MILESTONES: { count: number; reward: number }[] = [
  { count: 3, reward: 150 },
  { count: 5, reward: 400 },
  { count: 10, reward: 1000 },
]
