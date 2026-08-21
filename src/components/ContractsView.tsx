/**
 * The contract board.
 *
 * A contract names a series and a depth and nothing else. That restraint is
 * the mechanic: give a character a number and the character stops mattering,
 * and scoring a contract on credit value would only rename rarity, so the
 * answer would always be "send the eleven Mythics".
 *
 * This page used to be the gateway to the upgrade tree, with a currency of its
 * own to earn and a shelf of its own to spend it on (ADR 0013). Both are gone
 * (ADR 0014): the upgrades live in the Shop with everything else, milling
 * lives in the Press, and what is left here is a goal board. Free to attempt,
 * paying credits, and optional -- which means it has to earn attention rather
 * than collect it as a toll, so the page is one column in the order you act in
 * and fulfilling a contract plays a muster, because a mechanic with no ritual
 * is a spreadsheet with buttons.
 */

import { useEffect, useMemo, useState } from 'react'
import { useGame } from '../game/store'
import Icon from './Icon'
import type { OwnedCharacter } from '../game/types'
import { fmt, fmtCount } from '../game/format'
import {
  COMMISSION_BONUS,
  COMMISSION_SLOTS,
  answered,
  tierName,
  type Contract,
  type Pinned,
} from '../game/contracts'
import MusterStage from './MusterStage'
import '../styles/contracts.css'

/** Portraits a row wears: enough to say "you already have these". */
const FACES = 5

interface Row {
  contract: Contract | Pinned
  /** Pinned to the board rather than fulfillable today: it waits, and pays more. */
  pinned: boolean
  ready: boolean
  faces: OwnedCharacter[]
}

/**
 * Where a row sits.
 *
 * Fulfillable first, then whatever the collection is nearest to. The board
 * used to render in database order, so five contracts of wildly different
 * distance sat in a shuffled list and the page read as noise.
 */
function rank(r: Row): number {
  if (r.ready) return r.pinned ? 0 : 1
  return r.pinned ? 2 : 3
}

/** How far along a row is, as a fraction, guarding a breadth of zero. */
function share(c: Contract): number {
  return c.held / Math.max(1, c.breadth)
}

function Demand({ row, nearest, children }: { row: Row; nearest: boolean; children: React.ReactNode }) {
  const { contract, ready, pinned, faces } = row
  const pct = Math.min(100, Math.round(share(contract) * 100))
  return (
    <div
      className={`contract-row ${ready ? 'ready' : ''} ${pinned ? 'pinned' : ''} ${nearest ? 'next' : ''}`}
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
          <span className="contract-tier">{tierName(contract)}</span>
          <b className="contract-series" title={contract.series}>
            {contract.series}
          </b>
          {pinned && <span className="contract-chip pin">pinned · pays ×{COMMISSION_BONUS}</span>}
          {ready && <span className="contract-chip go">ready</span>}
          {nearest && !ready && <span className="contract-chip near">closest</span>}
        </div>
        <div className="contract-ask">
          Wants <b>{contract.breadth}</b> characters from this series, each at{' '}
          <b>★{contract.depth}</b> or better.
        </div>
        {/* The bar is the whole point of the row: what you hold against what is
            wanted is the only thing in this game that makes one particular
            character worth wanting. */}
        <div
          className="contract-bar"
          role="img"
          aria-label={`${contract.held} of ${contract.breadth} held`}
        >
          <span style={{ width: `${pct}%` }} />
          <em>
            {ready
              ? `${contract.breadth} of ${contract.breadth} — ready`
              : `${contract.held} of ${contract.breadth} · ${contract.breadth - contract.held} to go`}
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
  const acceptCommission = useGame((s) => s.acceptCommission)
  const claimCommission = useGame((s) => s.claimCommission)
  const abandonCommission = useGame((s) => s.abandonCommission)
  const setAim = useGame((s) => s.setAim)
  const [pickingAim, setPickingAim] = useState(false)

  /* A muster is a receipt, not a place. Leaving the page settles it. */
  useEffect(() => () => dismissMuster(), [dismissMuster])

  /*
   * One pass over the collection, not one per row: a series lookup over sixty-
   * five thousand cards, five times a render, is a frame nobody gets back.
   *
   * Whatever copy this device already has, and deliberately not refetched. Boot
   * loads the collection and the Collection view refreshes it when its revision
   * moves; asking again on the way in here means every visit after a pull pays
   * for five figures of cards over the wire to draw thirty portraits. A face
   * from a stale copy is a face -- the contract's own numbers come from the
   * instance on every snapshot, and those are the ones the button obeys.
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

  const rows = useMemo(() => {
    const all: Row[] = []
    const add = (c: Contract | Pinned, pinned: boolean) => {
      const faces = (bySeries.get(c.series) ?? [])
        .filter((o) => o.stars >= c.depth)
        .sort((a, b) => b.stars - a.stars)
        .slice(0, FACES)
      all.push({ contract: c, pinned, ready: answered(c), faces })
    }
    for (const c of board.commissions) add(c, true)
    for (const c of board.raids) add(c, false)
    return all.sort((a, b) => {
      const d = rank(a) - rank(b)
      if (d !== 0) return d
      return share(b.contract) - share(a.contract)
    })
  }, [board, bySeries])

  const ready = rows.filter((r) => r.ready)
  const open = rows.filter((r) => !r.ready)

  /*
   * The one unfinished row the collection is nearest to.
   *
   * A board of five rows you cannot fulfil is five identical refusals, and the
   * player has no reason to look at any of them. Naming the closest one gives
   * the eye somewhere to land and the next pull somewhere to go. A board of
   * nothing but empty rows names none, because "closest" out of five zeroes is
   * a coin toss dressed up as advice.
   */
  const nearestId = useMemo(() => {
    let best: Row | null = null
    for (const r of rows) {
      if (r.ready || r.contract.held <= 0) continue
      if (!best || share(r.contract) > share(best.contract)) best = r
    }
    return best?.contract.id ?? null
  }, [rows])

  /* Series to aim at: the ones the player is actually collecting, deepest
     first, because Called Shot is for finishing something you have started. */
  const series = useMemo(
    () =>
      [...bySeries.entries()]
        .map(([name, held]) => [name, held.length] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 24),
    [bySeries],
  )

  const aimShare = effects().aimShare
  const aimed = upgrades.aim > 0
  const slotsFree = Math.max(0, COMMISSION_SLOTS - board.commissions.length)

  /*
   * A row offers exactly what you can do with it and nothing else.
   *
   * A contract you are short of used to wear a dead primary button reading "4
   * more" -- the same thing the bar underneath it already said, drawn to look
   * like the button you press. What you can actually do with a row you cannot
   * fulfil is pin it, so that is the button it gets.
   */
  const action = (row: Row) => {
    const c = row.contract
    const pay = <span className="contract-reward">+{fmt(c.reward)} credits</span>
    if (row.pinned) {
      /* The bonus was applied when the pin was taken, so `reward` is already
         the full amount and there is nothing left to multiply here. */
      return row.ready ? (
        <>
          <button className="btn btn-primary" onClick={() => void claimCommission(c.id)}>
            Collect
          </button>
          {pay}
        </>
      ) : (
        <>
          {pay}
          <button
            className="btn btn-quiet"
            onClick={() => void abandonCommission(c.id)}
            title="Free the pin. The contract goes; nothing else changes."
          >
            Unpin
          </button>
        </>
      )
    }
    if (row.ready) {
      return (
        <>
          <button className="btn btn-primary" onClick={() => void raid(c.id)}>
            Fulfil
          </button>
          {pay}
        </>
      )
    }
    return (
      <>
        {pay}
        <button
          className="btn btn-ghost"
          disabled={slotsFree <= 0}
          onClick={() => void acceptCommission(c.id)}
          title={
            slotsFree > 0
              ? `Pin it: it stays on the board however long it takes, and pays ×${COMMISSION_BONUS} — ${fmt(Math.round(c.reward * COMMISSION_BONUS))} credits — when your collection reaches it.`
              : `All ${COMMISSION_SLOTS} pins are in use.`
          }
        >
          Pin
        </button>
      </>
    )
  }

  return (
    <div className="contracts-view">
      {muster && <MusterStage muster={muster} onClose={dismissMuster} />}

      <p className="contract-lede">
        Each row names a series and asks for characters you have already merged that deep.
        Fulfilling one costs nothing and risks nothing — press <b>Fulfil</b>, the characters go
        out and come straight back, and it pays a lump of credits. A row you cannot reach yet can
        be pinned instead, and it waits as long as it takes.
      </p>

      <div className="panel">
        <h2 className="section-title">
          Contracts{' '}
          <span className="slot-count">
            {slotsFree} of {COMMISSION_SLOTS} pins free
          </span>
        </h2>
        <p className="section-sub">
          Nothing here expires and nothing is lost. Fulfil the ready rows whenever you like, pin
          one that is out of reach to be paid ×{COMMISSION_BONUS} when your collection reaches it,
          and unpin it if you change your mind. Auto Summon fulfils whatever is ready and collects
          whatever fills — pinning is the one call it leaves to you.
        </p>

        {aimed && (
          <div className="contract-aim">
            <span className="contract-aim-state">
              <Icon name="cards_seek" />
              {aimSeries ? (
                <>
                  <b>{Math.round(aimShare * 100)}%</b> of every pull is drawn from{' '}
                  <b>{aimSeries}</b>
                </>
              ) : (
                <>
                  Called Shot is idle. Name a series and <b>{Math.round(aimShare * 100)}%</b> of
                  every pull comes from it — this is how you finish a contract on purpose.
                </>
              )}
            </span>
            <button className="btn btn-ghost" onClick={() => setPickingAim(!pickingAim)}>
              {pickingAim ? 'Close' : aimSeries ? 'Change target' : 'Choose a series'}
            </button>
            {aimSeries && (
              <button className="btn btn-quiet" onClick={() => void setAim(null)}>
                Stop aiming
              </button>
            )}
            {pickingAim && (
              <div className="contract-aim-picker">
                {series.length === 0 && (
                  <span className="contract-note">Nothing collected yet.</span>
                )}
                {series.map(([name, n]) => (
                  <button
                    key={name}
                    className={`chip ${aimSeries === name ? 'active' : ''}`}
                    onClick={() => {
                      void setAim(name)
                      setPickingAim(false)
                    }}
                  >
                    {name} <b>×{fmtCount(n)}</b>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {rows.length === 0 ? (
          <div className="empty-state small">
            <p>No contracts posted. The catalog may still be crawling.</p>
          </div>
        ) : (
          <div className="contract-list">
            {ready.length > 0 && <h3 className="contract-group">Ready now</h3>}
            {ready.map((row) => (
              <Demand key={row.contract.id} row={row} nearest={false}>
                {action(row)}
              </Demand>
            ))}
            {open.length > 0 && ready.length > 0 && (
              <h3 className="contract-group">Still short</h3>
            )}
            {open.map((row) => (
              <Demand key={row.contract.id} row={row} nearest={row.contract.id === nearestId}>
                {action(row)}
              </Demand>
            ))}
          </div>
        )}

        {/* The shelf this page used to end in has moved. Said in one line so a
            returning player looking for Called Shot knows where it went. */}
        <p className="contract-shop-note">
          Upgrades are bought in the <b>Shop</b>, Called Shot among them. Contracts only pay
          credits.
        </p>
      </div>
    </div>
  )
}
