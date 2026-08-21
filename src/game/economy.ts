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
 * One summon in fifty. Coins are gathered the moment they fall -- there was a
 * button to press, which is a strange thing to ask of someone who has just
 * been handed money.
 */
export const BASE_COIN_CHANCE = 0.02

/** What a coin is worth on average, for pulls too large to roll one by one. */
export const COIN_BASE_MEAN = (COIN_BASE_MIN + COIN_BASE_MAX) / 2

/** Roll for a coin. `chance` is the final probability, `valueMult` its worth. */
export function rollCoinDrop(chance: number, valueMult: number): { amount: number } | null {
  if (Math.random() >= chance) return null
  return { amount: coinAmount(valueMult) }
}

export function coinAmount(valueMult: number): number {
  const roll = COIN_BASE_MIN + Math.random() * (COIN_BASE_MAX - COIN_BASE_MIN)
  return Math.max(1, Math.round(roll * valueMult))
}

/* ------------------------------------------------- duplicates and merging */

/**
 * Copies of one character, and what they are worth together.
 *
 * A duplicate used to pay a few credits and vanish, which meant a collection
 * was a thing you passed through on the way to selling it. Copies stack now,
 * and every doubling of a stack merges it one star higher: two copies make a
 * ★1, four a ★2, eight a ★3, and so on. A star multiplies what the whole stack
 * fetches, so holding sixteen copies of a common beats selling sixteen commons
 * by a wide margin -- which is the only reason anyone would keep them.
 */
export const MERGE_MULT = 2.6
/**
 * Stars a stack can reach: one per doubling, so twelve is four thousand
 * copies of one character. It used to stop at six -- sixty-four copies --
 * which a late-game pull reaches in an afternoon, and a cap you hit is a
 * reason to stop keeping things.
 */
export const MAX_STARS = 12

/**
 * The star a stack of `copies` has merged to: one per doubling.
 *
 * The ceiling is a floor, not a fact: Deeper Merges raises it, so callers that
 * know whose stack it is pass the player's own. Twelve is what it is worth
 * before anybody has bought any (ADR 0013).
 */
export function starsFor(copies: number, cap: number = MAX_STARS): number {
  if (copies < 2) return 0
  return Math.min(Math.max(0, Math.floor(cap)), Math.floor(Math.log2(copies)))
}

/**
 * What a whole stack sells for: the merged core, plus the copies that have not
 * found a partner yet at face value.
 *
 * `bonus` is Merge Value, and it multiplies the finished stack rather than the
 * per-star rate. Per star is an *exponent* -- a stack merges to eighteen stars
 * -- so a line that raised `mult` by a flat amount a level multiplied income
 * by nearly two per level against a price that only doubled, and paid for
 * itself on every rung forever. This is the same idea priced honestly.
 */
export function stackValue(
  value: number,
  copies: number,
  stars: number,
  bonus = 1,
  mult = MERGE_MULT,
): number {
  const merged = Math.pow(2, stars)
  const leftover = Math.max(0, copies - merged)
  return Math.max(1, Math.round((value * Math.pow(mult, stars) + leftover * value) * bonus))
}

/** Names for the star tiers, so a card can say what it has become. */
export const STAR_NAMES = [
  '', 'Gleaming', 'Radiant', 'Prismatic', 'Astral', 'Eclipse', 'Zenith',
  'Empyrean', 'Ascendant', 'Sovereign', 'Everlight', 'Apotheosis', 'Absolute',
]

/* ------------------------------------------------------------- constants */

/**
 * Credit compensation rate for rolling a character you already own.
 *
 * A consolation prize rather than an income: the duplicate itself is the
 * reward now, because it is what merges a stack up a star.
 */
export const DUPLICATE_RATE = 0.04

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
