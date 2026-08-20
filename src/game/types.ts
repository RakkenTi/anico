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

export interface Settings {
  rollGender: RollGender
  /** Approximate roll pool size; maps to the top N/250 pages of series by popularity */
  poolSize: number
  rollsPerReset: number
  rollResetMinutes: number
  claimIntervalMinutes: number
  /** When true, characters you already own are skipped while rolling */
  skipOwned: boolean
  /** Sandbox: no roll limits, no cooldowns, for testing the loop */
  testingMode: boolean
  theme: ThemeKey
  layout: LayoutKey
  soundEnabled: boolean
  /** 0–1 master volume for the synthesized sound kit */
  soundVolume: number
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
