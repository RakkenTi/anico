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

export type RollGender = 'female' | 'male' | 'everyone'

export interface ServerSettings {
  rollGender: RollGender
  /** Size of the pool rolls draw from: the top N characters by favourites. */
  poolSize: number
  /** Never roll a character this player already owns. */
  skipOwned: boolean
}

export const DEFAULT_SETTINGS: ServerSettings = {
  rollGender: 'everyone',
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
  if (typeof patch?.skipOwned === 'boolean') next.skipOwned = patch.skipOwned
  return next
}
