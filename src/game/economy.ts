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

/* ------------------------------------------------------------------ gems */

export interface GemTier {
  key: string
  label: string
  color: string
  min: number
  max: number
  weight: number
}

/** Gem tiers modeled on Mudae's kakera reaction colors. Each drops a
    band of credits when gathered. */
export const GEM_TIERS: GemTier[] = [
  { key: 'P', label: 'Purple Gem', color: '#b07cf7', min: 1, max: 5, weight: 35 },
  { key: 'B', label: 'Blue Gem', color: '#5aa2ff', min: 8, max: 25, weight: 25 },
  { key: 'T', label: 'Teal Gem', color: '#43d9c6', min: 25, max: 50, weight: 14 },
  { key: 'G', label: 'Green Gem', color: '#6fdd6b', min: 50, max: 90, weight: 10 },
  { key: 'Y', label: 'Yellow Gem', color: '#f5d647', min: 90, max: 140, weight: 7 },
  { key: 'O', label: 'Orange Gem', color: '#ff9d3c', min: 140, max: 220, weight: 4.5 },
  { key: 'R', label: 'Red Gem', color: '#ff5d5d', min: 220, max: 350, weight: 2.8 },
  { key: 'W', label: 'Rainbow Gem', color: '#e88bff', min: 350, max: 500, weight: 1.4 },
  { key: 'L', label: 'Light Gem', color: '#fff3b0', min: 500, max: 800, weight: 0.3 },
]

export function gemTier(key: string): GemTier {
  return GEM_TIERS.find((t) => t.key === key) ?? GEM_TIERS[0]
}

/** Base chance for a gem to drop alongside a roll. */
export const BASE_GEM_CHANCE = 0.22

/**
 * Roll for a gem drop. `chance` is the final drop probability;
 * `upgradeLow` (Sapphire IV) bumps Purple/Blue drops one tier up.
 */
export function rollGemDrop(
  chance: number,
  upgradeLow: boolean,
): { tier: string; amount: number } | null {
  if (Math.random() >= chance) return null
  const total = GEM_TIERS.reduce((s, t) => s + t.weight, 0)
  let pick = Math.random() * total
  for (const t of GEM_TIERS) {
    pick -= t.weight
    if (pick <= 0) {
      let tier = t
      if (upgradeLow && (t.key === 'P' || t.key === 'B')) {
        tier = gemTier(t.key === 'P' ? 'B' : 'T')
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
