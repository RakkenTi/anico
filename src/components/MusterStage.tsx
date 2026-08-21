/**
 * The muster: a raid, watched rather than read.
 *
 * Summoning has a ritual -- a wrapper you tear, cards that flip, a stinger
 * when something good lands -- and the board shipped without one, which is why
 * it read as a spreadsheet with buttons. The rules here are unchanged and the
 * payout has already settled by the time this mounts: what it does is show the
 * player who went out. The characters are theirs, the stars are the ones they
 * spent thousands of copies merging, and that is the whole reward the mechanic
 * has to show for itself.
 *
 * Everything is choreographed in CSS off two custom properties -- `--i` per
 * card and `--n` for the rank -- so the browser can hand the whole sequence to
 * the compositor and nothing here re-renders while it plays.
 */

import { useEffect } from 'react'
import type { Muster } from '../game/store'
import { fmt, fmtCount } from '../game/format'
import { tierName } from '../game/contracts'

/** How long each card waits behind the one before it. */
const DEAL_STEP_MS = 70
/** Card deal, then the stamp, then the payout: the tail after the last card. */
const STAMP_MS = 420
const PAY_MS = 460
/** How long the payout stays up before the stage closes itself. */
const HOLD_MS = 2200

export default function MusterStage({ muster, onClose }: { muster: Muster; onClose: () => void }) {
  const shown = muster.roster.length
  const rest = Math.max(0, muster.breadth - shown)
  /* The tally card deals like any other, so the stamp waits behind it too. */
  const dealt = shown + (rest > 0 ? 1 : 0)
  const played = dealt * DEAL_STEP_MS + STAMP_MS + PAY_MS

  /* Closes itself, because a modal you must dismiss is a modal you resent by
     the fourth raid. A click anywhere skips straight to the end. */
  useEffect(() => {
    const id = setTimeout(onClose, played + HOLD_MS)
    return () => clearTimeout(id)
  }, [played, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="muster"
      role="dialog"
      aria-label={`${muster.series} answered`}
      onClick={onClose}
      style={{ '--n': dealt, '--step': `${DEAL_STEP_MS}ms` } as React.CSSProperties}
    >
      <div className="muster-inner">
        <div className="muster-head">
          <span className="muster-tier">{tierName(muster)}</span>
          <b className="muster-series">{muster.series}</b>
          <span className="muster-ask">
            {muster.breadth} at ★{muster.depth}
          </span>
        </div>

        <div className="muster-rank">
          {muster.roster.map((m, i) => (
            <figure key={m.id} className="muster-card" style={{ '--i': i } as React.CSSProperties}>
              <img src={m.image} alt="" draggable={false} />
              <span className="muster-star">★{m.stars}</span>
              <figcaption>{m.name}</figcaption>
            </figure>
          ))}
          {rest > 0 && (
            <figure className="muster-card more" style={{ '--i': shown } as React.CSSProperties}>
              <span className="muster-more">+{fmtCount(rest)}</span>
              <figcaption>more</figcaption>
            </figure>
          )}
        </div>

        <div className="muster-stamp">{muster.commission ? 'Delivered' : 'Answered'}</div>
        <div className="muster-pay">
          +{fmt(muster.reward)} <em>credits</em>
        </div>
        <button className="btn btn-quiet muster-close" onClick={onClose}>
          Return to the board
        </button>
      </div>
    </div>
  )
}
