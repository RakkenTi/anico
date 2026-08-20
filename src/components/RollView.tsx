import { useEffect, useRef, useState } from 'react'
import { useGame } from '../game/store'
import { coinTier } from '../game/economy'
import { dealDelayMs, dealStepMs, dealtFraction } from '../game/sound'
import CharacterCard from './CharacterCard'
import PackOpener from './PackOpener'

export default function RollView() {
  const s = useGame()
  const testing = s.sandbox
  const pack = s.pack && s.pack.state !== 'open' ? s.pack : null
  // Packs are the whole of the progression: nothing until Sapphire I, and
  // bigger from there. Zero means the only summon available is a single card.
  const packSize = s.packSize
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
    /* `opening` marks the stretch from a sealed pack to the last card landing.
       On a phone the controls stand down for it: there is nothing to press
       while a pack is being opened, and the bar was crowding the cards. */
    <div className={`roll-view ${mega ? 'mega' : ''} ${pack ? 'opening' : ''}`}>
      <div className="roll-stage" ref={stageRef}>
        {s.rolling ? (
          <div className="card-back" aria-label="Summoning…">
            <div className="card-back-inner">
              <span className="card-back-glyph">✦</span>
              <span className="card-back-word">summoning…</span>
            </div>
          </div>
        ) : pack ? (
          <PackOpener pack={pack} cards={s.rolled} />
        ) : s.rolled.length > 0 ? (
          /* One card and ten are the same thing at different widths. A single
             summon used to have a layout of its own — a card twice the size,
             with its own type scale — and on a phone that one card filled the
             screen while saying less than a spread slot does. */
          <div
            className={`roll-spread ${s.rolled.length === 1 ? 'single' : ''}`}
            key={s.rollCount}
            style={{
              // pulse fires with the rarity stinger, after the last card
              ['--pulse-delay' as string]: `${s.rolled.length * dealStepMs(s.rolled.length) + 80}ms`,
            }}
          >
            {s.rolled.map((r, i) => (
              <div
                key={`${r.char.id}-${i}`}
                className={`spread-slot ${i === s.selected ? 'selected' : ''} ${r.owned && !r.fresh ? 'owned' : ''} ${i === bestIdx ? 'spotlight' : ''}`}
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
                {r.wished && !r.owned ? (
                  <span className="spread-tag wished">a wish</span>
                ) : r.fresh ? (
                  <span className="spread-tag fresh">new</span>
                ) : (
                  r.owned && (
                    <span className="spread-tag">
                      {r.compensation > 0 ? `dupe +${r.compensation}` : 'owned'}
                    </span>
                  )
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
            disabled={s.rolling || dealing}
          >
            {s.rolling ? 'Summoning…' : 'Summon'}
          </button>
          {packSize > 0 && (
            <button
              className="btn btn-quiet btn-summon"
              onClick={() => s.roll(packSize)}
              disabled={s.rolling || dealing}
              title={
                testing
                  ? `Sandbox: summon ${packSize} at once`
                  : `Open a sealed pack of ${packSize}. Every card in it is yours.`
              }
            >
              ×{packSize}
            </button>
          )}
        </div>

        <div className="roll-meta">
          {testing ? (
            <span className="testing-note">Sandbox: a scratch profile, nothing is kept</span>
          ) : packSize > 0 ? (
            <span className="testing-note">Summon freely · packs hold {packSize}</span>
          ) : (
            /* The one thing the shop is for, said where the button would be. */
            <span className="testing-note">Summon freely · packs open at Sapphire I</span>
          )}
        </div>

        {/* Nothing about the contents until the wrapper is off: the bar was
            naming a card while the pack was still sealed. */}
        {entry && !s.rolling && !(s.pack && s.pack.state === 'sealed') && (
          <div className={`claim-bar ${entry.owned ? 'is-note' : ''}`}>
            <div className="claim-bar-info">
              <span className="claim-bar-name">{entry.char.name}</span>
              <span className="claim-bar-value" title="Credit value">{entry.char.creditValue.toLocaleString()}</span>
            </div>
            {entry.owned ? (
              <span className="claim-bar-note">
                {entry.fresh
                  ? 'straight from the pack, and yours'
                  : entry.compensation > 0
                    ? `already yours, compensated ${entry.compensation} credits`
                    : 'bound to your collection'}
              </span>
            ) : (
              <button
                className="btn btn-primary"
                onClick={s.claim}
                title="Add this character to your collection"
              >
                Claim
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

        {s.pendingCoins && (
          <button
            className="coin-drop"
            onClick={s.collectCoins}
            style={{ ['--coin-color' as string]: coinTier(s.pendingCoins.tier).color }}
          >
            <span className="coin-mark" aria-hidden="true">¢</span>
            {coinTier(s.pendingCoins.tier).label}: tap to gather <b>+{s.pendingCoins.amount}</b>
          </button>
        )}

        {s.error && (
          <div className="error-banner" onClick={s.clearError} role="alert">
            {s.error} <span className="dismiss">(dismiss)</span>
          </div>
        )}
      </aside>
    </div>
  )
}
