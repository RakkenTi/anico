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
  { x: 0, dy: 0.18 }, { x: 2.1, dy: -0.42 }, { x: 3.9, dy: 0.5 }, { x: 6.3, dy: -0.22 },
  { x: 8.2, dy: 0.36 }, { x: 10.6, dy: -0.54 }, { x: 12.5, dy: 0.14 }, { x: 14.9, dy: 0.46 },
  { x: 16.8, dy: -0.32 }, { x: 19.2, dy: 0.28 }, { x: 21.1, dy: -0.5 }, { x: 23.4, dy: 0.4 },
  { x: 25.3, dy: -0.18 }, { x: 27.7, dy: 0.54 }, { x: 29.6, dy: -0.36 }, { x: 32.0, dy: 0.22 },
  { x: 33.8, dy: -0.46 }, { x: 36.2, dy: 0.32 }, { x: 38.1, dy: -0.26 }, { x: 40.5, dy: 0.5 },
  { x: 42.3, dy: -0.4 }, { x: 44.7, dy: 0.18 }, { x: 46.6, dy: -0.5 }, { x: 49.0, dy: 0.36 },
  { x: 50.9, dy: -0.14 }, { x: 53.2, dy: 0.48 }, { x: 55.1, dy: -0.38 }, { x: 57.5, dy: 0.24 },
  { x: 59.4, dy: -0.48 }, { x: 61.7, dy: 0.34 }, { x: 63.6, dy: -0.2 }, { x: 66.0, dy: 0.52 },
  { x: 67.9, dy: -0.34 }, { x: 70.2, dy: 0.2 }, { x: 72.1, dy: -0.52 }, { x: 74.5, dy: 0.38 },
  { x: 76.4, dy: -0.16 }, { x: 78.7, dy: 0.44 }, { x: 80.6, dy: -0.42 }, { x: 83.0, dy: 0.26 },
  { x: 84.9, dy: -0.48 }, { x: 87.2, dy: 0.3 }, { x: 89.1, dy: -0.24 }, { x: 91.5, dy: 0.5 },
  { x: 93.4, dy: -0.36 }, { x: 95.7, dy: 0.22 }, { x: 97.6, dy: -0.44 }, { x: 100, dy: 0.16 },
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
