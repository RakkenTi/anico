/**
 * Geometry for tearing a pack open.
 *
 * The wrapper is one seamless piece until it is torn: a rip travels across it
 * and takes the strip above the seam with it. Both shapes are recomputed from
 * the rip's progress every frame, because a tear is a shape that changes, not
 * a piece that slides — the previous version moved a pre-cut lid, which is why
 * the seam was visible before anything had happened and why pulling felt like
 * dragging a lid rather than tearing anything.
 */

/** Where the seam sits, as a percentage down the pack. */
export const SEAM_Y = 22

/**
 * The seam's teeth: uneven spacing and small amplitude, so the parting edge
 * reads as torn foil rather than pinking shears. Fixed values, so the same
 * pack tears the same way twice and the shape is reviewable in a diff.
 */
const TEETH: { x: number; dy: number }[] = [
  { x: 0, dy: 0.4 }, { x: 4.2, dy: -0.9 }, { x: 8.1, dy: 1.1 }, { x: 12.6, dy: -0.5 },
  { x: 16.4, dy: 0.8 }, { x: 21.3, dy: -1.2 }, { x: 25.1, dy: 0.3 }, { x: 29.8, dy: 1.0 },
  { x: 33.6, dy: -0.7 }, { x: 38.4, dy: 0.6 }, { x: 42.2, dy: -1.1 }, { x: 46.9, dy: 0.9 },
  { x: 50.7, dy: -0.4 }, { x: 55.4, dy: 1.2 }, { x: 59.2, dy: -0.8 }, { x: 63.9, dy: 0.5 },
  { x: 67.7, dy: -1.0 }, { x: 72.4, dy: 0.7 }, { x: 76.2, dy: -0.6 }, { x: 80.9, dy: 1.1 },
  { x: 84.7, dy: -0.9 }, { x: 89.4, dy: 0.4 }, { x: 93.2, dy: -1.1 }, { x: 96.8, dy: 0.8 },
  { x: 100, dy: -0.3 },
]

/** The seam's height at a given horizontal position, interpolated. */
export function seamAt(x: number): number {
  if (x <= 0) return SEAM_Y + TEETH[0].dy
  if (x >= 100) return SEAM_Y + TEETH[TEETH.length - 1].dy
  for (let i = 1; i < TEETH.length; i++) {
    const a = TEETH[i - 1]
    const b = TEETH[i]
    if (x <= b.x) {
      const t = (x - a.x) / (b.x - a.x)
      return SEAM_Y + a.dy + (b.dy - a.dy) * t
    }
  }
  return SEAM_Y
}

const pt = (x: number, y: number) => `${x.toFixed(2)}% ${y.toFixed(2)}%`

/** Teeth between 0 and `x`, so a partial tear shows only the part torn so far. */
function seamRun(x: number): string[] {
  const out: string[] = []
  for (const t of TEETH) {
    if (t.x >= x) break
    out.push(pt(t.x, SEAM_Y + t.dy))
  }
  out.push(pt(x, seamAt(x)))
  return out
}

/**
 * What is left of the wrapper: everything below the seam, plus the part of the
 * top strip the rip has not reached yet.
 */
export function foilPath(rip: number): string {
  const x = Math.max(0, Math.min(100, rip * 100))
  const pts = [
    pt(x, 0),
    pt(100, 0),
    pt(100, 100),
    pt(0, 100),
    pt(0, seamAt(0)),
    ...seamRun(x),
  ]
  return `polygon(${pts.join(', ')})`
}

/** The strip coming away: above the seam, behind the rip. */
export function flapPath(rip: number): string {
  const x = Math.max(0, Math.min(100, rip * 100))
  if (x <= 0) return 'polygon(0% 0%, 0% 0%, 0% 0%)'
  const pts = [pt(0, 0), pt(x, 0), ...seamRun(x).reverse()]
  return `polygon(${pts.join(', ')})`
}
