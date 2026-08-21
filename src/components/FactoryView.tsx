/**
 * The Factory.
 *
 * The Press mills duplicates into scrap; this is the machine that eats the
 * scrap and pays credits for it, every press and every hour nobody is here.
 *
 * Drawn as a furnace, not as a production line. The line was a belt with four
 * riders, two stations and a stamper, and it was thirty pixel dimensions of
 * machinery to say one sentence: material goes in one side, credits come out
 * the other. A furnace says the same thing in three squares and an arrow, and
 * three squares and an arrow is a shape every player already knows how to
 * read.
 *
 *   in   ->  [scrap] ==arrow==> [credits]   out
 *   fuel ->  [heat]
 *
 * The one number this page used to get wrong is what it charged for a press.
 * It quoted the yard, and the yard is empty almost all of the time by design
 * -- the belt starts at two scrap a press against a Press making a fifth of
 * one -- so an entirely healthy factory read "0 an hour" and looked broken.
 * It quotes the *supply* now, which is what an hour is actually worth.
 *
 * Nothing ticks in React here except one rationed sound timer: this is the
 * view a player leaves open while doing something else, and a setInterval
 * re-rendering a tree for hours to move a stripe is how a phone gets warm.
 */

import '../styles/factory.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useGame } from '../game/store'
import { fmt, fmtCount } from '../game/format'
import { HEAT_MAX_MULT, heatMult } from '../game/industry'
import { sfx } from '../game/sound'

/** A press, when Auto Summon is off and presses come by hand. */
const PRESS_MS = 1500
/** Presses of scrap in the yard past which the yard is a backlog. */
const BACKLOG_PRESSES = 50
/** How fast the arrow may sweep, and how slow before it reads as stopped. */
const MIN_PERIOD = 260
const MAX_PERIOD = 3000
/** Cadence is rounded to this, so the sweep only re-phases when it must. */
const PERIOD_STEP = 50
/** Client throttle on stokes, and the hold-to-repeat cadence. */
const STOKE_GAP_MS = 150
const HOLD_MS = 160
const PUFF_MS = 420

/**
 * Scrap rates, which are fractions for the whole early game.
 *
 * `fmtCount` rounds, and a belt drawing 0.4 scrap a press reading "0" is the
 * page telling the player the machine is off while it is running.
 */
function rate(n: number): string {
  if (n <= 0) return '0'
  if (n < 10) return Number(n.toFixed(2)).toString()
  return fmtCount(n)
}

export default function FactoryView() {
  const works = useGame((s) => s.works)
  const creditsPerCard = useGame((s) => s.creditsPerCard)
  const autoSpinMs = useGame((s) => s.autoSpinMs)
  const credits = useGame((s) => s.credits)
  const slamPress = useGame((s) => s.slamPress)

  const pressMs = autoSpinMs > 0 ? autoSpinMs : PRESS_MS
  /* Scrap the Press hands over per press, and scrap the furnace takes off the
     pile -- it can eat what came in plus whatever is already waiting. */
  const supply = works.sparesPerPull / Math.max(1, works.sparesPerScrap)
  const draw = Math.min(works.belt, supply + works.scrap)
  const hot = heatMult(works.heat)
  const perScrap = creditsPerCard * works.scrapWorth * hot
  const perPress = draw * perScrap
  const perHour = (perPress / pressMs) * 3_600_000
  const idle = draw <= 0
  const backlog = works.scrap > works.belt * BACKLOG_PRESSES

  /* One sweep of the arrow per scrap through the furnace. */
  const period = idle
    ? 0
    : Math.round(Math.min(MAX_PERIOD, Math.max(MIN_PERIOD, pressMs / draw)) / PERIOD_STEP) *
      PERIOD_STEP

  /*
   * The burn tick.
   *
   * Floored well above the sweep rather than at it. A late-game furnace melts
   * several times a second, and a sound on every melt is not a factory but a
   * metronome you cannot switch off -- and this is the one view a player
   * deliberately leaves open. It runs only while the furnace runs and the tab
   * is actually in front of someone.
   */
  useEffect(() => {
    if (idle) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') sfx.melt()
    }, Math.max(2600, period))
    return () => clearInterval(id)
  }, [idle, period])

  /* ----------------------------------------------------------- the bellows
   *
   * The same hand the Press takes: one call, one verb. Stoking raises the
   * heat, which multiplies what every scrap fetches here and everywhere else
   * in the works, and it fades in seconds -- so it is worth a lot to a player
   * stood at the machine and nothing at all to the away rate.
   */
  const lastStoke = useRef(0)
  const puffId = useRef(0)
  const [puff, setPuff] = useState(0)

  const tryStoke = useCallback(() => {
    const now = performance.now()
    if (now - lastStoke.current < STOKE_GAP_MS) return
    lastStoke.current = now
    setPuff(++puffId.current)
    sfx.slam()
    void slamPress()
  }, [slamPress])

  useEffect(() => {
    if (!puff) return
    const t = setTimeout(() => setPuff(0), PUFF_MS + 40)
    return () => clearTimeout(t)
  }, [puff])

  const hold = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopHold = useCallback(() => {
    if (hold.current) {
      clearInterval(hold.current)
      hold.current = null
    }
  }, [])
  useEffect(() => stopHold, [stopHold])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      tryStoke()
      stopHold()
      hold.current = setInterval(tryStoke, HOLD_MS)
    },
    [tryStoke, stopHold],
  )
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.detail === 0) tryStoke()
    },
    [tryStoke],
  )

  const furnaceCls = [
    'fx-furnace',
    idle ? 'idle' : '',
    works.heat > 0.02 ? 'hot' : '',
    puff ? (puff % 2 ? 'puff-a' : 'puff-b') : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="factory-view">
      <div className="fx-strip">
        <div className="meter">
          <span className="meter-label">Yard</span>
          <b className="meter-value">{fmtCount(works.scrap)}</b>
          <span className="meter-note">scrap waiting</span>
        </div>
        <div className="meter">
          <span className="meter-label">A press</span>
          <b className="meter-value fx-gold">{fmt(perPress)}</b>
          <span className="meter-note">credits</span>
        </div>
        <div className="meter">
          <span className="meter-label">An hour</span>
          <b className="meter-value fx-gold">{fmt(perHour)}</b>
          <span className="meter-note">awake or away</span>
        </div>
        <div className="meter">
          <span className="meter-label">Heat</span>
          <b className="meter-value fx-gold">×{hot.toFixed(2)}</b>
          <span className="meter-note">
            {works.heat > 0.02 ? 'fading' : `up to ×${HEAT_MAX_MULT}`}
          </span>
        </div>
      </div>

      <div className="panel">
        <h2 className="section-title">
          The furnace
          <span className="slot-count">{idle ? 'cold' : `${rate(draw)} scrap a press`}</span>
        </h2>

        <button
          type="button"
          className={furnaceCls}
          style={{ '--fx-period': `${period || 1200}ms` } as React.CSSProperties}
          aria-label="Stoke the furnace"
          onPointerDown={onPointerDown}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          onClick={onClick}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Input: what the Press hands over. */}
          <span className="fx-slot fx-in">
            <span className="fx-slot-mark scrap" aria-hidden="true" />
            <b className="fx-slot-n">{fmtCount(works.scrap)}</b>
            <em className="fx-slot-tag">scrap</em>
          </span>

          {/* The arrow, sweeping once per scrap through the fire. */}
          <span className="fx-arrow" aria-hidden="true">
            <span className="fx-arrow-fill" />
          </span>

          {/* Output: credits, which are the only thing this machine makes. */}
          <span className="fx-slot fx-out">
            <span className="fx-slot-mark coin" aria-hidden="true" />
            <b className="fx-slot-n fx-gold">{fmt(credits)}</b>
            <em className="fx-slot-tag">credits</em>
          </span>

          {/* Fuel: heat, which is the only thing a hand changes. The flame
              fills the slot the way a furnace's fuel gauge does. */}
          <span className="fx-slot fx-fuel">
            <span className="fx-flame" style={{ '--h': works.heat.toFixed(3) } as React.CSSProperties}>
              <i />
            </span>
            <em className="fx-slot-tag">heat</em>
          </span>

          <span className="fx-burn" aria-hidden="true">
            <b className="fx-gold">×{hot.toFixed(2)}</b>
            <span className="fx-stoke">Stoke</span>
          </span>
        </button>

        <p className="fx-state">
          {idle ? (
            <>
              <b>Cold.</b> The Press has nothing to hand over yet.
            </>
          ) : backlog ? (
            <>
              <b>Backlog:</b> {fmtCount(works.scrap)} scrap waiting. Belt Speed widens the mouth.
            </>
          ) : (
            <>
              {rate(draw)} scrap a press at {fmt(perScrap)} credits each. Hold the furnace to stoke
              it.
            </>
          )}
        </p>

        <p className="fx-shop">
          Shop: <b>Foundry</b> raises what a scrap fetches, <b>Belt Speed</b> how much fits through.
        </p>
      </div>
    </div>
  )
}
