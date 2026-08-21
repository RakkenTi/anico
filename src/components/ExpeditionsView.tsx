/**
 * Expeditions.
 *
 * Scrap spent now, a bounty many presses later. Distance is measured in
 * presses, never minutes (ADR 0004), so the map is a road with the caravan
 * standing exactly where the player's presses left it. The token's only
 * motion is a bob in place timed off the Automaton's interval.
 *
 * Each run is drawn as a scene: sky and three ridge lines tinted by the
 * route's tier, a dashed trail that fills as the caravan walks, flag
 * waypoints that light when paid, and a gate at the far end. Position comes
 * from one custom property (--pos); everything that repeats is a CSS
 * keyframe.
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
import { sfx } from '../game/sound'
import '../styles/expeditions.css'

/** A covered wagon small enough to sit on the road. */
function Cart() {
  return (
    <svg viewBox="0 0 28 22" aria-hidden="true" focusable="false">
      <path
        d="M4.5 10 Q4.5 3.5 10 3.5 L18 3.5 Q23.5 3.5 23.5 10 L23.5 14.5 L4.5 14.5 Z"
        fill="currentColor"
        fillOpacity="0.28"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 4 V14 M14 3.5 V14 M18.5 4 V14"
        stroke="currentColor"
        strokeWidth="0.9"
        opacity="0.45"
      />
      <circle cx="9.5" cy="17.8" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18.5" cy="17.8" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** The gate at the end of the road. */
function Gate() {
  return (
    <svg viewBox="0 0 14 13" aria-hidden="true" focusable="false">
      <path d="M0.8 3.2 Q7 0.8 13.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M2.8 6 H11.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.8 3 V13 M10.2 3 V13" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/** Route crest: a ridge line in the tier's color. */
function Crest() {
  return (
    <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false">
      <path
        d="M1 14 L7 4 L11 9.5 L15.5 2.5 L23 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Layered ridges behind the road. Fills are set per tier in CSS. */
function Terrain() {
  return (
    <svg
      className="exp-terrain"
      viewBox="0 0 400 96"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="t-far"
        d="M0 64 L28 40 L58 56 L92 30 L128 54 L166 34 L204 58 L242 36 L278 55 L314 30 L348 52 L378 40 L400 56 L400 96 L0 96 Z"
      />
      <path
        className="t-mid"
        d="M0 76 Q42 54 84 68 T168 64 T252 70 T336 60 T400 70 L400 96 L0 96 Z"
      />
      <path className="t-near" d="M0 86 Q64 74 128 81 T272 79 T400 83 L400 96 L0 96 Z" />
    </svg>
  )
}

/** Presses at the Automaton's rate, said short: "45s", "12 min", "3 h". */
function autoTime(presses: number, ms: number): string {
  const s = (presses * ms) / 1000
  if (s < 90) return `${Math.max(1, Math.round(s))}s`
  const m = s / 60
  if (m < 90) return `${Math.round(m)} min`
  const h = m / 60
  if (h < 36) return `${Math.round(h)} h`
  return `${Math.round(h / 24)} d`
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
      /* A route the client has never heard of is a server ahead of this
         build; drop the row rather than draw a road of unknown length. */
      if (!route) continue
      const pos = Math.min(1, Math.max(0, exp.walked / Math.max(1, route.distance)))
      const passed = waypointsPassed(route, exp.walked)
      /* The last waypoint is the player's click, so the click is worth at
         least one waypoint even if the server has already counted five. */
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

  if (!works) return null

  const free = Math.max(0, works.caravans - works.out.length)
  const outOf = (key: string) => works.out.filter((e) => e.route === key).length

  return (
    <div className="expeditions-view">
      <p className="exp-lede">
        Caravans move <b>one step per summon press</b>.
      </p>

      <div className="exp-strip">
        <div className="meter">
          <span className="meter-label">Scrap</span>
          <b className="meter-value">{fmtCount(Math.floor(works.scrap))}</b>
        </div>
        <div className="meter">
          <span className="meter-label">Caravans</span>
          <b className="meter-value">
            {works.out.length}
            <em className="meter-of"> / {works.caravans}</em>
          </b>
          <span className="meter-note">{free > 0 ? `${free} free` : 'all out'}</span>
        </div>
        <div className="meter">
          <span className="meter-label">Roster</span>
          <b className="meter-value">{fmtCount(works.reach)}</b>
        </div>
      </div>

      <div className="panel">
        <h2 className="section-title">
          On the road{' '}
          <span className="slot-count">
            {works.out.length}/{works.caravans}
          </span>
        </h2>

        {runs.length === 0 ? (
          <div className="empty-state small">
            <p>No caravans out.</p>
          </div>
        ) : (
          <div className="exp-runs">
            {runs.map((run) => {
              const { exp, route, pos, passed, left, arrived, due } = run
              /* Bob timed off the Automaton so the cart steps at the rate the
                 player is pressing. Idle, it waits slowly. */
              const beat = autoSpinMs > 0 ? Math.min(2400, Math.max(700, autoSpinMs)) : 2600
              const share = exp.bounty / WAYPOINTS
              return (
                <div
                  key={exp.id}
                  className={`exp-run tier-${route.key} ${arrived ? 'arrived' : ''}`}
                  style={{ '--pos': pos, '--beat': `${beat}ms` } as React.CSSProperties}
                >
                  <div className="exp-run-head">
                    <b className="exp-run-name">{route.name}</b>
                    {arrived ? (
                      <span className="exp-chip go">Arrived</span>
                    ) : (
                      <span className="exp-chip">{fmtCount(left)} to go</span>
                    )}
                    <span className="exp-writ" title="Bounty, fixed at send">
                      <i className="exp-seal" />
                      {fmt(exp.bounty)}
                    </span>
                  </div>

                  <div
                    className="exp-scene"
                    role="img"
                    aria-label={`${fmtCount(exp.walked)} of ${fmtCount(route.distance)} presses walked, ${passed} of ${WAYPOINTS} waypoints paid`}
                  >
                    <Terrain />
                    <div className="exp-road" aria-hidden="true">
                      <span className="exp-rail">
                        <span className="exp-dashes" />
                      </span>
                      <span className="exp-walked" />

                      {Array.from({ length: WAYPOINTS }, (_, i) => {
                        const n = i + 1
                        const state = n <= passed ? 'passed' : n === passed + 1 ? 'next' : ''
                        const isEnd = n === WAYPOINTS
                        return (
                          <span
                            key={n}
                            className={`exp-mark ${state} ${isEnd ? 'end' : ''}`}
                            style={{ '--at': n / WAYPOINTS } as React.CSSProperties}
                          >
                            {isEnd ? (
                              <i className="exp-gate">
                                <Gate />
                                {arrived && <i className="exp-burst" />}
                              </i>
                            ) : (
                              <i className="exp-flag" />
                            )}
                            <b className="exp-mark-pay">
                              +{isEnd ? fmt(due) : fmt(Math.floor(share))}
                            </b>
                          </span>
                        )
                      })}

                      <span className="exp-caravan">
                        <span className="exp-caravan-token">
                          <Cart />
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="exp-run-foot">
                    <span className="exp-run-note">
                      {passed}/{WAYPOINTS} waypoints · {fmtCount(exp.walked)}/
                      {fmtCount(route.distance)} presses
                      {!arrived && autoSpinMs > 0 && ` · ${autoTime(left, autoSpinMs)} on Auto`}
                    </span>
                    {arrived && (
                      <button
                        className="btn btn-primary exp-collect"
                        onClick={() => void collectExpedition(exp.id)}
                      >
                        Collect {fmt(due)}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="section-title">
          Routes <span className="slot-count">{fmtCount(Math.floor(works.scrap))} scrap</span>
        </h2>

        <div className="exp-routes">
          {ROUTES.map((route) => {
            const pay = routePay(route, creditsPerCard, fx.scrapWorth, fx.outfit)
            const needScrap = Math.max(0, Math.ceil(route.scrap - works.scrap))
            const needReach = Math.max(0, route.reach - works.reach)
            const blocked = needReach > 0 || needScrap > 0 || free <= 0
            const here = outOf(route.key)
            const repeating = repeatRoute === route.key

            /* The button names the one blocker, worst first: a roster takes
               longer to fix than a yard. */
            const label =
              needReach > 0
                ? `Need ${fmtCount(needReach)} roster`
                : needScrap > 0
                  ? `Need ${fmtCount(needScrap)} scrap`
                  : free <= 0
                    ? 'All caravans out'
                    : `Send · ${fmtCount(route.scrap)} scrap`

            return (
              <div
                key={route.key}
                className={`exp-route tier-${route.key} ${blocked ? 'locked' : 'sendable'}`}
              >
                <span className="exp-crest" aria-hidden="true">
                  <Crest />
                </span>

                <div className="exp-route-main">
                  <div className="exp-route-head">
                    <b className="exp-route-name">{route.name}</b>
                    {here > 0 && <span className="exp-chip">{here} out</span>}
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
                        'no roster'
                      ) : (
                        <>
                          <em>{fmtCount(route.reach)}</em> roster
                        </>
                      )}
                    </span>
                  </div>
                  {/* The button names the roster; the second shortfall still
                      has to be said somewhere. */}
                  {needReach > 0 && needScrap > 0 && (
                    <div className="exp-route-need">Also {fmtCount(needScrap)} scrap short</div>
                  )}
                </div>

                <div className="exp-route-side">
                  <span className="exp-writ" title="Full bounty at today's rate">
                    <i className="exp-seal" />
                    {fmt(pay)}
                  </span>
                  <div className="exp-route-btns">
                    <button
                      className={`btn ${blocked ? 'btn-ghost' : 'btn-primary'}`}
                      disabled={blocked}
                      onClick={() => void sendExpedition(route.key)}
                      title={`${fmtCount(route.scrap)} scrap now, ${fmt(pay)} over ${fmtCount(route.distance)} presses`}
                    >
                      {label}
                    </button>
                    <button
                      className={`btn btn-quiet exp-repeat ${repeating ? 'on' : ''}`}
                      onClick={() => {
                        sfx.tap()
                        setUi({ repeatRoute: repeating ? null : route.key })
                      }}
                      title={
                        repeating
                          ? 'Auto Summon resends this route. Press to stop.'
                          : 'Auto Summon resends this route when a caravan returns.'
                      }
                    >
                      {repeating ? 'Repeating' : 'Repeat'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
