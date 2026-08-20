import { useCallback, useEffect, useRef, useState } from 'react'
import { useGame } from '../game/store'
import type { RollResult } from '../api'
import CharacterCard from './CharacterCard'

/** Drag distance that finishes a tear, and that counts as a thrown card. */
const TEAR_PX = 150
const THROW_PX = 80
/** How long a card takes to leave, and the gap between auto-thrown ones. */
const THROW_MS = 320
const AUTO_STEP_MS = 110
const AUTOTEAR_MS = 420

interface Props {
  pack: { state: 'sealed' | 'sliced' | 'open'; revealed: number; claimed: number; bonus: number }
  cards: RollResult[]
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * A ten-card pack, opened by hand.
 *
 * The wrapper is opaque until it is torn: what is inside is a surprise even
 * though the server settled it long ago, and the lid comes away under the
 * pointer rather than on a click. Underneath, the cards are face up in a stack
 * offset by a few pixels each, and the top one is thrown aside to reach the
 * next.
 *
 * Throws do not queue behind each other. Each departing card animates on its
 * own while the stack has already moved on, so a fast hand can send five cards
 * away before the first has landed.
 */
export default function PackOpener({ pack, cards }: Props) {
  const slicePack = useGame((s) => s.slicePack)
  const tearPack = useGame((s) => s.tearPack)

  const sealed = pack.state === 'sealed'
  const thrown = pack.revealed
  const remaining = cards.length - thrown

  /* ------------------------------------------------------------- tearing */

  const [tear, setTear] = useState(0)
  const [tearOff, setTearOff] = useState({ x: 0, y: 0 })
  const raf = useRef(0)

  const animateTear = useCallback((from: number, to: number, ms: number, done?: () => void) => {
    cancelAnimationFrame(raf.current)
    const start = performance.now()
    const step = (now: number) => {
      const t = clamp((now - start) / ms, 0, 1)
      setTear(from + (to - from) * (1 - Math.pow(1 - t, 3)))
      if (t < 1) raf.current = requestAnimationFrame(step)
      else done?.()
    }
    raf.current = requestAnimationFrame(step)
  }, [])
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  /* ------------------------------------------------- throwing cards away */

  // Cards mid-flight, keyed by their index in the spread. The stack has
  // already moved past them; these are only here to finish leaving.
  const [departing, setDeparting] = useState<
    { key: number; dir: number; fromX: number; fromY: number; fromRot: number }[]
  >([])

  const throwTop = useCallback(
    (dir: number, from = { x: 0, y: 0, rot: 0 }) => {
      const st = useGame.getState()
      if (!st.pack || st.pack.state !== 'sliced') return
      const idx = st.pack.revealed
      if (idx >= st.rolled.length) return
      setDeparting((d) => [
        ...d,
        { key: idx, dir, fromX: from.x, fromY: from.y, fromRot: from.rot },
      ])
      st.revealNext()
      window.setTimeout(() => setDeparting((d) => d.filter((x) => x.key !== idx)), THROW_MS)
    },
    [],
  )

  // Space: tear it, then flick the whole stack away in a quick alternating fan.
  const autoTimer = useRef(0)
  const autoOpen = useCallback(() => {
    let i = 0
    const step = () => {
      const st = useGame.getState()
      if (!st.pack || st.pack.state !== 'sliced' || st.pack.revealed >= st.rolled.length) return
      throwTop(i % 2 === 0 ? 1 : -1)
      i++
      autoTimer.current = window.setTimeout(step, AUTO_STEP_MS)
    }
    step()
  }, [throwTop])
  useEffect(() => () => clearTimeout(autoTimer.current), [])

  /**
   * Whether space opened this pack.
   *
   * Space asks for the whole thing to be done for you, and it only means that
   * if you say so before the wrapper is off. Tearing by hand is a statement
   * that you want to open it yourself, so from then on space is one card a
   * press rather than something that takes the pack away from you.
   */
  const [spaceTore, setSpaceTore] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const el = document.activeElement
      if (el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      e.preventDefault()
      if (sealed) {
        setSpaceTore(true)
        setTearOff({ x: 46, y: -26 })
        animateTear(tear, 1, AUTOTEAR_MS, () => {
          slicePack()
          autoOpen()
        })
      } else if (!spaceTore) {
        throwTop(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sealed, tear, spaceTore, animateTear, slicePack, autoOpen, throwTop])

  // The grid waits for the last card to actually land.
  useEffect(() => {
    if (pack.state === 'sliced' && thrown >= cards.length && departing.length === 0) tearPack()
  }, [pack.state, thrown, cards.length, departing.length, tearPack])

  /* -------------------------------------------------------------- input */

  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const surface = useRef<HTMLDivElement>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    origin.current = { x: e.clientX, y: e.clientY }
    surface.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!origin.current) return
    const dx = e.clientX - origin.current.x
    const dy = e.clientY - origin.current.y
    if (sealed) {
      setTearOff({ x: dx, y: dy })
      setTear(clamp(Math.hypot(dx, dy) / TEAR_PX, 0, 1))
    } else {
      setDrag({ x: dx, y: dy })
    }
  }

  const release = (e: React.PointerEvent) => {
    const start = origin.current
    if (!start) return
    origin.current = null
    surface.current?.releasePointerCapture(e.pointerId)
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y

    if (sealed) {
      if (tear >= 0.6) animateTear(tear, 1, 150, slicePack)
      else animateTear(tear, 0, 220)
      return
    }
    setDrag(null)
    if (Math.abs(dx) > THROW_PX) {
      throwTop(Math.sign(dx), { x: dx, y: dy * 0.35, rot: dx * 0.045 })
    } else if (Math.hypot(dx, dy) < 8) {
      // A tap counts. Swiping is the flourish, not a toll, and it is awkward
      // with a mouse and impossible from a keyboard.
      throwTop(1)
    }
  }

  const top = cards[thrown]
  const topStyle = drag
    ? {
        transform: `translate3d(${drag.x}px, ${drag.y * 0.35}px, 0) rotate(${drag.x * 0.045}deg)`,
        transition: 'none',
      }
    : undefined

  return (
    <div className="pack-opener">
      <div
        className={`pack-area ${sealed ? 'is-sealed' : ''}`}
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
        role="button"
        tabIndex={0}
        aria-label={sealed ? 'Sealed pack: drag to tear it open' : `${remaining} cards left`}
      >
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
              className="pack-card top"
              style={{ ['--depth' as string]: 0, zIndex: cards.length + 1, ...topStyle }}
            >
              <CharacterCard character={top.char} wished={top.wished} />
            </div>
          )}

          {/* Each of these is already off the stack; it is only finishing. */}
          {departing.map((d) => (
            <div
              key={d.key}
              className="pack-card departing"
              style={{
                ['--dir' as string]: d.dir,
                ['--from-x' as string]: `${d.fromX}px`,
                ['--from-y' as string]: `${d.fromY}px`,
                ['--from-rot' as string]: `${d.fromRot}deg`,
                zIndex: cards.length + 2 + d.key,
              }}
              aria-hidden="true"
            >
              <CharacterCard character={cards[d.key].char} wished={cards[d.key].wished} />
            </div>
          ))}
        </div>

        {sealed && (
          <div className="pack-wrap" aria-hidden="true">
            <span className="pack-body" />
            <span
              className="pack-lid"
              style={{
                transform: `translate3d(${tearOff.x * tear}px, ${tearOff.y * tear - tear * 90}px, 0) rotate(${tearOff.x * tear * 0.07}deg)`,
                opacity: 1 - tear * 0.9,
              }}
            >
              <span className="pack-strip" />
            </span>
            <span className="pack-mark">
              <span className="pack-brand">ANICO</span>
              <span className="pack-sub">{cards.length} cards</span>
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
            <b>{remaining}</b> of {cards.length} left — swipe or tap the top card away
            {spaceTore ? '.' : <>, or <kbd>Space</kbd> for one at a time.</>}
          </>
        )}
      </p>
    </div>
  )
}
