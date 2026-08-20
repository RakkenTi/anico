import { useCallback, useEffect, useRef, useState } from 'react'
import { useGame } from '../game/store'
import type { RollResult } from '../api'
import CharacterCard from './CharacterCard'

/** Drag distance that counts as a finished tear, and as a thrown card. */
const TEAR_PX = 150
const THROW_PX = 90
/** How long a thrown card takes to leave, and an auto-tear to finish. */
const THROW_MS = 300
const AUTOTEAR_MS = 420

interface Props {
  pack: { state: 'sealed' | 'sliced' | 'open'; revealed: number; claimed: number; bonus: number }
  cards: RollResult[]
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * A ten-card pack, opened by hand.
 *
 * The wrapper tears under the cursor rather than on a click: the lid follows
 * the drag and only comes away once it has travelled far enough, so a hesitant
 * pull springs back. Underneath, the cards are face up from the start and
 * stacked with each one peeking past the last; you throw the top card aside to
 * get at the next.
 *
 * None of it decides anything. The whole pack was granted server-side the
 * moment it was rolled, so this is the ceremony of opening one and quitting
 * halfway costs nothing.
 */
export default function PackOpener({ pack, cards }: Props) {
  const tearPack = useGame((s) => s.tearPack)
  const slicePack = useGame((s) => s.slicePack)
  const revealNext = useGame((s) => s.revealNext)

  const sealed = pack.state === 'sealed'
  const thrown = pack.revealed
  const remaining = cards.length - thrown

  /* ------------------------------------------------------------- tearing */

  // 0 is sealed, 1 is off. Driven straight from the pointer while dragging.
  const [tear, setTear] = useState(0)
  const [tearOff, setTearOff] = useState({ x: 0, y: 0 })
  const raf = useRef(0)

  const animateTear = useCallback(
    (from: number, to: number, ms: number, done?: () => void) => {
      cancelAnimationFrame(raf.current)
      const start = performance.now()
      const step = (now: number) => {
        const t = clamp((now - start) / ms, 0, 1)
        const eased = 1 - Math.pow(1 - t, 3)
        setTear(from + (to - from) * eased)
        if (t < 1) raf.current = requestAnimationFrame(step)
        else done?.()
      }
      raf.current = requestAnimationFrame(step)
    },
    [],
  )
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  // Space is the shortcut for people who would rather not drag anything.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const el = document.activeElement
      if (el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      e.preventDefault()
      if (sealed) {
        setTearOff({ x: 40, y: -30 })
        animateTear(tear, 1, AUTOTEAR_MS, slicePack)
      } else {
        tearPack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sealed, tear, animateTear, slicePack, tearPack])

  /* ------------------------------------------------- throwing cards off */

  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [flying, setFlying] = useState<{ x: number; rot: number } | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const surface = useRef<HTMLDivElement>(null)

  const throwCard = useCallback(
    (dir: number) => {
      if (flying) return
      setFlying({ x: dir * 780, rot: dir * 24 })
      setDrag(null)
      window.setTimeout(() => {
        setFlying(null)
        revealNext()
      }, THROW_MS)
    },
    [flying, revealNext],
  )

  const onPointerDown = (e: React.PointerEvent) => {
    if (flying) return
    origin.current = { x: e.clientX, y: e.clientY }
    surface.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!origin.current) return
    const dx = e.clientX - origin.current.x
    const dy = e.clientY - origin.current.y
    if (sealed) {
      // The lid comes away along whichever direction the pull is going.
      setTearOff({ x: dx, y: dy })
      setTear(clamp(Math.hypot(dx, dy) / TEAR_PX, 0, 1))
    } else {
      setDrag({ x: dx, y: dy })
    }
  }

  const release = (e: React.PointerEvent) => {
    if (!origin.current) return
    const start = origin.current
    origin.current = null
    surface.current?.releasePointerCapture(e.pointerId)
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    const moved = Math.hypot(dx, dy)

    if (sealed) {
      if (tear >= 0.6) animateTear(tear, 1, 160, slicePack)
      else animateTear(tear, 0, 220)
      return
    }
    // A tap counts: swiping is the flourish, not a toll, and it is awkward
    // with a mouse and impossible from a keyboard.
    if (Math.abs(dx) > THROW_PX) throwCard(Math.sign(dx))
    else if (moved < 8) throwCard(1)
    else setDrag(null)
  }

  const top = cards[thrown]
  const style = flying
    ? { transform: `translate3d(${flying.x}px, -40px, 0) rotate(${flying.rot}deg)`, opacity: 0 }
    : drag
      ? { transform: `translate3d(${drag.x}px, ${drag.y * 0.35}px, 0) rotate(${drag.x * 0.045}deg)` }
      : undefined

  return (
    <div className="pack-opener">
      <div
        className={`pack-area ${sealed ? 'sealed' : ''}`}
        ref={surface}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={() => {
          origin.current = null
          if (sealed) animateTear(tear, 0, 200)
          else setDrag(null)
        }}
        style={{ ['--tear' as string]: tear }}
      >
        {/* The stack sits under the wrapper the whole time, so tearing reveals
            it rather than swapping one thing for another. */}
        {/* The cards behind sit absolutely, so only the top one carries height
            and the stack is exactly as tall as a real card. */}
        <div className="pack-stack">
          {cards
            .slice(thrown + 1)
            .map((card, i) => (
              <div
                key={`${card.char.id}-${thrown + 1 + i}`}
                className="pack-card behind"
                style={{ ['--depth' as string]: i + 1, zIndex: cards.length - (i + 1) }}
                aria-hidden="true"
              >
                <CharacterCard character={card.char} wished={card.wished} />
              </div>
            ))
            .reverse()}
          {top && (
            <div
              className={`pack-card top ${flying ? 'flying' : ''}`}
              style={{ ['--depth' as string]: 0, zIndex: cards.length + 1, ...style }}
            >
              <CharacterCard character={top.char} wished={top.wished} />
            </div>
          )}
        </div>

        {sealed && (
          <div className="pack-wrap" aria-hidden="true">
            <span className="pack-body" />
            <span
              className="pack-lid"
              style={{
                transform: `translate3d(${tearOff.x * tear}px, ${tearOff.y * tear - tear * 70}px, 0) rotate(${tearOff.x * tear * 0.06}deg)`,
                opacity: 1 - tear * 0.85,
              }}
            >
              <span className="pack-brand">ANICO</span>
            </span>
            <span className="pack-rip" />
          </div>
        )}
      </div>

      <p className="pack-hint">
        {sealed ? (
          <>
            Drag across the pack to tear it open, or press <kbd>Space</kbd>.
          </>
        ) : (
          <>
            <b>{remaining}</b> of {cards.length} left — swipe the top card away, or{' '}
            <kbd>Space</kbd> to lay them all out.
          </>
        )}
      </p>
    </div>
  )
}
