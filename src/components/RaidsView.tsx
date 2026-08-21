/**
 * The board.
 *
 * Everything the credit economy cannot reach (ADR 0013): spare copies milled
 * into Scrip, demands to spend it on, and the Renown shelf the whole thing
 * pays into.
 *
 * A demand names a series and a depth and nothing else. That restraint is the
 * mechanic: give a character a number and the character stops mattering, and
 * scoring a raid on credit value would only rename rarity, so the answer would
 * always be "send the eleven Mythics".
 *
 * The page used to be four sibling panels of prose that explained why the
 * design is the way it is rather than what to press. It is now one column in
 * the order you act in -- what you have, what to send it at, what that buys --
 * and answering a demand plays a muster, because a mechanic with no ritual is
 * a spreadsheet with buttons.
 */

import { useEffect, useMemo, useState } from 'react'
import { useGame } from '../game/store'
import Icon from './Icon'
import type { IconName } from '../game/icons'
import type { OwnedCharacter } from '../game/types'
import { fmt, fmtCount } from '../game/format'
import { RENOWN_DEFS, renownCost, renownMaxed, sparesPerScrip } from '../game/renown'
import { COMMISSION_SLOTS, answered, tierName, type Commission, type Raid } from '../game/raids'
import MusterStage from './MusterStage'

/** Portraits a row wears: enough to say "you already have these". */
const FACES = 5

interface Row {
  raid: Raid | Commission
  /** Taken on rather than answerable: it stays on the board and pays more. */
  pinned: boolean
  ready: boolean
  affordable: boolean
  faces: OwnedCharacter[]
}

/**
 * Where a row sits.
 *
 * Payable first, then whatever the collection is nearest to. It used to render
 * in database order, so five demands of wildly different distance sat in a
 * shuffled list and the page read as noise.
 */
function rank(r: Row): number {
  if (r.ready) return r.pinned ? 0 : r.affordable ? 1 : 2
  return r.pinned ? 3 : 4
}

function Demand({ row, children }: { row: Row; children: React.ReactNode }) {
  const { raid, ready, pinned, faces } = row
  const pct = Math.min(100, Math.round((raid.held / Math.max(1, raid.breadth)) * 100))
  return (
    <div className={`raid-row ${ready ? 'answerable' : ''} ${pinned ? 'pinned' : ''}`}>
      <div className="raid-faces" aria-hidden="true">
        {faces.length === 0 ? (
          <span className="raid-facehole">
            <Icon name="crown_a" />
          </span>
        ) : (
          faces.map((c) => (
            <img key={c.id} src={c.image} alt="" loading="lazy" draggable={false} title={c.name} />
          ))
        )}
      </div>

      <div className="raid-body">
        <div className="raid-head">
          <span className="raid-tier">{tierName(raid)}</span>
          <b className="raid-series" title={raid.series}>
            {raid.series}
          </b>
          {pinned && <span className="raid-chip pin">pinned · pays ×2.5</span>}
          {ready && <span className="raid-chip go">ready</span>}
        </div>
        <div className="raid-ask">
          Wants <b>{raid.breadth}</b> characters from this series, each at <b>★{raid.depth}</b> or
          better.
        </div>
        {/* The bar is the whole point of the row: a demand you can nearly answer
            is the first thing in this game since the shop ran out that gives you
            a reason to want one particular character. */}
        <div className="raid-bar" role="img" aria-label={`${raid.held} of ${raid.breadth} held`}>
          <span style={{ width: `${pct}%` }} />
          <em>
            {ready ? `${raid.breadth} of ${raid.breadth} — send it` : `${raid.held} of ${raid.breadth} · ${raid.breadth - raid.held} to go`}
          </em>
        </div>
      </div>

      <div className="raid-actions">{children}</div>
    </div>
  )
}

export default function RaidsView() {
  const board = useGame((s) => s.board)
  const scrip = useGame((s) => s.scrip)
  const renown = useGame((s) => s.renown)
  const spares = useGame((s) => s.spares)
  const ceilings = useGame((s) => s.ceilings)
  const levels = useGame((s) => s.renownLevels)
  const aimSeries = useGame((s) => s.aimSeries)
  const collection = useGame((s) => s.collection)
  const effects = useGame((s) => s.effects)
  const muster = useGame((s) => s.muster)
  const dismissMuster = useGame((s) => s.dismissMuster)
  const raid = useGame((s) => s.raid)
  const acceptCommission = useGame((s) => s.acceptCommission)
  const claimCommission = useGame((s) => s.claimCommission)
  const abandonCommission = useGame((s) => s.abandonCommission)
  const buyRenown = useGame((s) => s.buyRenown)
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
   * from a stale copy is a face -- the demand's own numbers come from the
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
    const add = (r: Raid | Commission, pinned: boolean) => {
      const faces = (bySeries.get(r.series) ?? [])
        .filter((c) => c.stars >= r.depth)
        .sort((a, b) => b.stars - a.stars)
        .slice(0, FACES)
      all.push({ raid: r, pinned, ready: answered(r), affordable: scrip >= r.cost, faces })
    }
    for (const c of board.commissions) add(c, true)
    for (const r of board.raids) add(r, false)
    return all.sort((a, b) => {
      const d = rank(a) - rank(b)
      if (d !== 0) return d
      return b.raid.held / b.raid.breadth - a.raid.held / a.raid.breadth
    })
  }, [board, bySeries, scrip])

  const ready = rows.filter((r) => r.ready)
  const open = rows.filter((r) => !r.ready)

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

  const aimed = ceilings.aimShare > 0
  const slotsFree = COMMISSION_SLOTS - board.commissions.length
  const toNext = Math.max(0, ceilings.sparesPerScrip - spares)
  const mergeMult = effects().mergeMult

  /**
   * What one more level of a line is worth, said as income.
   *
   * The shelf quoted its own units -- "stacks merge to ★13" -- which is true
   * and tells a player nothing about why they should want it. A star is a flat
   * multiplier on every maxed stack in the collection, and that is the number
   * that answers "does this move me forward".
   */
  const gainOf = (key: string, level: number): string | null => {
    if (renownMaxed(level)) return null
    if (key === 'depth') {
      return `every stack already at the cap becomes worth ×${Number(mergeMult.toFixed(2))} more`
    }
    if (key === 'hands') return '+400 real cards a press, which is +400 spares a press'
    if (key === 'mill') {
      const gain = sparesPerScrip(level) / sparesPerScrip(level + 1) - 1
      return `${Math.round(gain * 100)}% more Scrip out of the same presses`
    }
    return null
  }

  /*
   * A row offers exactly what you can do with it and nothing else.
   *
   * A demand you are short of used to wear a dead primary button reading "4
   * more" -- the same thing the bar underneath it already said, drawn to look
   * like the button you press. What you can actually do with a row you cannot
   * answer is pin it, so that is the button it gets.
   */
  const action = (row: Row) => {
    const r = row.raid
    const pay = <span className="raid-reward">+{fmtCount(r.reward)} Renown</span>
    if (row.pinned) {
      return row.ready ? (
        <>
          <button className="btn btn-primary" onClick={() => void claimCommission(r.id)}>
            Collect · +{fmtCount(r.reward)}
          </button>
          {pay}
        </>
      ) : (
        <>
          {pay}
          <button
            className="btn btn-quiet"
            onClick={() => void abandonCommission(r.id)}
            title="Free the pin. The demand goes; nothing else changes."
          >
            Unpin
          </button>
        </>
      )
    }
    if (row.ready) {
      return (
        <>
          <button
            className="btn btn-primary"
            disabled={!row.affordable}
            onClick={() => void raid(r.id)}
            title={`Costs ${fmtCount(r.cost)} Scrip`}
          >
            {row.affordable
              ? `Send · ${fmtCount(r.cost)} Scrip`
              : `${fmtCount(r.cost - scrip)} more Scrip`}
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
          onClick={() => void acceptCommission(r.id)}
          title={
            slotsFree > 0
              ? `Pin it: it stays on the board however long it takes, and pays ×2.5 — ${fmtCount(Math.round(r.reward * 2.5))} Renown — when your collection reaches it.`
              : `All ${COMMISSION_SLOTS} pins are in use.`
          }
        >
          Pin
        </button>
      </>
    )
  }

  return (
    <div className="raids-view">
      {muster && <MusterStage muster={muster} onClose={dismissMuster} />}

      <p className="raids-lede">
        Summoning pays credits, and credits eventually run out of things to buy. This is what
        comes after it. Copies too deep to merge are milled into <b>Scrip</b>, Scrip sends raids,
        raids pay <b>Renown</b>, and Renown raises the ceilings your summon has been sitting
        against — so the pull that stopped growing starts growing again. The milling runs while
        you are away; the board waits until you are back.
      </p>

      <div className="refinery-strip">
        <div className="meter">
          <span className="meter-label">Scrip</span>
          <b className="meter-value">{fmtCount(scrip)}</b>
          <span className="meter-note">what a raid costs to send</span>
        </div>
        <div className="meter">
          <span className="meter-label">Renown</span>
          <b className="meter-value credits-text">{fmtCount(renown)}</b>
          <span className="meter-note">what a raid pays, spent at the bottom</span>
        </div>
        <div className="meter">
          <span className="meter-label">Spares</span>
          <b className="meter-value">
            {spares.toLocaleString()}
            <em className="meter-of"> / {ceilings.sparesPerScrip.toLocaleString()}</em>
          </b>
          <span className="meter-note" title="A stack merged twelve times holds 4,096 copies. One more can never merge, so it drops out as a spare.">
            {toNext.toLocaleString()} more make the next Scrip
          </span>
          <span className="meter-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (spares / Math.max(1, ceilings.sparesPerScrip)) * 100)}%` }} />
          </span>
        </div>
      </div>

      <div className="panel">
        <h2 className="section-title">
          Raids <span className="slot-count">{fmtCount(scrip)} Scrip to spend</span>
        </h2>
        <p className="section-sub">
          Each row asks for a breadth of one series at a depth of stars, and nothing is risked:
          a demand you cannot meet is refused, not lost. Pin one that is out of reach and it
          waits as long as it takes, paying ×2.5 when you get there. Auto Summon sends whatever
          is ready and collects whatever fills — pinning is the one call it leaves to you.
        </p>

        {aimed && (
          <div className="aim-row">
            <span className="aim-state">
              <Icon name="cards_seek" />
              {aimSeries ? (
                <>
                  <b>{Math.round(ceilings.aimShare * 100)}%</b> of every pull is drawn from{' '}
                  <b>{aimSeries}</b>
                </>
              ) : (
                <>
                  Called Shot is idle. Name a series and <b>{Math.round(ceilings.aimShare * 100)}%</b>{' '}
                  of every pull comes from it — this is how you finish a demand on purpose.
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
              <div className="aim-picker">
                {series.length === 0 && <span className="meter-note">Nothing collected yet.</span>}
                {series.map(([name, n]) => (
                  <button
                    key={name}
                    className={`chip ${aimSeries === name ? 'active' : ''}`}
                    onClick={() => {
                      void setAim(name)
                      setPickingAim(false)
                    }}
                  >
                    {name} <b>×{n}</b>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {rows.length === 0 ? (
          <div className="empty-state small">
            <p>No demands posted. The catalog may still be crawling.</p>
          </div>
        ) : (
          <div className="raid-list">
            {ready.length > 0 && <h3 className="raid-group">Ready now</h3>}
            {ready.map((row) => (
              <Demand key={row.raid.id} row={row}>
                {action(row)}
              </Demand>
            ))}
            {open.length > 0 && ready.length > 0 && <h3 className="raid-group">Still short</h3>}
            {open.map((row) => (
              <Demand key={row.raid.id} row={row}>
                {action(row)}
              </Demand>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="section-title">
          Renown <span className="slot-count">{fmtCount(renown)} to spend</span>
        </h2>
        <p className="section-sub">
          Renown buys no credits. It raises the caps your summon has been pinned against, which
          is worth more the more you have already built. Every line here finishes.
        </p>
        <div className="shop-rows">
          {RENOWN_DEFS.map((def) => {
            const level = levels[def.key]
            const maxed = renownMaxed(level)
            const cost = renownCost(def, level)
            const afford = !maxed && renown >= cost
            const gain = gainOf(def.key, level)
            return (
              <div key={def.key} className={`shop-row ${afford ? 'affordable' : ''} ${maxed ? 'maxed' : ''}`}>
                <button
                  className="row-buy"
                  disabled={maxed || !afford}
                  onClick={() => void buyRenown(def.key)}
                  title={def.blurb}
                >
                  <span className="row-icon">
                    <Icon name={def.icon as IconName} />
                  </span>
                  <span className="row-main">
                    <span className="row-name">
                      {def.name}
                      {(maxed || level > 0) && (
                        <em className="row-lv">{maxed ? 'max' : `Lv ${level}`}</em>
                      )}
                    </span>
                    <span className="row-effect">
                      {def.effect(level)}
                      {!maxed && (
                        <>
                          {' '}
                          <span className="row-arrow">&rsaquo;</span>{' '}
                          <b>{def.effect(level + 1)}</b>
                        </>
                      )}
                    </span>
                    <span className="row-blurb">{gain ?? def.blurb}</span>
                  </span>
                  <span className="row-cost">{maxed ? 'done' : `${fmt(cost)} R`}</span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
