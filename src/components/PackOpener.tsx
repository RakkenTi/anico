import { useCallback, useEffect, useRef, useState } from 'react'
import { useGame } from '../game/store'
import { rarityOf } from '../game/economy'
import { flapPath, foilPath } from '../game/tear'
import type { RollResult } from '../api'
import CharacterCard from './CharacterCard'

/**
 * Pointer travel that finishes a tear. Accumulated rather than measured from
 * where the drag began: a tear does not undo itself when your hand comes back,
 * so sawing at it works exactly as it does on a real wrapper.
 */
const TEAR_PX = 320
/** How far along the rip has to be, on release, to finish by itself. */
const TEAR_COMMIT = 0.5
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
  // Foil takes its colour from the best card in the pack. It gives nothing
  // away that matters -- everything inside is already claimed -- but a pack
  // with something good in it ought to look like one.
  const best = cards.reduce((m, c) => Math.max(m, c.char.creditValue), 0)
  const rarity = rarityOf(best).key
  const thrown = pack.revealed
  const remaining = cards.length - thrown

  /* ------------------------------------------------------------- tearing */

  // How far the rip has travelled across the seam, 0 to 1.
  const [tear, setTear] = useState(0)
  const tearRef = useRef(0)
  const raf = useRef(0)

  const setTearBoth = (v: number) => {
    tearRef.current = v
    setTear(v)
  }

  const animateTear = useCallback((to: number, ms: number, done?: () => void) => {
    cancelAnimationFrame(raf.current)
    const from = tearRef.current
    const start = performance.now()
    const step = (now: number) => {
      const t = clamp((now - start) / ms, 0, 1)
      const v = from + (to - from) * (1 - Math.pow(1 - t, 3))
      tearRef.current = v
      setTear(v)
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

  /**
   * Open the whole thing. Space does this from sealed, and so does the button,
   * which is the only way to reach it on a phone: there is no space bar there,
   * and tapping the stack deliberately means one card at a time.
   */
  const openAll = useCallback(() => {
    if (sealed) {
      setSpaceTore(true)
      animateTear(1, AUTOTEAR_MS, () => {
        slicePack()
        autoOpen()
      })
    } else {
      autoOpen()
    }
  }, [sealed, animateTear, slicePack, autoOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const el = document.activeElement
      if (el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      e.preventDefault()
      if (sealed) openAll()
      else if (!spaceTore) throwTop(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sealed, spaceTore, openAll, throwTop])

  // The grid waits for the last card to actually land.
  useEffect(() => {
    if (pack.state === 'sliced' && thrown >= cards.length && departing.length === 0) tearPack()
  }, [pack.state, thrown, cards.length, departing.length, tearPack])

  /* -------------------------------------------------------------- input */

  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const surface = useRef<HTMLDivElement>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    origin.current = { x: e.clientX, y: e.clientY }
    last.current = { x: e.clientX, y: e.clientY }
    surface.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!origin.current) return
    if (sealed) {
      // Every millimetre the pointer travels feeds the rip, in any direction.
      // Torn foil does not knit itself back together when the hand comes back,
      // so pulling, sawing and scrubbing all make progress.
      const prev = last.current ?? origin.current
      const travel = Math.hypot(e.clientX - prev.x, e.clientY - prev.y)
      last.current = { x: e.clientX, y: e.clientY }
      setTearBoth(clamp(tearRef.current + travel / TEAR_PX, 0, 1))
      return
    }
    const dx = e.clientX - origin.current.x
    const dy = e.clientY - origin.current.y
    setDrag({ x: dx, y: dy })
  }

  const release = (e: React.PointerEvent) => {
    const start = origin.current
    if (!start) return
    origin.current = null
    surface.current?.releasePointerCapture(e.pointerId)
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y

    // Past halfway the rip has committed and finishes on its own; short of
    // that the wrapper closes back up. Pulling accumulates while the hand is
    // down, so a hesitant tug can still be carried over the line by sawing at
    // it rather than being punished for stopping.
    if (sealed) {
      last.current = null
      if (tearRef.current >= TEAR_COMMIT) animateTear(1, 190, slicePack)
      else animateTear(0, 260)
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
        className={`pack-area foil-${rarity} ${sealed ? 'is-sealed' : ''}`}
        ref={surface}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={() => {
          origin.current = null
          last.current = null
          if (!sealed) setDrag(null)
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
            {/* One piece of foil, clipped to whatever the rip has left of it.
                Seamless until torn, because there is no seam to see yet. */}
            <span className="pack-foil" style={{ clipPath: foilPath(tear) }}>
              <span className="pack-strip" />
              <span className="pack-mark">
                <span className="pack-brand">ANICO</span>
                <span className="pack-sub">{cards.length} cards</span>
              </span>
            </span>
            {/* The strip coming away, curling as it goes. */}
            <span
              className="pack-flap"
              style={{
                clipPath: flapPath(tear),
                transform: `translate3d(${-tear * 10}px, ${-tear * 26}px, 0) rotate(${-tear * 5}deg)`,
                // Torn foil is still foil: it stays solid until it is nearly
                // away, rather than going translucent over the cards it covers.
                opacity: tear > 0.82 ? Math.max(0, 1 - (tear - 0.82) * 4) : 1,
              }}
            >
              <span className="pack-strip" />
            </span>
            <span className="pack-glint" style={{ opacity: tear > 0 && tear < 1 ? 1 : 0 }} />
          </div>
        )}
      </div>

      <p className="pack-hint">
        {sealed ? (
          <>
            Drag across the pack to tear it open.
          </>
        ) : (
          <>
            <b>{remaining}</b> of {cards.length} left — swipe or tap the top card away
            {spaceTore ? '.' : <>, or <kbd>Space</kbd> for one at a time.</>}
          </>
        )}
      </p>

      <button className="btn btn-quiet pack-skip" onClick={openAll}>
        {sealed ? 'Tear it open' : 'Open the rest'}
        <kbd aria-hidden="true">Space</kbd>
      </button>
    </div>
  )
}
