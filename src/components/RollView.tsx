import { useRef, useState } from 'react'
import { useEffect, useMemo } from 'react'
import { useGame } from '../game/store'
import type { AutoSell } from '../api'
import { dealDelayMs, dealStepMs, dealtFraction } from '../game/sound'
import { fmt, fmtCount } from '../game/format'
import CharacterCard from './CharacterCard'
import Icon from './Icon'
import PackOpener from './PackOpener'

export default function RollView() {
  const s = useGame()
  const testing = s.sandbox
  const pack = s.pack && s.pack.stacks.some((st) => st.state !== 'open') ? s.pack : null
  // Packs are the whole of the progression: nothing until Sapphire I, and
  // bigger from there. Zero means the only summon available is a single card.
  const packSize = s.packSize
  const affordable = s.canAffordPack()
  const busy = s.packBusy()
  const pullSize = s.cardsPerPull
  const entry = s.rolled[s.selected]
  const mega = s.rolled.length > 20

  /**
   * The order the spread is laid out in.
   *
   * A pack of a hundred lands as a wall of cards, and the one worth looking at
   * is somewhere in it. Sorting is a view: the cards keep their own identity,
   * and claiming works off the character rather than the position, so nothing
   * downstream can be confused by re-ordering them.
   */
  const view = useMemo(() => {
    const idx = s.rolled.map((_, i) => i)
    if (s.rollSort === 'rarity') {
      idx.sort((a, b) => s.rolled[b].char.creditValue - s.rolled[a].char.creditValue)
    }
    return idx
  }, [s.rolled, s.rollSort])

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
    <div className={`roll-view ${mega ? 'mega' : ''} ${mega ? 'hushed' : ''} ${pack ? 'opening' : ''}`}>
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
            {view.map((i) => s.rolled[i]).map((r, pos) => {
              const i = view[pos]
              return (
              <div
                key={`${r.char.id}-${i}`}
                className={`spread-slot ${i === s.selected ? 'selected' : ''} ${r.owned && !r.fresh ? 'owned' : ''} ${i === bestIdx ? 'spotlight' : ''}`}
                style={{ ['--deal-delay' as string]: `${dealDelayMs(pos, s.rolled.length).toFixed(1)}ms` }}
              >
                <div className="flip-inner">
                  <div className="flip-back" aria-hidden="true">✦</div>
                  <CharacterCard
                    character={r.char}
                    wished={r.wished}
                    compact
                    onClick={() => s.selectRolled(i)}
                    overlay={
                      r.wished && r.fresh ? (
                        <span className="spread-tag wished">a wish</span>
                      ) : r.autoSold ? (
                        <span className="spread-tag">sold</span>
                      ) : r.fresh ? (
                        <span className="spread-tag fresh">new</span>
                      ) : r.owned ? (
                        <span className="spread-tag">
                          {r.compensation > 0 ? `dupe +${r.compensation}` : 'owned'}
                        </span>
                      ) : null
                    }
                  />
                </div>
              </div>
              )
            })}
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
            disabled={s.rolling || dealing || busy}
          >
            {s.rolling ? 'Summoning…' : 'Summon'}
          </button>
          {packSize > 0 && (
            <button
              className="btn btn-quiet btn-summon btn-pack"
              onClick={() => s.roll(pullSize)}
              disabled={s.rolling || dealing || busy || !affordable}
              title={
                testing
                  ? `Sandbox: summon ${packSize} at once`
                  : affordable
                    ? `Open a sealed pack of ${packSize}. Every card in it is yours.`
                    : `This pull costs ${fmt(s.packPrice)} credits.`
              }
            >
              <span className="pack-x">
                ×{fmtCount(pullSize)}
                {s.packsPerPull > 1 && <em className="pack-mult"> {s.packsPerPull} packs</em>}
              </span>
              {!testing && (
                <span className="pack-price">
                  <Icon name="token" /> {fmt(s.packPrice)}
                </span>
              )}
            </button>
          )}
        </div>

        <div className="roll-meta">
          {testing ? (
            <span className="testing-note">Sandbox: a scratch profile, nothing is kept</span>
          ) : packSize > 0 ? (
            <span className="testing-note">
              Single summons are free ·{' '}
              {s.packsPerPull > 1
                ? `${s.packsPerPull} packs, ${fmtCount(pullSize)} cards`
                : `a pack of ${fmtCount(packSize)}`}{' '}
              costs {fmt(s.packPrice)}
            </span>
          ) : (
            /* The one thing the shop is for, said where the button would be. */
            <span className="testing-note">Summon freely · packs open at Sapphire I</span>
          )}
        </div>

        {/* Two machines, both bought in the shop: one sells the chaff as it
            lands, the other presses the button for you. Between them the late
            game runs without a hand on it. */}
        {!testing && (
          <div className="auto-row">
            <label className="auto-sell">
              <span className="auto-label">Auto-sell</span>
              <select
                className="input"
                value={s.settings.autoSell}
                onChange={(e) => s.updateSettings({ autoSell: e.target.value as AutoSell })}
              >
                <option value="off">Keep everything</option>
                <option value="rare">Sell below Rare</option>
                <option value="epic">Sell below Epic</option>
                <option value="legendary">Sell below Legendary</option>
                <option value="mythic">Sell below Mythic</option>
              </select>
            </label>
            {s.autoSpinMs > 0 && (
              <button
                className={`btn ${s.autoSpin ? 'btn-primary' : 'btn-quiet'} auto-spin`}
                onClick={() => s.setAutoSpin(!s.autoSpin)}
                title={`The Automaton opens a pull every ${(s.autoSpinMs / 1000).toFixed(1)}s while this is on`}
              >
                <Icon name="gear" className={s.autoSpin ? 'spinning' : undefined} />
                {/* Two labels, one shown at a time: a phone has no room for
                    the sentence and no patience for a mystery icon. */}
                <span className="label-long">
                  {s.autoSpin ? 'Automaton running' : 'Start the Automaton'}
                </span>
                <span className="label-short">{s.autoSpin ? 'Running' : 'Automaton'}</span>
              </button>
            )}
          </div>
        )}

        {/* Nothing about the contents until the wrapper is off: the bar was
            naming a card while the pack was still sealed. */}
        {/* A summon grants what it turns up, so this says what happened to
            the card rather than asking whether you want it. */}
        {entry && !s.rolling && !(s.pack && s.pack.stacks.every((st) => st.state === 'sealed')) && (
          <div className="claim-bar is-note">
            <div className="claim-bar-info">
              <span className="claim-bar-name">{entry.char.name}</span>
              <span className="claim-bar-value" title="Credit value">{fmt(entry.char.creditValue)}</span>
            </div>
            <span className="claim-bar-note">
              {entry.autoSold
                ? 'sold on arrival, as you asked'
                : entry.fresh
                  ? 'yours, and in your collection'
                  : entry.compensation > 0
                    ? `another copy — compensated ${fmt(entry.compensation)} credits`
                    : 'bound to your collection'}
            </span>
          </div>
        )}

        {s.rolled.length > 1 && !s.rolling && !pack && (
          <div className="sort-row" role="group" aria-label="Spread order">
            <span className="sort-label">Order</span>
            <button
              className={`chip ${s.rollSort === 'dealt' ? 'active' : ''}`}
              onClick={() => s.setRollSort('dealt')}
            >
              As dealt
            </button>
            <button
              className={`chip ${s.rollSort === 'rarity' ? 'active' : ''}`}
              onClick={() => s.setRollSort('rarity')}
            >
              Best first
            </button>
          </div>
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
