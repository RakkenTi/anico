/**
 * The stages a sandbox profile can be put at.
 *
 * Shared by the server (which seeds them) and the settings screen (which
 * offers them), so the two can never drift apart about what a stage means.
 * Pure data: the seeding itself is `server/sandbox.ts`, because a stage is a
 * rule and the server owns those (ADR 0003).
 */

/** What a profile's shop looks like at a stage. Absent keys keep their default. */
export interface StageSpec {
  /** Pack Size. */
  packs: number
  /** Extra Packs. */
  multipack: number
  /** Open Speed. */
  haste: number
  /** Longer Table. */
  table?: number
  /** Wider Deal. */
  hands?: number
  /** Deeper Merges. */
  depth?: number
  credits?: number
}

export interface SandboxStage extends StageSpec {
  key: string
  name: string
  blurb: string
  /** Characters to put in the collection. */
  own: number
  /** Copies on two thirds of them, which sets the star they have merged to. */
  copies: number
}

/*
 * The ladder.
 *
 * `mid` through `silly` carry the same Pack Size, Extra Packs and Open Speed as
 * the stress harness's rungs, because those numbers are already tuned to the
 * shapes worth looking at: the one that sells, the one with forty-one wrappers.
 * The ceilings differ -- the harness pins them low to keep its measurements
 * comparable, and a sandbox wants them where the end game actually is.
 */
export const SANDBOX_STAGES: SandboxStage[] = [
  {
    key: 'fresh',
    name: 'Fresh',
    blurb: 'A brand new account. Nothing bought, nothing owned, no credits.',
    packs: 0, multipack: 0, haste: 0, table: 0, hands: 0, depth: 0,
    credits: 0, own: 0, copies: 1,
  },
  {
    key: 'early',
    name: 'Early',
    blurb: 'Packs just opened. A few hundred characters, nothing merged deeply.',
    packs: 4, multipack: 1, haste: 4, table: 0, hands: 0, depth: 0,
    credits: 1e6, own: 200, copies: 4,
  },
  {
    key: 'mid',
    name: 'Mid',
    blurb: 'Two thousand characters, most of them merged below the star cap.',
    packs: 12, multipack: 6, haste: 14, table: 2, hands: 2, depth: 1,
    credits: 1e9, own: 2_000, copies: 512,
  },
  {
    key: 'late',
    name: 'Late',
    blurb: 'Twenty thousand characters and the ceilings half bought.',
    packs: 20, multipack: 16, haste: 24, table: 3, hands: 4, depth: 3,
    credits: 1e12, own: 20_000, copies: 4_096,
  },
  {
    key: 'deep',
    name: 'Deep',
    blurb: 'Sixty-five thousand characters, every ceiling bought out.',
    packs: 24, multipack: 23, haste: 30, table: 6, hands: 6, depth: 6,
    credits: 1e15, own: 65_000, copies: 4_096,
  },
  {
    key: 'silly',
    name: 'Silly',
    blurb: 'Forty-one wrappers of eleven million cards. The shape that hurts.',
    packs: 34, multipack: 40, haste: 40, table: 6, hands: 6, depth: 6,
    credits: Number.MAX_SAFE_INTEGER, own: 65_000, copies: 4_096,
  },
]

export const stageByKey = (key: string): SandboxStage | undefined =>
  SANDBOX_STAGES.find((s) => s.key === key)
