/**
 * Credit Badges: the shop, and the only progression the game has.
 *
 * Six badge lines, four levels each. Sapphire/Ruby/Emerald are locked behind
 * progress in the basic lines (or any two maxed badges), so the tree has a
 * shape rather than being six independent sliders.
 *
 * Two of the lines used to sell time back: extra summons an hour, and a ritual
 * that cleared a claim cooldown. Nothing is on a cooldown any more, so both
 * were selling something the game gives away. They buy the two things that are
 * still scarce instead: how many cards a pack holds (Sapphire), and how good
 * the cards in it are guaranteed to be (Emerald).
 */

import { RARITY_MIN } from './economy.js'

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

/**
 * Cards a pack holds at Sapphire I..IV.
 *
 * A pack is the whole reason to keep earning credits: with no Sapphire at all
 * the only summon is a single card, so the first level of this line is the
 * moment the game opens up rather than one more increment.
 */
export const PACK_SIZES = [10, 15, 20, 50] as const
/** Ruby IV's parting gift: every pack deals this many extra cards. */
export const RUBY_PACK_BONUS = 5

/** The rarity floor Emerald I..IV guarantees in every pack. */
export const GUARANTEE_TIERS = ['rare', 'epic', 'legendary', 'mythic'] as const

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
      '+1.5% coin drop chance',
      '+1.5% coin drop chance',
      '+1.5% coin drop chance',
      '+1.5% coin drop chance · daily offering doubled',
    ],
    prereq: null,
  },
  {
    key: 'sapphire',
    name: 'Sapphire',
    kanji: '青',
    color: '#5a8cff',
    baseCost: 300,
    levels: [
      `Unlock packs: a sealed ×${PACK_SIZES[0]}, and every card in it is yours`,
      `Packs hold ×${PACK_SIZES[1]}`,
      `Packs hold ×${PACK_SIZES[2]}`,
      `Packs hold ×${PACK_SIZES[3]} · Copper/Bronze coins upgrade one tier`,
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
      '+3% coin drop chance',
      `all badge prices −25% · packs hold ${RUBY_PACK_BONUS} more cards`,
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
      'Every pack is guaranteed a Rare or better',
      'That guarantee rises to Epic',
      'That guarantee rises to Legendary',
      'That guarantee rises to Mythic · claiming also pays the character’s credit value',
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
  coinChanceBonus: number
  coinUpgrade: boolean
  dailyMult: number
  wishClaimBonus: number
  dupCompMult: number
  claimPaysValue: boolean
  /** Cards a pack deals, or 0 while packs are still locked. */
  packSize: number
  /** Credit value at least one card in every pack is guaranteed to reach. */
  guaranteeValue: number
  /** The rarity that guarantee names, for the UI to say out loud. */
  guaranteeRarity: (typeof GUARANTEE_TIERS)[number] | null
}

export const BASE_WISH_SLOTS = 3

export function computeEffects(b: Badges): BadgeEffects {
  const sapphire = Math.min(b.sapphire, PACK_SIZES.length)
  const guaranteeRarity = b.emerald >= 1 ? GUARANTEE_TIERS[Math.min(b.emerald, 4) - 1] : null
  return {
    wishSlots: BASE_WISH_SLOTS + b.bronze + (b.ruby >= 1 ? 2 : 0),
    wishChanceMult: 1 + 0.25 * b.silver + (b.ruby >= 2 ? 0.5 : 0),
    coinChanceBonus: 0.015 * b.gold + (b.ruby >= 3 ? 0.03 : 0),
    coinUpgrade: b.sapphire >= 4,
    dailyMult: b.gold >= 4 ? 2 : 1,
    wishClaimBonus: b.bronze >= 4 ? 100 : 0,
    dupCompMult: b.silver >= 4 ? 2 : 1,
    claimPaysValue: b.emerald >= 4,
    packSize: sapphire >= 1 ? PACK_SIZES[sapphire - 1] + (b.ruby >= 4 ? RUBY_PACK_BONUS : 0) : 0,
    guaranteeValue: guaranteeRarity ? RARITY_MIN[guaranteeRarity] : 0,
    guaranteeRarity,
  }
}

export const ROMAN = ['', 'I', 'II', 'III', 'IV']
