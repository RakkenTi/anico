/**
 * How wide a net a roll casts.
 *
 * Shared by the server (which enforces it) and the settings screen (which
 * offers it), so the two can never drift apart about what a pool size means.
 * The number is a rank: "the top N characters by AniList favourites", turned
 * into a favourites floor at roll time.
 */

/**
 * Larger than the catalog can ever be, so it means "no floor at all". The
 * catalog is the interesting part of this game, and hiding most of it behind a
 * setting made a fresh instance feel far smaller than it is; drawing from all
 * of it is the default, and the smaller pools are there for anyone who would
 * rather only meet characters they recognise.
 */
export const POOL_EVERYTHING = 1_000_000
export const POOL_MIN = 100

export const POOL_OPTIONS: { value: number; label: string }[] = [
  { value: 2_000, label: 'Top 2,000 — household names only' },
  { value: 10_000, label: 'Top 10,000 — popular characters' },
  { value: 40_000, label: 'Top 40,000 — deep cuts included' },
  { value: POOL_EVERYTHING, label: 'Everything in the catalog' },
]
