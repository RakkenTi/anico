/**
 * The Factory.
 *
 * The Press mills duplicate cards into scrap; this is the machine that eats
 * the scrap. It runs on its own -- every press, and every hour the player is
 * away -- so there is nothing here to click, and a page with nothing to click
 * has exactly one job: make what is already happening legible.
 *
 * The complaint that produced this view is that every mechanic in this game
 * outside the pack tear is a paragraph and three numbers. So the belt is an
 * actual belt: scrap rides it, two stations fire as it passes, credits come
 * off the right end, and the whole thing runs at the speed the player's real
 * throughput says it runs at. Buying Belt Speed makes the belt visibly faster,
 * which is the only honest way to sell an upgrade to a machine you watch.
 *
 * Every repeating motion is a CSS keyframe reading its duration off a custom
 * property. Nothing here ticks in React: this view is the one a player leaves
 * open while they do something else, and a setInterval that re-renders a tree
 * for hours to move a stripe is how a phone gets warm.
 */

import '../styles/factory.css'
import { useState } from 'react'
import { useGame } from '../game/store'
import { fmt, fmtCount } from '../game/format'

/**
 * Pieces of scrap on the belt at once.
 *
 * Four riders plus a tread, two stations and two coins is nine elements the
 * compositor has to keep moving, which is the budget. The count is also the
 * belt's spacing: one item enters every cadence, so four of them means an item
 * spends four cadences crossing, and the belt reads as full rather than as one
 * lonely block making a trip.
 */
const ITEMS = 4
/** Where the melter and the stamper stand, as a fraction of the run. */
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
      <p className="fx-lede">
        The Press mills your duplicate cards into <b>scrap</b>. The belt pulls scrap out of the
        yard and melts it into <b>credits</b> — every press, and every hour you are away. There
        is nothing to press here; this is the machine running.
      </p>

      <div className="fx-strip">
        <div className="meter">
          <span className="meter-label">Yard</span>
          <b className="meter-value">{fmtCount(works.scrap)}</b>
          <span className="meter-note">scrap waiting for the belt</span>
        </div>
        <div className="meter">
          <span className="meter-label">Belt</span>
          <b className="meter-value">{rate(draw)}</b>
          <span className="meter-note">
            scrap a press out, <b>{rate(supply)}</b> a press in
          </span>
        </div>
        <div className="meter">
          <span className="meter-label">Per scrap</span>
          <b className="meter-value fx-gold">{fmt(perScrap)}</b>
          <span className="meter-note">credits one scrap melts down to</span>
        </div>
        <div className="meter">
          <span className="meter-label">An hour</span>
          <b className="meter-value fx-gold">{fmt(perHour)}</b>
          <span className="meter-note">credits at this throughput, awake or away</span>
        </div>
      </div>

      <div className="panel">
        <h2 className="section-title">
          The line <span className="fx-title-rate">{fmt(works.factoryRate)} last press</span>
        </h2>
        <p className="section-sub">
          Scrap leaves the yard, passes the melter and the stamper, and comes off the end as
          credits. The belt runs at the speed it really runs at:{' '}
          {starved
            ? 'nothing is on it right now.'
            : `a piece every ${(period / 1000).toFixed(2)} seconds.`}
        </p>

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
                    <span className="fx-scrap" />
                  </div>
                ))}
            </div>

            {/* The tag rides above its station: the bottom of a station is the
                lip that hangs over the belt, and a caption there would sit on
                the track the scrap is travelling down. */}
            <div className="fx-station fx-melter">
              <span className="fx-tag">melter</span>
              <span className="fx-hood" />
              {!starved && <span className="fx-flash" style={{ animationDelay: phase(MELTER_AT) }} />}
            </div>

            <div className="fx-station fx-stamper">
              <span className="fx-tag">stamper</span>
              <span className="fx-frame" />
              {!starved && (
                <span className="fx-piston" style={{ animationDelay: phase(STAMPER_AT) }} />
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
            yard the belt cannot get through. */}
        {starved && (
          <p className="fx-state starved">
            <b>The yard is empty.</b> The belt is turning with nothing on it. The Press makes{' '}
            {rate(supply)} scrap a press and the belt can take {rate(works.belt)} — deeper stacks
            and Finer Mill are what feed it faster.
          </p>
        )}
        {backlog && (
          <p className="fx-state backlog">
            <b>Scrap is piling up.</b> {fmtCount(works.scrap)} sit in the yard and the belt only
            takes {rate(works.belt)} a press. Belt Speed is what widens it.
          </p>
        )}
        {!starved && !backlog && (
          <p className="fx-state">
            The belt is keeping up: {rate(draw)} scrap a press in and out, {fmt(perScrap)} credits
            a scrap, {fmt(perHour)} credits an hour.
          </p>
        )}

        <p className="fx-shop">
          Two lines in the Shop move these numbers. <b>Foundry</b> raises what one scrap is worth;{' '}
          <b>Belt Speed</b> raises how much scrap a press the belt pulls.
          {autoSpinMs <= 0 && ' Auto Summon is off, so the line moves when you summon.'}
        </p>

        <button className="btn btn-quiet fx-more" onClick={() => setDetail(!detail)}>
          {detail ? 'Hide the numbers' : 'Show the numbers'}
        </button>

        {detail && (
          <dl className="fx-detail">
            <div>
              <dt>Into the yard</dt>
              <dd>
                {rate(supply)} scrap a press — {fmtCount(works.sparesPerPull)} spares a press,{' '}
                {fmtCount(works.sparesPerScrap)} spares to a scrap
              </dd>
            </div>
            <div>
              <dt>Out of the yard</dt>
              <dd>
                {rate(draw)} scrap a press, against a belt that can take {rate(works.belt)}
              </dd>
            </div>
            <div>
              <dt>In the yard</dt>
              <dd>{fmtCount(works.scrap)} scrap</dd>
            </div>
            <div>
              <dt>One scrap</dt>
              <dd>
                {fmt(perScrap)} credits — {fmt(creditsPerCard)} a card × {rate(works.scrapWorth)}{' '}
                cards a scrap
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
