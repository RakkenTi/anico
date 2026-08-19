/**
 * ANICO sound kit — sampled UI sounds, played through Web Audio so we can
 * schedule per-card sequences, vary pitch and follow the volume setting.
 *
 * All samples are CC0 from Kenney.nl (Casino Audio, Interface Sounds,
 * RPG Audio, Digital Audio, Music Jingles) and live in public/sfx/.
 * A ×10 summon deals one card-place sound per card, staggered to match
 * the 70ms flip animation, with a rising pitch across the sequence.
 */

export type RarityKey = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'

const SAMPLES = [
  'tap',
  'flip-1',
  'flip-2',
  'flip-3',
  'flip-4',
  'fan',
  'stamp',
  'confirm-1',
  'confirm-2',
  'coins',
  'coins-big',
  'glass',
  'error',
  'powerup',
  'powerup-short',
  'jingle-win',
  'jingle-daily',
] as const

type SampleName = (typeof SAMPLES)[number]

const FLIPS: SampleName[] = ['flip-1', 'flip-2', 'flip-3', 'flip-4']

interface SoundSettings {
  soundEnabled: boolean
  soundVolume: number
}

let readSettings: () => SoundSettings = () => ({ soundEnabled: true, soundVolume: 0.6 })

/** The store wires this up so the kit follows the persisted settings. */
export function bindSoundSettings(fn: () => SoundSettings) {
  readSettings = fn
}

let ctx: AudioContext | null = null
let master: GainNode | null = null
const buffers = new Map<SampleName, AudioBuffer>()
const loading = new Map<SampleName, Promise<void>>()

/** Lazy context: every sound here is triggered by a user gesture, so
    creation and resume are allowed by autoplay policies. */
function ac(): AudioContext | null {
  const s = readSettings()
  if (!s.soundEnabled || s.soundVolume <= 0) return null
  if (!ctx) {
    if (typeof AudioContext === 'undefined') return null
    ctx = new AudioContext()
    master = ctx.createGain()
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  master!.gain.value = s.soundVolume * s.soundVolume // squared ≈ perceptual taper
  return ctx
}

function load(name: SampleName): Promise<void> {
  const inFlight = loading.get(name)
  if (inFlight) return inFlight
  const p = (async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}sfx/${name}.ogg`)
    if (!res.ok) throw new Error(`sfx ${name}: ${res.status}`)
    const raw = await res.arrayBuffer()
    // decodeAudioData needs a context; by the time we load, ac() has run.
    if (!ctx) return
    buffers.set(name, await ctx.decodeAudioData(raw))
  })().catch(() => {
    loading.delete(name) // allow a retry on the next play
  })
  loading.set(name, p)
  return p
}

interface PlayOpts {
  at?: number
  rate?: number
  gain?: number
}

function play(name: SampleName, { at = 0, rate = 1, gain = 1 }: PlayOpts = {}) {
  const c = ac()
  if (!c) return
  const buf = buffers.get(name)
  if (!buf) {
    // First use: fetch, then play only if it arrives fast enough to
    // still feel attached to the click (late feedback is worse than none).
    const wanted = c.currentTime + at
    void load(name).then(() => {
      const b = buffers.get(name)
      if (b && c.currentTime - wanted < 0.3) startSource(c, b, Math.max(0, wanted - c.currentTime), rate, gain)
    })
    return
  }
  startSource(c, buf, at, rate, gain)
}

function startSource(c: AudioContext, buf: AudioBuffer, at: number, rate: number, gain: number) {
  const src = c.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = rate
  const g = c.createGain()
  g.gain.value = gain
  src.connect(g)
  g.connect(master!)
  src.start(c.currentTime + at)
}

/** Fetch everything on the first interaction so first plays aren't silent. */
function prime() {
  if (ac()) for (const name of SAMPLES) void load(name)
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', prime, { once: true })
}

/** Per-card deal interval, shared by the flip animation (via --deal-step)
    and the flip sounds so they stay in lockstep. 70ms up to 20 cards;
    a ×100 riffles through in ~1.2s; monster spreads compress further,
    capping around ~2.8s total for a sandbox ×1000. */
export function dealStepMs(count: number): number {
  if (count <= 1) return 0
  if (count <= 20) return 70
  if (count <= 100) return Math.max(12, Math.round(1200 / count))
  return Math.min(12, Math.max(2.8, Math.round((2800 / count) * 10) / 10))
}

/* The deal eases in and out: the first cards land unhurried, the middle
   riffles, the last few settle. delay(x) = x + A·sin(2πx)/2π has slope
   1 + A·cos(2πx), so gaps run (1+A)× nominal at the ends and (1−A)× in
   the middle — and it lands exactly on 1, leaving the total deal time
   (and everything synced to it) unchanged. */
const DEAL_EASE = 0.55

/** Delay before card `i` of a `count`-card deal flips, in ms. */
export function dealDelayMs(i: number, count: number): number {
  if (count <= 1) return 0
  const x = i / count
  return (x + (DEAL_EASE * Math.sin(2 * Math.PI * x)) / (2 * Math.PI)) * count * dealStepMs(count)
}

/** Fraction of the deal revealed at time fraction `u` — the inverse of the
    curve above, to first order, for animations that track the cascade. */
export function dealtFraction(u: number): number {
  const x = Math.max(0, Math.min(1, u))
  return x - (DEAL_EASE * Math.sin(2 * Math.PI * x)) / (2 * Math.PI)
}

export const sfx = {
  /** Small dry tick for tabs, chips and card selection. */
  tap() {
    play('tap', { gain: 0.6 })
  },

  /** Cards being fanned as a summon starts. */
  rollStart(count = 1) {
    play('fan', { gain: 0.7, rate: count > 1 ? 0.95 : 1.08 })
  },

  /** Reveal: one short flip per card, timed to the flip animation, then a
      stinger scaled to the best rarity. Monster spreads thin the flips to
      ~48 spread evenly across the deal — at 3ms spacing, more samples
      would smear into noise; fewer, faster ones read as a card riffle. */
  reveal(rarity: RarityKey, count = 1) {
    const step = dealStepMs(count) / 1000
    const stride = Math.ceil(count / 48)
    const spreadGain = count > 100 ? 0.45 : count > 10 ? 0.5 : 0.8
    for (let i = 0; i < count; i += stride) {
      play(FLIPS[(i / stride) % FLIPS.length], {
        // eased like the flip animation, so sound and card stay welded
        at: dealDelayMs(i, count) / 1000,
        // rise ~a minor third across the whole deal, whatever its length
        rate: 0.95 + (i / Math.max(count - 1, 1)) * 0.3 + (Math.random() * 0.06 - 0.03),
        gain: spreadGain,
      })
    }
    const after = count * step + 0.08
    switch (rarity) {
      case 'common':
        break // the deal speaks for itself
      case 'rare':
        play('confirm-1', { at: after, gain: 0.5 })
        break
      case 'epic':
        play('confirm-2', { at: after, gain: 0.6 })
        break
      case 'legendary':
        play('powerup-short', { at: after, gain: 0.6 })
        play('confirm-2', { at: after + 0.16, gain: 0.5 })
        break
      case 'mythic':
        play('glass', { at: after, gain: 0.6 })
        play('jingle-win', { at: after + 0.05, gain: 0.8 })
        break
    }
  },

  /** Claim: a firm card-shove thunk with a confirming chime. */
  claim() {
    play('stamp', { gain: 0.95 })
    play('confirm-1', { at: 0.12, gain: 0.7 })
  },

  /** Currency pickup: a quick, bright coin handle. */
  payout(at = 0) {
    play('coins', { at, rate: 1.15, gain: 0.75 })
  },

  /** Gem gather: glass ping into coins. */
  gem() {
    play('glass', { rate: 0.9, gain: 0.7 })
    play('coins', { at: 0.08, gain: 0.85 })
  },

  /** Daily offering: a solid coin payout with a confirming chime. */
  daily() {
    play('coins-big', { gain: 0.85 })
    play('confirm-2', { at: 0.1, gain: 0.55 })
  },

  /** Badge forge / purchase: coins over the counter, then a confirm. */
  buy() {
    play('coins-big', { gain: 0.85 })
    play('confirm-1', { at: 0.12, gain: 0.5 })
  },

  /** Selling: coins out, pitched slightly down. */
  sell() {
    play('coins', { rate: 0.92, gain: 0.85 })
  },

  /** Wishes and rituals: the classic rising power-up sparkle. */
  wish() {
    play('powerup', { gain: 0.55 })
  },

  /** Something failed: a soft error blip. */
  error() {
    play('error', { gain: 0.7 })
  },
}
