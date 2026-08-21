/**
 * The Press.
 *
 * A duplicate does not vanish: a copy landing on a stack you already own sheds
 * a spare fraction of a card, and a copy landing on a deep stack sheds nearly a
 * whole one. The press mills those spares into scrap, and the Factory buys the
 * scrap. It runs by itself, once per press, awake or away -- and the machine
 * itself is the interaction: slam it and the Factory belt runs three presses'
 * worth of the yard right now. Tapping can never outrun the press that fills
 * the yard; it just melts the backlog faster.
 *
 * The read-out is the machine: a ram on the real cadence, real portraits out
 * of the real collection going under it, and scrap coming out the far side.
 * When Finer Mill or Auto Summon speeds the works up the ram speeds up with
 * it.
 *
 * Every repeating thing here is a CSS keyframe reading one custom property for
 * its duration. This view can be left open for a working day and must cost
 * nothing to leave open: no animation frame, no interval driving motion. The
 * only transient React state is the slam itself, which exists exactly as long
 * as the player is hammering the machine.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGame } from '../game/store'
import type { OwnedCharacter } from '../game/types'
import { fmt, fmtCount } from '../game/format'
import { sfx } from '../game/sound'
import '../styles/press.css'

/** Faces held in reserve, so the feed is not the same three cards forever. */
const POOL = 12
/** How often the portraits under the ram are swapped for three others. */
const FACE_SWAP_MS = 4200
/** What the idle machine breathes on, since it has no real cadence to keep. */
const IDLE_STROKE_MS = 3600
/** Client-side throttle on manual slams; the server's own limit is 110ms. */
const SLAM_GAP_MS = 160
/** Hold-to-repeat cadence. Slightly over the throttle so every repeat lands. */
const HOLD_MS = 170

/**
 * Where each portrait sits under the ram, where it comes in from, and how far
 * ahead of the others it goes. Three of them, because a rank of three reads as
 * a handful being crushed rather than one card being shown. `x` is the seat
 * measured off the centre of the press and `from` is how far left of that seat
 * the bin's mouth is; `off` is a fraction of one stroke, kept under 2% so the
 * ram is never stopped above a card it has not touched.
 */
const SLOTS = [
  { x: -0.15, from: -0.39, tilt: -14, off: -0.016 },
  { x: 0, from: -0.54, tilt: -6, off: -0.008 },
  { x: 0.15, from: -0.69, tilt: -2, off: 0 },
]

/** The material waiting on the feed table. These never move: they are what
    guarantees a still frame of this view has the collection in it. */
const QUEUE = [
  { x: 0.23, tilt: -5 },
  { x: 0.3, tilt: 4 },
]

/** Chips off the far side, half a stroke apart so there is always scrap
    crossing the frame. They stop just short of the counter. */
const CHIPS = [
  { x: 0.2, y: 0.25, off: 0 },
  { x: 0.17, y: 0.21, off: -0.5 },
]

/** Where each spark of a slam burst flies, in units of --press-h. */
const SPARKS = [
  { x: -0.16, y: -0.1, s: 1 },
  { x: -0.09, y: -0.17, s: 0.7 },
  { x: 0.02, y: -0.2, s: 0.85 },
  { x: 0.11, y: -0.15, s: 0.7 },
  { x: 0.18, y: -0.07, s: 1 },
  { x: -0.2, y: -0.02, s: 0.6 },
  { x: 0.22, y: -0.01, s: 0.6 },
]

type Pay = { id: number; text: string; dx: number }

export default function PressView() {
  const works = useGame((s) => s.works)
  const collection = useGame((s) => s.collection)
  const effects = useGame((s) => s.effects)
  const autoSpinMs = useGame((s) => s.autoSpinMs)
  const skipOwned = useGame((s) => s.settings.skipOwned)
  const slamPress = useGame((s) => s.slamPress)
  const [showNumbers, setShowNumbers] = useState(false)

  /**
   * One ram stroke per scrap, clamped at both ends. Uncapped this is a machine
   * that either strobes or looks dead: a quarter second is as fast as a slam
   * still reads as a slam, four seconds is as slow as a running machine may
   * look before the player decides it has stopped.
   */
  const perPress = works.sparesPerPull / Math.max(1, works.sparesPerScrap)
  const pressMs = autoSpinMs > 0 ? autoSpinMs : 1500
  const pressPeriodMs = perPress > 0 ? Math.min(4000, Math.max(260, pressMs / perPress)) : 0
  const idle = pressPeriodMs === 0
  const stroke = idle ? IDLE_STROKE_MS : pressPeriodMs

  /**
   * The faces the machine feeds on: the deepest stacks held, because those are
   * the stacks actually shedding the spares being milled. One linear pass with
   * a twelve-slot shortlist rather than a sort -- the collection runs to five
   * figures and this page draws three portraits of it.
   */
  const pool = useMemo(() => {
    const best: OwnedCharacter[] = []
    let weakest = 0
    const refind = () => {
      weakest = 0
      for (let i = 1; i < best.length; i++) if (best[i].copies < best[weakest].copies) weakest = i
    }
    for (const c of collection) {
      if (!c.image) continue
      if (best.length < POOL) {
        best.push(c)
        if (best.length === POOL) refind()
        continue
      }
      if (c.copies > best[weakest].copies) {
        best[weakest] = c
        refind()
      }
    }
    return best.sort((a, b) => b.copies - a.copies)
  }, [collection])

  /* The hopper only wants restocking while the machine is running, and only if
     there is anything behind the three cards already on the bed. */
  const [cursor, setCursor] = useState(0)
  useEffect(() => {
    if (idle || pool.length <= SLOTS.length) return
    const t = setInterval(() => setCursor((n) => n + SLOTS.length), FACE_SWAP_MS)
    return () => clearInterval(t)
  }, [idle, pool.length])

  const faces = useMemo(
    () => SLOTS.map((_, i) => (pool.length === 0 ? undefined : pool[(cursor + i) % pool.length])),
    [pool, cursor],
  )
  /* Taken from behind the three on the bed, so the table is not showing the
     same character that is being crushed a hand's width to the right of it. */
  const queue = useMemo(
    () =>
      QUEUE.map((_, i) =>
        pool.length === 0 ? undefined : pool[(cursor + SLOTS.length + i) % pool.length],
      ),
    [pool, cursor],
  )

  /* ---------------------------------------------------------------- slam
   *
   * A tap anywhere on the rig is a manual stroke. Client throttle at 160ms,
   * one slamPress() per accepted tap. The manual stroke animation is a class
   * with two alternating names so a second tap restarts it, and the transient
   * payout markers are keyed by a counter and removed on animationend.
   */
  const lastSlam = useRef(0)
  const slamId = useRef(0)
  const [strokeId, setStrokeId] = useState(0)
  const [pays, setPays] = useState<Pay[]>([])
  const [starved, setStarved] = useState(0)

  const trySlam = useCallback(() => {
    const now = performance.now()
    if (now - lastSlam.current < SLAM_GAP_MS) return
    lastSlam.current = now
    const id = ++slamId.current
    setStrokeId(id)
    /* Honest sound up front: a slam only sounds like a slam if the yard has
       anything in it to crush. */
    if (useGame.getState().works.scrap > 0) sfx.slam()
    else sfx.tap()
    void slamPress().then((paid) => {
      if (paid > 0) {
        setPays((p) => [...p.slice(-3), { id, text: `+${fmt(paid)}`, dx: ((id % 5) - 2) * 10 }])
      } else {
        setStarved(id)
        setPays([])
      }
    })
  }, [slamPress])

  /* The manual-stroke class outlives the animation slightly, then clears so
     the automatic cadence takes the ram back. */
  useEffect(() => {
    if (!strokeId) return
    const t = setTimeout(() => setStrokeId(0), 360)
    return () => clearTimeout(t)
  }, [strokeId])

  /* Press-and-hold repeats at the throttle. The interval only lives while a
     pointer is down on the machine. */
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
      trySlam()
      stopHold()
      hold.current = setInterval(trySlam, HOLD_MS)
    },
    [trySlam, stopHold],
  )
  /* Space and Enter arrive as a click with detail 0; pointer taps already
     fired on pointerdown and are dropped here. */
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.detail === 0) trySlam()
    },
    [trySlam],
  )

  const rate = works.sparesPerPull
  const fill = Math.min(100, (works.spares / Math.max(1, works.sparesPerScrap)) * 100)
  const strokesPerMin = Math.round(60000 / stroke)
  const cardsPerPull = effects().cardsPerPull

  const rigStyle = { '--press-stroke': `${stroke}ms` } as React.CSSProperties
  const machineCls = [
    'press-machine',
    idle ? 'idle' : '',
    strokeId ? (strokeId % 2 ? 'slam-a' : 'slam-b') : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="press-view">
      <div className="panel">
        <h2 className="section-title">
          Hydraulic Press
          <span className="slot-count">{idle ? 'stopped' : `${fmtCount(strokesPerMin)}/min`}</span>
        </h2>
        <p className="section-sub">
          {idle
            ? skipOwned
              ? 'Skip Owned is on, so no spares come in.'
              : 'No spares yet. Duplicates feed the press.'
            : 'Runs on its own. Slam it to melt the yard faster.'}
        </p>

        {/* The machine is the button: every number painted on it is repeated
            as text in the meters underneath. */}
        <button
          type="button"
          className={machineCls}
          style={rigStyle}
          aria-label="Slam the press"
          title="Runs the belt through the yard now."
          onPointerDown={onPointerDown}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          onClick={onClick}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span className="press-rig" aria-hidden="true">
            <span className="press-crown">
              <span className="press-plate">Anico Hydraulics</span>
              <span className="press-lamp" />
              <span className="press-spm">{idle ? 'IDLE' : `${fmtCount(strokesPerMin)}/MIN`}</span>
            </span>

            <span className="press-column left" />
            <span className="press-column right" />
            <span className="press-guide left" />
            <span className="press-guide right" />

            <span className="press-bin" />
            <span className="press-table" />
            <span className="press-ramp" />
            <span className="press-base" />

            {queue.map((face, i) => (
              <span
                key={`q${i}`}
                className="press-queue"
                style={
                  {
                    '--press-qx': `calc(var(--press-h) * ${QUEUE[i].x - 0.0679})`,
                    '--press-tilt': `${QUEUE[i].tilt}deg`,
                  } as React.CSSProperties
                }
              >
                {face && <img src={face.image} alt="" draggable={false} loading="lazy" />}
              </span>
            ))}

            {faces.map((face, i) => (
              <span
                key={i}
                className="press-card"
                style={
                  {
                    '--press-x': `calc(var(--press-h) * ${SLOTS[i].x})`,
                    '--press-from-x': `calc(var(--press-h) * ${SLOTS[i].from})`,
                    '--press-tilt': `${SLOTS[i].tilt}deg`,
                    '--press-off': SLOTS[i].off,
                  } as React.CSSProperties
                }
              >
                {face && <img src={face.image} alt="" draggable={false} loading="lazy" />}
              </span>
            ))}

            <span className="press-bed" />

            {CHIPS.map((chip, i) => (
              <span
                key={i}
                className="press-scrap"
                style={
                  {
                    '--press-sx': `calc(var(--press-h) * ${chip.x})`,
                    '--press-sy': `calc(var(--press-h) * ${chip.y})`,
                    '--press-off': chip.off,
                  } as React.CSSProperties
                }
              />
            ))}

            <span className="press-cyl" />
            <span className="press-plunger">
              <span className="press-rod" />
              <span className="press-ram" />
            </span>

            <span className="press-gauge">
              <span className="press-gauge-label">spares</span>
              <span className="press-gauge-bar">
                <span style={{ width: `${fill}%` }} />
              </span>
            </span>

            <span className="press-slam-tag">Slam</span>

            {pays.map((p) => (
              <span
                key={p.id}
                className="press-pay"
                style={{ '--pay-dx': `${p.dx}px` } as React.CSSProperties}
                onAnimationEnd={(e) => {
                  if (e.target === e.currentTarget)
                    setPays((cur) => cur.filter((q) => q.id !== p.id))
                }}
              >
                {p.text}
                {SPARKS.map((s, i) => (
                  <i
                    key={i}
                    style={
                      {
                        '--spark-x': `calc(var(--press-h) * ${s.x})`,
                        '--spark-y': `calc(var(--press-h) * ${s.y})`,
                        '--spark-s': s.s,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </span>
            ))}

            {starved > 0 && (
              <span
                key={starved}
                className="press-starved"
                onAnimationEnd={() => setStarved(0)}
              >
                yard empty
              </span>
            )}
          </span>
        </button>

        <div className="press-meters">
          <div className="meter">
            <span className="meter-label">Spares</span>
            <b className="meter-value">
              {fmtCount(works.spares)}
              <em className="meter-of"> / {fmtCount(works.sparesPerScrap)}</em>
            </b>
            <span className="meter-note">
              {rate > 0 ? <>≈{fmtCount(Math.round(rate))} a press</> : 'nothing coming in'}
            </span>
            <span className="meter-bar">
              <span style={{ width: `${fill}%` }} />
            </span>
          </div>
          <div className="meter">
            <span className="meter-label">Scrap in yard</span>
            <b className="meter-value">{fmtCount(works.scrap)}</b>
            <span className="meter-note">
              belt takes <b>{scrapText(works.belt)}</b> a press
            </span>
          </div>
          <div className="meter">
            <span className="meter-label">Paid last press</span>
            <b className="meter-value credits-text">{fmt(works.factoryRate)}</b>
            <span className="meter-note">credits</span>
          </div>
        </div>

        <button className="btn btn-quiet press-toggle" onClick={() => setShowNumbers(!showNumbers)}>
          {showNumbers ? 'Hide the numbers' : 'Show the numbers'}
        </button>

        {showNumbers && (
          <dl className="press-numbers">
            <div>
              <dt>Cards a press deals</dt>
              <dd>{fmtCount(cardsPerPull)}</dd>
            </div>
            <div>
              <dt>Spares a press</dt>
              <dd>{fmtCount(Math.round(rate))}</dd>
            </div>
            <div>
              <dt>Spares to a scrap</dt>
              <dd>{fmtCount(works.sparesPerScrap)}</dd>
            </div>
            <div>
              <dt>Scrap a press</dt>
              <dd>{scrapText(perPress)}</dd>
            </div>
            <div>
              <dt>Belt takes</dt>
              <dd>{scrapText(works.belt)} scrap a press</dd>
            </div>
            <div>
              <dt>One scrap is worth</dt>
              <dd>{scrapText(works.scrapWorth)} cards</dd>
            </div>
            <div>
              <dt>Distinct characters held</dt>
              <dd>{fmtCount(works.reach)}</dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  )
}

/**
 * Scrap a press, said honestly: fmtCount rounds, and scrap a press spends
 * most of the game between a thousandth and a hundred, the exact band it
 * would round to "0".
 */
function scrapText(n: number): string {
  if (n >= 100) return fmtCount(n)
  if (n >= 10) return n.toFixed(1)
  if (n >= 1) return n.toFixed(2)
  return n.toFixed(3)
}
