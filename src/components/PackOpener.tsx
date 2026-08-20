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
/** Delay between one wrapper starting to tear and the next. */
const STAGGER_MS = 130

/**
 * How long the machine is allowed to spend emptying one pull, in seconds.
 *
 * Swift Hands buys cards a second, and a pull that outruns that budget is laid
 * out at once instead of thrown card by card. Two hundred cards at four a
 * second is fifty seconds of watching a pack whose contents were settled
 * before the wrapper came off; the throw is a flourish, not a toll.
 */
const THROW_BUDGET_S = 6
/** Even a slow pair of hands throws this many rather than skipping the show. */
const THROW_FLOOR = 12

interface Props {
  pack: NonNullable<ReturnType<typeof useGame.getState>['pack']>
  cards: RollResult[]
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * The packs, opened by hand.
 *
 * One wrapper per pack, side by side: Both Hands buys *packs*, and a pull of
 * four used to arrive as one stack four times as tall, which is the one thing
 * that upgrade should never look like. Each wrapper is opaque until it is
 * torn, tears under the pointer rather than on a click, and holds its own
 * stack of face-up cards that are thrown aside one at a time.
 *
 * Nothing here decides anything: every card in every pack was granted the
 * moment the pull was made. This is the unwrapping.
 */
export default function PackOpener({ pack, cards }: Props) {
  const autoSpin = useGame((s) => s.autoSpin)
  const cardRate = useGame((s) => s.cardRate)
  /**
   * Which pull these wrappers belong to.
   *
   * Part of each stack's key, so a pull gets its own components. Without it
   * React reuses the stack at index 0 from one pull to the next, and a stack
   * keeps how far it was torn: the second pull's wrapper arrived already in
   * pieces, seam and flap gone, while the game still called it sealed.
   */
  const gen = useGame((s) => s.rollCount)

  /**
   * Whether the whole pull gets thrown card by card, or laid out at once.
   *
   * One decision for the whole pull rather than per pack, so four packs of
   * fifty do not each decide they are small enough to animate.
   */
  const budget = Math.max(THROW_FLOOR, Math.round(cardRate * THROW_BUDGET_S))
  const instant = cards.length > budget
  // Cards a second *per stack*, so the pull as a whole empties at the rate
  // Swift Hands promises however many wrappers it arrived in.
  const stepMs = Math.max(24, Math.round((1000 * pack.stacks.length) / Math.max(1, cardRate)))

  /** Set once the player (or the machine) has asked for the whole thing. */
  const [auto, setAuto] = useState(false)
  const running = auto || autoSpin

  /**
   * Finish the whole pull without being asked again.
   *
   * Never a jump cut: the wrappers still come off on screen even when the
   * cards inside are too many to throw one at a time. The Automaton arrives
   * here as well, which is why it looks like somebody playing rather than a
   * number going up.
   */
  const openAll = useCallback(() => setAuto(true), [])

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

  const left = pack.stacks.reduce(
    (n, st, i) => n + Math.max(0, Math.min(pack.perPack, cards.length - i * pack.perPack) - st.revealed),
    0,
  )
  const anySealed = pack.stacks.some((st) => st.state === 'sealed')

  return (
    <div className="pack-opener">
      <div className={`pack-grid packs-${Math.min(pack.stacks.length, 6)}`}>
        {pack.stacks.map((st, i) => (
          <PackStack
            key={`${gen}-${i}`}
            index={i}
            state={st.state}
            thrown={st.revealed}
            cards={cards.slice(i * pack.perPack, (i + 1) * pack.perPack)}
            auto={running}
            instant={instant}
            stepMs={stepMs}
          />
        ))}
      </div>

      <p className="pack-hint">
        {anySealed ? (
          pack.stacks.length > 1 ? (
            <>Drag across a pack to tear it open — or take all {pack.stacks.length} at once.</>
          ) : (
            <>Drag across the pack to tear it open.</>
          )
        ) : (
          <>
            <b>{left}</b> of {cards.length} left — swipe or tap a top card away
            {running ? '.' : <>, or <kbd>Space</kbd> to throw the rest.</>}
          </>
        )}
      </p>

      <button className="btn btn-quiet pack-skip" onClick={openAll}>
        {anySealed
          ? pack.stacks.length > 1
            ? `Tear all ${pack.stacks.length} open`
            : 'Tear it open'
          : 'Open the rest'}
        <kbd aria-hidden="true">Space</kbd>
      </button>
    </div>
  )
}

/* --------------------------------------------------------------- one pack */

interface StackProps {
  index: number
  state: 'sealed' | 'sliced' | 'open'
  thrown: number
  cards: RollResult[]
  /** The machine (or Space) is emptying this pack without being asked again. */
  auto: boolean
  /** Too many cards to throw one by one: lay them out once the foil is off. */
  instant: boolean
  /** Milliseconds between automatic throws from this stack. */
  stepMs: number
}

function PackStack({ index, state, thrown, cards, auto, instant, stepMs }: StackProps) {
  const slicePack = useGame((s) => s.slicePack)
  const tearPack = useGame((s) => s.tearPack)

  const sealed = state === 'sealed'
  // Foil takes its colour from the best card in the pack. It gives nothing
  // away that matters -- everything inside is already claimed -- but a pack
  // with something good in it ought to look like one.
  const best = cards.reduce((m, c) => Math.max(m, c.char.creditValue), 0)
  const rarity = rarityOf(best).key
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

  // Cards mid-flight, keyed by their index in this pack. The stack has already
  // moved past them; these are only here to finish leaving.
  const [departing, setDeparting] = useState<
    { key: number; dir: number; fromX: number; fromY: number; fromRot: number }[]
  >([])

  const throwTop = useCallback(
    (dir: number, from = { x: 0, y: 0, rot: 0 }) => {
      const st = useGame.getState()
      const mine = st.pack?.stacks[index]
      if (!mine || mine.state !== 'sliced') return
      const idx = mine.revealed
      if (idx >= stackCards(st, index).length) return
      setDeparting((d) => [...d, { key: idx, dir, fromX: from.x, fromY: from.y, fromRot: from.rot }])
      st.revealNext(index)
      window.setTimeout(() => setDeparting((d) => d.filter((x) => x.key !== idx)), THROW_MS)
    },
    [index],
  )

  /**
   * Hands-off opening: tear the wrapper, then flick the stack away in a quick
   * alternating fan. Both the Automaton and Space arrive here, which is why
   * the machine looks like somebody playing rather than a number going up.
   */
  const timer = useRef(0)
  useEffect(() => {
    if (!auto) return
    let i = 0
    const throwLoop = () => {
      const st = useGame.getState()
      const mine = st.pack?.stacks[index]
      if (!mine || mine.state !== 'sliced' || mine.revealed >= stackCards(st, index).length) return
      throwTop(i % 2 === 0 ? 1 : -1)
      i++
      timer.current = window.setTimeout(throwLoop, stepMs)
    }
    // Past the throwing budget the cards land in the spread all at once. The
    // foil still comes off first: a pack that is simply replaced by a grid
    // never looks opened, it looks skipped.
    const empty = () => (instant ? tearPack(index) : throwLoop())
    const begin = () => {
      if (useGame.getState().pack?.stacks[index]?.state === 'sealed') {
        animateTear(1, AUTOTEAR_MS, () => {
          slicePack(index)
          empty()
        })
      } else {
        empty()
      }
    }
    // Wrappers come off one after another rather than all in the same frame:
    // four packs tearing in perfect unison reads as one animation, not four.
    timer.current = window.setTimeout(begin, index * STAGGER_MS)
    return () => clearTimeout(timer.current)
  }, [auto, index, instant, stepMs, animateTear, slicePack, tearPack, throwTop])
  useEffect(() => () => clearTimeout(timer.current), [])

  // This pack is done once its last card has actually landed.
  useEffect(() => {
    if (state === 'sliced' && thrown >= cards.length && departing.length === 0) tearPack(index)
  }, [state, thrown, cards.length, departing.length, tearPack, index])

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
      if (tearRef.current >= TEAR_COMMIT) animateTear(1, 190, () => slicePack(index))
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

  // Only the top of the stack is ever visible, so only the top of the stack is
  // mounted. The rest is a number, and a depth marker under the corner.
  const behind = cards.slice(thrown + 1, thrown + 1 + STACK_RENDER_DEPTH)

  return (
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
