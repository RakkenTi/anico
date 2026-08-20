/**
 * Credit economy.
 *
 * A character's credit value derives from its AniList popularity
 * (favourites count) on a power curve: the most-favourited characters
 * land around 850-900 credits, mid-tier around 100-300, and obscure
 * ones bottom out near 20, mirroring Mudae's value spread.
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

/* ----------------------------------------------------------------- coins */

export interface CoinTier {
  key: string
  label: string
  color: string
  min: number
  max: number
  weight: number
}

/**
 * Coin drops, a ladder of minted metals. Each drops a band of credits when
 * gathered. The ladder keeps a spread of hues rather than nine shades of
 * brown, so a drop still reads at a glance which tier it was.
 */
export const COIN_TIERS: CoinTier[] = [
  { key: 'copper', label: 'Copper Coin', color: '#b87333', min: 1, max: 5, weight: 35 },
  { key: 'bronze', label: 'Bronze Coin', color: '#cd7f32', min: 8, max: 25, weight: 25 },
  { key: 'silver', label: 'Silver Coin', color: '#c3ccd9', min: 25, max: 50, weight: 14 },
  { key: 'electrum', label: 'Electrum Coin', color: '#dcc98a', min: 50, max: 90, weight: 10 },
  { key: 'gold', label: 'Gold Coin', color: '#f2b632', min: 90, max: 140, weight: 7 },
  { key: 'rose', label: 'Rose Gold Coin', color: '#e9a6a0', min: 140, max: 220, weight: 4.5 },
  { key: 'platinum', label: 'Platinum Coin', color: '#dfe9f5', min: 220, max: 350, weight: 2.8 },
  { key: 'mythril', label: 'Mythril Coin', color: '#9fe8ff', min: 350, max: 500, weight: 1.4 },
  { key: 'solar', label: 'Solar Coin', color: '#fff3b0', min: 500, max: 800, weight: 0.3 },
]

export function coinTier(key: string): CoinTier {
  return COIN_TIERS.find((t) => t.key === key) ?? COIN_TIERS[0]
}

/**
 * Base chance for a coin to drop alongside a roll.
 *
 * Roughly one summon in twenty-five. Coins used to land on nearly a quarter of
 * all rolls, which made them background noise rather than an event; the badge
 * bonuses are scaled to match, so a maxed loadout still roughly triples the
 * rate instead of drowning the base.
 */
export const BASE_COIN_CHANCE = 0.04

/**
 * Roll for a coin drop. `chance` is the final drop probability;
 * `upgradeLow` (Sapphire IV) bumps Copper/Bronze drops one tier up.
 */
export function rollCoinDrop(
  chance: number,
  upgradeLow: boolean,
): { tier: string; amount: number } | null {
  if (Math.random() >= chance) return null
  const total = COIN_TIERS.reduce((s, t) => s + t.weight, 0)
  let pick = Math.random() * total
  for (const t of COIN_TIERS) {
    pick -= t.weight
    if (pick <= 0) {
      let tier = t
      if (upgradeLow && (t.key === 'copper' || t.key === 'bronze')) {
        tier = coinTier(t.key === 'copper' ? 'bronze' : 'silver')
      }
      const amount = Math.round(tier.min + Math.random() * (tier.max - tier.min))
      return { tier: tier.key, amount }
    }
  }
  return null
}

/* ------------------------------------------------------------- constants */

/** Credit compensation rate for rolling a character you already own. */
export const DUPLICATE_RATE = 0.1

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
