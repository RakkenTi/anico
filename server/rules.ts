/**
 * Server-owned settings.
 *
 * The old client store mixed two unrelated things under "settings": rules the
 * game runs by, and how the app looks and sounds. Only the first kind lives
 * here, because only the first kind can be enforced. Theme, layout and volume
 * stay on the client, where getting them wrong costs nothing.
 */

export type RollGender = 'female' | 'male' | 'everyone'

export interface ServerSettings {
  rollGender: RollGender
  /** Size of the pool rolls draw from: the top N characters by favourites. */
  poolSize: number
  rollsPerReset: number
  rollResetMinutes: number
  claimIntervalMinutes: number
  /** Never roll a character this player already owns. */
  skipOwned: boolean
}

export const DEFAULT_SETTINGS: ServerSettings = {
  rollGender: 'everyone',
  poolSize: 10000,
  rollsPerReset: 10,
  rollResetMinutes: 60,
  claimIntervalMinutes: 180,
  skipOwned: false,
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

/** Accept only known keys, in range. Settings arrive from the client. */
export function sanitizeSettings(patch: any, current: ServerSettings): ServerSettings {
  const next = { ...current }
  if (patch?.rollGender === 'female' || patch?.rollGender === 'male' || patch?.rollGender === 'everyone') {
    next.rollGender = patch.rollGender
  }
  if (patch?.poolSize !== undefined) next.poolSize = clampInt(patch.poolSize, 100, 100_000, current.poolSize)
  if (patch?.rollsPerReset !== undefined) {
    next.rollsPerReset = clampInt(patch.rollsPerReset, 1, 100, current.rollsPerReset)
  }
  if (patch?.rollResetMinutes !== undefined) {
    next.rollResetMinutes = clampInt(patch.rollResetMinutes, 1, 1440, current.rollResetMinutes)
  }
  if (patch?.claimIntervalMinutes !== undefined) {
    next.claimIntervalMinutes = clampInt(patch.claimIntervalMinutes, 0, 1440, current.claimIntervalMinutes)
  }
  if (typeof patch?.skipOwned === 'boolean') next.skipOwned = patch.skipOwned
  return next
}
