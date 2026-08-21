/**
 * Expeditions.
 *
 * The slow faucet. The Press mills duplicates into scrap and the Factory
 * trickles that scrap into credits every press; an expedition instead spends a
 * backlog of scrap in one go and pays a bounty many times larger at the far
 * end of a route.
 *
 * Distance is counted in presses, never in minutes (ADR 0004), so this page has
 * to *look* like that is true: the map is a road with the caravan standing
 * where the player's presses left it, not a bar draining against a clock. The
 * token's only motion is a plod in place, timed off the Automaton's own
 * interval, so a player who is auto-summoning sees it step with their presses
 * and a player who is idle sees it waiting.
 *
 * The whole view is a route map plus a ladder of routes, in the order the
 * player acts in: what is out, then what to send next.
 */

import { useMemo } from 'react'
import { useGame, useUi } from '../game/store'
import { fmt, fmtCount } from '../game/format'
import {
  ROUTES,
  WAYPOINTS,
  routePay,
  waypointsPassed,
  type Expedition,
  type Route,
} from '../game/industry'
import '../styles/expeditions.css'

/** A cart, drawn small enough to sit on a four-pixel road. */
function Cart() {
  return (
    <svg viewBox="0 0 24 20" aria-hidden="true" focusable="false">
      <path
        d="M3 5h11l4 5v4H3z"
        fill="currentColor"
        fillOpacity="0.22"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="16" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/**
 * How long a number of presses takes at the Automaton's rate.
 *
 * Said as an aside to a press count and never instead of one: the presses are
 * what move the caravan, and this is only the player asking how long they would
 * have to leave it running.
 */
function pressingTime(presses: number, ms: number): string {
  const seconds = (presses * ms) / 1000
  if (seconds < 90) return `about ${Math.max(1, Math.round(seconds))} seconds`
  const minutes = seconds / 60
  if (minutes < 90) return `about ${Math.round(minutes)} minutes`
  const hours = minutes / 60
  if (hours < 36) return `about ${Math.round(hours)} hours`
  return `about ${Math.round(hours / 24)} days`
}

interface Run {
  exp: Expedition
  route: Route
  /** 0 to 1 along the road: the only number the map is drawn from. */
  pos: number
  passed: number
  left: number
  arrived: boolean
  /** Credits the final click pays: everything the waypoints have not. */
  due: number
}

/** Arrived first, then whoever is nearest the end. */
function rank(a: Run, b: Run): number {
  if (a.arrived !== b.arrived) return a.arrived ? -1 : 1
  return b.pos - a.pos
}

export default function ExpeditionsView() {
  const works = useGame((s) => s.works)
  const creditsPerCard = useGame((s) => s.creditsPerCard)
  // `scrapWorth` is cards-per-scrap and already carries the size of this
  // player's press, which a bare Foundry level cannot (see BASE_SCRAP_WORTH).
  const fx = useGame((s) => s.effects)()
  const autoSpinMs = useGame((s) => s.autoSpinMs)
  const sendExpedition = useGame((s) => s.sendExpedition)
  const repeatRoute = useUi((s) => s.repeatRoute)
  const setUi = useUi((s) => s.set)
  const collectExpedition = useGame((s) => s.collectExpedition)

  const runs = useMemo(() => {
    const list: Run[] = []
    for (const exp of works?.out ?? []) {
      const route = ROUTES.find((r) => r.key === exp.route)
      /* A route the client has never heard of is a server ahead of this build;
         drop the row rather than draw a road of unknown length. */
      if (!route) continue
      const pos = Math.min(1, Math.max(0, exp.walked / Math.max(1, route.distance)))
      const passed = waypointsPassed(route, exp.walked)
      /* The last waypoint is the player's click, so the click is worth at least
         one waypoint even if the server has already counted five. */
      const share = exp.bounty / WAYPOINTS
      list.push({
        exp,
        route,
        pos,
        passed,
        left: Math.max(0, route.distance - exp.walked),
        arrived: exp.walked >= route.distance,
        due: Math.max(share, exp.bounty - share * exp.paid),
      })
    }
    return list.sort(rank)
  }, [works?.out])

  /* The works arrive with the first snapshot, and every hook above has already
     run by here. Nothing on this page is worth a skeleton: it is one screen and
     it is drawn a moment later. */
  if (!works) return null

  const free = Math.max(0, works.caravans - works.out.length)
  const outOf = (key: string) => works.out.filter((e) => e.route === key).length

  return (
    <div className="expeditions-view">
      <p className="exp-lede">
        A caravan moves <b>one step per summon press</b>, not while you wait. Outfit one with
        scrap, keep summoning, and it walks the route and pays the bounty at the end. Close the
        app for a week and it is exactly where you left it.
      </p>

      <div className="exp-strip">
        <div className="meter">
          <span className="meter-label">Scrap</span>
          <b className="meter-value">{fmtCount(Math.floor(works.scrap))}</b>
          <span className="meter-note">what a route costs to outfit</span>
        </div>
        <div className="meter">
          <span className="meter-label">Caravans</span>
          <b className="meter-value">
            {works.out.length}
            <em className="meter-of"> / {works.caravans}</em>
          </b>
          <span className="meter-note">
            {free > 0 ? `${free} free to send` : 'all out — collect one to free a slot'}
          </span>
        </div>
        <div className="meter">
          <span className="meter-label">Roster</span>
          <b className="meter-value">{fmtCount(works.reach)}</b>
          <span className="meter-note">distinct characters held — the longer routes need more</span>
        </div>
      </div>

      <div className="panel">
        <h2 className="section-title">
          On the road{' '}
          <span className="slot-count">
            {works.out.length} of {works.caravans} out
          </span>
        </h2>

        {runs.length === 0 ? (
          <div className="empty-state small">
            <p>No caravans out. Pick a route below and press Send.</p>
          </div>
        ) : (
          <div className="exp-runs">
            {runs.map((run) => {
              const { exp, route, pos, passed, left, arrived, due } = run
              /* The plod is timed off the Automaton so the cart steps at the rate
                 the player is actually pressing. Idle, it waits slowly. */
              const beat = autoSpinMs > 0 ? Math.min(2400, Math.max(700, autoSpinMs)) : 2600
              const share = exp.bounty / WAYPOINTS
              return (
                <div
                  key={exp.id}
                  className={`exp-run ${arrived ? 'arrived' : ''}`}
                  style={{ '--pos': pos, '--beat': `${beat}ms` } as React.CSSProperties}
                >
                  <div className="exp-run-head">
                    <b className="exp-run-name">{route.name}</b>
                    {arrived ? (
                      <span className="exp-run-chip go">arrived</span>
                    ) : (
                      <span className="exp-run-chip">{fmtCount(left)} presses to go</span>
                    )}
                    <span className="exp-run-bounty">pays {fmt(exp.bounty)}</span>
                  </div>

                  <div className="exp-map">
                    <div
                      className="exp-track"
                      role="img"
                      aria-label={`${fmtCount(exp.walked)} of ${fmtCount(route.distance)} presses walked, ${passed} of ${WAYPOINTS} waypoints paid`}
                    >
                      <span className="exp-rail" aria-hidden="true">
                        <span className="exp-dashes" />
                      </span>
                      <span className="exp-walked" aria-hidden="true" />

                      {Array.from({ length: WAYPOINTS }, (_, i) => {
                        const n = i + 1
                        const state = n <= passed ? 'passed' : n === passed + 1 ? 'next' : ''
                        return (
                          <span
                            key={n}
                            className={`exp-mark ${state} ${n === WAYPOINTS ? 'end' : ''}`}
                            style={{ '--at': n / WAYPOINTS } as React.CSSProperties}
                            aria-hidden="true"
                          >
                            <i className="exp-mark-dot" />
                            {n === WAYPOINTS && arrived && <i className="exp-burst" />}
                            <b className="exp-mark-pay">
                              +{n === WAYPOINTS ? fmt(due) : fmt(Math.floor(share))}
                            </b>
                          </span>
                        )
                      })}

                      <span className="exp-caravan" aria-hidden="true">
                        <span className="exp-caravan-token">
                          <Cart />
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="exp-run-foot">
                    <span className="exp-run-note">
                      {passed} of {WAYPOINTS} waypoints paid. {fmtCount(exp.walked)} of{' '}
                      {fmtCount(route.distance)} presses walked.
                    </span>
                    {/* The press count is the number that matters and the head
                        already carries it. This is only the aside: how long
                        those presses take if the Automaton makes them. */}
                    {!arrived && autoSpinMs > 0 && (
                      <span className="exp-run-note">
                        Auto Summon presses every {(autoSpinMs / 1000).toFixed(1)}s, so those{' '}
                        {fmtCount(left)} presses are {pressingTime(left, autoSpinMs)} of leaving it
                        running.
                      </span>
                    )}
                  </div>

                  {arrived && (
                    <div className="exp-run-actions">
                      <button
                        className="btn btn-primary exp-collect"
                        onClick={() => void collectExpedition(exp.id)}
                      >
                        Collect · {fmt(due)}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="section-title">
          Routes <span className="slot-count">{fmtCount(Math.floor(works.scrap))} scrap to spend</span>
        </h2>
        <p className="section-sub">
          Longer routes cost more scrap, take more presses and pay more. The scrap leaves the yard
          the moment you send; nothing is at risk after that.
        </p>

        <div className="exp-routes">
          {ROUTES.map((route) => {
            const pay = routePay(route, creditsPerCard, fx.scrapWorth, fx.outfit)
            const needScrap = Math.max(0, Math.ceil(route.scrap - works.scrap))
            const needReach = Math.max(0, route.reach - works.reach)
            const blocked = needReach > 0 || needScrap > 0 || free <= 0
            const here = outOf(route.key)

            /* One button says the one thing standing in the way, worst first: a
               roster you have not built takes longer to fix than a yard you have
               not filled. The line under it names both when both are short,
               because "3 more scrap" on a route you cannot crew is a lie. */
            const label =
              needReach > 0
                ? `${fmtCount(needReach)} more characters`
                : needScrap > 0
                  ? `${fmtCount(needScrap)} more scrap`
                  : free <= 0
                    ? 'All caravans out'
                    : `Send · ${fmtCount(route.scrap)} scrap`

            return (
              <div
                key={route.key}
                className={`exp-route-row ${blocked ? 'locked' : 'sendable'}`}
              >
                <div className="exp-route-main">
                  <div className="exp-route-head">
                    <b className="exp-route-name">{route.name}</b>
                    {here > 0 && <span className="exp-run-chip">{here} out</span>}
                  </div>
                  <div className="exp-route-facts">
                    <span className="exp-route-fact">
                      <em>{fmtCount(route.distance)}</em> presses
                    </span>
                    <span className="exp-route-fact">
                      <em>{fmtCount(route.scrap)}</em> scrap
                    </span>
                    <span className="exp-route-fact">
                      {route.reach === 0 ? (
                        <em>no roster needed</em>
                      ) : (
                        <>
                          <em>{fmtCount(route.reach)}</em> characters
                        </>
                      )}
                    </span>
                    <span className="exp-route-fact">
                      pays every <em>{fmtCount(Math.round(route.distance / WAYPOINTS))}</em> presses
                    </span>
                  </div>
                  {(needScrap > 0 || needReach > 0 || free <= 0) && (
                    <div className="exp-route-need">
                      {needReach > 0 && (
                        <span>
                          Needs {fmtCount(route.reach)} distinct characters. You hold{' '}
                          {fmtCount(works.reach)} — {fmtCount(needReach)} to go.
                        </span>
                      )}
                      {needScrap > 0 && (
                        <span>
                          Needs {fmtCount(route.scrap)} scrap. You have{' '}
                          {fmtCount(Math.floor(works.scrap))} — {fmtCount(needScrap)} short.
                        </span>
                      )}
                      {needReach <= 0 && needScrap <= 0 && free <= 0 && (
                        <span>
                          All {works.caravans} caravans are out. Collect one to free a slot.
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="exp-route-actions">
                  <span className="exp-route-pay">{fmt(pay)}</span>
                  <button
                    className={`btn ${blocked ? 'btn-ghost' : 'btn-primary'}`}
                    disabled={blocked}
                    onClick={() => void sendExpedition(route.key)}
                    title={`${fmtCount(route.scrap)} scrap now, ${fmt(pay)} over ${fmtCount(route.distance)} presses`}
                  >
                    {label}
                  </button>
                  {/* A standing order rather than a second decision: Auto Summon
                      re-outfits this same road whenever a caravan comes home and
                      the yard can pay for it. One road at a time, and changing it
                      is still a press. */}
                  <button
                    className={`btn btn-quiet exp-repeat ${repeatRoute === route.key ? 'on' : ''}`}
                    onClick={() =>
                      setUi({ repeatRoute: repeatRoute === route.key ? null : route.key })
                    }
                    title={
                      repeatRoute === route.key
                        ? 'Auto Summon is re-sending this road. Press to stop.'
                        : 'Have Auto Summon send this road again every time a caravan comes home.'
                    }
                  >
                    {repeatRoute === route.key ? 'Repeating' : 'Repeat'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
