/**
 * The Press.
 *
 * A copy landing on a stack you already own sheds a spare fraction of a card.
 * The press mills those spares into scrap and the Factory buys the scrap. It
 * runs by itself, once per press, awake or away.
 *
 * The machine is also the button. A tap does three things at once -- stokes
 * the heat, brings the ram down on whatever is in the tank, and runs the belt
 * over what that made -- so a tap always pays something, which the first
 * version of this did not: it only melted the yard, the yard is empty almost
 * all the time by design, and a button that answers "yard empty" is a button
 * that does nothing.
 *
 * Everything that repeats is one CSS keyframe reading `--press-stroke`, and
 * the ram, the cards under it and the chips off the far side are three
 * keyframes cut at the same percentage of the same duration with no delays
 * between them. That is the whole of how they stay in step: there is no
 * second clock to drift against. A hand slam drives a nested one-shot on the
 * same three elements, so hammering it is in step too.
 *
 * This view can be left open for a working day and must cost nothing to leave
 * open: no animation frame, no interval driving motion.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGame } from '../game/store'
import type { OwnedCharacter } from '../game/types'
import { fmt, fmtCount } from '../game/format'
import { HEAT_MAX_MULT, heatMult } from '../game/industry'
import { sfx } from '../game/sound'
import '../styles/press.css'

/** Portraits on the bed, and how many are held back so the feed varies. */
const BED = 3
const POOL = 12
/** How often the portraits under the ram are swapped for three others. */
const FACE_SWAP_MS = 4200
/** What an idle machine breathes on, having no real cadence to keep. */
const IDLE_STROKE_MS = 3600
/** Client throttle on manual slams. The server's own limit is 110ms. */
const SLAM_GAP_MS = 150
/** Hold-to-repeat cadence, just over the throttle so every repeat lands. */
const HOLD_MS = 160
/** How long the hand-slam one-shot runs, and so how long the class lives. */
const KICK_MS = 300

type Pay = { id: number; text: string; dx: number; hot: boolean }

export default function PressView() {
  const works = useGame((s) => s.works)
  const collection = useGame((s) => s.collection)
  const autoSpinMs = useGame((s) => s.autoSpinMs)
  const skipOwned = useGame((s) => s.settings.skipOwned)
  const slamPress = useGame((s) => s.slamPress)

  /**
   * One ram stroke per scrap, clamped at both ends. Uncapped this is a machine
   * that either strobes or looks dead: a quarter second is as fast as a stroke
   * still reads as a stroke, four seconds as slow as a running machine may
   * look before a player decides it has stopped.
   */
  const perPress = works.sparesPerPull / Math.max(1, works.sparesPerScrap)
  const pressMs = autoSpinMs > 0 ? autoSpinMs : 1500
  const cadence = perPress > 0 ? Math.min(4000, Math.max(280, pressMs / perPress)) : 0
  const idle = cadence === 0
  const stroke = idle ? IDLE_STROKE_MS : cadence

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

  /* Restocked only while the machine is running, and only if there is anything
     behind the three already on the bed. */
  const [cursor, setCursor] = useState(0)
  useEffect(() => {
    if (idle || pool.length <= BED) return
    const t = setInterval(() => setCursor((n) => n + BED), FACE_SWAP_MS)
    return () => clearInterval(t)
  }, [idle, pool.length])

  const faces = useMemo(
    () =>
      Array.from({ length: BED }, (_, i) =>
        pool.length === 0 ? undefined : pool[(cursor + i) % pool.length],
      ),
    [pool, cursor],
  )

  /* ------------------------------------------------------------------ slam */

  const lastSlam = useRef(0)
  const kickId = useRef(0)
  const [kick, setKick] = useState(0)
  const [pays, setPays] = useState<Pay[]>([])

  const trySlam = useCallback(() => {
    const now = performance.now()
    if (now - lastSlam.current < SLAM_GAP_MS) return
    lastSlam.current = now
    const id = ++kickId.current
    setKick(id)
    sfx.slam()
    void slamPress().then(({ paid, heat }) => {
      /* A tap on an empty tank and an empty yard still bought heat, and heat
         is what the next scrap will be worth. Saying so is the difference
         between a button that did nothing and one that did the only thing
         there was to do. */
      setPays((p) => [
        ...p.slice(-3),
        paid > 0
          ? { id, text: `+${fmt(paid)}`, dx: ((id % 5) - 2) * 12, hot: false }
          : { id, text: `×${heatMult(heat).toFixed(2)} heat`, dx: ((id % 5) - 2) * 12, hot: true },
      ])
    })
  }, [slamPress])

  /* The one-shot class outlives its animation slightly, then clears. */
  useEffect(() => {
    if (!kick) return
    const t = setTimeout(() => setKick(0), KICK_MS + 40)
    return () => clearTimeout(t)
  }, [kick])

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

  /* ------------------------------------------------------------------ read */

  const fill = Math.min(1, works.spares / Math.max(1, works.sparesPerScrap))
  const hot = heatMult(works.heat)
  const perMin = Math.round(60000 / stroke)

  const frameCls = [
    'press-frame',
    idle ? 'idle' : '',
    works.heat > 0.02 ? 'hot' : '',
    kick ? (kick % 2 ? 'kick-a' : 'kick-b') : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="press-view">
      <div className="panel">
        <h2 className="section-title">
          Hydraulic Press
          <span className="slot-count">{idle ? 'stopped' : `${fmtCount(perMin)}/min`}</span>
        </h2>
        <p className="section-sub">
          {idle
            ? skipOwned
              ? 'Skip Owned is on, so no spares come in.'
              : 'Duplicates feed the press. Summon to start it.'
            : 'Hold the machine to slam it. Slamming mills the tank early and heats the works.'}
        </p>

        {/* The machine is the button. Every number painted on it is repeated
            as text underneath. */}
        <button
          type="button"
          className={frameCls}
          style={{ '--press-stroke': `${stroke}ms` } as React.CSSProperties}
          aria-label="Slam the press"
          onPointerDown={onPointerDown}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          onClick={onClick}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span className="press-crown" aria-hidden="true">
            <span className="press-brand">Anico Hydraulics</span>
            <span className="press-heat">
              <em className="press-heat-tag">heat</em>
              <span className="press-heat-bar">
                <i style={{ width: `${Math.round(works.heat * 100)}%` }} />
              </span>
              <b className="press-heat-x">×{hot.toFixed(2)}</b>
            </span>
          </span>

          <span className="press-throat" aria-hidden="true">
            <span className="press-post left" />
            <span className="press-post right" />
            <span className="press-cyl" />

            <span className="press-plunger">
              <span className="press-rod" />
              <span className="press-ram" />
            </span>

            <span className="press-bed">
              {faces.map((face, i) => (
                <span key={i} className="press-card" style={{ '--i': i } as React.CSSProperties}>
                  <span className="press-card-inner">
                    {face && <img src={face.image} alt="" draggable={false} loading="lazy" />}
                  </span>
                </span>
              ))}
            </span>

            <span className="press-chute">
              {[0, 1, 2].map((i) => (
                <i key={i} className="press-chip" style={{ '--i': i } as React.CSSProperties} />
              ))}
            </span>

            {pays.map((p) => (
              <span
                key={p.id}
                className={`press-pay ${p.hot ? 'heat' : ''}`}
                style={{ '--dx': `${p.dx}px` } as React.CSSProperties}
                onAnimationEnd={(e) => {
                  if (e.target === e.currentTarget)
                    setPays((cur) => cur.filter((q) => q.id !== p.id))
                }}
              >
                {p.text}
              </span>
            ))}
          </span>

          <span className="press-foot" aria-hidden="true">
            <span className="press-gauge">
              <i style={{ width: `${Math.round(fill * 100)}%` }} />
            </span>
            <span className="press-slam">Slam</span>
          </span>
        </button>

        <div className="press-meters">
          <div className="meter">
            <span className="meter-label">Tank</span>
            <b className="meter-value">
              {fmtCount(works.spares)}
              <em className="meter-of"> / {fmtCount(works.sparesPerScrap)}</em>
            </b>
            <span className="meter-note">refills as you summon</span>
          </div>
          <div className="meter">
            <span className="meter-label">Heat</span>
            <b className="meter-value credits-text">×{hot.toFixed(2)}</b>
            <span className="meter-note">
              {works.heat > 0.02 ? 'fading' : `tap for up to ×${HEAT_MAX_MULT}`}
            </span>
          </div>
          <div className="meter">
            <span className="meter-label">Yard</span>
            <b className="meter-value">{fmtCount(works.scrap)}</b>
            <span className="meter-note">scrap for the Factory</span>
          </div>
        </div>
      </div>
    </div>
  )
}
