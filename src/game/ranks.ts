/**
 * The shape of the leaderboard.
 *
 * Here rather than on the server for the same reason every other shared type
 * is: the client renders these and the instance fills them in, and one
 * definition is what stops the two drifting.
 */

export interface RankRow {
  rank: number
  player: string
  /** The person looking. Their own row is marked wherever it lands. */
  you: boolean
  online: boolean
  value: number
  /** What the number is, when a number alone does not say it: a character. */
  note?: string
}

export type RankUnit = 'credits' | 'count' | 'stars'

export interface RankBoard {
  key: string
  title: string
  blurb: string
  unit: RankUnit
  rows: RankRow[]
  /** The viewer's own standing, when they placed below the rows above. */
  you: RankRow | null
}

/** A name on the roster: enough to list everybody and open one of them. */
export interface RosterEntry {
  id: number
  player: string
  you: boolean
  online: boolean
}

export interface Ranks {
  /** Accounts on this instance, sandbox profiles not counted. */
  players: number
  /** How many of them have a device connected this second. */
  online: number
  /** Distinct characters claimed across the instance, and cards held. */
  claimed: number
  cards: number
  /** Everybody on the instance, connected first, then by name. */
  roster: RosterEntry[]
  boards: RankBoard[]
}

/** One of somebody else's cards, as their profile shows it. */
export interface ProfileCard {
  id: number
  name: string
  image: string
  series: string
  credit_value: number
  copies: number
  stars: number
}

/**
 * What one player looks like to another.
 *
 * Only what playing produced. There is nothing here about the account: no
 * settings, no sessions, no record of who invited whom.
 */
export interface PlayerProfile {
  id: number
  player: string
  isAdmin: boolean
  you: boolean
  online: boolean
  joinedAt: number
  credits: number
  rolls: number
  streak: number
  characters: number
  cards: number
  stars: number
  badges: Record<string, number>
  upgrades: Record<string, number>
  best: ProfileCard[]
}
