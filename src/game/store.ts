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
import { EMPTY_BADGES, computeEffects, type BadgeKey, type Badges, type Effects } from './badges'
import { BASE_CARD_RATE, EMPTY_UPGRADES, type UpgradeKey, type Upgrades } from './upgrades'
import { POOL_EVERYTHING } from './pool'
import { bindSoundSettings, dealStepMs, setDealSpeed, sfx } from './sound'
import { fmt, fmtCount } from './format'
import {
  ApiError,
  api,
  listenForState,
  type RollResult,
  type ServerSettings,
  type Snapshot,
} from '../api'

const HOUR = 3_600_000
const EMPTY_SETTINGS: ServerSettings = {
  rollGender: 'everyone',
  autoSell: 'off',
  poolSize: POOL_EVERYTHING,
  skipOwned: false,
}

let toastSeq = 1

/** The live stream, if one is open. One per tab, whatever route opened it. */
let liveOff: (() => void) | null = null

type PackState = NonNullable<GameState['pack']>

/** One wrapper's cards: the pull is dealt in equal slices, pack by pack. */
export function stackCards(
  s: { rolled: RollResult[]; pack: PackState | null },
  index: number,
): RollResult[] {
  if (!s.pack) return []
  const from = index * s.pack.perPack
  return s.rolled.slice(from, from + s.pack.perPack)
}

/**
 * Ask the browser for a pull's artwork before it is needed.
 *
 * Card images come from AniList's CDN, and a spread that mounts two hundred
 * <img> tags at once turns into two hundred simultaneous requests exactly as
 * the deal animation starts -- which is how a pack opening ends up janking on
 * a phone. Warming them while the wrapper is still on costs nothing (the
 * requests are the same ones, just earlier) and the cards arrive decoded.
 */
const WARM_AHEAD = 60
function warmImages(results: RollResult[]): void {
  if (typeof Image === 'undefined') return
  for (const r of results.slice(0, WARM_AHEAD)) {
    const img = new Image()
    img.decoding = 'async'
    img.src = r.char.image
  }
}

const patchStack = (
  pack: PackState,
  index: number,
  patch: Partial<PackState['stacks'][number]>,
): PackState => ({
  ...pack,
  stacks: pack.stacks.map((st, i) => (i === index ? { ...st, ...patch } : st)),
})

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
  /** The instance's collection revision, and the one our copy was fetched at. */
  collectionRev: number
  collectionAt: number
  wishes: RolledCharacter[]
  badges: Badges
  upgrades: Upgrades
  settings: ServerSettings
  /** Cards a pack deals, or 0 while the shop has not unlocked them yet. */
  packSize: number
  /** Packs torn at a single press. */
  packsPerPull: number
  /** Cards one press draws, ceiling applied. */
  cardsPerPull: number
  /** What one press costs: every card in the pull. */
  packPrice: number
  /** Milliseconds between automatic pulls, or 0 while the Automaton is unbought. */
  autoSpinMs: number
  /** Cards a second the hands manage: what Swift Hands buys. */
  cardRate: number
  lastDailyAt: number
  dailyStreak: number
  totalRolls: number
  totalClaims: number
  /**
   * The packs currently on screen, if the last summon was a pull.
   *
   * Several of them, side by side, each with its own wrapper and its own
   * counter: Both Hands buys *packs*, not a bigger pack, and one enormous
   * stack is exactly what that upgrade should not look like. Presentation
   * only -- every card in every one of them is claimed by the time it arrives.
   */
  pack: {
    perPack: number
    claimed: number
    bonus: number
    stacks: { state: 'sealed' | 'sliced' | 'open'; revealed: number }[]
  } | null

  /* browser only */
  /**
   * Coins that have just been gathered, for the little rising markers over the
   * balance. They are already in `credits` -- these are the receipt, not the
   * money.
   */
  coinPops: { id: number; amount: number }[]
  /** The Automaton is running: it pulls on its own until it cannot pay. */
  autoSpin: boolean
  rolled: RollResult[]
  /** How the spread on screen is ordered: as dealt, or best card first. */
  rollSort: 'dealt' | 'rarity'
  selected: number
  rolling: boolean
  rollCount: number
  dealUntil: number
  clockOffset: number
  now: number
  error: string | null
  toasts: Toast[]

  effects: () => Effects
  dailyReady: () => boolean
  canAffordPack: () => boolean
  /** True while a pack is on screen with cards still to come out of it. */
  packBusy: () => boolean

  boot: () => Promise<void>
  /** Fetch the collection again when another device has changed it. */
  refreshCollection: () => Promise<void>
  signIn: (username: string, password: string) => Promise<string | null>
  signUp: (username: string, password: string, invite?: string) => Promise<string | null>
  signOut: () => Promise<void>

  tick: () => void
  roll: (packs?: number) => Promise<void>
  selectRolled: (index: number) => void
  setRollSort: (sort: 'dealt' | 'rarity') => void
  setAutoSpin: (on: boolean) => Promise<void>
  popCoins: (amount: number) => void
  dismissCoinPop: (id: number) => void
  slicePack: (index: number) => void
  tearPack: (index: number) => void
  finishPacks: () => void
  revealNext: (index: number) => void
  setSandbox: (on: boolean) => Promise<void>
  claimDaily: () => Promise<void>
  lock: (id: number, locked: boolean) => Promise<void>
  sell: (id: number) => Promise<void>
  sellMany: (ids: number[]) => Promise<void>
  addWish: (char: RolledCharacter) => Promise<void>
  removeWish: (id: number) => Promise<void>
  buyBadge: (key: BadgeKey) => Promise<void>
  buyUpgrade: (key: UpgradeKey) => Promise<void>
  updateSettings: (patch: Partial<ServerSettings>) => Promise<void>
  grantCredits: (amount: number) => Promise<void>
  resetSave: (username: string, password: string) => Promise<string | null>
  clearError: () => void
  pushToast: (text: string, flavor?: Toast['flavor']) => void
  dismissToast: (id: number) => void
}

export const useGame = create<GameState>()((set, get) => {
  /**
   * Fold an authoritative snapshot into the mirror.
   *
   * `adopt` is for the two moments a session begins -- boot and sign-in --
   * where the browser takes on the state the server is holding. Everything
   * else leaves the per-device switches alone: Auto Summon runs on *this*
   * device, and a snapshot pushed because the desktop pressed the button must
   * not start or stop the machine on the phone.
   */
  const apply = (s: Snapshot, adopt = false) => {
    // Every animation timer reads its cadence from the sound module, so the
    // Swift Hands level is pushed there the moment the server confirms it.
    // Swift Hands is quoted in cards a second; the animation wants a multiple
    // of its own base cadence, which is the rate a fresh account deals at.
    setDealSpeed(BASE_CARD_RATE / Math.max(1, s.cardRate))
    return set((prev) => ({
      authed: true,
      username: s.username,
      isAdmin: s.isAdmin,
      sandbox: s.sandbox,
      sandboxAllowed: s.sandboxAllowed,
      credits: s.credits,
      collection: s.collection ?? prev.collection,
      collectionRev: s.collectionRev,
      // A pushed snapshot carries no collection, so the copy we hold keeps the
      // revision it was fetched at and the view knows to ask again.
      collectionAt: s.collection ? s.collectionRev : prev.collectionAt,
      wishes: s.wishes,
      badges: s.badges,
      upgrades: s.upgrades,
      settings: s.settings,
      packSize: s.packSize,
      packsPerPull: s.packsPerPull,
      cardsPerPull: s.cardsPerPull,
      packPrice: s.packPrice,
      autoSpinMs: s.autoSpinMs,
      cardRate: s.cardRate,
      autoSpin: adopt ? s.autoSpin : prev.autoSpin,
      lastDailyAt: s.lastDailyAt,
      dailyStreak: s.dailyStreak,
      totalRolls: s.totalRolls,
      totalClaims: s.totalClaims,
      clockOffset: s.serverNow - Date.now(),
      now: s.serverNow,
    }))
  }

  /**
   * Say what the Automaton did while the tab was closed.
   *
   * The credits are already in the balance by the time this runs -- the server
   * settles them before it answers -- so this is a receipt, in the same shape
   * as the one a coin drop leaves.
   */
  const reportOffline = (s: Snapshot) => {
    if (!s.offline || s.offline.credits <= 0) return
    const { pulls, credits, minutes } = s.offline
    const spent =
      minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
        : `${minutes}m`
    sfx.payout(0.5)
    get().pushToast(
      `The Automaton worked ${spent} while you were away: ${fmtCount(pulls)} pulls, +${fmt(credits)} credits.`,
      'credits',
    )
  }

  /**
   * Open the live stream, once.
   *
   * Called from every route into a signed-in session, not just from boot:
   * signing in on a fresh tab used to leave the tab deaf, so a second device
   * showed a balance that stopped moving the moment the first one spent
   * anything.
   */
  const connectLive = () => {
    if (liveOff) return
    liveOff = listenForState((live) => apply(live))
  }

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
    collectionRev: 0,
    collectionAt: 0,
    wishes: [],
    badges: { ...EMPTY_BADGES },
    upgrades: { ...EMPTY_UPGRADES },
    settings: { ...EMPTY_SETTINGS },
    packSize: 0,
    packsPerPull: 1,
    cardsPerPull: 0,
    packPrice: 0,
    autoSpinMs: 0,
    cardRate: BASE_CARD_RATE,
    lastDailyAt: 0,
    dailyStreak: 0,
    totalRolls: 0,
    totalClaims: 0,
    coinPops: [],
    autoSpin: false,
    pack: null,

    rolled: [],
    rollSort: 'dealt' as const,
    selected: 0,
    rolling: false,
    rollCount: 0,
    dealUntil: 0,
    clockOffset: 0,
    now: Date.now(),
    error: null,
    toasts: [],

    effects: () => computeEffects(get().badges, get().upgrades),
    canAffordPack: () => {
      const s = get()
      return s.packSize > 0 && (s.sandbox || s.credits >= s.packPrice)
    },
    packBusy: () => {
      const p = get().pack
      return !!p && p.stacks.some((st) => st.state !== 'open')
    },
    dailyReady: () => {
      const s = get()
      return s.sandbox || s.now - s.lastDailyAt >= DAILY_INTERVAL_H * HOUR
    },

    refreshCollection: async () => {
      const st = get()
      if (st.collectionAt === st.collectionRev) return
      const snap = await guard(() => api.state())
      if (snap) apply(snap)
    },

    boot: async () => {
      try {
        const me = await api.me()
        if (!me.player) {
          set({ authed: false, needsSetup: me.needsSetup })
          return
        }
        const snap = await api.state()
        apply(snap, true)
        reportOffline(snap)
        connectLive()
      } catch {
        set({ error: 'Cannot reach the instance.' })
      } finally {
        set({ booting: false })
      }
    },

    signIn: async (username, password) => {
      try {
        await api.login(username, password)
        apply(await api.state(), true)
        connectLive()
        sfx.tap()
        return null
      } catch (e) {
        return e instanceof ApiError ? e.message : 'Cannot reach the instance.'
      }
    },

    signUp: async (username, password, invite) => {
      try {
        await api.register(username, password, invite)
        apply(await api.state(), true)
        connectLive()
        sfx.tap()
        return null
      } catch (e) {
        return e instanceof ApiError ? e.message : 'Cannot reach the instance.'
      }
    },

    signOut: async () => {
      liveOff?.()
      liveOff = null
      await api.logout().catch(() => {})
      set({ authed: false, rolled: [], collection: [], username: '', isAdmin: false, sandbox: false })
    },

    tick: () => set((s) => ({ now: Date.now() + s.clockOffset })),

    roll: async (packs = 0) => {
      const s = get()
      // A pack keeps the button until its last card is out. Pulling again
      // mid-open used to wipe a spread nobody had finished looking at, and it
      // made the tearing optional in a way that rather defeated the pack.
      if (s.rolling || s.now < s.dealUntil || s.packBusy()) return
      sfx.rollStart(packs > 0 ? s.packSize : 1)
      set({ rolling: true, error: null })
      const res = await guard(() => api.roll(packs))
      if (!res) {
        // The Automaton stops the moment a pull is refused, which is almost
        // always "you cannot afford this any more".
        set({ rolling: false, autoSpin: false })
        return
      }
      const firstFresh = res.results.findIndex((r) => r.fresh)
      warmImages(res.results)
      apply(res.state)
      set((prev) => ({
        rolled: res.results,
        rollSort: 'dealt' as const,
        selected: firstFresh === -1 ? 0 : firstFresh,
        rolling: false,
        rollCount: prev.rollCount + 1,
        // One entry per wrapper. Even the Automaton's pulls arrive sealed: it
        // tears and swipes them itself, on screen, like a hand would.
        pack: res.pack
          ? {
              perPack: Math.max(1, res.perPack),
              claimed: res.claimed,
              bonus: res.bonus,
              stacks: Array.from({ length: Math.max(1, res.packCount) }, () => ({
                state: 'sealed' as const,
                revealed: 0,
              })),
            }
          : null,
        dealUntil:
          Date.now() + prev.clockOffset + res.results.length * dealStepMs(res.results.length) + 700,
      }))
      if (res.coins > 0) get().popCoins(res.coins)
      if (res.merged > 0) {
        sfx.payout(0.4)
        get().pushToast(
          `${res.merged} stack${res.merged === 1 ? '' : 's'} merged a star higher.`,
          'credits',
        )
      }
      for (const note of res.notes) get().pushToast(note, 'credits')
      if (res.notes.length > 0) sfx.payout(0.3)
      if (res.swept > 0) {
        get().pushToast(
          `Auto-sold ${fmtCount(res.swept)} card${res.swept === 1 ? '' : 's'} from the last summon for +${fmt(res.sweptFor)} credits`,
          'credits',
        )
      }
      if (res.hidden > 0) {
        get().pushToast(
          `${fmtCount(res.hidden)} more cards behind these, appraised for +${fmt(res.hiddenFor)} credits`,
          'credits',
        )
      }
      // A sealed pack sounds out as it is opened, not as it arrives.
      if (res.pack) return
      const best = res.results.reduce((m, r) => Math.max(m, r.char.creditValue), 0)
      sfx.reveal(rarityOf(best).key, res.results.length)
      if (res.results.some((r) => r.wished && r.fresh)) {
        sfx.wish()
        get().pushToast('A wish appears before you.', 'wish')
      }
    },

    /** The rising "+N" over the balance. Coins are already banked by then. */
    popCoins: (amount) => {
      sfx.coins()
      const id = toastSeq++
      set((prev) => ({ coinPops: [...prev.coinPops.slice(-4), { id, amount }] }))
      setTimeout(() => get().dismissCoinPop(id), 1600)
    },

    dismissCoinPop: (id) => set((prev) => ({ coinPops: prev.coinPops.filter((c) => c.id !== id) })),

    /**
     * Switch this device's machine on or off.
     *
     * The switch is per device -- two of them can grind in parallel, and they
     * should -- but the server is told, because Offline Earnings pays for the
     * hours nothing was running and it cannot know that from a flag that only
     * ever existed in a page somebody navigated away from.
     */
    setAutoSpin: async (on) => {
      const s = get()
      if (on && s.autoSpinMs <= 0) return
      sfx.tap()
      set({ autoSpin: on })
      const res = await guard(() => api.autoSpin(on))
      if (!res) {
        set({ autoSpin: false })
        return
      }
      apply(res.state)
      reportOffline(res.state)
    },

    setRollSort: (sort) => {
      if (get().rollSort === sort) return
      sfx.tap()
      set({ rollSort: sort })
    },

    selectRolled: (index) => {
      const s = get()
      if (index >= 0 && index < s.rolled.length && index !== s.selected) {
        sfx.tap()
        set({ selected: index })
      }
    },

    /** The wrapper comes away from one pack, leaving its stack. */
    slicePack: (index) => {
      const s = get()
      const stack = s.pack?.stacks[index]
      if (!s.pack || !stack || stack.state !== 'sealed') return
      sfx.rollStart(1)
      const first = s.rolled[index * s.pack.perPack]
      if (first) sfx.reveal(rarityOf(first.char.creditValue).key, 1)
      set({ selected: index * s.pack.perPack, pack: patchStack(s.pack, index, { state: 'sliced' }) })
    },

    /** Skip the throwing and lay one pack's cards out at once. */
    tearPack: (index) => {
      const s = get()
      const stack = s.pack?.stacks[index]
      if (!s.pack || !stack || stack.state === 'open') return
      const cards = stackCards(s, index)
      const best = cards.reduce((m, r) => Math.max(m, r.char.creditValue), 0)
      sfx.reveal(rarityOf(best).key, cards.length)
      set({ pack: patchStack(s.pack, index, { state: 'open', revealed: cards.length }) })
    },

    /**
     * Every wrapper off at once, quietly.
     *
     * For the Automaton running while the player is on another tab: there is
     * no opener mounted to tear anything, and a pack nobody can reach would
     * block the loop for good. Silent, because it is not a moment.
     */
    finishPacks: () => {
      const s = get()
      if (!s.pack) return
      set({
        pack: {
          ...s.pack,
          stacks: s.pack.stacks.map((_, i) => ({
            state: 'open' as const,
            revealed: stackCards(s, i).length,
          })),
        },
      })
    },

    /**
     * Throw the top card of one pack aside, uncovering the one under it.
     *
     * Deliberately does not end the pack when the last card goes: the card is
     * still in the air at that point, and the view calls tearPack once it has
     * actually landed. Throws can therefore overlap without one cutting the
     * previous one's animation short.
     */
    revealNext: (index) => {
      const s = get()
      const stack = s.pack?.stacks[index]
      if (!s.pack || !stack || stack.state !== 'sliced') return
      const cards = stackCards(s, index)
      const next = stack.revealed + 1
      if (next > cards.length) return
      // Follow whatever is now on top, so the bar under the stack describes
      // the card being looked at rather than the one just discarded.
      const at = index * s.pack.perPack + Math.min(next, cards.length - 1)
      const entry = s.rolled[at]
      if (entry) sfx.reveal(rarityOf(entry.char.creditValue).key, 1)
      set({ selected: at, pack: patchStack(s.pack, index, { revealed: next }) })
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

    /**
     * Keep this one.
     *
     * The spread is updated straight away as well as the collection: a card
     * that has just been queued for auto-sell is exactly the card somebody is
     * looking at when they press this, and it should stop saying it is for
     * sale the moment they do.
     */
    lock: async (id, locked) => {
      sfx.tap()
      set((prev) => ({
        rolled: prev.rolled.map((r) =>
          r.char.id === id ? { ...r, locked, willSell: locked ? false : r.willSell } : r,
        ),
      }))
      const res = await guard(() => api.lock(id, locked))
      if (res) apply(res.state)
    },

    sell: async (id) => {
      sfx.sell()
      const res = await guard(() => api.sell([id]))
      if (res) apply(res.state)
    },

    sellMany: async (ids) => {
      const res = await guard(() => api.sell(ids))
      if (!res) return
      sfx.sell()
      apply(res.state)
      get().pushToast(
        `Sold ${fmtCount(res.sold)} character${res.sold === 1 ? '' : 's'} for +${fmt(res.total)} credits`,
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

    buyUpgrade: async (key) => {
      sfx.buy()
      const res = await guard(
        () => api.buyUpgrade(key),
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
