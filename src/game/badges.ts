/**
 * Credit Badges — adapted from Mudae's badge/reward tree.
 *
 * Six badge lines, four levels each. Sapphire/Ruby/Emerald are locked
 * behind progress in the basic lines (or any two maxed badges), exactly
 * like Mudae's prerequisite chart. Effects are rebalanced for a
 * single-player economy.
 */

export type BadgeKey = 'bronze' | 'silver' | 'gold' | 'sapphire' | 'ruby' | 'emerald'
export type Badges = Record<BadgeKey, number>

export const EMPTY_BADGES: Badges = {
  bronze: 0,
  silver: 0,
  gold: 0,
  sapphire: 0,
  ruby: 0,
  emerald: 0,
}

export interface BadgeDef {
  key: BadgeKey
  name: string
  kanji: string
  color: string
  baseCost: number
  /** Effect description for levels I..IV */
  levels: [string, string, string, string]
  prereq: string | null
}

export const BADGE_DEFS: BadgeDef[] = [
  {
    key: 'bronze',
    name: 'Bronze',
    kanji: '銅',
    color: '#cd8a4f',
    baseCost: 150,
    levels: [
      '+1 wish slot',
      '+1 wish slot',
      '+1 wish slot',
      '+1 wish slot · +100 credits when you claim a wished character',
    ],
    prereq: null,
  },
  {
    key: 'silver',
    name: 'Silver',
    kanji: '銀',
    color: '#c8ccd8',
    baseCost: 200,
    levels: [
      '+25% chance for your wishes to appear in rolls',
      '+25% wish chance',
      '+25% wish chance',
      '+25% wish chance · duplicate compensation doubled',
    ],
    prereq: null,
  },
  {
    key: 'gold',
    name: 'Gold',
    kanji: '金',
    color: '#d4af37',
    baseCost: 250,
    levels: [
      '+5% gem drop chance',
      '+5% gem drop chance',
      '+5% gem drop chance',
      '+5% gem drop chance · daily offering doubled',
    ],
    prereq: null,
  },
  {
    key: 'sapphire',
    name: 'Sapphire',
    kanji: '青',
    color: '#5a8cff',
    baseCost: 400,
    levels: [
      '+1 roll per reset',
      '+1 roll per reset',
      '+1 roll per reset',
      '+1 roll per reset · Purple/Blue gems upgrade one tier',
    ],
    prereq: 'Bronze I + Silver I + Gold I, or any two badges at IV',
  },
  {
    key: 'ruby',
    name: 'Ruby',
    kanji: '紅',
    color: '#f05a7e',
    baseCost: 550,
    levels: [
      '+2 wish slots',
      '+50% chance for your wishes to appear in rolls',
      '+10% gem drop chance',
      '+2 rolls per reset · all badge prices −25%',
    ],
    prereq: 'Bronze II + Silver II + Gold II, or any two badges at IV',
  },
  {
    key: 'emerald',
    name: 'Emerald',
    kanji: '翠',
    color: '#4fd0a0',
    baseCost: 700,
    levels: [
      'Unlock the Claim Reset ritual (usable every 50 h)',
      '−10 h between Claim Resets',
      '−10 h between Claim Resets',
      '−10 h between Claim Resets · claims also pay the character’s credit value',
    ],
    prereq: 'Bronze III + Silver III + Gold III, or any two badges at IV',
  },
]

function maxedCount(b: Badges): number {
  return Object.values(b).filter((lv) => lv >= 4).length
}

/** Whether the next level of `key` can be purchased (prerequisites only). */
export function badgeUnlocked(key: BadgeKey, b: Badges): boolean {
  const twoIVs = maxedCount(b) >= 2
  switch (key) {
    case 'sapphire':
      return (b.bronze >= 1 && b.silver >= 1 && b.gold >= 1) || twoIVs
    case 'ruby':
      return (b.bronze >= 2 && b.silver >= 2 && b.gold >= 2) || twoIVs
    case 'emerald':
      return (b.bronze >= 3 && b.silver >= 3 && b.gold >= 3) || twoIVs
    default:
      return true
  }
}

export function badgeCost(def: BadgeDef, nextLevel: number, discounted: boolean): number {
  return Math.round(def.baseCost * nextLevel * (discounted ? 0.75 : 1))
}

/** Aggregate gameplay effects of a badge loadout. */
export interface BadgeEffects {
  wishSlots: number
  wishChanceMult: number
  gemChanceBonus: number
  extraRolls: number
  gemUpgrade: boolean
  dailyMult: number
  wishClaimBonus: number
  dupCompMult: number
  claimPaysValue: boolean
  claimResetUnlocked: boolean
  claimResetHours: number
}

export const BASE_WISH_SLOTS = 3

export function computeEffects(b: Badges): BadgeEffects {
  return {
    wishSlots: BASE_WISH_SLOTS + b.bronze + (b.ruby >= 1 ? 2 : 0),
    wishChanceMult: 1 + 0.25 * b.silver + (b.ruby >= 2 ? 0.5 : 0),
    gemChanceBonus: 0.05 * b.gold + (b.ruby >= 3 ? 0.1 : 0),
    extraRolls: b.sapphire + (b.ruby >= 4 ? 2 : 0),
    gemUpgrade: b.sapphire >= 4,
    dailyMult: b.gold >= 4 ? 2 : 1,
    wishClaimBonus: b.bronze >= 4 ? 100 : 0,
    dupCompMult: b.silver >= 4 ? 2 : 1,
    claimPaysValue: b.emerald >= 4,
    claimResetUnlocked: b.emerald >= 1,
    claimResetHours: b.emerald >= 1 ? 50 - 10 * (b.emerald - 1) : Infinity,
  }
}

export const ROMAN = ['', 'I', 'II', 'III', 'IV']
