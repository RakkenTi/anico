/**
 * Server-owned settings and pacing.
 *
 * The old client store mixed two unrelated things under "settings": rules the
 * game runs by, and how the app looks and sounds. Only the first kind lives
 * here, because only the first kind can be enforced. Theme, layout and volume
 * stay on the client, where getting them wrong costs nothing.
 *
 * Pacing is a third kind again, and it is not a setting at all. Roll budgets
 * and claim cooldowns used to be player-editable sliders, which on a shared
 * instance means every player quietly sets their own difficulty. They are
 * constants now; the only way to summon more is to earn it in the shop.
 */

export type RollGender = 'female' | 'male' | 'everyone'

export const PACING = {
  /** Single summons granted each hour, before badges add to it. */
  rollsPerHour: 10,
  rollResetMinutes: 60,
  /** The ×10 spread is its own allowance: once a day, no hourly rolls spent. */
  multiRollSize: 10,
  multiRollIntervalHours: 24,
  /** One claim an hour, whichever summon it came from. */
  claimIntervalMinutes: 60,
} as const

export interface ServerSettings {
  rollGender: RollGender
  /** Size of the pool rolls draw from: the top N characters by favourites. */
  poolSize: number
  /** Never roll a character this player already owns. */
  skipOwned: boolean
}

export const DEFAULT_SETTINGS: ServerSettings = {
  rollGender: 'everyone',
  poolSize: 10000,
  skipOwned: false,
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

/**
 * Accept only known keys, in range. Settings arrive from the client, and what
 * is left here is preference: who shows up in a roll, and how wide the pool
 * is. Nothing in this object changes how fast anyone plays.
 */
export function sanitizeSettings(patch: any, current: ServerSettings): ServerSettings {
  const next = { ...current }
  if (patch?.rollGender === 'female' || patch?.rollGender === 'male' || patch?.rollGender === 'everyone') {
    next.rollGender = patch.rollGender
  }
  if (patch?.poolSize !== undefined) next.poolSize = clampInt(patch.poolSize, 100, 100_000, current.poolSize)
  if (typeof patch?.skipOwned === 'boolean') next.skipOwned = patch.skipOwned
  return next
}
