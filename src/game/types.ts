export type Gender = 'Female' | 'Male' | 'Other'

export interface RolledCharacter {
  id: number
  name: string
  nativeName: string | null
  image: string
  gender: Gender
  favourites: number
  series: string
  creditValue: number
  /** Alternative names (aliases) from AniList; shown on name hover. */
  aliases?: string[]
  /** Extra artwork (series covers) for the modal carousel. */
  covers?: string[]
}

export interface OwnedCharacter extends RolledCharacter {
  claimedAt: number
  /** How many of this character the player holds. */
  copies: number
  /** The star the stack has merged to, one per doubling. */
  stars: number
  /** What the whole stack fetches, stars and Appraisal included. */
  stackValue: number
}

export type RollGender = 'female' | 'male' | 'everyone'

export type ThemeKey = 'festival' | 'daybreak' | 'arcade'

/** Structural layouts, orthogonal to themes, which only recolor. */
export type LayoutKey = 'classic' | 'scroll' | 'ledger' | 'stage'

/** One revealed card in the current summon (single roll or x10 spread). */
export interface RollResult {
  char: RolledCharacter
  owned: boolean
  wished: boolean
  compensation: number
}

export interface PendingCoins {
  tier: string
  amount: number
}

export interface Toast {
  id: number
  text: string
  flavor?: 'credits' | 'wish' | 'info'
}
