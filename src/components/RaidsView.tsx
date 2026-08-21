/**
 * The board.
 *
 * Everything the credit economy cannot reach (ADR 0013): the Refinery milling
 * spare copies into Scrip, raids to spend it on, commissions taken on rather
 * than answered, and the Renown shelf the whole thing pays into.
 *
 * A raid names a series and a depth and nothing else. That restraint is the
 * mechanic: give a character a number and the character stops mattering, and
 * scoring a raid on credit value would only rename rarity, so the answer would
 * always be "send the eleven Mythics".
 */

import { useMemo, useState } from 'react'
import { useGame } from '../game/store'
import Icon from './Icon'
import type { IconName } from '../game/icons'
import { fmt, fmtCount } from '../game/format'
import { RENOWN_DEFS, renownCost, renownMaxed } from '../game/renown'
import { COMMISSION_SLOTS, answered, tierName, type Commission, type Raid } from '../game/raids'

/** One row of the board, whether it is answerable or taken on. */
function Demand({
  raid,
  children,
}: {
  raid: Raid | Commission
  children: React.ReactNode
}) {
  const done = answered(raid)
  const pct = Math.min(100, Math.round((raid.held / Math.max(1, raid.breadth)) * 100))
  return (
    <div className={`raid-row ${done ? 'answerable' : ''}`}>
      <div className="raid-head">
        <span className="raid-tier">{tierName(raid)}</span>
        <b className="raid-series" title={raid.series}>
          {raid.series}
        </b>
      </div>
      <div className="raid-ask">
        <b>{raid.breadth}</b> characters at <b>★{raid.depth}</b>
      </div>
      {/* The bar is the whole point of the row: a raid you can nearly answer is
          the first thing in this game since the shop ran out that gives you a
          reason to want one particular character. */}
      <div className="raid-bar" role="img" aria-label={`${raid.held} of ${raid.breadth} held`}>
        <span style={{ width: `${pct}%` }} />
        <em>
          {raid.held} / {raid.breadth}
        </em>
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
  const raid = useGame((s) => s.raid)
  const acceptCommission = useGame((s) => s.acceptCommission)
  const claimCommission = useGame((s) => s.claimCommission)
  const abandonCommission = useGame((s) => s.abandonCommission)
  const buyRenown = useGame((s) => s.buyRenown)
  const setAim = useGame((s) => s.setAim)
  const [pickingAim, setPickingAim] = useState(false)

  /* Series to aim at: the ones the player is actually collecting, deepest
     first, because Called Shot is for finishing something you have started. */
  const series = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of collection) m.set(c.series, (m.get(c.series) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
  }, [collection])

  const aimed = ceilings.aimShare > 0
  const slotsFree = COMMISSION_SLOTS - board.commissions.length

  return (
    <div className="raids-view">
      <div className="panel refinery">
        <h2 className="section-title">The Refinery</h2>
        <p className="section-sub">
          A press deals a bounded number of real cards however large the pull is, so copies
          arrive at a flat rate that no upgrade can multiply. Copies past what a stack can
          still merge are <b>spares</b>, and spares are milled into Scrip. It runs while you
          are away; the board does not.
        </p>
        <div className="refinery-meters">
          <div className="meter">
            <span className="meter-label">Scrip</span>
            <b className="meter-value">{fmtCount(scrip)}</b>
            <span className="meter-note">
              {spares.toLocaleString()} / {ceilings.sparesPerScrip.toLocaleString()} spares toward
              the next
            </span>
          </div>
          <div className="meter">
            <span className="meter-label">Renown</span>
            <b className="meter-value credits-text">{fmtCount(renown)}</b>
            <span className="meter-note">paid by raids, spent below</span>
          </div>
          <div className="meter">
            <span className="meter-label">Called Shot</span>
            <b className="meter-value">{aimed ? (aimSeries ?? 'no target') : 'locked'}</b>
            <span className="meter-note">
              {aimed
                ? `${Math.round(ceilings.aimShare * 100)}% of every pull, aimed`
                : 'buy the line below to aim a pull'}
            </span>
          </div>
        </div>
        {aimed && (
          <div className="aim-row">
            <button className="btn btn-ghost" onClick={() => setPickingAim(!pickingAim)}>
              {pickingAim ? 'Close' : 'Choose a series'}
            </button>
            {aimSeries && (
              <button className="btn btn-quiet" onClick={() => void setAim(null)}>
                Stop aiming
              </button>
            )}
            {pickingAim && (
              <div className="aim-picker">
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
      </div>

      <div className="panel">
        <h2 className="section-title">
          Raids <span className="slot-count">{fmtCount(scrip)} Scrip</span>
        </h2>
        <p className="section-sub">
          A raid asks for a breadth of one series at a depth of stars, and pays Renown.
          Nothing is gambled: one you cannot answer is refused, not lost.
        </p>
        {board.raids.length === 0 ? (
          <div className="empty-state small">
            <p>No raids posted. The catalog may still be crawling.</p>
          </div>
        ) : (
          <div className="raid-list">
            {board.raids.map((r) => (
              <Demand key={r.id} raid={r}>
                <button
                  className="btn btn-primary"
                  disabled={!answered(r) || scrip < r.cost}
                  onClick={() => void raid(r.id)}
                >
                  {answered(r) ? `Raid · ${fmtCount(r.cost)} Scrip` : `Needs ${r.breadth - r.held} more`}
                </button>
                <span className="raid-reward">+{fmtCount(r.reward)} Renown</span>
                {!answered(r) && slotsFree > 0 && (
                  <button className="btn btn-ghost" onClick={() => void acceptCommission(r.id)}>
                    Take it on
                  </button>
                )}
              </Demand>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="section-title">
          Commissions{' '}
          <span className="slot-count">
            {board.commissions.length} / {COMMISSION_SLOTS} slots
          </span>
        </h2>
        <p className="section-sub">
          A raid taken on rather than answered. It costs no Scrip, pays more, and waits as
          long as you like — nothing here expires. What it costs is the slot.
        </p>
        {board.commissions.length === 0 ? (
          <div className="empty-state small">
            <p>Nothing taken on. Pick something above you cannot answer yet.</p>
          </div>
        ) : (
          <div className="raid-list">
            {board.commissions.map((c) => (
              <Demand key={c.id} raid={c}>
                <button
                  className="btn btn-primary"
                  disabled={!answered(c)}
                  onClick={() => void claimCommission(c.id)}
                >
                  {answered(c) ? `Collect · +${fmtCount(c.reward)}` : `Needs ${c.breadth - c.held} more`}
                </button>
                <button className="btn btn-quiet" onClick={() => void abandonCommission(c.id)}>
                  Give back
                </button>
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
          Renown buys no credits. It raises the ceilings the credit engine has been sitting
          against, which is worth more the more you have already built.
        </p>
        <div className="shop-rows">
          {RENOWN_DEFS.map((def) => {
            const level = levels[def.key]
            const maxed = renownMaxed(level)
            const cost = renownCost(def, level)
            const afford = !maxed && renown >= cost
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
