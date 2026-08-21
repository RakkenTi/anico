/**
 * Expeditions.
 *
 * Scrap spent now, credits later. "Later" is counted in summons, never in
 * minutes (ADR 0004), so a caravan stands exactly where the player's last
 * summon left it and a week away costs nothing.
 *
 * Drawn as a progress rail with five stops on it, and nothing else. The
 * previous version was a landscape -- sky, three ridge lines tinted per tier,
 * a dashed trail, flag waypoints, a gate -- and a player reading it had to
 * work out that the hills meant nothing, the flags meant money, and "presses"
 * meant summons. A bar, five ticks and the word "summons" says all of it.
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

interface Run {
  exp: Expedition
  route: Route
  /** 0 to 1 along the road: the only number the rail is drawn from. */
  pos: number
  passed: number
  left: number
  arrived: boolean
  /** Credits the final click pays: everything the stops have not. */
  due: number
}

export default function ExpeditionsView() {
  const works = useGame((s) => s.works)
  const creditsPerCard = useGame((s) => s.creditsPerCard)
  const fx = useGame((s) => s.effects)()
  const sendExpedition = useGame((s) => s.sendExpedition)
  const repeatRoute = useUi((s) => s.repeatRoute)
  const setUi = useUi((s) => s.set)
  const collectExpedition = useGame((s) => s.collectExpedition)

  const runs = useMemo(() => {
    const list: Run[] = []
    for (const exp of works?.out ?? []) {
      const route = ROUTES.find((r) => r.key === exp.route)
      /* A route this client has never heard of is a server ahead of this
         build; drop the row rather than draw a road of unknown length. */
      if (!route) continue
      /* The last stop is the player's click, so the click is worth at least
         one stop even if the server has already counted all five. */
      const share = exp.bounty / WAYPOINTS
      list.push({
        exp,
        route,
        pos: Math.min(1, Math.max(0, exp.walked / Math.max(1, route.distance))),
        passed: waypointsPassed(route, exp.walked),
        left: Math.max(0, route.distance - exp.walked),
        arrived: exp.walked >= route.distance,
        due: Math.max(share, exp.bounty - share * exp.paid),
      })
    }
    /* Arrived first, then whoever is nearest the end. */
    return list.sort((a, b) => (a.arrived !== b.arrived ? (a.arrived ? -1 : 1) : b.pos - a.pos))
  }, [works?.out])

  if (!works) return null

  const free = Math.max(0, works.caravans - works.out.length)

  return (
    <div className="expeditions-view">
      <p className="exp-lede">
        Spend scrap to send a caravan. It walks one step per summon and pays as it goes.
      </p>

      <div className="exp-strip">
        <div className="meter">
          <span className="meter-label">Scrap</span>
          <b className="meter-value">{fmtCount(Math.floor(works.scrap))}</b>
          <span className="meter-note">in the yard</span>
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
          <span className="meter-note">characters held</span>
        </div>
      </div>

      {runs.length > 0 && (
        <div className="panel">
          <h2 className="section-title">
            On the road{' '}
            <span className="slot-count">
              {works.out.length}/{works.caravans}
            </span>
          </h2>

          <div className="exp-runs">
            {runs.map(({ exp, route, pos, passed, left, arrived, due }) => (
              <div key={exp.id} className={`exp-run ${arrived ? 'arrived' : ''}`}>
                <div className="exp-run-head">
                  <b className="exp-run-name">{route.name}</b>
                  <span className="exp-run-left">
                    {arrived ? 'Arrived' : `${fmtCount(left)} summons to go`}
                  </span>
                  <span className="exp-run-pay">{fmt(exp.bounty)} cr</span>
                </div>

                <div
                  className="exp-rail"
                  style={{ '--pos': pos } as React.CSSProperties}
                  role="img"
                  aria-label={`${fmtCount(exp.walked)} of ${fmtCount(route.distance)} summons, ${passed} of ${WAYPOINTS} stops paid`}
                >
                  <span className="exp-rail-fill" />
                  {Array.from({ length: WAYPOINTS }, (_, i) => (
                    <i
                      key={i}
                      className={`exp-stop ${i + 1 <= passed ? 'paid' : ''}`}
                      style={{ '--at': (i + 1) / WAYPOINTS } as React.CSSProperties}
                    />
                  ))}
                </div>

                <div className="exp-run-foot">
                  <span className="exp-run-note">
                    {passed}/{WAYPOINTS} stops paid
                  </span>
                  {arrived && (
                    <button
                      className="btn btn-primary"
                      onClick={() => void collectExpedition(exp.id)}
                    >
                      Collect {fmt(due)}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
                    : 'Send'

            return (
              <div key={route.key} className={`exp-route ${blocked ? 'locked' : ''}`}>
                <div className="exp-route-main">
                  <b className="exp-route-name">{route.name}</b>
                  <div className="exp-route-facts">
                    <span>
                      <em>{fmtCount(route.scrap)}</em> scrap
                    </span>
                    <span>
                      <em>{fmtCount(route.distance)}</em> summons
                    </span>
                    {route.reach > 0 && (
                      <span>
                        <em>{fmtCount(route.reach)}</em> roster
                      </span>
                    )}
                  </div>
                </div>

                <div className="exp-route-side">
                  <b className="exp-route-pay">{fmt(pay)} cr</b>
                  <div className="exp-route-btns">
                    <button
                      className={`btn ${blocked ? 'btn-ghost' : 'btn-primary'}`}
                      disabled={blocked}
                      onClick={() => void sendExpedition(route.key)}
                    >
                      {label}
                    </button>
                    {/* Only offered on a route you could actually send: a
                        standing order for a road you cannot walk is a switch
                        with nothing behind it. */}
                    {(repeating || needReach + needScrap === 0) && (
                      <button
                        className={`btn btn-quiet exp-repeat ${repeating ? 'on' : ''}`}
                        onClick={() => {
                          sfx.tap()
                          setUi({ repeatRoute: repeating ? null : route.key })
                        }}
                        title="Auto Summon resends this route when a caravan comes home."
                      >
                        {repeating ? 'Repeating' : 'Repeat'}
                      </button>
                    )}
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
