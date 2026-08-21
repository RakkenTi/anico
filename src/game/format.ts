/**
 * Number names.
 *
 * An incremental outgrows its own digits. Credits stop being a number you
 * read and become a number you *recognise*: what matters at 4.21e18 is the
 * exponent, and eighteen digits of separators hide it rather than showing it.
 * Everything the player is quoted a price or a payout in goes through here --
 * the client, the server's own error messages, and the shop's effect lines.
 *
 * Small numbers are left alone. A pack of 25 for 300 credits is a number
 * anybody can hold in their head, and "300" reads better than "300.0".
 */

/**
 * Short scale, built rather than typed out.
 *
 * The names are the ones every incremental uses, which matters more than
 * being Latin about it: a player who has seen one of these games can read
 * Qa/Qi/Sx at a glance. Hand-written, the ladder stopped at 1e93 and a save
 * twenty minutes past that read "1.29e132" in the middle of a shop full of
 * suffixes -- so it is generated, and it runs past 1e308, which is the largest
 * number a double can hold at all. Nothing can fall off the end of it.
 */
const ONES = ['', 'U', 'D', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No']
const TENS = ['', 'Dc', 'Vg', 'Tg', 'Qag', 'Qig', 'Sxg', 'Spg', 'Ocg', 'Nog']
const HUNDREDS = ['', 'Ce', 'Dce']

function buildSuffixes(): string[] {
  const out = ['', 'K', 'M', 'B', 'T']
  for (let tier = 5; tier < 340; tier++) {
    // Tier 5 is Qa: the Latin ladder starts at quadrillion and counts from
    // one, so the illion this tier names is one less than the tier itself.
    const n = tier - 1
    const s = HUNDREDS[Math.floor(n / 100)] ?? ''
    const t = TENS[Math.floor((n % 100) / 10)]
    const o = ONES[n % 10]
    out.push(n < 10 ? o : `${o}${t}${s}`)
  }
  return out
}

const SUFFIXES = buildSuffixes()

/** Below this, a number is written out in full with separators. */
const PLAIN_BELOW = 10_000

/**
 * The largest number this game lets a balance become.
 *
 * A double gives up at about 1.8e308, and it gives up by turning into
 * `Infinity` -- which is not a big number but a poison that spreads through
 * every sum it touches and lands in the database as `null`. Nothing in the
 * game should ever get near this; it is here so that a bug cannot make a save
 * unreadable, only rich.
 */
export const NUMBER_CEILING = 1e300

/** Bring any arithmetic back to a number the rest of the game can survive. */
export function safe(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0
  if (n >= NUMBER_CEILING) return NUMBER_CEILING
  if (n <= -NUMBER_CEILING) return -NUMBER_CEILING
  return n
}

/**
 * Format a credit amount for display.
 *
 * Three significant figures once the suffixes start, because the fourth never
 * changed anybody's mind about whether they could afford something. Past the
 * table -- which a double cannot actually reach -- it falls back to an
 * exponent rather than inventing names nobody has agreed on.
 */
export function fmt(n: number): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '0'
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞'
  const sign = n < 0 ? '-' : ''
  const v = Math.abs(n)
  if (v < PLAIN_BELOW) return sign + Math.round(v).toLocaleString()
  const tier = Math.floor(Math.log10(v) / 3)
  if (tier >= SUFFIXES.length) {
    const exp = Math.floor(Math.log10(v))
    return `${sign}${(v / Math.pow(10, exp)).toFixed(2)}e${exp}`
  }
  const scaled = v / Math.pow(1000, tier)
  // 9.99K, 99.9K, 999K: three figures, however many are in front of the point.
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
  return `${sign}${scaled.toFixed(digits)}${SUFFIXES[tier]}`
}

/**
 * A count of things rather than an amount of money.
 *
 * Same scale, but a pack of 1,250 cards is still a pack of 1,250 cards: the
 * separator version stays readable a good deal further up when the number is
 * something you could in principle count.
 */
export function fmtCount(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fmt(n)
  const v = Math.abs(n)
  if (v < 1_000_000) return Math.round(n).toLocaleString()
  return fmt(n)
}

/** A multiplier, as the shop says it: ×1.25, ×12.4, ×1.2K. */
export function fmtMult(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return `×${fmt(n)}`
  if (n < 10) return `×${Number(n.toFixed(2))}`
  if (n < 10_000) return `×${Math.round(n).toLocaleString()}`
  return `×${fmt(n)}`
}

/** A percentage, for the handful of places one still makes sense. */
export function fmtPct(fraction: number): string {
  const pct = fraction * 100
  if (pct >= 1000) return `${fmt(pct)}%`
  return `${pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10}%`
}
