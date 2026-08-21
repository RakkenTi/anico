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
  /** Kept on purpose: never auto-sold, and skipped by a bulk sale. */
  locked: boolean
  /** How many of this character the player holds. */
  copies: number
  /** The star the stack has merged to, one per doubling. */
  stars: number
  /** What the whole stack fetches, stars and Appraisal included. */
  stackValue: number
}

export type RollGender = 'female' | 'male' | 'everyone'

export type ThemeKey = 'festival' | 'daybreak' | 'arcade'

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
  /**
   * `alert` is the one that survives a phone.
   *
   * Everything else here is a receipt -- what a pull earned, what a stack
   * merged to -- and on a small screen a stack of those covers the bottom of
   * the game while saying nothing anybody reads twice. An alert is a refusal:
   * the answer to something you just tapped, and there is no other copy of it.
   */
  flavor?: 'credits' | 'wish' | 'info' | 'alert'
}
