import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  OwnedCharacter,
  PendingGem,
  RolledCharacter,
  RollResult,
  Settings,
  Toast,
} from './types'
import {
  BASE_GEM_CHANCE,
  DAILY_INTERVAL_H,
  GEM_TIERS,
  DAILY_STREAK_WINDOW_H,
  SERIES_MILESTONES,
  dailyAmount,
  duplicateCompensation,
  rarityOf,
  rollGemDrop,
} from './economy'
import { bindSoundSettings, dealStepMs, sfx } from './sound'
import {
  BADGE_DEFS,
  EMPTY_BADGES,
  badgeCost,
  badgeUnlocked,
  computeEffects,
  type BadgeEffects,
  type BadgeKey,
  type Badges,
} from './badges'
import { fetchRollBatch, matchesGender } from '../api/anilist'

export const DEFAULT_SETTINGS: Settings = {
  rollGender: 'everyone',
  poolSize: 10000,
  rollsPerReset: 10,
  rollResetMinutes: 60,
  claimIntervalMinutes: 180,
  skipOwned: false,
  testingMode: false,
  theme: 'arcade',
  layout: 'stage',
  soundEnabled: true,
  soundVolume: 0.6,
}

export const CONSUMABLES = {
  rollRefill: { name: 'Roll Refill', icon: '↻', description: 'Instantly refill your rolls to maximum', cost: 200 },
  claimReset: { name: 'Claim Incense', icon: '◷', description: 'Make your claim available right now', cost: 500 },
} as const

export type ConsumableKey = keyof typeof CONSUMABLES

/** Per-wish base chance that a roll is replaced by that wish. */
const WISH_BASE_CHANCE = 0.025
const WISH_CHANCE_CAP = 0.6

const HOUR = 3_600_000

let toastSeq = 1

interface GameState {
  credits: number
  collection: OwnedCharacter[]
  wishes: RolledCharacter[]
  settings: Settings
  badges: Badges
  rollsLeft: number
  rollsResetAt: number
  nextClaimAt: number
  lastDailyAt: number
  dailyStreak: number
  lastRitualAt: number
  /** Highest series-set milestone already paid out, per series */
  seriesPaid: Record<string, number>
  /** Cards revealed by the last summon (1 or 10) */
  rolled: RollResult[]
  /** Index into `rolled` of the highlighted card */
  selected: number
  pendingGem: PendingGem | null
  rolling: boolean
  rollCount: number
  /** Timestamp until which the current deal animation is still playing. */
  dealUntil: number
  /** Lifetime counters for the stats page (persisted). */
  totalRolls: number
  totalClaims: number
  error: string | null
  now: number
  buffer: RolledCharacter[]
  toasts: Toast[]

  effects: () => BadgeEffects
  maxRolls: () => number
  claimCooldownMs: () => number
  claimReady: () => boolean
  dailyReady: () => boolean
  ritualReadyAt: () => number

  tick: () => void
  roll: (count?: number) => Promise<void>
  selectRolled: (index: number) => void
  claim: () => void
  /** Sandbox only: claim every unowned card in the current spread. */
  claimAll: () => void
  collectGem: () => void
  claimDaily: () => void
  claimRitual: () => void
  sell: (id: number) => void
  /** Sandbox only: sell every listed character in one transaction. */
  sellMany: (ids: number[]) => void
  addWish: (char: RolledCharacter) => void
  removeWish: (id: number) => void
  buyBadge: (key: BadgeKey) => void
  buyConsumable: (key: ConsumableKey) => void
  updateSettings: (patch: Partial<Settings>) => void
  grantCredits: (amount: number) => void
  resetSave: () => void
  clearError: () => void
  pushToast: (text: string, flavor?: Toast['flavor']) => void
  dismissToast: (id: number) => void
}

export const useGame = create<GameState>()(
  persist(
    (set, get) => ({
      credits: 0,
      collection: [],
      wishes: [],
      settings: DEFAULT_SETTINGS,
      badges: { ...EMPTY_BADGES },
      rollsLeft: DEFAULT_SETTINGS.rollsPerReset,
      rollsResetAt: Date.now() + DEFAULT_SETTINGS.rollResetMinutes * 60_000,
      nextClaimAt: 0,
      lastDailyAt: 0,
      dailyStreak: 0,
      lastRitualAt: 0,
      seriesPaid: {},
      rolled: [],
      selected: 0,
      pendingGem: null,
      rolling: false,
      rollCount: 0,
      dealUntil: 0,
      totalRolls: 0,
      totalClaims: 0,
      error: null,
      now: Date.now(),
      buffer: [],
      toasts: [],

      effects: () => computeEffects(get().badges),

      maxRolls: () => {
        const s = get()
        return s.settings.rollsPerReset + s.effects().extraRolls
      },

      claimCooldownMs: () => get().settings.claimIntervalMinutes * 60_000,

      claimReady: () => {
        const s = get()
        return s.settings.testingMode || Date.now() >= s.nextClaimAt
      },

      dailyReady: () => {
        const s = get()
        return s.settings.testingMode || Date.now() - s.lastDailyAt >= DAILY_INTERVAL_H * HOUR
      },

      ritualReadyAt: () => {
        const s = get()
        const fx = s.effects()
        if (!fx.claimResetUnlocked) return Infinity
        if (s.settings.testingMode) return 0
        return s.lastRitualAt + fx.claimResetHours * HOUR
      },

      tick: () => {
        const s = get()
        const now = Date.now()
        if (now >= s.rollsResetAt) {
          set({
            rollsLeft: s.maxRolls(),
            rollsResetAt: now + s.settings.rollResetMinutes * 60_000,
            now,
          })
        } else {
          set({ now })
        }
      },

      roll: async (count = 1) => {
        const s = get()
        const testing = s.settings.testingMode
        // No re-roll while a roll is in flight or its deal is still playing.
        if (s.rolling || Date.now() < s.dealUntil || (!testing && s.rollsLeft <= 0)) return
        const n = testing ? count : Math.min(count, s.rollsLeft)
        sfx.rollStart(n)
        set({ rolling: true, error: null, pendingGem: null })
        try {
          const fx = s.effects()
          const wishChanceOf = (open: RolledCharacter[]) =>
            Math.min(WISH_CHANCE_CAP, open.length * WISH_BASE_CHANCE * fx.wishChanceMult)

          let buffer = s.buffer
          const ensureBuffer = async (need: number) => {
            if (buffer.length >= need) return
            const exclude = s.settings.skipOwned
              ? new Set(s.collection.map((c) => c.id))
              : new Set<number>()
            const fresh = await fetchRollBatch(s.settings.poolSize, s.settings.rollGender, exclude)
            const have = new Set(buffer.map((c) => c.id))
            buffer = buffer.concat(fresh.filter((c) => !have.has(c.id)))
          }

          const results: RollResult[] = []
          let totalComp = 0
          let gemAmount = 0
          let gemBestIdx = -1
          for (let i = 0; i < n; i++) {
            // Wished characters can barge into any roll (Mudae wish mechanic).
            const rolledIds = new Set(results.map((r) => r.char.id))
            const openWishes = s.wishes.filter(
              (w) => !s.collection.some((c) => c.id === w.id) && !rolledIds.has(w.id),
            )
            let char: RolledCharacter
            let wished = false
            if (openWishes.length > 0 && Math.random() < wishChanceOf(openWishes)) {
              char = openWishes[Math.floor(Math.random() * openWishes.length)]
              wished = true
            } else {
              // Monster rolls (×1000) span several API batches; if one fails
              // mid-way, reveal what we already have instead of losing it all.
              try {
                await ensureBuffer(1)
              } catch (e) {
                if (results.length > 0) {
                  get().pushToast(
                    `The stream ran dry at ${results.length} — revealing what fate allowed.`,
                    'info',
                  )
                  break
                }
                throw e
              }
              // Avoid duplicate cards within one spread when possible.
              let idx = buffer.findIndex((c) => !rolledIds.has(c.id))
              if (idx === -1) idx = 0
              char = buffer[idx]
              buffer = buffer.filter((_, j) => j !== idx)
              wished = s.wishes.some((w) => w.id === char.id)
            }
            const owned = s.collection.some((c) => c.id === char.id)
            const compensation = owned
              ? duplicateCompensation(char.creditValue, fx.dupCompMult)
              : 0
            totalComp += compensation
            const gem = rollGemDrop(BASE_GEM_CHANCE + fx.gemChanceBonus, fx.gemUpgrade)
            if (gem) {
              gemAmount += gem.amount
              const tierIdx = GEM_TIERS.findIndex((t) => t.key === gem.tier)
              if (tierIdx > gemBestIdx) gemBestIdx = tierIdx
            }
            results.push({ char, owned, wished, compensation })
          }

          const firstFresh = results.findIndex((r) => !r.owned)
          set((prev) => ({
            buffer,
            rolled: results,
            selected: firstFresh === -1 ? 0 : firstFresh,
            credits: prev.credits + totalComp,
            pendingGem:
              gemBestIdx >= 0 ? { tier: GEM_TIERS[gemBestIdx].key, amount: gemAmount } : null,
            rollsLeft: testing ? prev.rollsLeft : prev.rollsLeft - n,
            rollCount: prev.rollCount + 1,
            totalRolls: prev.totalRolls + results.length,
            dealUntil: Date.now() + results.length * dealStepMs(results.length) + 700,
            rolling: false,
          }))
          const bestValue = results.reduce((m, r) => Math.max(m, r.char.creditValue), 0)
          sfx.reveal(rarityOf(bestValue).key, results.length)
          const wishHits = results.filter((r) => r.wished && !r.owned).length
          if (wishHits > 0) {
            sfx.wish()
            get().pushToast('A wish appears before you…', 'wish')
          }
        } catch (e) {
          sfx.error()
          set({ rolling: false, error: e instanceof Error ? e.message : String(e) })
        }
      },

      selectRolled: (index) => {
        const s = get()
        if (index >= 0 && index < s.rolled.length && index !== s.selected) {
          sfx.tap()
          set({ selected: index })
        }
      },

      claim: () => {
        const s = get()
        const entry = s.rolled[s.selected]
        if (!entry || entry.owned || !s.claimReady()) return
        sfx.claim()
        const fx = s.effects()
        const char = entry.char
        const owned: OwnedCharacter = { ...char, claimedAt: Date.now() }

        let bonus = 0
        if (entry.wished && fx.wishClaimBonus > 0) {
          bonus += fx.wishClaimBonus
          get().pushToast(`Wish fulfilled! +${fx.wishClaimBonus} credits (Bronze IV)`, 'credits')
        }
        if (fx.claimPaysValue) {
          bonus += char.creditValue
          get().pushToast(`Emerald IV pays the dowry: +${char.creditValue} credits`, 'credits')
        }

        // Series set milestones
        const collection = [...s.collection, owned]
        const inSeries = collection.filter((c) => c.series === char.series).length
        const paid = s.seriesPaid[char.series] ?? 0
        let seriesBonus = 0
        let newPaid = paid
        for (const m of SERIES_MILESTONES) {
          if (inSeries >= m.count && paid < m.count) {
            seriesBonus += m.reward
            newPaid = m.count
          }
        }
        if (seriesBonus > 0) {
          get().pushToast(
            `Series set: ${inSeries}× ${char.series} — +${seriesBonus} credits!`,
            'credits',
          )
        }

        if (bonus + seriesBonus > 0) sfx.payout(0.3)
        set((prev) => ({
          collection,
          rolled: prev.rolled.map((r, i) =>
            i === prev.selected ? { ...r, owned: true, compensation: 0 } : r,
          ),
          credits: prev.credits + bonus + seriesBonus,
          totalClaims: prev.totalClaims + 1,
          seriesPaid: seriesBonus > 0 ? { ...prev.seriesPaid, [char.series]: newPaid } : prev.seriesPaid,
          nextClaimAt: prev.settings.testingMode
            ? prev.nextClaimAt
            : Date.now() + prev.claimCooldownMs(),
        }))
      },

      claimAll: () => {
        const s = get()
        // No cooldown bookkeeping here, so this stays sandbox-only.
        if (!s.settings.testingMode) return
        const fx = s.effects()
        const collection = [...s.collection]
        const seriesPaid = { ...s.seriesPaid }
        const ownedIds = new Set(collection.map((c) => c.id))
        const now = Date.now()
        let bonus = 0
        let claimedCount = 0
        for (const entry of s.rolled) {
          if (entry.owned || ownedIds.has(entry.char.id)) continue
          const char = entry.char
          collection.push({ ...char, claimedAt: now })
          ownedIds.add(char.id)
          claimedCount++
          if (entry.wished && fx.wishClaimBonus > 0) bonus += fx.wishClaimBonus
          if (fx.claimPaysValue) bonus += char.creditValue
          const inSeries = collection.filter((c) => c.series === char.series).length
          const paid = seriesPaid[char.series] ?? 0
          for (const m of SERIES_MILESTONES) {
            if (inSeries >= m.count && paid < m.count) {
              bonus += m.reward
              seriesPaid[char.series] = m.count
            }
          }
        }
        if (claimedCount === 0) return
        sfx.claim()
        if (bonus > 0) sfx.payout(0.3)
        set((prev) => ({
          collection,
          seriesPaid,
          credits: prev.credits + bonus,
          totalClaims: prev.totalClaims + claimedCount,
          rolled: prev.rolled.map((r) => (r.owned ? r : { ...r, owned: true, compensation: 0 })),
        }))
        get().pushToast(
          `Claimed ${claimedCount} character${claimedCount > 1 ? 's' : ''}${bonus > 0 ? ` (+${bonus} credits)` : ''} — sandbox`,
          'info',
        )
      },

      collectGem: () => {
        const s = get()
        if (!s.pendingGem) return
        sfx.gem()
        set((prev) => ({
          credits: prev.credits + s.pendingGem!.amount,
          pendingGem: null,
        }))
      },

      claimDaily: () => {
        const s = get()
        if (!s.dailyReady()) return
        sfx.daily()
        const now = Date.now()
        const withinStreak = now - s.lastDailyAt <= DAILY_STREAK_WINDOW_H * HOUR
        const streak = withinStreak ? s.dailyStreak + 1 : 1
        const amount = dailyAmount(streak, s.effects().dailyMult)
        set((prev) => ({
          credits: prev.credits + amount,
          lastDailyAt: now,
          dailyStreak: streak,
        }))
        get().pushToast(
          `Daily offering: +${amount} credits${streak > 1 ? ` (day ${streak} streak)` : ''}`,
          'credits',
        )
      },

      claimRitual: () => {
        const s = get()
        if (Date.now() < s.ritualReadyAt()) return
        sfx.wish()
        set({ nextClaimAt: 0, lastRitualAt: Date.now() })
        get().pushToast('The ritual is complete — your claim is ready.', 'info')
      },

      sell: (id) => {
        const s = get()
        const char = s.collection.find((c) => c.id === id)
        if (!char) return
        sfx.sell()
        set((prev) => ({
          collection: prev.collection.filter((c) => c.id !== id),
          credits: prev.credits + char.creditValue,
        }))
      },

      sellMany: (ids) => {
        const s = get()
        // Bulk, irreversible and cooldown-free — sandbox only, like claimAll.
        if (!s.settings.testingMode) return
        const doomed = new Set(ids)
        const sold = s.collection.filter((c) => doomed.has(c.id))
        if (sold.length === 0) return
        const total = sold.reduce((n, c) => n + c.creditValue, 0)
        sfx.sell()
        set((prev) => ({
          collection: prev.collection.filter((c) => !doomed.has(c.id)),
          credits: prev.credits + total,
        }))
        get().pushToast(
          `Sold ${sold.length} character${sold.length > 1 ? 's' : ''} for +${total} credits — sandbox`,
          'credits',
        )
      },

      addWish: (char) => {
        const s = get()
        if (s.wishes.length >= s.effects().wishSlots) return
        if (s.wishes.some((w) => w.id === char.id)) return
        sfx.tap()
        set({ wishes: [...s.wishes, char] })
      },

      removeWish: (id) => {
        set((prev) => ({ wishes: prev.wishes.filter((w) => w.id !== id) }))
      },

      buyBadge: (key) => {
        const s = get()
        const def = BADGE_DEFS.find((d) => d.key === key)
        if (!def) return
        const level = s.badges[key]
        if (level >= 4 || !badgeUnlocked(key, s.badges)) return
        const cost = badgeCost(def, level + 1, s.badges.ruby >= 4)
        if (s.credits < cost) return
        sfx.buy()
        set((prev) => ({
          credits: prev.credits - cost,
          badges: { ...prev.badges, [key]: level + 1 },
          // Sapphire/Ruby roll bonuses apply immediately too
          rollsLeft:
            (key === 'sapphire' ? prev.rollsLeft + 1 : key === 'ruby' && level === 3 ? prev.rollsLeft + 2 : prev.rollsLeft),
        }))
      },

      buyConsumable: (key) => {
        const s = get()
        const item = CONSUMABLES[key]
        if (s.credits < item.cost) return
        if (key === 'rollRefill') {
          if (s.rollsLeft >= s.maxRolls()) return
          sfx.buy()
          set((prev) => ({ credits: prev.credits - item.cost, rollsLeft: prev.maxRolls() }))
        } else {
          if (s.claimReady()) return
          sfx.buy()
          set((prev) => ({ credits: prev.credits - item.cost, nextClaimAt: 0 }))
        }
      },

      updateSettings: (patch) => {
        const s = get()
        const settings = { ...s.settings, ...patch }
        const invalidateBuffer =
          patch.rollGender !== undefined ||
          patch.poolSize !== undefined ||
          patch.skipOwned !== undefined
        const buffer = invalidateBuffer
          ? s.buffer.filter(
              (c) =>
                matchesGender(c, settings.rollGender) &&
                (!settings.skipOwned || !s.collection.some((o) => o.id === c.id)),
            )
          : s.buffer
        const maxRolls = settings.rollsPerReset + s.effects().extraRolls
        set({
          settings,
          buffer: invalidateBuffer && patch.poolSize !== undefined ? [] : buffer,
          rollsLeft: Math.min(s.rollsLeft, maxRolls),
        })
      },

      grantCredits: (amount) => {
        set((prev) => ({ credits: prev.credits + amount }))
      },

      resetSave: () => {
        set({
          credits: 0,
          collection: [],
          wishes: [],
          settings: DEFAULT_SETTINGS,
          badges: { ...EMPTY_BADGES },
          rollsLeft: DEFAULT_SETTINGS.rollsPerReset,
          rollsResetAt: Date.now() + DEFAULT_SETTINGS.rollResetMinutes * 60_000,
          nextClaimAt: 0,
          lastDailyAt: 0,
          dailyStreak: 0,
          lastRitualAt: 0,
          seriesPaid: {},
          rolled: [],
          selected: 0,
          pendingGem: null,
          totalRolls: 0,
          totalClaims: 0,
          buffer: [],
          error: null,
        })
      },

      clearError: () => set({ error: null }),

      pushToast: (text, flavor) => {
        const toast: Toast = { id: toastSeq++, text, flavor }
        set((prev) => ({ toasts: [...prev.toasts.slice(-3), toast] }))
      },

      dismissToast: (id) => {
        set((prev) => ({ toasts: prev.toasts.filter((t) => t.id !== id) }))
      },
    }),
    {
      name: 'mudae-clone-save',
      version: 7,
      migrate: (persisted: any, version) => {
        if (version < 2 && persisted) {
          // v1 had a flat `perks` shop — refund what was spent, move to badges.
          const perks = persisted.perks ?? {}
          const bases: Record<string, number> = {
            extraRolls: 500, swiftClaims: 750, gemHunter: 400, goldenTouch: 600,
          }
          let refund = 0
          for (const [k, lvRaw] of Object.entries(perks)) {
            const lv = Number(lvRaw) || 0
            refund += (bases[k] ?? 0) * ((lv * (lv + 1)) / 2)
          }
          // still the pre-v6 field name at this point in the chain
          persisted.kakera = (persisted.kakera ?? 0) + refund
          delete persisted.perks
          persisted.badges = { ...EMPTY_BADGES }
          persisted.wishes = []
          persisted.settings = { ...DEFAULT_SETTINGS, ...(persisted.settings ?? {}) }
        }
        if (version < 4 && persisted) {
          // v3→v4 adds layout + sound settings; merging defaults covers both.
          persisted.settings = { ...DEFAULT_SETTINGS, ...(persisted.settings ?? {}) }
        }
        if (version < 5 && persisted) {
          // v5: only Midnight Arcade + Stage ship for now; force them, and
          // seed the lifetime counters for the stats page.
          persisted.settings = {
            ...DEFAULT_SETTINGS,
            ...(persisted.settings ?? {}),
            theme: 'arcade',
            layout: 'stage',
          }
          persisted.totalRolls = persisted.totalRolls ?? 0
          persisted.totalClaims = persisted.totalClaims ?? (persisted.collection?.length ?? 0)
        }
        if (version < 7 && persisted) {
          // The currency is called credits now. It was `kakera` through v5 and
          // briefly `shards` in v6, so accept either legacy field — a save
          // written by any earlier build converts. The storage key stays
          // 'mudae-clone-save' so existing saves are still found at all.
          persisted.credits = persisted.credits ?? persisted.shards ?? persisted.kakera ?? 0
          delete persisted.shards
          delete persisted.kakera
          const rename = (c: any) => {
            if (!c) return c
            if (c.creditValue === undefined) c.creditValue = c.shardValue ?? c.kakeraValue ?? 0
            delete c.shardValue
            delete c.kakeraValue
            return c
          }
          persisted.collection = (persisted.collection ?? []).map(rename)
          persisted.wishes = (persisted.wishes ?? []).map(rename)
        }
        return persisted
      },
      partialize: (s) => ({
        credits: s.credits,
        collection: s.collection,
        wishes: s.wishes,
        settings: s.settings,
        badges: s.badges,
        rollsLeft: s.rollsLeft,
        rollsResetAt: s.rollsResetAt,
        nextClaimAt: s.nextClaimAt,
        lastDailyAt: s.lastDailyAt,
        dailyStreak: s.dailyStreak,
        lastRitualAt: s.lastRitualAt,
        seriesPaid: s.seriesPaid,
        totalRolls: s.totalRolls,
        totalClaims: s.totalClaims,
      }),
    },
  ),
)

bindSoundSettings(() => {
  const { soundEnabled, soundVolume } = useGame.getState().settings
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
