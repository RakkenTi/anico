/**
 * The instance leaderboard.
 *
 * Anico is single-player in every rule it has: nobody can take a card off
 * anybody, and one player's collection changes nothing about another's draws.
 * What a shared instance was missing was any evidence that the other people
 * exist. This is that evidence and nothing more -- six columns of the numbers
 * everybody already has, and a mark against whoever is connected right now.
 *
 * Sandbox profiles are excluded everywhere. They start with credits handed to
 * them and are deleted on the next restart, so a board they appeared on would
 * be a board anybody could top by pressing a button in Settings.
 */

import type { DB } from './db.js'
import { onlineIds } from './bus.js'
import type { PlayerProfile, RankBoard, RankRow, RankUnit, Ranks } from '../src/game/ranks.js'
import { EMPTY_BADGES } from '../src/game/badges.js'
import { EMPTY_UPGRADES } from '../src/game/upgrades.js'

export type { PlayerProfile, RankBoard, RankRow, RankUnit, Ranks }

interface Standing {
  id: number
  username: string
  credits: number
  rolls: number
  /** Distinct characters, which is what "collection size" has always meant. */
  characters: number
  /** Every copy of every one of them. */
  cards: number
  /** The highest star any one stack has merged to. */
  stars: number
  /** The credit value of the best card ever claimed. */
  best: number
  /** The characters behind the two numbers above, named once per gather. */
  starCard?: string
  bestCard?: string
}

/**
 * How long a set of standings is served before it is gathered again.
 *
 * Three aggregates over every claim on the instance is not a query to run per
 * viewer per second, and a leaderboard that is ten seconds stale is a
 * leaderboard. The board also refreshes itself on the client, so this is the
 * ceiling on what that costs however many people are watching.
 */
const CACHE_MS = 10_000

let cache: { at: number; rows: Standing[] } | null = null

function standings(db: DB): Standing[] {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) return cache.rows
  const rows = db
    .prepare(
      `SELECT p.id, p.username,
              ps.credits, ps.total_rolls AS rolls,
              (SELECT COUNT(*)                  FROM claims c WHERE c.player_id = p.id) AS characters,
              (SELECT COALESCE(SUM(c.copies),0) FROM claims c WHERE c.player_id = p.id) AS cards,
              (SELECT COALESCE(MAX(c.stars),0)  FROM claims c WHERE c.player_id = p.id) AS stars,
              (SELECT COALESCE(MAX(c.credit_value),0) FROM claims c WHERE c.player_id = p.id) AS best
         FROM players p JOIN player_state ps ON ps.player_id = p.id
        WHERE p.sandbox_of IS NULL`,
    )
    .all() as Standing[]
  // Naming the two cards is a scan of one player's claims each, so it happens
  // here -- once per player per gather -- rather than once per row rendered.
  const named = db.prepare(
    `SELECT ch.name FROM claims c JOIN characters ch ON ch.id = c.character_id
      WHERE c.player_id = ? AND c.stars = ? ORDER BY c.copies DESC LIMIT 1`,
  )
  const richest = db.prepare(
    `SELECT ch.name FROM claims c JOIN characters ch ON ch.id = c.character_id
      WHERE c.player_id = ? AND c.credit_value = ? LIMIT 1`,
  )
  const nameOf = (stmt: { get: (...a: unknown[]) => unknown }, id: number, value: number) =>
    value > 0 ? (stmt.get(id, value) as { name: string } | undefined)?.name : undefined
  for (const r of rows) {
    r.starCard = nameOf(named, r.id, r.stars)
    r.bestCard = nameOf(richest, r.id, r.best)
  }
  cache = { at: now, rows }
  return rows
}

/** Anything cached about this instance is wrong the moment a name changes. */
export function forgetRanks(): void {
  cache = null
}

const TOP = 10

interface BoardSpec {
  key: string
  title: string
  blurb: string
  unit: RankUnit
  of: (s: Standing) => number
  note?: (s: Standing) => string | undefined
}

const BOARDS: BoardSpec[] = [
  {
    key: 'credits',
    title: 'Fortune',
    blurb: 'Credits in hand right now, which is as much about what you have not spent.',
    unit: 'credits',
    of: (s) => s.credits,
  },
  {
    key: 'characters',
    title: 'Collection',
    blurb: 'Distinct characters claimed. Selling a stack does not take one back off here.',
    unit: 'count',
    of: (s) => s.characters,
  },
  {
    key: 'cards',
    title: 'Cards held',
    blurb: 'Every copy of every character, duplicates and all.',
    unit: 'count',
    of: (s) => s.cards,
  },
  {
    key: 'stars',
    title: 'Brightest stack',
    blurb: 'The highest star anybody has merged one character to.',
    unit: 'stars',
    of: (s) => s.stars,
    note: (s) => s.starCard,
  },
  {
    key: 'best',
    title: 'Best find',
    blurb: 'The most valuable card ever pulled, at the value it was pulled at.',
    unit: 'credits',
    of: (s) => s.best,
    note: (s) => s.bestCard,
  },
  {
    key: 'rolls',
    title: 'Summons',
    blurb: 'Presses of the button, by hand and by Automaton alike.',
    unit: 'count',
    of: (s) => s.rolls,
  },
]

/**
 * Whether somebody is at the game right now.
 *
 * A live stream, or being the person who just asked -- they are looking at the
 * page, whatever the bus thinks. Without the second half the demo, which runs
 * the instance in the tab and opens no stream at all, would tell its only
 * visitor that nobody is playing.
 */
const presence = (viewerId: number) => {
  const live = onlineIds()
  return (id: number) => id === viewerId || live.has(id)
}

export function ranks(db: DB, viewerId: number): Ranks {
  const rows = standings(db)
  const isOn = presence(viewerId)
  const online = rows.filter((r) => isOn(r.id)).length

  const boards = BOARDS.map((spec) => {
    const ranked = rows
      .map((s) => ({ s, value: spec.of(s) }))
      .sort((a, b) => b.value - a.value)
      .map((r, i) => ({ ...r, rank: i + 1 }))

    const render = (r: { s: Standing; value: number; rank: number }): RankRow => ({
      rank: r.rank,
      player: r.s.username,
      you: r.s.id === viewerId,
      online: isOn(r.s.id),
      value: r.value,
      note: spec.note?.(r.s),
    })

    const top = ranked.slice(0, TOP)
    const mine = ranked.find((r) => r.s.id === viewerId)
    return {
      key: spec.key,
      title: spec.title,
      blurb: spec.blurb,
      unit: spec.unit,
      rows: top.map(render),
      // Only when they placed outside the top, so their own line is on every
      // board whether or not they are winning it.
      you: mine && mine.rank > TOP ? render(mine) : null,
    }
  })

  return {
    players: rows.length,
    online,
    claimed: rows.reduce((n, r) => n + r.characters, 0),
    cards: rows.reduce((n, r) => n + r.cards, 0),
    // Everybody, not just whoever placed: a board of ten is a ranking, and the
    // roster is the answer to "who else is on this thing".
    roster: rows
      .map((r) => ({ id: r.id, player: r.username, you: r.id === viewerId, online: isOn(r.id) }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.player.localeCompare(b.player)),
    boards,
  }
}

/**
 * One player, as everybody else is allowed to see them.
 *
 * Everything here is a consequence of playing: what they hold, what they have
 * bought, the best card they have turned up. Nothing about the account itself
 * -- no settings, no sessions, no note of who invited whom -- because a page
 * for looking at your friends' collections is not a page for auditing them.
 */
export function profile(db: DB, id: number, viewerId: number): PlayerProfile | null {
  const row = db
    .prepare(
      `SELECT p.id, p.username, p.created_at, p.is_admin,
              ps.credits, ps.total_rolls AS rolls, ps.daily_streak AS streak,
              ps.badges_json, ps.upgrades_json,
              (SELECT COUNT(*)                  FROM claims c WHERE c.player_id = p.id) AS characters,
              (SELECT COALESCE(SUM(c.copies),0) FROM claims c WHERE c.player_id = p.id) AS cards,
              (SELECT COALESCE(MAX(c.stars),0)  FROM claims c WHERE c.player_id = p.id) AS stars
         FROM players p JOIN player_state ps ON ps.player_id = p.id
        WHERE p.id = ? AND p.sandbox_of IS NULL`,
    )
    .get(id) as any
  if (!row) return null

  const parse = <T,>(raw: string, fallback: T): T => {
    try {
      return { ...fallback, ...(JSON.parse(raw) as object) }
    } catch {
      return fallback
    }
  }

  // The five best things they own, which is the part of somebody else's
  // collection anybody actually wants to see.
  const best = db
    .prepare(
      `SELECT ch.id, ch.name, ch.image, ch.series, c.credit_value, c.copies, c.stars
         FROM claims c JOIN characters ch ON ch.id = c.character_id
        WHERE c.player_id = ?
        ORDER BY c.credit_value DESC LIMIT 5`,
    )
    .all(id) as PlayerProfile['best']

  return {
    id: row.id,
    player: row.username,
    isAdmin: !!row.is_admin,
    you: row.id === viewerId,
    online: presence(viewerId)(row.id),
    joinedAt: row.created_at,
    credits: row.credits,
    rolls: row.rolls,
    streak: row.streak,
    characters: row.characters,
    cards: row.cards,
    stars: row.stars,
    badges: parse(row.badges_json, { ...EMPTY_BADGES }),
    upgrades: parse(row.upgrades_json, { ...EMPTY_UPGRADES }),
    best,
  }
}
