import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
/**
 * How long each stack waits its turn before its card leaves, and the longest
 * any of them waits.
 *
 * A layer is written in one go -- one store write for every wrapper -- so
 * without this all seventeen cards would leave in the same frame and read as
 * one animation rather than seventeen stacks.
 */
const THROW_STEP_MS = 26
const THROW_STAGGER_MS = 4 * THROW_STEP_MS
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
 * The shortest, so a pull is still something that happens.
 *
 * Open Speed eventually buys more cards a second than a pull even holds, at
 * which point the honest answer is "instantly" and the honest answer is not
 * worth watching. Barely longer than the tear it follows.
 */
const MIN_OPEN_S = 0.6
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
/**
 * Cards that may be in the air at once, and how many of a batch actually fly.
 *
 * A card leaving is an animation the browser cannot hand to the compositor --
 * it travels a distance measured from the pack's own width, which is a custom
 * property, and a keyframe that reads one is recalculated on the main thread
 * every frame along with the whole card underneath it. Sixty-eight of those at
 * once was two thirds of the frame budget of a seventeen-pack pull.
 *
 * So the budget belongs to the pull and is shared out: one pack throws four
 * cards at a time as it always did, seventeen throw one each, and either way
 * about twenty cards are in the air. Every stack still visibly throws, which
 * is the thing that must not regress -- a stack whose counter drops while
 * nothing moves reads as broken.
 */
const IN_FLIGHT_BUDGET = 20
const IN_FLIGHT_MAX = 4
const inFlightPerStack = (stacks: number) =>
  Math.max(1, Math.min(IN_FLIGHT_MAX, Math.floor(IN_FLIGHT_BUDGET / Math.max(1, stacks))))

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
 * Columns for a big pull, sized to the room the grid actually has.
 *
 * "As square as the count allows" is right up to a couple of dozen wrappers.
 * Past that, square means six rows, and six rows crammed into the height
 * between the header and the dock make every wrapper a sliver while half the
 * screen's width sits empty. So the shape follows the room instead: for every
 * plausible column count, work out how wide a wrapper it yields under the
 * same two limits the stylesheet applies -- its share of the width, its share
 * of the height -- and keep the widest. Near-ties go to the fullest bottom
 * row, because thirteen going out as twelve and one reads as a mistake.
 *
 * `w`/`room`/`gap`/`lean` mirror the .pack-grid rules in index.css; if those
 * numbers move, these must move with them.
 */
function fitCols(n: number, w: number, room: number, gap: number, lean: number): number {
  if (n <= 3) return n
  let bestW = 0
  const widths = new Array<number>(n + 1).fill(0)
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const wide = Math.min((w - (cols - 1) * gap - lean) / cols, (room / rows - gap) / 2, 330)
    widths[cols] = wide
    if (wide > bestW) bestW = wide
  }
  let best = columnsFor(n)
  let bestFull = -1
  for (let cols = 1; cols <= n; cols++) {
    if (widths[cols] < bestW * 0.97) continue
    const rows = Math.ceil(n / cols)
    const full = (n - (rows - 1) * cols) / cols
    if (full > bestFull) {
      bestFull = full
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
  /** How long this card waits before it leaves, in ms. */
  delay: number
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** A rip in progress: one wrapper's tear, as the shared driver sees it. */
interface Rip {
  from: number
  to: number
  start: number
  ms: number
  done?: () => void
}

/** Shared, so a stack with nothing in the air keeps the same empty array. */
const NOTHING: Departing[] = []

/**
 * How thick a pile still looks, 0.12 to 1, in forty-eighths.
 *
 * Never quite nothing: an empty-looking stack that still has cards in it reads
 * as a bug rather than as nearly done.
 */
const PILE_STEPS = 48
const pileOf = (left: number, held: number) =>
  Math.max(0.12, Math.round((left / Math.max(1, held)) * PILE_STEPS) / PILE_STEPS)

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

  /* The room the grid has, measured off its parent rather than guessed from
     the viewport: layouts cap the pane at different widths and mega pulls go
     full-bleed. Null exactly once, before the first layout effect. */
  const [pane, setPane] = useState<{ w: number; room: number; gap: number; lean: number } | null>(
    null,
  )

  // The render budget is shared out: one stack shows ten cards deep, twenty
  // show three, and the browser mounts about the same number either way.
  const depth = stackDepth(stacks)
  const cols = pane
    ? fitCols(stacks, pane.w, pane.room, pane.gap, pane.lean)
    : columnsFor(stacks)
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

  /*
   * The cadence, for the pull as a whole, counted in the cards it actually
   * holds.
   *
   * Open Speed is quoted in cards a second and a pull holds what the wrappers
   * say -- a hundred and ninety thousand of them, at the far end. What is
   * *dealt* is a thousand at most, and each of those stands in for the two
   * hundred behind it, so pacing the throws by the dealt count made every
   * thrown card worth two hundred and emptied a two-hundred-thousand-card pull
   * in the time nine hundred should take. It reads as instant, and no amount of
   * Open Speed changes it, which is exactly the complaint.
   *
   * So the clock is set on the real total: `rate` is real cards a second for
   * the whole pull (never per pack, which would make every Extra Pack a free
   * doubling of the rate), and the throws are paced at whatever share of that
   * the dealt cards represent.
   */
  const dealtTotal = Math.max(1, cards.length)
  const carries = Math.max(1, heldTotal / dealtTotal)
  const realRate = Math.max(1, cardRate, heldTotal / MAX_OPEN_S)
  const dealtRate = Math.min(Math.max(1, realRate / carries), dealtTotal / MIN_OPEN_S)
  const rawStep = (1000 * stacks) / dealtRate
  const target = Math.max(MIN_STEP_MS, 1000 / TICKS_PER_SECOND)
  const batch = rawStep >= target ? 1 : Math.ceil(target / rawStep)
  const stepMs = Math.max(MIN_STEP_MS, Math.round(rawStep * batch))

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

  const setTearAt = useCallback((which: number[], v: number) => {
    const next = [...tearsRef.current]
    for (const i of which) next[i] = v
    tearsRef.current = next
    setTears(next)
  }, [])

  /*
   * One clock for every rip.
   *
   * The wrappers tear a beat apart, so seventeen of them used to mean
   * seventeen animation loops, each waking on its own frame and each writing
   * the whole array of rips back into React. One driver steps all of them and
   * writes once a frame however many are moving, which is the difference
   * between a stutter and a stagger.
   */
  const rips = useRef<Map<number, Rip>>(new Map())
  const driver = useRef(0)

  const animateTear = useCallback((which: number[], to: number, ms: number, done?: () => void) => {
    const start = performance.now()
    which.forEach((i, n) => {
      rips.current.set(i, {
        from: tearsRef.current[i] ?? 0,
        to,
        start,
        ms,
        // Whatever follows the rip belongs to the wrapper that asked, not to
        // every wrapper moving with it.
        done: n === 0 ? done : undefined,
      })
    })
    if (driver.current) return
    const step = (now: number) => {
      const next = [...tearsRef.current]
      const finished: (() => void)[] = []
      for (const [i, rip] of rips.current) {
        const t = clamp((now - rip.start) / rip.ms, 0, 1)
        next[i] = rip.from + (rip.to - rip.from) * (1 - Math.pow(1 - t, 3))
        if (t >= 1) {
          rips.current.delete(i)
          if (rip.done) finished.push(rip.done)
        }
      }
      tearsRef.current = next
      setTears(next)
      driver.current = rips.current.size > 0 ? requestAnimationFrame(step) : 0
      for (const fn of finished) fn()
    }
    driver.current = requestAnimationFrame(step)
  }, [])
  useEffect(() => {
    const running = driver
    return () => {
      if (running.current) cancelAnimationFrame(running.current)
      running.current = 0
    }
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
  const perStackInFlight = inFlightPerStack(stacks)
  const depart = useCallback((going: Departing[]) => {
    if (going.length === 0) return 0
    setDeparting((d) => {
      const next = [...d, ...going]
      // Newest first, keep a few per stack, then back into arrival order so
      // the cards in the air keep their z-order.
      const kept: Departing[] = []
      const perStack = new Map<number, number>()
      for (let i = next.length - 1; i >= 0; i--) {
        const n = perStack.get(next[i].stack) ?? 0
        if (n >= perStackInFlight) continue
        perStack.set(next[i].stack, n + 1)
        kept.push(next[i])
      }
      return kept.reverse()
    })
    window.setTimeout(
      () =>
        setDeparting((d) =>
          d.filter((x) => !going.some((g) => g.stack === x.stack && g.key === x.key)),
        ),
      THROW_MS + THROW_STAGGER_MS,
    )
    return going.length
  }, [perStackInFlight])

  /**
   * Take `count` cards off every stack that still has some.
   *
   * One store write for the whole layer, whether it came from a hand or from
   * the machine. `dirFor` decides which way each stack's cards go; `from` is
   * where they start, which is where the finger left off for a swipe and the
   * top of the pile for everything else.
   *
   * Only the first couple of a batch are given an animation and the rest leave
   * with them: at six ticks a second nobody can tell two cards from five, and
   * the browser very much can. The second of a pair drifts rather than
   * reversing, so a batch leaves as a small fan going the same way.
   */
  const throwLayer = useCallback(
    (
      dirFor: (i: number) => number,
      count = 1,
      from = { x: 0, y: 0, rot: 0 },
    ) => {
      const st = useGame.getState()
      if (!st.pack) return 0
      const before = st.pack.stacks.map((s) => s.revealed)
      const moved = st.revealLayer(st.pack.stacks.map(() => count))
      const going: Departing[] = []
      moved.forEach((n, i) => {
        for (let k = 0; k < Math.min(n, perStackInFlight); k++) {
          going.push({
            stack: i,
            key: before[i] + k,
            dir: dirFor(i),
            fromX: from.x,
            fromY: from.y + k * -10,
            fromRot: from.rot + k * 4,
            // Written together, thrown a beat apart: what makes seventeen
            // stacks look like seventeen stacks rather than one animation.
            delay: (i % 5) * THROW_STEP_MS,
          })
        }
      })
      depart(going)
      return moved.reduce((a, b) => a + b, 0)
    },
    [depart, perStackInFlight],
  )

  /* ------------------------------------------- hands off: Space, and the machine */

  const [auto, setAuto] = useState(false)
  const running = auto || autoSpin
  const openAll = useCallback(() => setAuto(true), [])

  const timers = useRef<number[]>([])
  useEffect(() => {
    if (!running) return
    const hold = timers.current
    /*
     * Cards leave a grid outwards, not across it.
     *
     * With one pack a card sailing right is a flourish; with thirteen it
     * lands on the pack next door and the whole thing turns to soup. The
     * left-hand columns throw left and the right-hand columns throw right, so
     * everything travels away from the grid rather than through it.
     */
    const outward = (i: number, n: number) => {
      const col = i % cols
      const middle = (cols - 1) / 2
      // A single column, or the middle of an odd grid, has no outside to aim
      // at, so it fans both ways as it always did.
      if (Math.abs(col - middle) < 0.4) return n % 2 === 0 ? 1 : -1
      return col < middle ? -1 : 1
    }
    // One wrapper after another rather than all in the same frame: five packs
    // tearing in perfect unison reads as one animation, not five.
    const step = Math.min(STAGGER_MAX_MS, STAGGER_TOTAL_MS / stacks)
    ;(useGame.getState().pack?.stacks ?? []).forEach((_, i) => {
      hold.push(
        window.setTimeout(() => {
          if (useGame.getState().pack?.stacks[i]?.state !== 'sealed') return
          animateTear([i], 1, AUTOTEAR_MS, () => slicePack(i))
        }, i * step),
      )
    })
    /*
     * One clock for the throwing, not one per stack.
     *
     * Every stack empties at the same cadence, so seventeen timers were
     * seventeen store writes and seventeen renders per tick for a layer that
     * could be written once. The wrappers still come off one after another,
     * and the cards still leave a beat apart -- that is `delay` on the card,
     * not a timer of its own.
     */
    let tick = 0
    const loop = () => {
      const moved = throwLayer((i) => outward(i, tick), batch)
      tick++
      const st = useGame.getState()
      const sealedLeft = (st.pack?.stacks ?? []).some((x) => x.state === 'sealed')
      if (moved === 0 && !sealedLeft) return
      hold.push(window.setTimeout(loop, stepMs))
    }
    hold.push(window.setTimeout(loop, Math.min(step, AUTOTEAR_MS)))
    return () => {
      hold.forEach(clearTimeout)
      hold.length = 0
    }
  }, [running, batch, stepMs, stacks, cols, animateTear, slicePack, throwLayer])

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

  /* ------------------------------------------------------ what each stack gets */

  /*
   * Props a stack can be compared on.
   *
   * `PackStack` is memoised, which is worth nothing if its props are rebuilt
   * every render: slicing the cards and filtering the cards in flight both
   * hand back a fresh array every time, and a fresh array is a changed prop.
   * Cut once per pull and grouped once per throw instead, so a stack that did
   * not move does not re-render -- and at seventeen stacks seven deep, the
   * stacks that did not move are sixteen of them.
   */
  const perPack = pack.perPack
  const slices = useMemo(
    () => Array.from({ length: stacks }, (_, i) => cards.slice(i * perPack, (i + 1) * perPack)),
    [cards, stacks, perPack],
  )
  const inFlight = useMemo(() => {
    const by = new Map<number, Departing[]>()
    for (const d of departing) {
      const list = by.get(d.stack)
      if (list) list.push(d)
      else by.set(d.stack, [d])
    }
    return by
  }, [departing])

  /* -------------------------------------------------------------- input */

  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const surface = useRef<HTMLDivElement>(null)

  /* Before first paint, then on resize: the numbers mirror .pack-grid's own
     formula in index.css (desktop and its 860px phone override). */
  useLayoutEffect(() => {
    const measure = () => {
      const holder = surface.current?.parentElement
      if (!holder) return
      const phone = window.innerWidth <= 860
      setPane({
        w: holder.clientWidth,
        room: Math.max(
          140,
          phone ? window.innerHeight - 420 : window.innerHeight * 0.64 - 110,
        ),
        gap: phone ? 12 : 20,
        lean: phone ? 30 : 40,
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

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
    const way = Math.sign(dx) || 1
    if (Math.abs(dx) > THROW_PX) {
      throwLayer(() => way, 1, { x: dx, y: dy * 0.35, rot: dx * 0.045 })
    } else if (Math.hypot(dx, dy) < 8) {
      // A tap counts. Swiping is the flourish, not a toll, and it is awkward
      // with a mouse and impossible from a keyboard.
      throwLayer(() => 1)
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
            cards={slices[i]}
            held={heldIn(i).held}
            left={leftIn(i)}
            // Rounded, so a pile that has barely moved is the same value and
            // costs nothing: a custom property on a stack invalidates every
            // card under it, and a pull is forty of those.
            pile={pileOf(leftIn(i), heldIn(i).held)}
            depth={depth}
            tear={tears[i] ?? 0}
            drag={drag}
            departing={inFlight.get(i) ?? NOTHING}
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
  /** How thick the pile still is, 0 to 1. The fan is scaled by it. */
  pile: number
  /** Cards mounted behind the top one. A share of the pull's budget. */
  depth: number
  tear: number
  drag: { x: number; y: number } | null
  departing: Departing[]
}

/**
 * One wrapper and its pile. Gestures belong to the grid, not to this.
 *
 * Memoised: see the props built for it above.
 */
const PackStack = memo(function PackStack({ state, thrown, cards, held, left, pile, depth, tear, drag, departing }: StackProps) {
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
      {/* `--pile` thins the fan as the pack empties: ten mounted cards cannot
          show a stack of two thousand getting shorter, but the lean can. */}
      <div className="pack-stack" style={{ ['--pile' as string]: pile.toFixed(3) }}>
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
            /* Two settle animations, alternating.
               The card used to be keyed by position so every throw remounted
               it and replayed the drop. A remount at seventeen stacks is
               seventeen images torn out of the document and seventeen more put
               back, several times a second; swapping which animation is named
               restarts it just as well and keeps the element. */
            className={`pack-card top ${thrown % 2 === 0 ? 'settle-a' : 'settle-b'}`}
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
              ['--from-x' as string]: `${d.fromX}px`,
              ['--from-y' as string]: `${d.fromY}px`,
              ['--from-rot' as string]: `${d.fromRot}deg`,
              zIndex: behind.length + 2 + d.key,
            }}
            aria-hidden="true"
          >
            {/* The travel lives on its own element so the card keeps a plain
                static transform and the flight stays on the compositor. */}
            <div
              className={`pack-fly ${d.dir < 0 ? 'to-left' : ''}`}
              style={{ animationDelay: `${d.delay}ms` }}
            >
              <CharacterCard character={cards[d.key].char} wished={cards[d.key].wished} />
            </div>
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
})
