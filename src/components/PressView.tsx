/**
 * The Press.
 *
 * A duplicate does not vanish: a copy landing on a stack you already own sheds
 * a spare fraction of a card, and a copy landing on a deep stack sheds nearly a
 * whole one. The press mills those spares into scrap, and the Factory buys the
 * scrap. Nothing on this page is pressable -- the machine runs by itself, once
 * per press, awake or away.
 *
 * Which is exactly why it used to be a number in a box, and why that was wrong.
 * A faucet the player never touches is a faucet the player never believes in,
 * so the read-out is the machine: a ram on the real cadence, real portraits out
 * of the real collection going under it, and scrap coming out the far side.
 * When Finer Mill or Auto Summon speeds the works up the ram speeds up with it,
 * which is the only proof of an upgrade an idle mechanic can offer.
 *
 * Every repeating thing here is a CSS keyframe reading one custom property for
 * its duration. This view can be left open for a working day and must cost
 * nothing to leave open: no animation frame, no interval driving motion, and
 * seven moving elements in total.
 */

import { useEffect, useMemo, useState } from 'react'
import { useGame } from '../game/store'
import type { OwnedCharacter } from '../game/types'
import { fmt, fmtCount } from '../game/format'
import '../styles/press.css'

/** Faces held in reserve, so the feed is not the same three cards forever. */
const POOL = 12
/**
 * How often the portraits under the ram are swapped for three others.
 *
 * The one thing on this page that is a React state change, and deliberately
 * slow: at four seconds it is under a thousand renders in an hour of three
 * images and a line of text, against sixty thousand if the swap chased the
 * ram. The motion itself never touches React.
 */
const FACE_SWAP_MS = 4200
/** What the idle machine breathes on, since it has no real cadence to keep. */
const IDLE_STROKE_MS = 3600

/**
 * Where each portrait sits under the ram, where it comes in from, and how far
 * ahead of the others it goes.
 *
 * Three of them, because a rank of three reads as a handful being crushed
 * rather than as one card being shown, and because at 390px a card here is
 * about twenty-five pixels wide and a fourth would stop being a face.
 *
 * `x` is the seat measured off the centre of the press and `from` is how far
 * left of that seat the bin's mouth is, both in the frame's own units, so all
 * three fall out of one mouth and fan out along the table on the way in. `off`
 * is a fraction of one stroke and is kept under 2%: a card that leaves early
 * is flat before the ram arrives, and a ram stopped above a card it has not
 * touched is worse than three cards landing together.
 */
const SLOTS = [
  { x: -0.15, from: -0.39, tilt: -14, off: -0.016 },
  { x: 0, from: -0.54, tilt: -6, off: -0.008 },
  { x: 0.15, from: -0.69, tilt: -2, off: 0 },
]

/**
 * The material waiting on the feed table.
 *
 * These never move and that is their job: they are what guarantees a still
 * frame of this view has the collection in it, whatever instant of the stroke
 * it catches. `x` is measured off the left edge of the frame.
 */
const QUEUE = [
  { x: 0.23, tilt: -5 },
  { x: 0.3, tilt: 4 },
]

/**
 * Chips off the far side.
 *
 * Two, half a stroke apart, which is not decoration: one chip is in the air
 * for three fifths of a cycle and two offset by half of one means there is
 * always scrap crossing the frame. The still that catches this machine with
 * its ram at the top still catches it working.
 *
 * They stop just short of the counter rather than on it. The counter is the
 * one thing in the frame that cannot shrink all the way with it -- digits
 * below eleven pixels stop being digits -- so on a phone it is proportionally
 * wide, and a chip aimed at the middle of it lands on top of the number.
 */
const CHIPS = [
  { x: 0.2, y: 0.25, off: 0 },
  { x: 0.17, y: 0.21, off: -0.5 },
]

/**
 * Scrap a press, said honestly.
 *
 * fmtCount rounds, and scrap a press spends most of the game between a
 * thousandth and a hundred -- the exact band it would round to "0". Above a
 * hundred the suffixes are the right answer again.
 */
function scrapText(n: number): string {
  if (n >= 100) return fmtCount(n)
  if (n >= 10) return n.toFixed(1)
  if (n >= 1) return n.toFixed(2)
  return n.toFixed(3)
}

export default function PressView() {
  const works = useGame((s) => s.works)
  const collection = useGame((s) => s.collection)
  const effects = useGame((s) => s.effects)
  const autoSpinMs = useGame((s) => s.autoSpinMs)
  const skipOwned = useGame((s) => s.settings.skipOwned)
  const [showNumbers, setShowNumbers] = useState(false)

  /**
   * One ram stroke per scrap, clamped at both ends.
   *
   * Uncapped this is a machine that either strobes or looks dead: a late-game
   * press makes a scrap every summon, an early one takes four hundred summons
   * to make one. A quarter of a second is as fast as a slam still reads as a
   * slam, and four seconds is as slow as a running machine may look before the
   * player decides it has stopped.
   */
  const perPress = works.sparesPerPull / Math.max(1, works.sparesPerScrap)
  const pressMs = autoSpinMs > 0 ? autoSpinMs : 1500
  const pressPeriodMs = perPress > 0 ? Math.min(4000, Math.max(260, pressMs / perPress)) : 0
  const idle = pressPeriodMs === 0
  const stroke = idle ? IDLE_STROKE_MS : pressPeriodMs

  /**
   * The faces the machine feeds on: the deepest stacks held, because those are
   * the stacks actually shedding the spares being milled.
   *
   * One linear pass with a twelve-slot shortlist rather than a sort. The
   * collection runs to five figures and this page draws three portraits of it,
   * so ordering the whole thing to pick three would be the most expensive work
   * on the view by an order of magnitude. Once the shortlist has filled a
   * replacement is rare, so re-finding the weakest seat costs nothing amortised.
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

  const rate = works.sparesPerPull
  const left = Math.max(0, works.sparesPerScrap - works.spares)
  const presses = rate > 0 ? Math.ceil(left / rate) : 0
  const fill = Math.min(100, (works.spares / Math.max(1, works.sparesPerScrap)) * 100)
  const strokesPerMin = Math.round(60000 / stroke)
  /* Scrap a minute only means anything once something is pressing on its own.
     By hand the honest unit is scrap a press, because the clock is you. */
  const perMinute = autoSpinMs > 0 ? perPress * (60000 / autoSpinMs) : 0
  const cardsPerPull = effects().cardsPerPull

  const rigStyle = { '--press-stroke': `${stroke}ms` } as React.CSSProperties

  return (
    <div className="press-view">
      <p className="press-lede">
        A copy of a character you already hold does not stack for nothing: it sheds a{' '}
        <b>spare</b>, and a copy landing on a deep stack sheds more of one. The press mills spares
        into <b>scrap</b>, and the Factory buys the scrap. It runs by itself on every press, here
        or away.
      </p>

      <div className="panel">
        <h2 className="section-title">
          Hydraulic Press
          <span className="slot-count">
            {idle ? 'stopped' : `${fmtCount(strokesPerMin)} strokes a minute`}
          </span>
        </h2>
        <p className="section-sub">
          {idle
            ? 'Nothing is coming down the chute, so the ram is parked.'
            : 'The ram keeps pace with the mill, so it speeds up when your rate does. There is nothing here to press.'}
        </p>

        {/* The machine says nothing a screen reader needs: every number painted
            on it is repeated as text in the meters underneath. */}
        <div className={`press-machine ${idle ? 'idle' : ''}`} style={rigStyle} aria-hidden="true">
          <div className="press-rig">
            <div className="press-crown">
              <span className="press-plate">Hydraulic Press</span>
              <span className="press-lamp" />
              <span className="press-spm">{idle ? 'idle' : `${fmtCount(strokesPerMin)}/min`}</span>
            </div>

            <div className="press-column left" />
            <div className="press-column right" />
            <div className="press-guide left" />
            <div className="press-guide right" />

            <div className="press-bin" />
            <div className="press-table" />
            <div className="press-ramp" />
            <div className="press-base" />

            {queue.map((face, i) => (
              <div
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
              </div>
            ))}

            {faces.map((face, i) => (
              <div
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
              </div>
            ))}

            <div className="press-bed" />

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

            <div className="press-plunger">
              <span className="press-rod" />
              <span className="press-ram" />
            </div>

            <div className="press-gauge">
              <span className="press-gauge-label">spares</span>
              <span className="press-gauge-bar">
                <span style={{ width: `${fill}%` }} />
              </span>
            </div>

            <div className="press-yard">
              <span className="press-yard-n">{fmtCount(works.scrap)}</span>
              <span className="press-yard-label">scrap</span>
            </div>
          </div>
        </div>

        {idle ? (
          <div className="press-idle">
            {skipOwned ? (
              <p>
                <b>Skip Owned is on.</b> A pull never deals you a character you already hold, so
                nothing is a duplicate, nothing sheds a spare, and the press has nothing to mill.
                Turn it off in Settings and it starts on the next press.
              </p>
            ) : (
              <p>
                <b>No spares are coming in.</b> The press only mills duplicates. Keep summoning
                until a character repeats — every copy after the first sheds a spare — and the ram
                starts on its own.
              </p>
            )}
          </div>
        ) : (
          <div className="press-lines">
            <p className="press-line">
              <b>{fmtCount(Math.round(rate))} spares a press.</b> That is {scrapText(perPress)} scrap
              a press
              {perMinute > 0 && <>, about {scrapText(perMinute)} scrap a minute</>}.{' '}
              {presses <= 1
                ? 'The next scrap comes off on this press.'
                : `Next scrap in about ${fmtCount(presses)} presses.`}
            </p>
            <p className="press-line dim">
              Two things speed it up. Deeper stacks: a copy landing on a stack at its cap sheds a
              whole spare, one halfway there sheds half. And <b>Finer Mill</b> in the Shop, which
              cuts the {fmtCount(works.sparesPerScrap)} spares a scrap costs.
            </p>
          </div>
        )}

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
            <span className="meter-label">Scrap in the yard</span>
            <b className="meter-value">{fmtCount(works.scrap)}</b>
            <span className="meter-note">
              the belt takes <b>{scrapText(works.belt)}</b> a press
            </span>
          </div>
          <div className="meter">
            <span className="meter-label">Factory paid</span>
            <b className="meter-value credits-text">{fmt(works.factoryRate)}</b>
            <span className="meter-note">credits, over the last press</span>
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
