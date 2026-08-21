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
import { getMeta, setMeta, type DB } from './db.js'
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
  /** Never roll a character this player already owns. */
  skipOwned: boolean
  /**
   * Let Auto Aim point Called Shot for you.
   *
   * A setting rather than a second purchase: the upgrade is what makes the
   * machine capable of aiming, and this is whether it is allowed to. Default
   * on, because nobody buys Auto Aim in order to leave it off, and off is one
   * switch away for a player who wants the crosshair back.
   */
  autoAim: boolean
}

export const DEFAULT_SETTINGS: ServerSettings = {
  rollGender: 'everyone',
  autoSell: 'off',
  skipOwned: false,
  autoAim: true,
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

/**
 * How wide a net every roll on this instance casts.
 *
 * One number for everybody, set by the admin. A pool is not a preference: the
 * top two thousand characters are worth several times what the long tail is,
 * so a narrower pool is a richer game, and a player who can pick their own is
 * playing a different one from the person next to them.
 */
export function instancePool(db: DB): number {
  const raw = Number(getMeta(db, POOL_KEY))
  if (!Number.isFinite(raw)) return POOL_EVERYTHING
  return Math.min(POOL_EVERYTHING, Math.max(POOL_MIN, Math.round(raw)))
}

export function setInstancePool(db: DB, value: unknown): number {
  const next = clampInt(value, POOL_MIN, POOL_EVERYTHING, POOL_EVERYTHING)
  setMeta(db, POOL_KEY, String(next))
  return next
}

const POOL_KEY = 'pool_size'

/**
 * Accept only known keys. Settings arrive from the client, and what is left
 * here is preference: who shows up in a roll, and what happens to the cards
 * nobody wants. Nothing in this object changes what anyone can afford.
 *
 * The pool used to live here, which made how rich the catalog is a per-player
 * choice: narrowing it to the top two thousand raises every card's value and is
 * a straightforward way to play a different, easier game than everyone else on
 * the instance. It belongs to the instance now (see `instancePool`).
 */
export function sanitizeSettings(patch: any, current: ServerSettings): ServerSettings {
  const next = { ...current }
  if (patch?.rollGender === 'female' || patch?.rollGender === 'male' || patch?.rollGender === 'everyone') {
    next.rollGender = patch.rollGender
  }
  if (['off', 'rare', 'epic', 'legendary', 'mythic'].includes(patch?.autoSell)) {
    next.autoSell = patch.autoSell
  }
  if (typeof patch?.skipOwned === 'boolean') next.skipOwned = patch.skipOwned
  if (typeof patch?.autoAim === 'boolean') next.autoAim = patch.autoAim
  return next
}
