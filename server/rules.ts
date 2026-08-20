/**
 * Server-owned settings.
 *
 * The old client store mixed two unrelated things under "settings": rules the
 * game runs by, and how the app looks and sounds. Only the first kind lives
 * here, because only the first kind can be enforced. Theme, layout and volume
 * stay on the client, where getting them wrong costs nothing.
 *
 * There is no pacing left to keep. Roll budgets and claim cooldowns were once
 * player-editable sliders, then instance constants, and are now gone entirely:
 * summoning and claiming are free, and the only thing still worth earning is
 * what the shop sells.
 */

import { POOL_EVERYTHING, POOL_MIN } from '../src/game/pool.js'
import { RARITY_MIN } from '../src/game/economy.js'

export type RollGender = 'female' | 'male' | 'everyone'

/**
 * Which pulls are sold the moment they arrive.
 *
 * "rare" means "sell anything below Rare". Never touches a wish come true or a
 * stack that has started to merge -- those are the two things in the game
 * worth keeping, and a convenience that throws them away is a trap.
 */
export type AutoSell = 'off' | 'rare' | 'epic' | 'legendary' | 'mythic'

export function autoSellFloor(mode: AutoSell): number {
  switch (mode) {
    case 'rare':
      return RARITY_MIN.rare
    case 'epic':
      return RARITY_MIN.epic
    case 'legendary':
      return RARITY_MIN.legendary
    case 'mythic':
      return RARITY_MIN.mythic
    default:
      return 0
  }
}

export interface ServerSettings {
  rollGender: RollGender
  /** Sell every pull below this rarity as it lands. */
  autoSell: AutoSell
  /** Size of the pool rolls draw from: the top N characters by favourites. */
  poolSize: number
  /** Never roll a character this player already owns. */
  skipOwned: boolean
}

export const DEFAULT_SETTINGS: ServerSettings = {
  rollGender: 'everyone',
  autoSell: 'off',
  poolSize: POOL_EVERYTHING,
  skipOwned: false,
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

/**
 * Accept only known keys, in range. Settings arrive from the client, and what
 * is left here is preference: who shows up in a roll, and how wide the pool
 * is. Nothing in this object changes what anyone can afford.
 */
export function sanitizeSettings(patch: any, current: ServerSettings): ServerSettings {
  const next = { ...current }
  if (patch?.rollGender === 'female' || patch?.rollGender === 'male' || patch?.rollGender === 'everyone') {
    next.rollGender = patch.rollGender
  }
  if (patch?.poolSize !== undefined) {
    next.poolSize = clampInt(patch.poolSize, POOL_MIN, POOL_EVERYTHING, current.poolSize)
  }
  if (['off', 'rare', 'epic', 'legendary', 'mythic'].includes(patch?.autoSell)) {
    next.autoSell = patch.autoSell
  }
  if (typeof patch?.skipOwned === 'boolean') next.skipOwned = patch.skipOwned
  return next
}
