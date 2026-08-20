import { useCallback, useEffect, useRef, useState } from 'react'
import { useGame, stackCards } from '../game/store'
import { rarityOf } from '../game/economy'
import { STACK_RENDER_DEPTH } from '../game/upgrades'
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
/** How long a card takes to leave, once thrown. */
const THROW_MS = 320
const AUTOTEAR_MS = 420

/**
 * The longest a pull may take to empty, in seconds.
 *
 * Open Speed buys cards a second and that is what it delivers: a hundred cards
 * at twelve a second take eight seconds, and the next level makes them take
 * six. Only when the pack has outgrown the hands entirely does this cap bind.
 */
const MAX_OPEN_S = 8
/** Below this the browser cannot draw a frame per swipe, so they leave in twos. */
const MIN_STEP_MS = 28

interface Props {
  pack: NonNullable<ReturnType<typeof useGame.getState>['pack']>
  cards: RollResult[]
}

interface Departing {
  stack: number
  key: number
  dir: number
  fromX: number
  fromY: number
  fromRot: number
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * The packs, opened by hand.
 *
 * One gesture for the whole pull, not one per pack. Every wrapper tears
 * together under a single drag, and every swipe afterwards takes the top card
 * off all of them at once. Five packs on a phone are five stacks about a
 * thumb-and-a-half wide: aiming at one of them to tear it, and then aiming at
 * each in turn to empty it, is a chore that gets worse the more packs you buy,
 * which is precisely backwards for an upgrade you paid for.
 *
 * Nothing here decides anything: every card in every pack was granted the
 * moment the pull was made. This is the unwrapping.
 */
export default function PackOpener({ pack, cards }: Props) {
  const slicePack = useGame((s) => s.slicePack)
  const tearPack = useGame((s) => s.tearPack)
  const autoSpin = useGame((s) => s.autoSpin)
  const cardRate = useGame((s) => s.cardRate)
  /**
   * Which pull these wrappers belong to.
   *
   * Part of each stack's key, so a pull gets its own components. Without it
   * React reuses the stack at index 0 from one pull to the next and it keeps
   * how far it was torn.
   */
  const gen = useGame((s) => s.rollCount)

  const stacks = Math.max(1, pack.stacks.length)
  /*
   * The cadence, for the pull as a whole.
   *
   * One swipe takes a card off every stack, so a swipe is `stacks` cards and
   * the gap between swipes is what makes the pull empty at the promised rate.
   * The cap only ever raises the rate, never lowers it.
   */
  const rate = Math.max(1, cardRate, cards.length / MAX_OPEN_S)
  const rawStep = (1000 * stacks) / rate
  const batch = rawStep >= MIN_STEP_MS ? 1 : Math.ceil(MIN_STEP_MS / rawStep)
  const stepMs = Math.max(MIN_STEP_MS, Math.round(rawStep * batch))

  const anySealed = pack.stacks.some((st) => st.state === 'sealed')
  const left = pack.stacks.reduce(
    (n, st, i) => n + Math.max(0, Math.min(pack.perPack, cards.length - i * pack.perPack) - st.revealed),
    0,
  )

  /* ------------------------------------------------------------- tearing */

  // How far the rip has travelled across the seam, 0 to 1. Shared: one rip
  // runs across every wrapper in the pull.
  const [tear, setTear] = useState(0)
  const tearRef = useRef(0)
  const raf = useRef(0)

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

  const sliceAll = useCallback(() => {
    const st = useGame.getState()
    st.pack?.stacks.forEach((s, i) => {
      if (s.state === 'sealed') slicePack(i)
    })
  }, [slicePack])

  /* ------------------------------------------------- throwing cards away */

  const [departing, setDeparting] = useState<Departing[]>([])

  /** Take the top card off every stack that still has one. */
  const throwLayer = useCallback((dir: number, from = { x: 0, y: 0, rot: 0 }) => {
    const st = useGame.getState()
    if (!st.pack) return 0
    const going: Departing[] = []
    st.pack.stacks.forEach((s, i) => {
      if (s.state !== 'sliced') return
      if (s.revealed >= stackCards(st, i).length) return
      going.push({ stack: i, key: s.revealed, dir, fromX: from.x, fromY: from.y, fromRot: from.rot })
      st.revealNext(i)
    })
    if (going.length === 0) return 0
    setDeparting((d) => [...d, ...going])
    window.setTimeout(
      () => setDeparting((d) => d.filter((x) => !going.some((g) => g.stack === x.stack && g.key === x.key))),
      THROW_MS,
    )
    return going.length
  }, [])

  /* ------------------------------------------- hands off: Space, and the machine */

  const [auto, setAuto] = useState(false)
  const running = auto || autoSpin
  const openAll = useCallback(() => setAuto(true), [])

  const timer = useRef(0)
  useEffect(() => {
    if (!running) return
    let i = 0
    const loop = () => {
      let moved = 0
      for (let n = 0; n < batch; n++) {
        moved += throwLayer(i % 2 === 0 ? 1 : -1)
        i++
      }
      if (moved === 0) return
      timer.current = window.setTimeout(loop, stepMs)
    }
    if (useGame.getState().pack?.stacks.some((s) => s.state === 'sealed')) {
      animateTear(1, AUTOTEAR_MS, () => {
        sliceAll()
        loop()
      })
    } else {
      loop()
    }
    return () => clearTimeout(timer.current)
  }, [running, batch, stepMs, animateTear, sliceAll, throwLayer])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const el = document.activeElement
      if (el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      e.preventDefault()
      // Space always means "finish it": from sealed it tears every wrapper and
      // empties them, and mid-open it takes over the throwing.
      openAll()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openAll])

  // A pack is done once its last card has actually landed.
  useEffect(() => {
    const st = useGame.getState()
    st.pack?.stacks.forEach((s, i) => {
      if (s.state !== 'sliced') return
      if (s.revealed < stackCards(st, i).length) return
      if (departing.some((d) => d.stack === i)) return
      tearPack(i)
    })
  }, [pack, departing, tearPack])

  /* -------------------------------------------------------------- input */

  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const surface = useRef<HTMLDivElement>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (running) return
    origin.current = { x: e.clientX, y: e.clientY }
    last.current = { x: e.clientX, y: e.clientY }
    surface.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!origin.current) return
    if (anySealed) {
      // Every millimetre the pointer travels feeds the rip, in any direction.
      // Torn foil does not knit itself back together when the hand comes back,
      // so pulling, sawing and scrubbing all make progress.
      const prev = last.current ?? origin.current
      const travel = Math.hypot(e.clientX - prev.x, e.clientY - prev.y)
      last.current = { x: e.clientX, y: e.clientY }
      const v = clamp(tearRef.current + travel / TEAR_PX, 0, 1)
      tearRef.current = v
      setTear(v)
      return
    }
    setDrag({ x: e.clientX - origin.current.x, y: e.clientY - origin.current.y })
  }

  const release = (e: React.PointerEvent) => {
    const start = origin.current
    if (!start) return
    origin.current = null
    surface.current?.releasePointerCapture(e.pointerId)
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y

    // Past halfway the rip has committed and finishes on its own; short of
    // that the wrappers close back up.
    if (anySealed) {
      last.current = null
      if (tearRef.current >= TEAR_COMMIT) animateTear(1, 190, sliceAll)
      else animateTear(0, 260)
      return
    }
    setDrag(null)
    if (Math.abs(dx) > THROW_PX) {
      throwLayer(Math.sign(dx), { x: dx, y: dy * 0.35, rot: dx * 0.045 })
    } else if (Math.hypot(dx, dy) < 8) {
      // A tap counts. Swiping is the flourish, not a toll, and it is awkward
      // with a mouse and impossible from a keyboard.
      throwLayer(1)
    }
  }

  return (
    <div className="pack-opener">
      <div
        className={`pack-grid packs-${Math.min(stacks, 6)} ${anySealed ? 'is-sealed' : ''}`}
        ref={surface}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={() => {
          origin.current = null
          last.current = null
          setDrag(null)
        }}
        style={{ ['--tear' as string]: tear }}
        role="button"
        tabIndex={0}
        aria-label={anySealed ? 'Sealed packs: drag to tear them open' : `${left} cards left`}
      >
        {pack.stacks.map((st, i) => (
          <PackStack
            key={`${gen}-${i}`}
            state={st.state}
            thrown={st.revealed}
            cards={cards.slice(i * pack.perPack, (i + 1) * pack.perPack)}
            tear={tear}
            drag={drag}
            departing={departing.filter((d) => d.stack === i)}
          />
        ))}
      </div>

      <p className="pack-hint">
        {anySealed ? (
          stacks > 1 ? (
            <>Drag anywhere to tear all {stacks} open.</>
          ) : (
            <>Drag across the pack to tear it open.</>
          )
        ) : (
          <>
            <b>{left}</b> of {cards.length} left. Swipe or tap to take one off
            {stacks > 1 ? ' every stack' : ''}.
          </>
        )}
      </p>

      <button className="btn btn-quiet pack-skip" onClick={openAll}>
        {anySealed ? (stacks > 1 ? `Tear all ${stacks} open` : 'Tear it open') : 'Open the rest'}
        <kbd aria-hidden="true">Space</kbd>
      </button>
    </div>
  )
}

/* --------------------------------------------------------------- one pack */

interface StackProps {
  state: 'sealed' | 'sliced' | 'open'
  thrown: number
  cards: RollResult[]
  tear: number
  drag: { x: number; y: number } | null
  departing: Departing[]
}

/** One wrapper and its pile. Gestures belong to the grid, not to this. */
function PackStack({ state, thrown, cards, tear, drag, departing }: StackProps) {
  const sealed = state === 'sealed'
  // Foil takes its colour from the best card in the pack. It gives nothing
  // away that matters -- everything inside is already claimed -- but a pack
  // with something good in it ought to look like one.
  const best = cards.reduce((m, c) => Math.max(m, c.char.creditValue), 0)
  const rarity = rarityOf(best).key
  const remaining = cards.length - thrown
  const top = cards[thrown]
  const topStyle = drag
    ? {
        transform: `translate3d(${drag.x}px, ${drag.y * 0.35}px, 0) rotate(${drag.x * 0.045}deg)`,
        transition: 'none',
      }
    : undefined
  // Only the top of the stack is ever visible, so only the top of the stack is
  // mounted. The rest is a number under the corner.
  const behind = cards.slice(thrown + 1, thrown + 1 + STACK_RENDER_DEPTH)

  return (
    <div className={`pack-area foil-${rarity} ${sealed ? 'is-sealed' : ''}`}>
      <div className="pack-stack">
        {behind
          .map((card, i) => (
            <div
              key={`${card.char.id}-${thrown + 1 + i}`}
              className="pack-card behind"
              style={{ ['--depth' as string]: i + 1, zIndex: behind.length - (i + 1) }}
              aria-hidden="true"
            >
              <CharacterCard character={card.char} wished={card.wished} />
            </div>
          ))
          .reverse()}

        {top && (
          <div
            className="pack-card top"
            style={{ ['--depth' as string]: 0, zIndex: behind.length + 1, ...topStyle }}
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
              zIndex: behind.length + 2 + d.key,
            }}
            aria-hidden="true"
          >
            <CharacterCard character={cards[d.key].char} wished={cards[d.key].wished} />
          </div>
        ))}

        {!sealed && remaining > 1 && <span className="pack-left">{remaining}</span>}
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
  )
}
