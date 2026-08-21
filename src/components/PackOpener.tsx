import { useCallback, useEffect, useRef, useState } from 'react'
import { useGame, stackCards } from '../game/store'
import { rarityOf } from '../game/economy'
import { stackDepth } from '../game/upgrades'
import { flapPath, foilPath } from '../game/tear'
import type { RollResult } from '../api'
import CharacterCard from './CharacterCard'
import { fmtCount } from '../game/format'

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
/**
 * How often a stack may update, at most.
 *
 * Every throw is a store write and a render of the whole view, so at a hundred
 * and fifty cards a second the browser spends longer re-rendering than
 * animating and the pull takes half again as long as the rate promised. Past
 * ten ticks a second the cards leave in twos and threes instead, which nobody
 * can tell apart at that speed and which the clock certainly can.
 */
const TICKS_PER_SECOND = 6
const MIN_STEP_MS = 28
/** Cards allowed to be mid-flight at once. They are decoration. */
const MAX_IN_FLIGHT = 16

/**
 * Columns for a given number of wrappers.
 *
 * As square as the count allows, and preferring a full last row: thirteen
 * packs went out as twelve and one, which reads as a mistake rather than a
 * layout. Five columns leaves 5/5/3, four leaves 4/4/4/1, so the widest
 * near-square arrangement with the fullest bottom row wins.
 */
function columnsFor(n: number): number {
  if (n <= 3) return n
  const root = Math.ceil(Math.sqrt(n))
  let best = root
  let bestScore = -1
  for (let cols = root; cols <= Math.min(n, root + 2); cols++) {
    const rows = Math.ceil(n / cols)
    const lastRow = n - (rows - 1) * cols
    // A full bottom row is worth most; after that, fewer rows.
    const score = (lastRow / cols) * 10 - rows
    if (score > bestScore) {
      bestScore = score
      best = cols
    }
  }
  return best
}
/**
 * Delay between one wrapper starting to tear itself open and the next.
 *
 * Shared out, so ten packs do not spend a second and a half getting started:
 * the point of the stagger is that they are not in lockstep, not that the last
 * one waits its turn.
 */
const STAGGER_TOTAL_MS = 600
const STAGGER_MAX_MS = 130

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
 * By hand, one gesture does the whole pull: every wrapper tears together under
 * a single drag, and every swipe afterwards takes the top card off all of them
 * at once. Five packs on a phone are five stacks about a thumb-and-a-half
 * wide, and aiming at each in turn is a chore that gets worse the more packs
 * you buy, which is backwards for an upgrade you paid for.
 *
 * Hands off, it is the opposite: Space, the button and Auto Summon open the
 * packs one at a time, each tearing a beat after the last and emptying at its
 * own pace. Nobody is aiming at anything, and a machine that unwraps five
 * packs in lockstep looks like one animation rather than five.
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
  const target = Math.max(MIN_STEP_MS, 1000 / TICKS_PER_SECOND)
  const batch = rawStep >= target ? 1 : Math.ceil(target / rawStep)
  const stepMs = Math.max(MIN_STEP_MS, Math.round(rawStep * batch))

  // The render budget is shared out: one stack shows ten cards deep, twenty
  // show three, and the browser mounts about the same number either way.
  const depth = stackDepth(stacks)
  const cols = columnsFor(stacks)
  const anySealed = pack.stacks.some((st) => st.state === 'sealed')

  /*
   * What a wrapper says, and what is behind it.
   *
   * A pack holds what the shop sold you -- two thousand cards, or twenty
   * thousand -- and dealing every one of them as a card is not a thing a
   * browser or a database should be asked to do. The cards that *are* dealt
   * stand in for the rest: throwing one takes its share of the pack with it,
   * and those are the cards the server appraises. So the count on a stack is
   * the real one and it drains to nothing, which is the only version of this
   * where the arithmetic on screen adds up.
   */
  const heldIn = (i: number) => {
    const dealtHere = Math.max(0, Math.min(pack.perPack, cards.length - i * pack.perPack))
    return { dealt: dealtHere, held: Math.max(dealtHere, pack.held) }
  }
  const leftIn = (i: number) => {
    const { dealt, held } = heldIn(i)
    const thrown = pack.stacks[i]?.revealed ?? 0
    if (dealt <= 0) return 0
    return Math.max(0, held - Math.round((thrown * held) / dealt))
  }
  const left = pack.stacks.reduce((n, _, i) => n + leftIn(i), 0)
  const heldTotal = pack.stacks.reduce((n, _, i) => n + heldIn(i).held, 0)

  /* ------------------------------------------------------------- tearing */

  /*
   * How far each rip has travelled across its seam, 0 to 1.
   *
   * One number per wrapper rather than one for the pull: a hand tears all of
   * them at once and writes the same value to every entry, and the machine
   * tears them one at a time and writes to one.
   */
  const [tears, setTears] = useState<number[]>(() => Array(stacks).fill(0))
  const tearsRef = useRef<number[]>(tears)
  const rafs = useRef<Map<number, number>>(new Map())

  const setTearAt = useCallback((which: number[], v: number) => {
    const next = [...tearsRef.current]
    for (const i of which) next[i] = v
    tearsRef.current = next
    setTears(next)
  }, [])

  const animateTear = useCallback(
    (which: number[], to: number, ms: number, done?: () => void) => {
      for (const i of which) {
        const running = rafs.current.get(i)
        if (running) cancelAnimationFrame(running)
      }
      const from = which.map((i) => tearsRef.current[i] ?? 0)
      const start = performance.now()
      const step = (now: number) => {
        const t = clamp((now - start) / ms, 0, 1)
        const next = [...tearsRef.current]
        which.forEach((i, n) => {
          next[i] = from[n] + (to - from[n]) * (1 - Math.pow(1 - t, 3))
        })
        tearsRef.current = next
        setTears(next)
        if (t < 1) {
          const id = requestAnimationFrame(step)
          for (const i of which) rafs.current.set(i, id)
        } else {
          for (const i of which) rafs.current.delete(i)
          done?.()
        }
      }
      const id = requestAnimationFrame(step)
      for (const i of which) rafs.current.set(i, id)
    },
    [],
  )
  useEffect(() => {
    const map = rafs.current
    return () => map.forEach((id) => cancelAnimationFrame(id))
  }, [])

  /** Every wrapper still on, for the gestures that mean "all of them". */
  const sealedNow = () =>
    (useGame.getState().pack?.stacks ?? []).flatMap((s, i) => (s.state === 'sealed' ? [i] : []))

  const sliceAll = useCallback(() => {
    for (const i of sealedNow()) slicePack(i)
  }, [slicePack])

  /* ------------------------------------------------- throwing cards away */

  const [departing, setDeparting] = useState<Departing[]>([])

  /** Send some cards on their way, and clear them up once they have landed. */
  const depart = useCallback((going: Departing[]) => {
    if (going.length === 0) return 0
    setDeparting((d) => [...d, ...going].slice(-MAX_IN_FLIGHT))
    window.setTimeout(
      () =>
        setDeparting((d) =>
          d.filter((x) => !going.some((g) => g.stack === x.stack && g.key === x.key)),
        ),
      THROW_MS,
    )
    return going.length
  }, [])

  /** Take the top card off one stack. */
  const throwFrom = useCallback(
    (i: number, dir: number, count = 1) => {
      const st = useGame.getState()
      const stack = st.pack?.stacks[i]
      if (!stack || stack.state !== 'sliced') return 0
      const held = stackCards(st, i).length
      const going: Departing[] = []
      for (let n = 0; n < count; n++) {
        const at = stack.revealed + n
        if (at >= held) break
        going.push({ stack: i, key: at, dir: n % 2 === 0 ? dir : -dir, fromX: 0, fromY: 0, fromRot: 0 })
        st.revealNext(i)
      }
      return depart(going)
    },
    [depart],
  )

  /** Take the top card off every stack that still has one: a hand's swipe. */
  const throwLayer = useCallback(
    (dir: number, from = { x: 0, y: 0, rot: 0 }) => {
      const st = useGame.getState()
      if (!st.pack) return 0
      const going: Departing[] = []
      st.pack.stacks.forEach((s, i) => {
        if (s.state !== 'sliced') return
        if (s.revealed >= stackCards(st, i).length) return
        going.push({ stack: i, key: s.revealed, dir, fromX: from.x, fromY: from.y, fromRot: from.rot })
        st.revealNext(i)
      })
      return depart(going)
    },
    [depart],
  )

  /* ------------------------------------------- hands off: Space, and the machine */

  const [auto, setAuto] = useState(false)
  const running = auto || autoSpin
  const openAll = useCallback(() => setAuto(true), [])

  const timers = useRef<number[]>([])
  useEffect(() => {
    if (!running) return
    const hold = timers.current
    const startStack = (i: number) => {
      let n = 0
      const loop = () => {
        if (throwFrom(i, n % 2 === 0 ? 1 : -1, batch) === 0) return
        n++
        hold.push(window.setTimeout(loop, stepMs))
      }
      if (useGame.getState().pack?.stacks[i]?.state === 'sealed') {
        animateTear([i], 1, AUTOTEAR_MS, () => {
          slicePack(i)
          loop()
        })
      } else {
        loop()
      }
    }
    // One wrapper after another rather than all in the same frame: five packs
    // tearing in perfect unison reads as one animation, not five.
    ;(useGame.getState().pack?.stacks ?? []).forEach((_, i) => {
      const step = Math.min(STAGGER_MAX_MS, STAGGER_TOTAL_MS / stacks)
      hold.push(window.setTimeout(() => startStack(i), i * step))
    })
    return () => {
      hold.forEach(clearTimeout)
      hold.length = 0
    }
  }, [running, batch, stepMs, stacks, animateTear, slicePack, throwFrom])

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

  /**
   * A hand is welcome while the machine is working.
   *
   * Swiping alongside Auto Summon throws extra layers off, so being at the
   * screen is worth something: the machine sets the floor on how fast a pull
   * empties, not the ceiling. Only the tear is left alone while it runs, since
   * that is an animation already in flight.
   */
  const canTear = anySealed && !running

  const onPointerDown = (e: React.PointerEvent) => {
    origin.current = { x: e.clientX, y: e.clientY }
    last.current = { x: e.clientX, y: e.clientY }
    surface.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!origin.current) return
    if (canTear) {
      // Every millimetre the pointer travels feeds the rip, in any direction.
      // Torn foil does not knit itself back together when the hand comes back,
      // so pulling, sawing and scrubbing all make progress.
      const prev = last.current ?? origin.current
      const travel = Math.hypot(e.clientX - prev.x, e.clientY - prev.y)
      last.current = { x: e.clientX, y: e.clientY }
      const sealedIdx = sealedNow()
      const v = clamp((tearsRef.current[sealedIdx[0]] ?? 0) + travel / TEAR_PX, 0, 1)
      setTearAt(sealedIdx, v)
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
    if (canTear) {
      last.current = null
      const sealedIdx = sealedNow()
      const at = tearsRef.current[sealedIdx[0]] ?? 0
      if (at >= TEAR_COMMIT) animateTear(sealedIdx, 1, 190, sliceAll)
      else animateTear(sealedIdx, 0, 260)
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
        className={`pack-grid ${anySealed ? 'is-sealed' : ''}`}
        style={{
          ['--cols' as string]: cols,
          ['--rows' as string]: Math.ceil(stacks / cols),
        }}
        ref={surface}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={() => {
          origin.current = null
          last.current = null
          setDrag(null)
        }}
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
            held={heldIn(i).held}
            left={leftIn(i)}
            depth={depth}
            tear={tears[i] ?? 0}
            drag={drag}
            departing={departing.filter((d) => d.stack === i)}
          />
        ))}
      </div>

      <p className="pack-hint">
        {running ? (
          <>
            Opening {stacks > 1 ? `${stacks} packs` : 'the pack'}… swipe along to help.
          </>
        ) : anySealed ? (
          stacks > 1 ? (
            <>Drag anywhere to tear all {stacks} open.</>
          ) : (
            <>Drag across the pack to tear it open.</>
          )
        ) : (
          <>
            <b>{fmtCount(left)}</b> of {fmtCount(heldTotal)} left. Swipe or tap to take a
            card off{stacks > 1 ? ' every stack' : ''}.
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
  /** What the wrapper says it holds, and how much of that is left. */
  held: number
  left: number
  /** Cards mounted behind the top one. A share of the pull's budget. */
  depth: number
  tear: number
  drag: { x: number; y: number } | null
  departing: Departing[]
}

/** One wrapper and its pile. Gestures belong to the grid, not to this. */
function PackStack({ state, thrown, cards, held, left, depth, tear, drag, departing }: StackProps) {
  const sealed = state === 'sealed'
  // Foil takes its colour from the best card in the pack. It gives nothing
  // away that matters -- everything inside is already claimed -- but a pack
  // with something good in it ought to look like one.
  const best = cards.reduce((m, c) => Math.max(m, c.char.creditValue), 0)
  const rarity = rarityOf(best).key
  const top = cards[thrown]
  const topStyle = drag
    ? {
        transform: `translate3d(${drag.x}px, ${drag.y * 0.35}px, 0) rotate(${drag.x * 0.045}deg)`,
        transition: 'none',
      }
    : undefined
  // Only the top of the stack is ever visible, so only the top of the stack is
  // mounted. The rest is a number under the corner.
  const behind = cards.slice(thrown + 1, thrown + 1 + depth)

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

        {!sealed && left > 0 && <span className="pack-left">{fmtCount(left)}</span>}
      </div>

      {sealed && (
        <div className="pack-wrap" aria-hidden="true">
          {/* One piece of foil, clipped to whatever the rip has left of it.
              Seamless until torn, because there is no seam to see yet. */}
          <span className="pack-foil" style={{ clipPath: foilPath(tear) }}>
            <span className="pack-strip" />
            <span className="pack-mark">
              <span className="pack-brand">ANICO</span>
              <span className="pack-sub">{fmtCount(held)} cards</span>
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
