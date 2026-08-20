import { useEffect, useRef } from 'react'
import { useGame } from '../game/store'
import type { RollResult } from '../api'
import CharacterCard from './CharacterCard'

/** How far a drag has to travel before it counts as a swipe. */
const SWIPE_PX = 70

interface Props {
  pack: { state: 'sealed' | 'sliced' | 'open'; revealed: number; claimed: number; bonus: number }
  count: number
  cards: RollResult[]
}

/**
 * A ten-card pack, opened the way a physical one is.
 *
 * Two ways in, both ending in the same place because the cards are already the
 * player's either way: space tears the whole thing open at once, or a swipe
 * cuts the wrapper and each card is then slid off the top of the stack.
 *
 * Nothing here decides anything. The spread was rolled and claimed server-side
 * before this component ever mounted; this is the ceremony, and closing the tab
 * halfway through costs nothing.
 */
export default function PackOpener({ pack, count, cards }: Props) {
  const slicePack = useGame((s) => s.slicePack)
  const tearPack = useGame((s) => s.tearPack)
  const revealNext = useGame((s) => s.revealNext)

  const sealed = pack.state === 'sealed'
  const remaining = count - pack.revealed

  // Space is the shortcut for "just show me everything".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const el = document.activeElement
      if (el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      e.preventDefault()
      tearPack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tearPack])

  // One drag handler for both stages: it cuts the wrapper, then slides cards.
  const drag = useRef<{ x: number; y: number } | null>(null)
  const surface = useRef<HTMLDivElement>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY }
    surface.current?.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const dx = e.clientX - drag.current.x
    const dy = e.clientY - drag.current.y
    if (Math.hypot(dx, dy) < SWIPE_PX) return
    drag.current = null
    surface.current?.releasePointerCapture(e.pointerId)
    if (sealed) slicePack()
    else revealNext()
  }
  const onPointerUp = (e: React.PointerEvent) => {
    // A tap that never became a swipe still advances: swiping is the flourish,
    // not a toll, and it is awkward with a mouse and impossible with a keyboard.
    if (drag.current) {
      drag.current = null
      surface.current?.releasePointerCapture(e.pointerId)
      if (sealed) slicePack()
      else revealNext()
    }
  }

  return (
    <div className="pack-opener">
      <div
        className={`pack ${pack.state}`}
        ref={surface}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        role="button"
        tabIndex={0}
        aria-label={
          sealed ? 'Sealed pack: swipe to slice it open' : `Swipe to reveal card ${pack.revealed + 1} of ${count}`
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (sealed) slicePack()
            else revealNext()
          }
        }}
      >
        {sealed ? (
          <div className="pack-wrap">
            <span className="pack-foil" aria-hidden="true" />
            <span className="pack-brand">ANICO</span>
            <span className="pack-count">{count} cards</span>
            <span className="pack-tear" aria-hidden="true" />
          </div>
        ) : (
          <div className="pack-stack">
            {/* The cards still face down, deepest first so the top one sits on
                top. Only the top card is live; the rest are just thickness. */}
            {Array.from({ length: Math.max(remaining, 0) }, (_, i) => {
              const depth = remaining - 1 - i
              return (
                <div
                  key={depth}
                  className={`pack-card ${depth === 0 ? 'top' : ''}`}
                  style={{
                    ['--depth' as string]: depth,
                    zIndex: count - depth,
                  }}
                >
                  <span className="covered-glyph" aria-hidden="true">✦</span>
                </div>
              )
            })}
            {remaining <= 0 && <div className="pack-empty">wrapper</div>}
          </div>
        )}
      </div>

      <div className="pack-side">
        {pack.revealed > 0 && cards[pack.revealed - 1] && (
          <div className="pack-latest" key={pack.revealed}>
            <CharacterCard
              character={cards[pack.revealed - 1].char}
              wished={cards[pack.revealed - 1].wished}
            />
          </div>
        )}
        <p className="pack-hint">
          {sealed ? (
            <>
              A sealed pack of <b>{count}</b>. <kbd>Space</kbd> to tear it open, or swipe across
              it to slice the wrapper.
            </>
          ) : (
            <>
              <b>{remaining}</b> left. Swipe a card off the stack, or <kbd>Space</kbd> to take the
              rest at once.
            </>
          )}
        </p>
        <p className="pack-note">They are already yours either way.</p>
      </div>
    </div>
  )
}
