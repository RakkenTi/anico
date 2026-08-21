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

export interface Ranks {
  /** Accounts on this instance, sandbox profiles not counted. */
  players: number
  /** How many of them have a device connected this second. */
  online: number
  /** Distinct characters claimed across the instance, and cards held. */
  claimed: number
  cards: number
  boards: RankBoard[]
}
