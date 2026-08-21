/**
 * The second tree.
 *
 * Badges buy the shape of the game and they finish at 63.9M credits; upgrades
 * buy its curve and never finish. By a quadrillion credits there is nothing
 * left to buy that changes anything, because shape is what was missing and
 * shape is what ran out (ADR 0013).
 *
 * Renown is the currency raids pay, and this is what it buys. Every line here
 * raises a ceiling the credit engine has been sitting against -- how deep a
 * stack may merge, how many cards a pull deals, how many wrappers fit on a
 * screen -- so it is a lever on the engine rather than another faucet into it.
 * Nothing here is convertible to credits in either direction, and nothing here
 * multiplies a rate.
 *
 * It ends. Six levels a line, five lines, in the same spirit as badges: what
 * this buys is shape, and shape is finite.
 */

export type RenownKey = 'depth' | 'hands' | 'table' | 'aim' | 'mill'
export type Renown = Record<RenownKey, number>

export const EMPTY_RENOWN: Renown = { depth: 0, hands: 0, table: 0, aim: 0, mill: 0 }

/** Levels every line has. */
export const RENOWN_MAX = 6

/* ------------------------------------------------------------- the floors */

/** Stars a stack may merge to before Deeper Merges is bought. */
export const BASE_MAX_STARS = 12
/** Cards a pull deals before Wider Deal is bought. */
export const BASE_MAX_DEALT = 1_000
/** Wrappers a pull may put on the screen before Longer Table is bought. */
export const BASE_MAX_STACKS = 24
/**
 * Spares one Scrip is worth.
 *
 * A press deals at most a thousand cards and no upgrade can raise that, so at
 * end game -- where nearly every claim is a spare -- this is about one Scrip a
 * press. The whole second economy is denominated in presses, which is what
 * keeps the credit curve out of it.
 */
export const BASE_SPARES_PER_SCRIP = 900

export interface RenownDef {
  key: RenownKey
  name: string
  /** Name of the vendored Kenney icon this line wears. */
  icon: string
  /** One plain sentence: what buying this does. */
  blurb: string
  baseCost: number
  growth: number
  /** What owning `level` of this line does, as the shelf says it. */
  effect: (level: number) => string
}

export const RENOWN_DEFS: RenownDef[] = [
  {
    key: 'depth',
    name: 'Deeper Merges',
    icon: 'flask_full',
    blurb: 'Stacks merge past ★12. Each star multiplies what the whole stack is worth.',
    baseCost: 8,
    growth: 2.1,
    effect: (l) => `stacks merge to ★${maxStars(l)}`,
  },
  {
    key: 'hands',
    name: 'Wider Deal',
    icon: 'cards_fan',
    blurb: 'A pull deals more real cards, so more of it becomes copies instead of credits.',
    baseCost: 5,
    growth: 1.95,
    effect: (l) => `${maxDealt(l).toLocaleString()} cards dealt`,
  },
  {
    key: 'table',
    name: 'Longer Table',
    icon: 'cards_stack_high',
    blurb: 'More wrappers fit side by side, so Extra Packs starts mattering again.',
    baseCost: 4,
    growth: 1.85,
    effect: (l) => `${maxStacks(l)} wrappers on screen`,
  },
  {
    key: 'aim',
    name: 'Called Shot',
    icon: 'cards_seek',
    blurb: 'Name a series and part of every pull is drawn from it.',
    baseCost: 6,
    growth: 2.0,
    effect: (l) => (l > 0 ? `${Math.round(aimShare(l) * 100)}% of a pull, aimed` : 'no target'),
  },
  {
    key: 'mill',
    name: 'Finer Mill',
    icon: 'gear',
    blurb: 'The Refinery gets more Scrip out of the same spares.',
    baseCost: 3,
    growth: 1.8,
    effect: (l) => `${sparesPerScrip(l)} spares per Scrip`,
  },
]

/* ------------------------------------------------------------ the numbers */

const lv = (level: number) => Math.max(0, Math.min(RENOWN_MAX, Math.floor(level)))

/**
 * How deep a stack may merge.
 *
 * The strongest line in the game and priced like it: `stackValue` is
 * `value × mergeMult ^ stars`, so at Merge Value L36 one star here is a flat
 * ×18.8 on every maxed stack, which eighteen levels of Sell Value would take
 * to match. It is gated by the flat stream rather than by money -- ★13 needs
 * 8,192 copies of one character and copies arrive a thousand a press whatever
 * you own -- so what it costs in the end is being there.
 */
export function maxStars(level: number): number {
  return BASE_MAX_STARS + lv(level)
}

/**
 * Cards a pull deals.
 *
 * Every dealt card is a claim written, so this is the one line here with a
 * cost the server pays: four hundred more cards a level, not a doubling. It
 * also very slightly lowers credit income, because a dealt duplicate pays 16%
 * of sell value where an appraised card pays 100% -- about 3.9% of a pull at
 * the top of this line, for three and a half times the spares.
 */
export function maxDealt(level: number): number {
  return BASE_MAX_DEALT + 400 * lv(level)
}

/** Wrappers a pull may lay side by side. */
export function maxStacks(level: number): number {
  return BASE_MAX_STACKS + 4 * lv(level)
}

/** How much of a pull is drawn from the series the player named. */
export function aimShare(level: number): number {
  return lv(level) === 0 ? 0 : Math.min(0.6, 0.1 * lv(level))
}

/** Spares the Refinery needs for one Scrip. */
export function sparesPerScrip(level: number): number {
  return Math.max(1, Math.round(BASE_SPARES_PER_SCRIP / (1 + lv(level))))
}

/** What the next level of a line costs, in Renown. */
export function renownCost(def: RenownDef, currentLevel: number): number {
  const level = lv(currentLevel)
  const raw = def.baseCost * Math.pow(def.growth, level)
  return raw < 100 ? Math.round(raw) : Math.round(raw / 10) * 10
}

export function renownMaxed(level: number): boolean {
  return lv(level) >= RENOWN_MAX
}

/** Everything the tree does, read as one object the way badges are. */
export interface RenownEffects {
  maxStars: number
  maxDealt: number
  maxStacks: number
  aimShare: number
  sparesPerScrip: number
}

export function renownEffects(r: Renown): RenownEffects {
  return {
    maxStars: maxStars(r.depth),
    maxDealt: maxDealt(r.hands),
    maxStacks: maxStacks(r.table),
    aimShare: aimShare(r.aim),
    sparesPerScrip: sparesPerScrip(r.mill),
  }
}

/** Renown levels arrive from the database as loose JSON. */
export function sanitizeRenown(raw: unknown): Renown {
  const out = { ...EMPTY_RENOWN }
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(EMPTY_RENOWN) as RenownKey[]) {
      const n = Number((raw as Record<string, unknown>)[key])
      if (Number.isFinite(n)) out[key] = lv(n)
    }
  }
  return out
}
