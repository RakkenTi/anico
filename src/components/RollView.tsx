import { useEffect, useRef, useState } from 'react'
import { useGame, formatDuration } from '../game/store'
import { gemTier } from '../game/economy'
import { dealDelayMs, dealStepMs, dealtFraction } from '../game/sound'
import CharacterCard from './CharacterCard'

export default function RollView() {
  const s = useGame()
  const testing = s.sandbox
  const claimReady = testing || s.now >= s.nextClaimAt
  const rollsResetIn = s.rollsResetAt - s.now
  const claimIn = s.nextClaimAt - s.now
  const fx = s.effects()
  const ritualAt = s.ritualReadyAt()
  const fun = s.settings.mode === 'fun'
  const canRoll = testing || fun || s.rollsLeft > 0
  // A face-down spread that has not been picked from yet.
  const facedown = s.covered && s.covered.revealed === null ? s.covered : null
  // The x10 spread is its own once-a-day allowance and spends no hourly rolls,
  // so it stays available when the hourly budget is empty, and vice versa.
  const multiReady = fun || s.multiReady()
  const multiIn = s.multiReadyAt - s.now
  const entry = s.rolled[s.selected]
  const unclaimed = s.rolled.filter((r) => !r.owned).length
  const mega = s.rolled.length > 20

  // Mega spreads lock the page: html/body stop scrolling entirely and only
  // the card pane scrolls, so the rail's buttons can never leave the screen.
  useEffect(() => {
    document.documentElement.classList.toggle('mega-lock', mega)
    return () => document.documentElement.classList.remove('mega-lock')
  }, [mega])

  const rolledCount = s.rolled.length

  // No re-roll while the deal animation is playing (store enforces the same
  // rule; this mirrors it visually by disabling the buttons). `dealing` is
  // derived: the roll whose deal has finished lags rollCount until the timer.
  const [dealtRoll, setDealtRoll] = useState(0)
  const dealing = rolledCount > 0 && dealtRoll < s.rollCount
  useEffect(() => {
    if (rolledCount === 0) return
    const t = setTimeout(
      () => setDealtRoll(s.rollCount),
      rolledCount * dealStepMs(rolledCount) + 700,
    )
    return () => clearTimeout(t)
  }, [s.rollCount, rolledCount])

  // Follow the deal: when a fresh spread overflows its pane, glide the
  // scroll down in step with the flip cascade until the last row lands.
  // Any manual input (wheel/touch/click) hands control back to the user.
  const stageRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = stageRef.current
    if (!mega || !el || rolledCount === 0) return
    el.scrollTop = 0
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const total = rolledCount * dealStepMs(rolledCount)
    if (total <= 0) return
    const start = performance.now()
    let raf = 0
    const stop = () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('wheel', stop)
      el.removeEventListener('touchstart', stop)
      el.removeEventListener('pointerdown', stop)
    }
    el.addEventListener('wheel', stop, { passive: true })
    el.addEventListener('touchstart', stop, { passive: true })
    el.addEventListener('pointerdown', stop)
    const tick = (now: number) => {
      const max = el.scrollHeight - el.clientHeight
      if (max <= 0) return stop()
      const u = (now - start) / total
      if (u >= 1) {
        el.scrollTop = max
        return stop()
      }
      // keep the card that is flipping right now just above the fold: it
      // holds at 0 while the first screenful deals, then rides the eased
      // cascade and lands on the last row exactly as the deal ends.
      const dealtPx = dealtFraction(u) * el.scrollHeight
      el.scrollTop = Math.max(0, Math.min(max, dealtPx - el.clientHeight))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return stop
  }, [s.rollCount, mega, rolledCount])

  // The spread's highest-value card gets a one-shot pulse once dealt.
  const bestIdx =
    s.rolled.length > 1
      ? s.rolled.reduce(
          (bi, r, i) => (r.char.creditValue > s.rolled[bi].char.creditValue ? i : bi),
          0,
        )
      : -1

  return (
    <div className={`roll-view ${mega ? 'mega' : ''}`}>
      <div className="roll-stage" ref={stageRef}>
        {s.rolling ? (
          <div className="card-back" aria-label="Summoning…">
            <div className="card-back-inner">
              <span className="card-back-glyph">✦</span>
              <span className="card-back-word">summoning…</span>
            </div>
          </div>
        ) : facedown ? (
          <div className="roll-spread covered" key={`covered-${s.rollCount}`}>
            {Array.from({ length: facedown.count }, (_, i) => (
              <button
                key={i}
                className="spread-slot covered-slot"
                style={{ ['--deal-delay' as string]: `${dealDelayMs(i, facedown.count).toFixed(1)}ms` }}
                onClick={() => void s.flip(i)}
                disabled={s.rolling}
                title="Turn this one over"
                aria-label={`Face-down card ${i + 1} of ${facedown.count}`}
              >
                <span className="covered-glyph" aria-hidden="true">✦</span>
                <span className="covered-hint">turn over</span>
              </button>
            ))}
          </div>
        ) : s.rolled.length === 1 && entry ? (
          <div className="roll-reveal" key={s.rollCount}>
            {entry.wished && !entry.owned && (
              <div className="wish-banner">A wish come true</div>
            )}
            <div className="flip-inner">
              <div className="flip-back" aria-hidden="true">✦</div>
              <CharacterCard character={entry.char} wished={entry.wished} />
            </div>
          </div>
        ) : s.rolled.length > 1 ? (
          <div
            className="roll-spread"
            key={s.rollCount}
            style={{
              // pulse fires with the rarity stinger, after the last card
              ['--pulse-delay' as string]: `${s.rolled.length * dealStepMs(s.rolled.length) + 80}ms`,
            }}
          >
            {s.rolled.map((r, i) => (
              <div
                key={`${r.char.id}-${i}`}
                className={`spread-slot ${i === s.selected ? 'selected' : ''} ${r.owned ? 'owned' : ''} ${i === bestIdx ? 'spotlight' : ''}`}
                style={{ ['--deal-delay' as string]: `${dealDelayMs(i, s.rolled.length).toFixed(1)}ms` }}
              >
                <div className="flip-inner">
                  <div className="flip-back" aria-hidden="true">✦</div>
                  <CharacterCard
                    character={r.char}
                    wished={r.wished}
                    compact
                    onClick={() => s.selectRolled(i)}
                  />
                </div>
                {r.owned && (
                  <span className="spread-tag">
                    {r.compensation > 0 ? `dupe +${r.compensation}` : 'owned'}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="card-back idle">
            <div className="card-back-inner">
              <span className="card-back-glyph">✦</span>
              <span className="card-back-word">fate awaits</span>
            </div>
          </div>
        )}
      </div>

      <aside className="roll-rail">
        <div className="roll-actions">
          <button
            className="btn btn-primary btn-summon"
            onClick={() => s.roll(1)}
            disabled={s.rolling || dealing || !canRoll}
          >
            {s.rolling ? 'Summoning…' : 'Summon'}
          </button>
          <button
            className="btn btn-quiet btn-summon"
            onClick={() => s.roll(s.multiSize)}
            disabled={s.rolling || dealing || !multiReady}
            title={
              multiReady
                ? `Your daily ×${s.multiSize} summon. Costs no hourly summons.`
                : `Your daily ×${s.multiSize} returns in ${formatDuration(multiIn)}`
            }
          >
            {multiReady ? `×${s.multiSize}` : formatDuration(multiIn)}
          </button>
          {testing && (
            <button
              className="btn btn-quiet btn-summon"
              onClick={() => s.roll(100)}
              disabled={s.rolling || dealing}
              title="Sandbox only: summon 100 at once"
            >
              ×100
            </button>
          )}
        </div>

        {facedown && !s.rolling && (
          <p className="covered-note">
            Ten cards, face down. Turn <b>one</b> over — the rest stay a mystery.
          </p>
        )}

        <div className="roll-meta">
          {testing ? (
            <span className="testing-note">Sandbox: a scratch profile, nothing is kept</span>
          ) : fun ? (
            <span className="testing-note">Fun mode: summon and claim freely</span>
          ) : (
            <>
              <span>
                {s.rollsLeft}/{s.rollsMax} summons · refill {formatDuration(rollsResetIn)}
              </span>
              <br />
              <span className={multiReady ? 'ready' : ''}>
                {multiReady ? `daily ×${s.multiSize} ready` : `daily ×${s.multiSize} ${formatDuration(multiIn)}`}
              </span>
              <br />
              <span className={claimReady ? 'ready' : ''}>
                {claimReady ? 'claim ready' : `claim ${formatDuration(claimIn)}`}
              </span>
            </>
          )}
        </div>

        {entry && !s.rolling && (
          <div className="claim-bar">
            <div className="claim-bar-info">
              <span className="claim-bar-name">{entry.char.name}</span>
              <span className="claim-bar-value" title="Credit value">{entry.char.creditValue.toLocaleString()}</span>
            </div>
            {entry.owned ? (
              <span className="claim-bar-note">
                {entry.compensation > 0
                  ? `already yours, compensated ${entry.compensation} credits`
                  : 'bound to your collection'}
              </span>
            ) : (
              <button
                className="btn btn-primary"
                disabled={!claimReady}
                onClick={s.claim}
                title={
                  claimReady
                    ? 'Add this character to your collection'
                    : `Claim available in ${formatDuration(claimIn)}`
                }
              >
                {claimReady ? 'Claim' : formatDuration(claimIn)}
              </button>
            )}
          </div>
        )}

        {testing && !s.rolling && s.rolled.length > 1 && unclaimed > 0 && (
          <button
            className="btn btn-primary"
            onClick={s.claimAll}
            title="Sandbox only: claim every unowned card in this spread"
          >
            Claim all ({unclaimed})
          </button>
        )}

        {s.pendingGem && (
          <button
            className="gem-drop"
            onClick={s.collectGem}
            style={{ ['--gem-color' as string]: gemTier(s.pendingGem.tier).color }}
          >
            <span className="gem-mark" aria-hidden="true" />
            {gemTier(s.pendingGem.tier).label}: tap to gather <b>+{s.pendingGem.amount}</b>
          </button>
        )}

        {s.error && (
          <div className="error-banner" onClick={s.clearError} role="alert">
            {s.error} <span className="dismiss">(dismiss)</span>
          </div>
        )}

        {fx.claimResetUnlocked && !claimReady && !testing && (
          <button
            className="btn btn-quiet"
            disabled={s.now < ritualAt}
            onClick={s.claimRitual}
            title="Emerald badge ritual: reset your claim cooldown"
          >
            {s.now >= ritualAt
              ? 'Perform the Claim Reset ritual'
              : `Ritual ready in ${formatDuration(ritualAt - s.now)}`}
          </button>
        )}
      </aside>
    </div>
  )
}
