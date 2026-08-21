/**
 * The Factory.
 *
 * The Press mills duplicate cards into scrap; this is the machine that eats
 * the scrap. It runs on its own -- every press, and every hour the player is
 * away -- so there is nothing here to click, and a page with nothing to click
 * has exactly one job: make what is already happening legible.
 *
 * So the belt is an actual belt: scrap rides it, melts into an ingot under
 * the furnace, gets struck into a coin under the stamper, and credits come
 * off the right end at the speed the player's real throughput says they do.
 * Buying Belt Speed makes the belt visibly faster, which is the only honest
 * way to sell an upgrade to a machine you watch.
 *
 * Every repeating motion is a CSS keyframe reading its duration off a custom
 * property. Nothing here ticks in React except one rationed sound timer: this
 * view is the one a player leaves open while they do something else, and a
 * setInterval that re-renders a tree for hours to move a stripe is how a
 * phone gets warm.
 */

import '../styles/factory.css'
import { useEffect, useState } from 'react'
import { useGame } from '../game/store'
import { fmt, fmtCount } from '../game/format'
import { sfx } from '../game/sound'

/**
 * Pieces of scrap on the belt at once.
 *
 * Four riders plus a tread, two stations and two coins is the compositor
 * budget. The count is also the belt's spacing: one item enters every
 * cadence, so four of them means an item spends four cadences crossing, and
 * the belt reads as full rather than as one lonely block making a trip.
 */
const ITEMS = 4
/** Where the furnace and the stamper stand, as a fraction of the run.
    The rider morph keyframes in factory.css are cut from these numbers:
    a station at `at` fires at (at * 100 + 4) / 108 percent of the ride. */
const MELTER_AT = 0.38
const STAMPER_AT = 0.72
/** A press, when Auto Summon is not running and presses come by hand. */
const PRESS_MS = 1500
/** Presses of scrap sitting in the yard past which the yard is a backlog. */
const BACKLOG_PRESSES = 50
/** An item every 200ms is already a blur; one every three seconds still moves. */
const MIN_PERIOD = 200
const MAX_PERIOD = 3000
/**
 * Cadence is rounded to this before it reaches the stylesheet.
 *
 * `draw` is min(belt, supply + yard), so while the yard is shallow it moves a
 * little on every single press, and every change re-phases four animation
 * delays mid-stride -- the belt jerks. Rounding means the line only re-phases
 * when the throughput has actually moved by something a player could see.
 */
const PERIOD_STEP = 50

/**
 * Scrap counts, which are fractions for the whole early game.
 *
 * `fmtCount` rounds, and a belt drawing 0.4 scrap a press reading "0" is the
 * page telling the player the machine is off when it is running.
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
  const [detail, setDetail] = useState(false)

  const pressMs = autoSpinMs > 0 ? autoSpinMs : PRESS_MS
  /* Scrap the Press hands over per press, and scrap the belt takes off the
     pile -- the belt can eat what came in plus whatever is already waiting. */
  const supply = works.sparesPerPull / Math.max(1, works.sparesPerScrap)
  const draw = Math.min(works.belt, supply + works.scrap)
  const perScrap = creditsPerCard * works.scrapWorth
  const perHour = (works.factoryRate / pressMs) * 3_600_000
  const starved = works.scrap <= 0 && supply < works.belt
  const backlog = works.scrap > works.belt * BACKLOG_PRESSES
  const state = starved ? 'starved' : backlog ? 'backlog' : 'running'

  /* One item every `period` ms. A starved belt has no items, but it is still
     turning, so the tread borrows the cadence the belt *would* run at. */
  const cadence = (per: number) =>
    Math.round(Math.min(MAX_PERIOD, Math.max(MIN_PERIOD, pressMs / per)) / PERIOD_STEP) *
    PERIOD_STEP
  const period = draw > 0 ? cadence(draw) : 0
  const treadPeriod = period > 0 ? period : cadence(Math.max(0.5, works.belt))
  /* How long one piece takes to cross, which is the loop every phase is cut from. */
  const travel = treadPeriod * ITEMS
  /*
   * The tread moves at about the speed of the things standing on it.
   *
   * A tread stripe is 14px, and the belt's run is around 175px on a phone and
   * two and a half times that on a desktop -- so a stripe is somewhere between
   * a twelfth and a thirtieth of a crossing, and no single divisor is right at
   * both widths. Sixteen splits them, and the tread reads as the same machine
   * as the scrap riding it either way. Floored at 90ms, past which a stripe
   * pattern stops being motion and becomes flicker.
   */
  const treadMs = Math.min(2400, Math.max(90, travel / 16))

  /*
   * When a station fires, and when a coin comes off.
   *
   * Items enter on the cadence, so anything an item does at a fixed point on
   * the belt also happens on the cadence: the station only needs the phase --
   * how far into a cadence the first item reaches it -- and CSS repeats it
   * forever from there. Coins run on a double cadence and alternate, so two
   * elements cover a payout on every item.
   */
  const phase = (at: number) => `${Math.round((at * travel) % Math.max(1, period))}ms`
  const coinCycle = Math.max(1, period * 2)
  const coinPhase = (i: number) => `${Math.round((travel + i * period) % coinCycle)}ms`

  /*
   * The payout tick.
   *
   * Floored well above the coin cadence rather than at it. A late-game belt
   * pays several times a second, and a sound on every payout is not a factory
   * but a metronome you cannot switch off -- and this is the one view a player
   * deliberately leaves open while doing something else. Every few seconds
   * reads as a machine working somewhere nearby, which is all it is for.
   *
   * It runs only while the line runs and the tab is actually in front of
   * someone; a hidden tab making foundry noises is a bug report.
   */
  useEffect(() => {
    if (starved || period <= 0) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') sfx.melt()
    }, Math.max(2600, coinCycle))
    return () => clearInterval(id)
  }, [starved, period, coinCycle])

  /*
   * How full the yard looks.
   *
   * Logarithmic against the backlog threshold: a yard holds anything from two
   * scrap to a number with a suffix on it, and on a linear scale every state
   * short of the backlog draws as an empty bin.
   */
  const cap = Math.max(1, works.belt * BACKLOG_PRESSES)
  const pile =
    works.scrap <= 0
      ? 0
      : Math.max(0.08, Math.min(1, Math.log10(1 + works.scrap) / Math.log10(1 + cap)))

  const summary = starved
    ? 'The belt is turning with nothing on it. The yard is empty.'
    : `${rate(draw)} scrap a press on the belt, paying ${fmt(perScrap * draw)} credits a press.`

  return (
    <div className="factory-view">
      <div className="fx-strip">
        <div className="meter">
          <span className="meter-label">Yard</span>
          <b className="meter-value">{fmtCount(works.scrap)}</b>
          <span className="meter-note">scrap waiting</span>
        </div>
        <div className="meter">
          <span className="meter-label">Belt</span>
          <b className="meter-value">{rate(draw)}</b>
          <span className="meter-note">
            a press out, <b>{rate(supply)}</b> in
          </span>
        </div>
        <div className="meter">
          <span className="meter-label">Per scrap</span>
          <b className="meter-value fx-gold">{fmt(perScrap)}</b>
          <span className="meter-note">credits at melt</span>
        </div>
        <div className="meter">
          <span className="meter-label">An hour</span>
          <b className="meter-value fx-gold">{fmt(perHour)}</b>
          <span className="meter-note">credits, awake or away</span>
        </div>
      </div>

      <div className="panel">
        <h2 className="section-title">
          The line <span className="fx-title-rate">{fmt(works.factoryRate)} last press</span>
        </h2>

        {/* The machine. Everything inside is decoration for one sentence, so
            the sentence is what a screen reader gets. */}
        <div
          className="fx-line"
          data-state={state}
          role="img"
          aria-label={summary}
          style={{
            ['--fx-period' as string]: `${Math.max(1, period || treadPeriod)}ms`,
            ['--fx-travel' as string]: `${travel}ms`,
            ['--fx-tread' as string]: `${Math.round(treadMs)}ms`,
            ['--fx-coin' as string]: `${coinCycle}ms`,
            ['--fx-pile' as string]: pile.toFixed(3),
          }}
        >
          {/* The bin sits on the belt's own baseline, so the count goes above
              it the way the station tags do. */}
          <div className="fx-yard" aria-hidden="true">
            <span className="fx-cap">{fmtCount(works.scrap)} scrap</span>
            <span className="fx-bin">
              <span className="fx-heap" />
            </span>
          </div>

          <div className="fx-belt" aria-hidden="true">
            <div className="fx-track">
              <div className="fx-tread" />
              {!starved &&
                Array.from({ length: ITEMS }, (_, i) => (
                  <div
                    key={i}
                    className="fx-rider"
                    style={{
                      ['--fx-i' as string]: i,
                      animationDelay: `${-i * period}ms`,
                    }}
                  >
                    {/* One piece of scrap, three costumes: a grey chunk to the
                        furnace, a molten ingot to the stamper, a coin off the
                        end. Each costume is an opacity keyframe cut at the
                        stations' offsets, riding the rider's own delay. */}
                    <span className="fx-chunk" />
                    <span className="fx-ingot" />
                    <span className="fx-coin" />
                  </div>
                ))}
            </div>

            {/* The tag rides above its station: the bottom of a station is the
                mouth that straddles the belt, and a caption there would sit on
                the track the scrap is travelling down. */}
            <div className="fx-station fx-melter">
              <span className="fx-tag">melter</span>
              <span className="fx-heat" />
              <span className="fx-stack" />
              <span className="fx-hood" />
              {!starved && <span className="fx-flash" style={{ animationDelay: phase(MELTER_AT) }} />}
            </div>

            <div className="fx-station fx-stamper">
              <span className="fx-tag">stamper</span>
              <span className="fx-frame" />
              {!starved && (
                <>
                  <span className="fx-piston" style={{ animationDelay: phase(STAMPER_AT) }} />
                  <span className="fx-spark" style={{ animationDelay: phase(STAMPER_AT) }} />
                </>
              )}
            </div>

            {!starved &&
              [0, 1].map((i) => (
                <span key={i} className="fx-credit" style={{ animationDelay: coinPhase(i) }}>
                  +{fmt(perScrap)}
                </span>
              ))}
          </div>

          <div className="fx-out" aria-hidden="true">
            <b className="fx-total">{fmt(credits)}</b>
            <span className="fx-cap">credits</span>
          </div>
        </div>

        {/* The two states a player will sit in for a long time without being
            told why, if nobody says it here: a belt with nothing on it, and a
            yard the belt cannot get through. One line each. */}
        {starved && (
          <p className="fx-state starved">
            <b>Yard empty.</b> The belt waits.
          </p>
        )}
        {backlog && (
          <p className="fx-state backlog">
            <b>Backlog:</b> {fmtCount(works.scrap)} scrap waiting. Belt Speed widens the belt.
          </p>
        )}
        {!starved && !backlog && (
          <p className="fx-state">
            Keeping up: {rate(draw)} scrap a press, {fmt(perHour)} credits an hour.
          </p>
        )}

        <p className="fx-shop">
          Shop: <b>Foundry</b> raises scrap worth, <b>Belt Speed</b> widens the belt.
          {autoSpinMs <= 0 && ' Auto Summon is off; the line moves when you summon.'}
        </p>

        <button className="btn btn-quiet fx-more" onClick={() => setDetail(!detail)}>
          {detail ? 'Hide the numbers' : 'Show the numbers'}
        </button>

        {detail && (
          <dl className="fx-detail">
            <div>
              <dt>Into the yard</dt>
              <dd>
                {rate(supply)} scrap a press ({fmtCount(works.sparesPerPull)} spares,{' '}
                {fmtCount(works.sparesPerScrap)} to a scrap)
              </dd>
            </div>
            <div>
              <dt>Out of the yard</dt>
              <dd>
                {rate(draw)} scrap a press, of {rate(works.belt)} the belt takes
              </dd>
            </div>
            <div>
              <dt>In the yard</dt>
              <dd>{fmtCount(works.scrap)} scrap</dd>
            </div>
            <div>
              <dt>One scrap</dt>
              <dd>
                {fmt(perScrap)} credits ({fmt(creditsPerCard)} a card × {rate(works.scrapWorth)}{' '}
                cards)
              </dd>
            </div>
            <div>
              <dt>Last press paid</dt>
              <dd>{fmt(works.factoryRate)} credits</dd>
            </div>
            <div>
              <dt>A press</dt>
              <dd>{autoSpinMs > 0 ? `every ${(pressMs / 1000).toFixed(2)}s` : 'when you summon'}</dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  )
}
