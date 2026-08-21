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
import { beltRate, caravans, foundryMult, outfitMult, sparesPerScrap } from './industry.js'
import {
  aimShare,
  autoSpinMs,
  cardRate,
  maxDealtFor,
  maxStacksFor,
  maxStarsFor,
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

/**
 * The rarity floor Emerald I..IV guarantees; V and VI add more of them.
 *
 * The floor is what the badge aims at, not what it can always reach. Mythic
 * starts around twenty-six thousand favourites, which is eleven characters on
 * all of AniList -- not eleven per catalog, eleven people -- and Emerald VI
 * asks for three of them in every wrapper of a pull that can hold twenty-four.
 * A guarantee that cannot be met at its own tier is met at the best tier the
 * catalog can still supply; see `guaranteePool` in server/game.ts.
 */
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
      '+1 wish slot. Wished cards pay +100 credits',
      '+2 wish slots',
      '+2 wish slots. Wished cards pay +2,000 credits',
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
      '+25% wish chance',
      '+25% wish chance',
      '+25% wish chance',
      '+25% wish chance. Duplicates pay double',
      '+50% wish chance',
      '+50% wish chance. Duplicates pay 4x',
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
      '+0.5% coin drop chance. Daily bonus doubled',
      '+1% coin drop chance',
      '+1% coin drop chance. Coins worth double',
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
      `Unlocks packs. ${PACK_SIZES[0]} cards, all yours`,
      `Packs hold ${PACK_SIZES[1]} cards`,
      `Packs hold ${PACK_SIZES[2]} cards`,
      `Packs hold ${PACK_SIZES[3]} cards. Every pack drops a coin`,
      `Packs hold ${PACK_SIZES[4]} cards`,
      `Packs hold ${PACK_SIZES[5]} cards. Every pack drops 3 coins`,
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
      '+50% wish chance',
      '+1.5% coin drop chance',
      'Shop prices -25%',
      'Shop prices -40%',
      'Shop prices -50%',
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
      'Every pack contains a Rare or better',
      'Every pack contains an Epic or better',
      'Every pack contains a Legendary or better',
      'Every pack contains a Mythic, or the best left in the catalog. New cards pay back 25% of their value',
      'Every pack contains 2 Mythics, or the best left in the catalog',
      'Every pack contains 3 Mythics, or the best left in the catalog. New cards pay back 50%',
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

  /* The works (ADR 0014). Bought with credits in the same shop as everything
     above, because no mechanic here holds another one's ceilings hostage. */
  /** Stars a stack may merge to. */
  maxStars: number
  /** Real cards one press deals, however large the pull is. */
  maxDealt: number
  /** Wrappers a press may lay side by side. */
  maxStacks: number
  /** Share of every pull drawn from the series Called Shot names. */
  aimShare: number
  /** Spare copies the Press needs for one scrap. */
  sparesPerScrap: number
  /** Scrap the Factory's belt pulls through per press. */
  belt: number
  /** Cards one scrap is worth: the Foundry's fraction of this player's press. */
  scrapWorth: number
  /** What an expedition's bounty is multiplied by. */
  outfit: number
  /** Expeditions that may be on the road at once. */
  caravans: number
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
    maxStars: maxStarsFor(u.depth),
    maxDealt: maxDealtFor(u.hands),
    maxStacks: maxStacksFor(u.table),
    aimShare: aimShare(u.aim),
    sparesPerScrap: sparesPerScrap(u.mill),
    belt: beltRate(u.belt),
    // Cards, not a bare multiplier: the Foundry buys a fraction of a *press*,
    // and a press is exponential where scrap is flat. See BASE_SCRAP_WORTH.
    scrapWorth: foundryMult(u.foundry) * packSize * packsPerPull(u.multipack),
    outfit: outfitMult(u.outfit),
    caravans: caravans(u.caravan),
  }
}

/** Badge levels are Roman up to six, and nobody needs VII here. */
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI']
