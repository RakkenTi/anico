/**
 * The contract board.
 *
 * A contract names a series and a depth, and pays when you hold that much of
 * it. That is the whole rule. It used to have a second verb -- pinning, which
 * held a row you could not answer at a bonus, out of three slots, with an
 * Unpin button to give the slot back -- and a rulebook bolted to a to-do list
 * is a rulebook nobody reads.
 *
 * Called Shot (the Shop's `aim` upgrade) routes a share of every pull toward
 * one series, so each row carries an Aim control for its own series and the
 * header carries a picker over everything held.
 */

import { useEffect, useMemo, useState } from 'react'
import { useGame } from '../game/store'
import Icon from './Icon'
import type { OwnedCharacter } from '../game/types'
import { fmt, fmtCount } from '../game/format'
import { sfx } from '../game/sound'
import { answered, tierName, type Contract } from '../game/contracts'
import MusterStage from './MusterStage'
import '../styles/contracts.css'

/** Portraits a row wears: enough to say "you already have these". */
const FACES = 5

/** Most series options rendered in the aim picker at once. */
const PICKER_MAX = 30

interface Row {
  contract: Contract
  ready: boolean
  faces: OwnedCharacter[]
}

/** How far along a row is, as a fraction, guarding a breadth of zero. */
function share(c: Contract): number {
  return c.held / Math.max(1, c.breadth)
}

/** Crosshair mark for the Aim controls; filled centre when the aim is live. */
function Crosshair({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 0.6v3M8 12.4v3M0.6 8h3M12.4 8h3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {filled && <circle cx="8" cy="8" r="2" fill="currentColor" />}
    </svg>
  )
}

function Demand({
  row,
  nearest,
  aimedAt,
  children,
}: {
  row: Row
  nearest: boolean
  aimedAt: boolean
  children: React.ReactNode
}) {
  const { contract, ready, faces } = row
  const pct = Math.min(100, Math.round(share(contract) * 100))
  return (
    <div
      className={`contract-row ${ready ? 'ready' : ''} ${nearest ? 'next' : ''} ${
        aimedAt ? 'aimed' : ''
      }`}
    >
      <div className="contract-faces" aria-hidden="true">
        {faces.length === 0 ? (
          <span className="contract-facehole">
            <Icon name="crown_a" />
          </span>
        ) : (
          /* `--i` staggers the idle drift in CSS, so the rank breathes without
             a single React tick behind it. */
          faces.map((c, i) => (
            <img
              key={c.id}
              src={c.image}
              alt=""
              loading="lazy"
              draggable={false}
              title={c.name}
              style={{ '--i': i } as React.CSSProperties}
            />
          ))
        )}
      </div>

      <div className="contract-body">
        <div className="contract-head">
          <b className="contract-series" title={contract.series}>
            {contract.series}
          </b>
          <span className="contract-chip tier">{tierName(contract)}</span>
          {ready && <span className="contract-chip go">ready</span>}
          {nearest && !ready && <span className="contract-chip near">closest</span>}
          {aimedAt && !ready && <span className="contract-chip aim">aimed</span>}
        </div>
        <div className="contract-ask">
          Wants <b>{contract.breadth}</b> from this series at <b>★{contract.depth}+</b>
        </div>
        <div
          className="contract-bar"
          role="img"
          aria-label={`${contract.held} of ${contract.breadth} held`}
        >
          <span style={{ width: `${pct}%` }} />
          <em>
            {contract.held} of {contract.breadth}
          </em>
        </div>
      </div>

      <div className="contract-actions">{children}</div>
    </div>
  )
}

export default function ContractsView() {
  const board = useGame((s) => s.board)
  const collection = useGame((s) => s.collection)
  const upgrades = useGame((s) => s.upgrades)
  const effects = useGame((s) => s.effects)
  const aimSeries = useGame((s) => s.aimSeries)
  const muster = useGame((s) => s.muster)
  const dismissMuster = useGame((s) => s.dismissMuster)
  const raid = useGame((s) => s.raid)
  const setAim = useGame((s) => s.setAim)
  const [pickingAim, setPickingAim] = useState(false)
  const [aimQuery, setAimQuery] = useState('')

  /* A muster is a receipt, not a place. Leaving the page settles it. */
  useEffect(() => () => dismissMuster(), [dismissMuster])

  /*
   * One pass over the collection, not one per row: a series lookup over sixty-
   * five thousand cards, five times a render, is a frame nobody gets back.
   *
   * Whatever copy this device already has, and deliberately not refetched. Boot
   * loads the collection and the Collection view refreshes it when its revision
   * moves; a face from a stale copy is a face, and the contract's own numbers
   * come from the instance on every snapshot.
   */
  const bySeries = useMemo(() => {
    const m = new Map<string, OwnedCharacter[]>()
    for (const c of collection) {
      const held = m.get(c.series)
      if (held) held.push(c)
      else m.set(c.series, [c])
    }
    return m
  }, [collection])

  /* Fulfillable first, then whatever the collection is nearest to. The board
     used to render in database order, and five contracts of wildly different
     distance in a shuffled list read as noise. */
  const rows = useMemo(() => {
    const all: Row[] = board.map((c) => ({
      contract: c,
      ready: answered(c),
      faces: (bySeries.get(c.series) ?? [])
        .filter((o) => o.stars >= c.depth)
        .sort((a, b) => b.stars - a.stars)
        .slice(0, FACES),
    }))
    return all.sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? -1 : 1
      return share(b.contract) - share(a.contract)
    })
  }, [board, bySeries])

  const ready = rows.filter((r) => r.ready)
  const open = rows.filter((r) => !r.ready)

  /*
   * The one unfinished row the collection is nearest to. A board of nothing
   * but empty rows names none: "closest" out of five zeroes is a coin toss.
   */
  const nearestId = useMemo(() => {
    let best: Row | null = null
    for (const r of rows) {
      if (r.ready || r.contract.held <= 0) continue
      if (!best || share(r.contract) > share(best.contract)) best = r
    }
    return best?.contract.id ?? null
  }, [rows])

  /* Every held series, deepest stack first, for the aim picker. */
  const allSeries = useMemo(
    () =>
      [...bySeries.entries()]
        .map(([name, held]) => [name, held.length] as const)
        .sort((a, b) => b[1] - a[1]),
    [bySeries],
  )

  const aimMatches = useMemo(() => {
    const q = aimQuery.trim().toLowerCase()
    const hits = q ? allSeries.filter(([name]) => name.toLowerCase().includes(q)) : allSeries
    return hits.slice(0, PICKER_MAX)
  }, [allSeries, aimQuery])

  const aimShare = effects().aimShare
  const aimOwned = upgrades.aim > 0

  const aim = (series: string | null) => {
    void setAim(series)
    sfx.tap()
  }

  /* A row offers exactly what you can do with it: fulfil it, or aim at it. */
  const action = (row: Row) => {
    const c = row.contract
    const on = aimSeries === c.series
    return (
      <>
        {aimOwned && (
          <button
            className={`contract-aim-btn ${on ? 'on' : ''}`}
            title="Aim pulls at this series"
            aria-pressed={on}
            onClick={() => aim(on ? null : c.series)}
          >
            <Crosshair filled={on} />
          </button>
        )}
        <span className="contract-reward">+{fmt(c.reward)} cr</span>
        {row.ready && (
          <button className="btn btn-primary" onClick={() => void raid(c.id)}>
            Fulfil
          </button>
        )}
      </>
    )
  }

  return (
    <div className="contracts-view">
      {muster && <MusterStage muster={muster} onClose={dismissMuster} />}

      <p className="contract-lede">
        A contract pays credits for characters you already hold. Fulfil one whenever it is ready.
      </p>

      <div className="panel">
        <h2 className="section-title">
          Contracts <span className="slot-count">{ready.length} ready</span>
        </h2>

        {aimOwned ? (
          <div className={`contract-aim ${aimSeries ? 'live' : ''}`}>
            <div className="contract-aim-main">
              <span className="contract-aim-label">
                <Crosshair filled={!!aimSeries} /> Called Shot
              </span>
              {aimSeries ? (
                <>
                  <b className="contract-aim-target" title={aimSeries}>
                    {aimSeries}
                  </b>
                  <span className="contract-aim-share">
                    {Math.round(aimShare * 100)}% of every pull
                  </span>
                </>
              ) : (
                <span className="contract-aim-target idle">No target set.</span>
              )}
            </div>
            <div className="contract-aim-controls">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setPickingAim(!pickingAim)
                  sfx.tap()
                }}
              >
                {pickingAim ? 'Close' : aimSeries ? 'Change' : 'Set target'}
              </button>
              {aimSeries && (
                <button className="btn btn-quiet" onClick={() => aim(null)}>
                  Clear
                </button>
              )}
            </div>
            {pickingAim && (
              <div className="contract-aim-picker">
                <input
                  className="contract-aim-search"
                  type="search"
                  placeholder="Search held series"
                  value={aimQuery}
                  onChange={(e) => setAimQuery(e.target.value)}
                  autoFocus
                />
                <div className="contract-aim-options">
                  {aimMatches.length === 0 && (
                    <span className="contract-note">No held series match.</span>
                  )}
                  {aimMatches.map(([name, n]) => (
                    <button
                      key={name}
                      className={`contract-aim-option ${aimSeries === name ? 'active' : ''}`}
                      onClick={() => {
                        aim(name)
                        setPickingAim(false)
                      }}
                    >
                      <span className="contract-aim-option-name">{name}</span>
                      <b>×{fmtCount(n)}</b>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="contract-note contract-aim-locked">
            Called Shot, in the Shop, aims your pulls at one series.
          </p>
        )}

        {rows.length === 0 ? (
          <div className="empty-state small">
            <p>No contracts posted.</p>
          </div>
        ) : (
          <div className="contract-list">
            {ready.length > 0 && <h3 className="contract-group">Ready now</h3>}
            {ready.map((row) => (
              <Demand
                key={row.contract.id}
                row={row}
                nearest={false}
                aimedAt={aimOwned && aimSeries === row.contract.series}
              >
                {action(row)}
              </Demand>
            ))}
            {open.length > 0 && ready.length > 0 && <h3 className="contract-group">Still short</h3>}
            {open.map((row) => (
              <Demand
                key={row.contract.id}
                row={row}
                nearest={row.contract.id === nearestId}
                aimedAt={aimOwned && aimSeries === row.contract.series}
              >
                {action(row)}
              </Demand>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
