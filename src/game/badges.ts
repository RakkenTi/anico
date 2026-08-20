/**
 * Credit Badges: the shop's first shelf, and the shape of the game.
 *
 * Six lines of six levels. Badges are not the curve -- upgrades are, and they
 * never end -- these decide what the loop *is*: whether packs exist at all,
 * how many wishes you may pin, whether a pack promises a Mythic. Every level
 * here unlocks or changes something you can name, which is why they are short
 * ladders with a top rung rather than another exponential.
 *
 * Sapphire, Ruby and Emerald are locked behind progress in the first three, so
 * the tree has a shape rather than being six independent sliders.
 */

import { RARITY_MIN } from './economy.js'
import {
  autoSpinMs,
  cardRate,
  coinChanceBonus,
  coinValueMult,
  mergeMult,
  offlineHours,
  offlineRate,
  packMult,
  packsPerPull,
  roundCost,
  sellMult,
  wishMult,
  type Upgrades,
} from './upgrades.js'

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

/** Levels every badge line has. */
export const BADGE_MAX = 6

/**
 * Cards a pack holds at Sapphire I..VI.
 *
 * A pack is the whole reason to keep earning credits: with no Sapphire at all
 * the only summon is a single card, so the first level of this line is the
 * moment the game opens up. Round numbers, and only this line and Deeper Packs
 * may move them.
 */
export const PACK_SIZES = [10, 15, 20, 25, 40, 60] as const

/** The rarity floor Emerald I..IV guarantees; V and VI add more of them. */
export const GUARANTEE_TIERS = ['rare', 'epic', 'legendary', 'mythic'] as const

/** What the shop charges, as a multiple of list price, at Ruby 0..VI. */
const RUBY_DISCOUNT = [1, 1, 1, 1, 0.75, 0.6, 0.5] as const

export interface BadgeDef {
  key: BadgeKey
  /** Name of the vendored Kenney icon this line wears. */
  icon: string
  name: string
  kanji: string
  color: string
  baseCost: number
  /** Effect description for levels I..VI */
  levels: [string, string, string, string, string, string]
  prereq: string | null
}

export const BADGE_DEFS: BadgeDef[] = [
  {
    key: 'bronze',
    icon: 'suit_hearts',
    name: 'Bronze',
    kanji: '銅',
    color: '#cd8a4f',
    baseCost: 200,
    levels: [
      '+1 wish slot',
      '+1 wish slot',
      '+1 wish slot',
      '+1 wish slot · +100 credits when you claim a wished character',
      '+2 wish slots',
      '+2 wish slots · that claim bonus becomes +2,000',
    ],
    prereq: null,
  },
  {
    key: 'silver',
    icon: 'dice',
    name: 'Silver',
    kanji: '銀',
    color: '#c8ccd8',
    baseCost: 250,
    levels: [
      '+25% chance for your wishes to appear in rolls',
      '+25% wish chance',
      '+25% wish chance',
      '+25% wish chance · duplicate compensation doubled',
      '+50% wish chance',
      '+50% wish chance · duplicate compensation quadrupled',
    ],
    prereq: null,
  },
  {
    key: 'gold',
    icon: 'token',
    name: 'Gold',
    kanji: '金',
    color: '#d4af37',
    baseCost: 300,
    levels: [
      '+0.5% coin drop chance',
      '+0.5% coin drop chance',
      '+0.5% coin drop chance',
      '+0.5% coin drop chance · daily offering doubled',
      '+1% coin drop chance',
      '+1% coin drop chance · coins are worth double',
    ],
    prereq: null,
  },
  {
    key: 'sapphire',
    icon: 'cards_stack_high',
    name: 'Sapphire',
    kanji: '青',
    color: '#5a8cff',
    baseCost: 600,
    levels: [
      `Unlock packs: a sealed ×${PACK_SIZES[0]}, and every card in it is yours`,
      `Packs hold ×${PACK_SIZES[1]}`,
      `Packs hold ×${PACK_SIZES[2]}`,
      `Packs hold ×${PACK_SIZES[3]} · every pack drops a coin`,
      `Packs hold ×${PACK_SIZES[4]}`,
      `Packs hold ×${PACK_SIZES[5]} · every pack drops three coins`,
    ],
    prereq: 'Bronze I + Silver I + Gold I, or any two badges at IV',
  },
  {
    key: 'ruby',
    icon: 'pouch',
    name: 'Ruby',
    kanji: '紅',
    color: '#f05a7e',
    baseCost: 6000,
    levels: [
      '+2 wish slots',
      '+50% chance for your wishes to appear in rolls',
      '+1.5% coin drop chance',
      'Everything in the shop costs 25% less',
      'Everything in the shop costs 40% less',
      'Everything in the shop costs half',
    ],
    prereq: 'Bronze II + Silver II + Gold II, or any two badges at IV',
  },
  {
    key: 'emerald',
    icon: 'crown_a',
    name: 'Emerald',
    kanji: '翠',
    color: '#4fd0a0',
    baseCost: 9000,
    levels: [
      'Every pack is guaranteed a Rare or better',
      'That guarantee rises to Epic',
      'That guarantee rises to Legendary',
      'That guarantee rises to Mythic · claiming pays a quarter of the character’s value',
      'Two guaranteed Mythics in every pack',
      'Three guaranteed Mythics · claiming pays half',
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

/**
 * What the next level of a badge costs.
 *
 * Steeper than triple. A badge line is meant to be finished -- that is the
 * difference between this shelf and the one below it -- but finishing all six
 * of them should be the arc of an early game rather than an afternoon.
 */
export const BADGE_GROWTH = 5

export function badgeCost(def: BadgeDef, nextLevel: number, priceMult = 1): number {
  return roundCost(def.baseCost * Math.pow(BADGE_GROWTH, Math.max(0, nextLevel - 1)) * priceMult)
}

/**
 * Aggregate gameplay effects of a loadout.
 *
 * Badges and upgrades are bought on two shelves of one shop and stored apart,
 * but nothing downstream should have to care which one paid for a number.
 * Everything folds into one object here.
 */
export interface Effects {
  wishSlots: number
  wishChanceMult: number
  coinChanceBonus: number
  coinValueMult: number
  /** Coins a pack always turns up, on top of the per-card chance. */
  packCoins: number
  dailyMult: number
  wishClaimBonus: number
  dupCompMult: number
  /** Everything sold pays this much more. */
  sellMult: number
  /** Emerald IV+: a claim pays back this fraction of the character's value. */
  claimPayback: number
  /** Cards a pack deals, or 0 while packs are still locked. */
  packSize: number
  /** Cards a second the opening animation manages. */
  cardRate: number
  /** Milliseconds between automatic pulls, or 0 while the Automaton is unbought. */
  autoSpinMs: number
  /** Fraction of that speed the machine keeps with the tab closed. */
  offlineRate: number
  /** How many hours it will keep going out there. */
  offlineHours: number
  /** Packs torn at a single press. */
  packsPerPull: number
  /** Cards one press draws in total, across every pack in it. */
  cardsPerPull: number
  /** What a star multiplies a stack by. */
  mergeMult: number
  /** Everything in the shop costs this multiple of its list price. */
  priceMult: number
  /** Credit value the guaranteed cards in a pack are drawn above. */
  guaranteeValue: number
  /** How many cards that guarantee covers. */
  guaranteeCount: number
  /** The rarity the guarantee names, for the UI to say out loud. */
  guaranteeRarity: (typeof GUARANTEE_TIERS)[number] | null
}

export const BASE_WISH_SLOTS = 3

const at = (level: number, table: readonly number[]) =>
  table[Math.max(0, Math.min(table.length - 1, level))]

export function computeEffects(b: Badges, u: Upgrades): Effects {
  const sapphire = Math.min(b.sapphire, PACK_SIZES.length)
  const emerald = Math.min(b.emerald, BADGE_MAX)
  const guaranteeRarity = emerald >= 1 ? GUARANTEE_TIERS[Math.min(emerald, 4) - 1] : null
  const base = sapphire >= 1 ? PACK_SIZES[sapphire - 1] : 0
  // Deeper Packs multiplies rather than adds, so the line never runs out of
  // meaning: +25 cards is everything at level one and nothing at level twenty.
  const packSize = base > 0 ? Math.max(1, Math.round(base * packMult(u.packs))) : 0
  return {
    wishSlots:
      BASE_WISH_SLOTS + Math.min(b.bronze, 4) + (b.bronze >= 5 ? 2 : 0) + (b.bronze >= 6 ? 2 : 0) +
      (b.ruby >= 1 ? 2 : 0),
    wishChanceMult:
      (1 + 0.25 * Math.min(b.silver, 4) + (b.silver >= 5 ? 0.5 : 0) + (b.silver >= 6 ? 0.5 : 0) +
        (b.ruby >= 2 ? 0.5 : 0)) * wishMult(u.divination),
    coinChanceBonus:
      0.005 * Math.min(b.gold, 4) + (b.gold >= 5 ? 0.01 : 0) + (b.gold >= 6 ? 0.01 : 0) +
      (b.ruby >= 3 ? 0.015 : 0) + coinChanceBonus(u.fortune),
    coinValueMult: coinValueMult(u.fortune) * (b.gold >= 6 ? 2 : 1),
    packCoins: b.sapphire >= 6 ? 3 : b.sapphire >= 4 ? 1 : 0,
    dailyMult: b.gold >= 4 ? 2 : 1,
    wishClaimBonus: b.bronze >= 6 ? 2000 : b.bronze >= 4 ? 100 : 0,
    dupCompMult: (b.silver >= 6 ? 4 : b.silver >= 4 ? 2 : 1) * sellMult(u.appraisal),
    sellMult: sellMult(u.appraisal),
    claimPayback: b.emerald >= 6 ? 0.5 : b.emerald >= 4 ? 0.25 : 0,
    packSize,
    cardRate: cardRate(u.haste),
    autoSpinMs: autoSpinMs(u.automaton),
    offlineRate: u.automaton > 0 ? offlineRate(u.nightshift) : 0,
    offlineHours: u.automaton > 0 ? offlineHours(u.nightshift) : 0,
    packsPerPull: packsPerPull(u.multipack),
    cardsPerPull: packSize * packsPerPull(u.multipack),
    mergeMult: mergeMult(u.alchemy),
    priceMult: at(b.ruby, RUBY_DISCOUNT),
    guaranteeValue: guaranteeRarity ? RARITY_MIN[guaranteeRarity] : 0,
    guaranteeCount: emerald >= 6 ? 3 : emerald >= 5 ? 2 : emerald >= 1 ? 1 : 0,
    guaranteeRarity,
  }
}

/** Badge levels are Roman up to six, and nobody needs VII here. */
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI']
