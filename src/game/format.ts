/**
 * Number names.
 *
 * An incremental outgrows its own digits. Credits stop being a number you
 * read and become a number you *recognise*: what matters at 4.21e18 is the
 * exponent, and eighteen digits of separators hide it rather than showing it.
 * Everything the player is quoted a price or a payout in goes through here.
 *
 * Small numbers are left alone. A pack of 25 for 300 credits is a number
 * anybody can hold in their head, and "300" reads better than "300.0".
 */

/**
 * Short scale, two letters past the familiar four. The names are the ones
 * every incremental uses, which matters more than being Latin about it: a
 * player who has seen one of these games can read Qa/Qi/Sx at a glance.
 */
const SUFFIXES = [
  '', 'K', 'M', 'B', 'T',
  'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No',
  'Dc', 'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc',
  'Vg', 'UVg', 'DVg', 'TVg', 'QaVg', 'QiVg', 'SxVg', 'SpVg', 'OcVg', 'NoVg',
  'Tg',
]

/** Below this, a number is written out in full with separators. */
const PLAIN_BELOW = 10_000

/**
 * Format a credit amount for display.
 *
 * Three significant figures once the suffixes start, because the fourth never
 * changed anybody's mind about whether they could afford something. Past the
 * table it falls back to an exponent rather than inventing names nobody has
 * agreed on.
 */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞'
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
  const v = Math.abs(n)
  if (v < 1_000_000) return Math.round(n).toLocaleString()
  return fmt(n)
}

/** A multiplier, as the shop says it: ×1.25, ×12.4, ×1.2K. */
export function fmtMult(n: number): string {
  if (n < 10) return `×${n.toFixed(2).replace(/\.?0+$/, '')}`
  if (n < 10_000) return `×${Math.round(n).toLocaleString()}`
  return `×${fmt(n)}`
}

/** A percentage, for the handful of places one still makes sense. */
export function fmtPct(fraction: number): string {
  const pct = fraction * 100
  if (pct >= 1000) return `${fmt(pct)}%`
  return `${pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10}%`
}
