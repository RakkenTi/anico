import { useEffect, useState } from 'react'
import { api, type RankBoard, type RankRow, type Ranks } from '../api'
import { fmt, fmtCount } from '../game/format'
import { useGame } from '../game/store'
import { DEMO } from '../game/demo'
import Icon from './Icon'

/**
 * Where everybody stands.
 *
 * No rule in this game is competitive -- nobody's collection changes anybody
 * else's draws -- so this is not a scoreboard so much as proof that the other
 * accounts on the instance are being played. Which is why the dot matters more
 * than the ranking: somebody is summoning right now, on the same server.
 *
 * It refreshes on a timer because there is nothing to push. The instance
 * gathers these numbers at most once every ten seconds however many people are
 * watching, so a slow poll here costs the server nothing.
 */
const REFRESH_MS = 20_000

function value(row: RankRow, unit: RankBoard['unit']): string {
  if (unit === 'credits') return fmt(row.value)
  if (unit === 'stars') return row.value > 0 ? `${row.value}★` : '—'
  return fmtCount(row.value)
}

function Row({ row, unit }: { row: RankRow; unit: RankBoard['unit'] }) {
  return (
    <li className={`rank-row ${row.you ? 'rank-you' : ''} ${row.rank <= 3 ? `rank-top rank-${row.rank}` : ''}`}>
      <span className="rank-place">{row.rank}</span>
      <span className="rank-name">
        {/* Dimmed rather than absent when offline: an empty slot reads as a
            missing thing, and this is a fact about a person, not a badge. */}
        <span className={`rank-dot ${row.online ? 'on' : ''}`} title={row.online ? 'Playing now' : 'Away'} />
        {row.player}
        {row.you && <em className="rank-tag">you</em>}
      </span>
      {row.note && <span className="rank-note">{row.note}</span>}
      <span className="rank-value">{value(row, unit)}</span>
    </li>
  )
}

function Board({ board }: { board: RankBoard }) {
  return (
    <div className="panel rank-board">
      <h2 className="section-title">{board.title}</h2>
      <p className="section-sub">{board.blurb}</p>
      <ol className="rank-list">
        {board.rows.map((r) => (
          <Row key={`${board.key}-${r.rank}`} row={r} unit={board.unit} />
        ))}
        {board.you && (
          <>
            <li className="rank-gap" aria-hidden="true">
              ⋯
            </li>
            <Row row={board.you} unit={board.unit} />
          </>
        )}
      </ol>
    </div>
  )
}

export default function LeaderboardView() {
  const [ranks, setRanks] = useState<Ranks | null>(null)
  const [error, setError] = useState<string | null>(null)
  const username = useGame((s) => s.username)

  useEffect(() => {
    let alive = true
    const load = () =>
      api
        .ranks()
        .then((r) => {
          if (!alive) return
          setRanks(r)
          setError(null)
        })
        .catch(() => alive && setError('Could not reach the instance.'))
    void load()
    const id = setInterval(() => void load(), REFRESH_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
    // Reloaded on a rename so the board stops calling you by the old name
    // before the next poll comes round.
  }, [username])

  if (error && !ranks) {
    return (
      <div className="ranks-view">
        <div className="panel">
          <p className="section-sub">{error}</p>
        </div>
      </div>
    )
  }
  if (!ranks) {
    return (
      <div className="ranks-view">
        <div className="panel">
          <p className="section-sub">Counting…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="ranks-view">
      <div className="panel ranks-header">
        <div className="ranks-hero">
          <Icon name="podium" className="ranks-glyph" />
          <div>
            <h2 className="section-title">This instance</h2>
            <p className="section-sub">
              {fmtCount(ranks.players)} {ranks.players === 1 ? 'player' : 'players'} here,{' '}
              <b className="ranks-online">{fmtCount(ranks.online)}</b> playing right now, holding{' '}
              {fmtCount(ranks.cards)} cards between them across {fmtCount(ranks.claimed)}{' '}
              characters.
            </p>
            {/* One visitor per tab, so the boards below are a table for one.
                Said out loud rather than hidden: what a shared instance does
                with this page is the point of it. */}
            {DEMO && (
              <p className="section-sub">
                The demo is an instance of one. On a real instance these are your friends.
              </p>
            )}
          </div>
        </div>
      </div>

      {ranks.boards.map((b) => (
        <Board key={b.key} board={b} />
      ))}

      <p className="attribution">
        Sandbox profiles are left off every board: they are handed credits and deleted on the
        next restart.
      </p>
    </div>
  )
}
