/**
 * Client store.
 *
 * The rules moved to the server: this holds a mirror of the authoritative
 * snapshot plus the things only the browser cares about (which card is
 * selected, whether a deal animation is playing, toasts). Every mutating
 * action is a request whose reply replaces the mirror.
 *
 * Two clocks exist. Cooldowns are stamped by the server, so `now` is the local
 * clock corrected by the offset measured on the last snapshot; without that, a
 * browser a minute fast shows "claim ready" a minute early.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LayoutKey, OwnedCharacter, RolledCharacter, ThemeKey, Toast } from './types'
import { DAILY_INTERVAL_H, rarityOf } from './economy'
import { computeEffects, type BadgeEffects, type BadgeKey, type Badges } from './badges'
import { bindSoundSettings, dealStepMs, sfx } from './sound'
import { ApiError, api, type RollResult, type ServerSettings, type Snapshot } from '../api'

export const CONSUMABLES = {
  rollRefill: { name: 'Roll Refill', icon: '↻', description: 'Instantly refill your rolls to maximum', cost: 200 },
  claimReset: { name: 'Claim Incense', icon: '◷', description: 'Make your claim available right now', cost: 500 },
} as const
export type ConsumableKey = keyof typeof CONSUMABLES

const HOUR = 3_600_000
const EMPTY_BADGES: Badges = { bronze: 0, silver: 0, gold: 0, sapphire: 0, ruby: 0, emerald: 0 }
const EMPTY_SETTINGS: ServerSettings = {
  mode: 'fun',
  rollGender: 'everyone',
  poolSize: 10000,
  skipOwned: false,
}

let toastSeq = 1

interface GameState {
  /* session */
  booting: boolean
  authed: boolean
  needsSetup: boolean
  username: string
  isAdmin: boolean
  /** Currently playing the throwaway sandbox profile. */
  sandbox: boolean
  /** Allowed to switch the sandbox on at all. */
  sandboxAllowed: boolean

  /* mirrored from the server */
  credits: number
  collection: OwnedCharacter[]
  wishes: RolledCharacter[]
  badges: Badges
  settings: ServerSettings
  rollsLeft: number
  rollsMax: number
  rollsResetAt: number
  multiReadyAt: number
  multiSize: number
  nextClaimAt: number
  lastDailyAt: number
  dailyStreak: number
  lastRitualAt: number
  totalRolls: number
  totalClaims: number
  pendingCoins: { tier: string; amount: number } | null
  /**
   * The pack currently on screen, if the last summon was one. Presentation
   * only: its cards are already claimed by the time it arrives.
   */
  pack: { state: 'sealed' | 'sliced' | 'open'; revealed: number; claimed: number; bonus: number } | null

  /* browser only */
  rolled: RollResult[]
  selected: number
  rolling: boolean
  rollCount: number
  dealUntil: number
  clockOffset: number
  now: number
  error: string | null
  toasts: Toast[]

  effects: () => BadgeEffects
  maxRolls: () => number
  claimReady: () => boolean
  multiReady: () => boolean
  dailyReady: () => boolean
  ritualReadyAt: () => number

  boot: () => Promise<void>
  signIn: (username: string, password: string) => Promise<string | null>
  signUp: (username: string, password: string, invite?: string) => Promise<string | null>
  signOut: () => Promise<void>

  tick: () => void
  roll: (count?: number) => Promise<void>
  selectRolled: (index: number) => void
  claim: () => Promise<void>
  claimAll: () => Promise<void>
  collectCoins: () => Promise<void>
  slicePack: () => void
  tearPack: () => void
  revealNext: () => void
  setSandbox: (on: boolean) => Promise<void>
  claimDaily: () => Promise<void>
  claimRitual: () => Promise<void>
  sell: (id: number) => Promise<void>
  sellMany: (ids: number[]) => Promise<void>
  addWish: (char: RolledCharacter) => Promise<void>
  removeWish: (id: number) => Promise<void>
  buyBadge: (key: BadgeKey) => Promise<void>
  buyConsumable: (key: ConsumableKey) => Promise<void>
  updateSettings: (patch: Partial<ServerSettings>) => Promise<void>
  grantCredits: (amount: number) => Promise<void>
  resetSave: (username: string, password: string) => Promise<string | null>
  clearError: () => void
  pushToast: (text: string, flavor?: Toast['flavor']) => void
  dismissToast: (id: number) => void
}

export const useGame = create<GameState>()((set, get) => {
  /** Fold an authoritative snapshot into the mirror. */
  const apply = (s: Snapshot) =>
    set((prev) => ({
      authed: true,
      username: s.username,
      isAdmin: s.isAdmin,
      sandbox: s.sandbox,
      sandboxAllowed: s.sandboxAllowed,
      credits: s.credits,
      collection: s.collection ?? prev.collection,
      wishes: s.wishes,
      badges: s.badges,
      settings: s.settings,
      rollsLeft: s.rollsLeft,
      rollsMax: s.rollsMax,
      rollsResetAt: s.rollsResetAt,
      multiReadyAt: s.multiReadyAt,
      multiSize: s.multiSize,
      nextClaimAt: s.nextClaimAt,
      lastDailyAt: s.lastDailyAt,
      dailyStreak: s.dailyStreak,
      lastRitualAt: s.lastRitualAt,
      totalRolls: s.totalRolls,
      totalClaims: s.totalClaims,
      pendingCoins: s.pendingCoins,
      clockOffset: s.serverNow - Date.now(),
      now: s.serverNow,
    }))

  /** Run a call, surfacing the server's own message and never wedging the UI. */
  const guard = async <T,>(fn: () => Promise<T>, onError?: (m: string) => void): Promise<T | null> => {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        set({ authed: false })
        return null
      }
      const message = e instanceof ApiError ? e.message : 'The instance is unreachable.'
      sfx.error()
      if (onError) onError(message)
      else set({ error: message })
      return null
    }
  }

  return {
    booting: true,
    authed: false,
    needsSetup: false,
    username: '',
    isAdmin: false,
    sandbox: false,
    sandboxAllowed: false,

    credits: 0,
    collection: [],
    wishes: [],
    badges: { ...EMPTY_BADGES },
    settings: { ...EMPTY_SETTINGS },
    rollsLeft: 0,
    rollsMax: 0,
    rollsResetAt: 0,
    multiReadyAt: 0,
    multiSize: 10,
    nextClaimAt: 0,
    lastDailyAt: 0,
    dailyStreak: 0,
    lastRitualAt: 0,
    totalRolls: 0,
    totalClaims: 0,
    pendingCoins: null,
    pack: null,

    rolled: [],
    selected: 0,
    rolling: false,
    rollCount: 0,
    dealUntil: 0,
    clockOffset: 0,
    now: Date.now(),
    error: null,
    toasts: [],

    effects: () => computeEffects(get().badges),
    // The server owns the budget; the badge term is already folded into it.
    maxRolls: () => get().rollsMax,
    claimReady: () => {
      const s = get()
      // Fun mode never advances the claim cooldown server-side, but a stale
      // one can survive a switch out of normal mode; the client must agree
      // with the server about that rather than disabling a working button.
      return s.sandbox || s.settings.mode === 'fun' || s.now >= s.nextClaimAt
    },
    multiReady: () => {
      const s = get()
      return s.sandbox || s.now >= s.multiReadyAt
    },
    dailyReady: () => {
      const s = get()
      return s.sandbox || s.now - s.lastDailyAt >= DAILY_INTERVAL_H * HOUR
    },
    ritualReadyAt: () => {
      const s = get()
      const fx = s.effects()
      if (!fx.claimResetUnlocked) return Infinity
      if (s.sandbox) return 0
      return s.lastRitualAt + fx.claimResetHours * HOUR
    },

    boot: async () => {
      try {
        const me = await api.me()
        if (!me.player) {
          set({ authed: false, needsSetup: me.needsSetup })
          return
        }
        apply(await api.state())
      } catch {
        set({ error: 'Cannot reach the instance.' })
      } finally {
        set({ booting: false })
      }
    },

    signIn: async (username, password) => {
      try {
        await api.login(username, password)
        apply(await api.state())
        sfx.tap()
        return null
      } catch (e) {
        return e instanceof ApiError ? e.message : 'Cannot reach the instance.'
      }
    },

    signUp: async (username, password, invite) => {
      try {
        await api.register(username, password, invite)
        apply(await api.state())
        sfx.tap()
        return null
      } catch (e) {
        return e instanceof ApiError ? e.message : 'Cannot reach the instance.'
      }
    },

    signOut: async () => {
      await api.logout().catch(() => {})
      set({ authed: false, rolled: [], collection: [], username: '', isAdmin: false, sandbox: false })
    },

    tick: () => set((s) => ({ now: Date.now() + s.clockOffset })),

    roll: async (count = 1) => {
      const s = get()
      if (s.rolling || s.now < s.dealUntil) return
      sfx.rollStart(count)
      set({ rolling: true, error: null, pendingCoins: null })
      const res = await guard(() => api.roll(count))
      if (!res) {
        set({ rolling: false })
        return
      }
      const firstFresh = res.results.findIndex((r) => !r.owned)
      apply(res.state)
      set((prev) => ({
        rolled: res.results,
        selected: firstFresh === -1 ? 0 : firstFresh,
        rolling: false,
        rollCount: prev.rollCount + 1,
        pack: res.pack
          ? { state: 'sealed' as const, revealed: 0, claimed: res.claimed, bonus: res.bonus }
          : null,
        dealUntil:
          Date.now() + prev.clockOffset + res.results.length * dealStepMs(res.results.length) + 700,
      }))
      // A sealed pack sounds out as it is opened, not as it arrives.
      if (res.pack) return
      const best = res.results.reduce((m, r) => Math.max(m, r.char.creditValue), 0)
      sfx.reveal(rarityOf(best).key, res.results.length)
      if (res.results.some((r) => r.wished && !r.owned)) {
        sfx.wish()
        get().pushToast('A wish appears before you.', 'wish')
      }
    },

    selectRolled: (index) => {
      const s = get()
      if (index >= 0 && index < s.rolled.length && index !== s.selected) {
        sfx.tap()
        set({ selected: index })
      }
    },

    claim: async () => {
      const s = get()
      const entry = s.rolled[s.selected]
      if (!entry || entry.owned) return
      sfx.claim()
      const res = await guard(() => api.claim(entry.char.id))
      if (!res) return
      apply(res.state)
      set((prev) => ({
        rolled: prev.rolled.map((r, i) =>
          i === prev.selected ? { ...r, owned: true, compensation: 0 } : r,
        ),
      }))
      for (const note of res.notes) get().pushToast(note, 'credits')
      if (res.notes.length > 0) sfx.payout(0.3)
    },

    claimAll: async () => {
      const res = await guard(() => api.claimAll())
      if (!res) return
      sfx.claim()
      if (res.bonus > 0) sfx.payout(0.3)
      apply(res.state)
      set((prev) => ({
        rolled: prev.rolled.map((r) => (r.owned ? r : { ...r, owned: true, compensation: 0 })),
      }))
      get().pushToast(
        `Claimed ${res.claimed} character${res.claimed === 1 ? '' : 's'}${res.bonus > 0 ? ` (+${res.bonus} credits)` : ''} (sandbox)`,
        'info',
      )
    },

    collectCoins: async () => {
      sfx.coins()
      const res = await guard(() => api.coins())
      if (res) apply(res.state)
    },

    /** Cut the wrapper: the cards are there, waiting to be turned over. */
    slicePack: () => {
      const s = get()
      if (!s.pack || s.pack.state !== 'sealed') return
      sfx.rollStart(1)
      set({ pack: { ...s.pack, state: 'sliced' } })
    },

    /** Tear it open and take the lot in one go. */
    tearPack: () => {
      const s = get()
      if (!s.pack || s.pack.state === 'open') return
      const best = s.rolled.reduce((m, r) => Math.max(m, r.char.creditValue), 0)
      sfx.reveal(rarityOf(best).key, s.rolled.length)
      set({ pack: { ...s.pack, state: 'open', revealed: s.rolled.length } })
    },

    /** Slide the top card off a sliced pack. */
    revealNext: () => {
      const s = get()
      if (!s.pack || s.pack.state !== 'sliced') return
      const next = s.pack.revealed + 1
      const entry = s.rolled[s.pack.revealed]
      if (entry) sfx.reveal(rarityOf(entry.char.creditValue).key, 1)
      set({
        selected: s.pack.revealed,
        pack: { ...s.pack, revealed: next, state: next >= s.rolled.length ? 'open' : 'sliced' },
      })
    },

    setSandbox: async (on) => {
      const res = await guard(() => api.sandbox(on))
      if (!res) return
      apply(res.state)
      set({ rolled: [], selected: 0, pack: null })
      get().pushToast(
        on
          ? 'Sandbox on. This is a scratch profile: nothing here is kept.'
          : 'Sandbox off, and its data is gone. Back to your own collection.',
        'info',
      )
    },

    claimDaily: async () => {
      sfx.daily()
      const res = await guard(() => api.daily())
      if (!res) return
      apply(res.state)
      get().pushToast(
        `Daily offering: +${res.amount} credits${res.streak > 1 ? ` (day ${res.streak} streak)` : ''}`,
        'credits',
      )
    },

    claimRitual: async () => {
      sfx.wish()
      const res = await guard(() => api.ritual())
      if (!res) return
      apply(res.state)
      get().pushToast('The ritual is complete. Your claim is ready.', 'info')
    },

    sell: async (id) => {
      sfx.sell()
      const res = await guard(() => api.sell([id]))
      if (res) apply(res.state)
    },

    sellMany: async (ids) => {
      const res = await guard(() => api.sell(ids, true))
      if (!res) return
      sfx.sell()
      apply(res.state)
      get().pushToast(
        `Sold ${res.sold} character${res.sold === 1 ? '' : 's'} for +${res.total} credits (sandbox)`,
        'credits',
      )
    },

    addWish: async (char) => {
      sfx.tap()
      const res = await guard(
        () => api.addWish(char.id),
        (m) => get().pushToast(m, 'info'),
      )
      if (res) apply(res.state)
    },

    removeWish: async (id) => {
      const res = await guard(() => api.removeWish(id))
      if (res) apply(res.state)
    },

    buyBadge: async (key) => {
      sfx.buy()
      const res = await guard(
        () => api.buyBadge(key),
        (m) => get().pushToast(m, 'info'),
      )
      if (res) apply(res.state)
    },

    buyConsumable: async (key) => {
      sfx.buy()
      const res = await guard(
        () => api.buyItem(key),
        (m) => get().pushToast(m, 'info'),
      )
      if (res) apply(res.state)
    },

    updateSettings: async (patch) => {
      const res = await guard(() => api.updateSettings(patch))
      if (res) apply(res.state)
    },

    grantCredits: async (amount) => {
      const res = await guard(() => api.grant(amount))
      if (res) apply(res.state)
    },

    /** Wiping a collection asks for the account's own credentials first. */
    resetSave: async (username, password) => {
      let failure: string | null = null
      const res = await guard(
        () => api.reset(username, password),
        (m) => {
          failure = m
        },
      )
      if (!res) return failure ?? 'Could not reach the instance.'
      apply(res.state)
      set({ rolled: [], selected: 0, rollCount: 0, pack: null })
      get().pushToast('Your collection has been erased.', 'info')
      return null
    },

    clearError: () => set({ error: null }),

    pushToast: (text, flavor) =>
      set((prev) => ({ toasts: [...prev.toasts.slice(-3), { id: toastSeq++, text, flavor }] })),

    dismissToast: (id) => set((prev) => ({ toasts: prev.toasts.filter((t) => t.id !== id) })),
  }
})

/* ---------------------------------------------------------------------------
   Presentation settings stay on the device. Theme, layout and volume are not
   rules, nobody can cheat with them, and syncing them would mean a player's
   phone dictated how the app looks on their laptop.
   ------------------------------------------------------------------------- */

interface UiSettings {
  theme: ThemeKey
  layout: LayoutKey
  soundEnabled: boolean
  soundVolume: number
  set: (patch: Partial<Omit<UiSettings, 'set'>>) => void
}

export const useUi = create<UiSettings>()(
  persist(
    (set) => ({
      theme: 'arcade',
      layout: 'stage',
      soundEnabled: true,
      soundVolume: 0.6,
      set: (patch) => set(patch),
    }),
    { name: 'anico-ui' },
  ),
)

bindSoundSettings(() => {
  const { soundEnabled, soundVolume } = useUi.getState()
  return { soundEnabled, soundVolume }
})

/** Formats a ms duration as h:mm:ss or m:ss. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}
