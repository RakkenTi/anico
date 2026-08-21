/**
 * The catalog: the instance's own table of characters.
 *
 * AniList is reached from the server, never the browser. One instance shares
 * one ~90 request/minute budget, so uncoordinated per-player calls would trip
 * limits nobody could diagnose. A background crawl at first boot walks the
 * reachable pool and after that rolls are a local SELECT: instant, and
 * unaffected by AniList being down.
 *
 * "The reachable pool" is bigger than one query can express. AniList refuses
 * offset pagination past 5000 entries, so a single sweep of anime by
 * popularity can only ever see the top 5000 shows and the headline cast of
 * each. The crawl is therefore a list of *segments*, each its own 5000-entry
 * sweep from a different angle: anime then manga, headline cast then the next
 * rank down. Together they reach several times what one sweep does, and
 * because every row is an upsert keyed by character id, segments that overlap
 * cost nothing but a refreshed favourites count.
 */

import type { DB } from './db.js'
import { getMeta, setMeta } from './db.js'
import { creditValue } from '../src/game/economy.js'
import { POOL_EVERYTHING } from '../src/game/pool.js'
import type { RollGender } from './rules.js'

const ENDPOINT = 'https://graphql.anilist.co'
/**
 * Media per request, and cast fetched per media.
 *
 * Both were smaller (15 and 20). The ceiling that matters is AniList's request
 * *count*, not the size of any one response, so asking for more per request is
 * how the catalog grows without spending longer against that ceiling: 625
 * characters a request rather than 300, for the same one request.
 */
const MEDIA_PER_PAGE = 25
const CHARS_PER_MEDIA = 25

/** AniList rejects offset pagination past 5000 entries. */
const MAX_OFFSET = 5000
export const PAGES_PER_SEGMENT = Math.floor(MAX_OFFSET / MEDIA_PER_PAGE)

/**
 * The sweeps the crawl makes, in order.
 *
 * Anime first and headline cast first, so the characters most people are
 * actually hunting land in the catalog within the first stretch; the deeper
 * segments fill in behind them while the instance is already playable.
 */
interface Segment {
  type: 'ANIME' | 'MANGA'
  /** Which page of each media's cast, sorted by favourites. */
  charPage: number
  label: string
}

const SEGMENTS: Segment[] = [
  { type: 'ANIME', charPage: 1, label: 'anime, headline cast' },
  { type: 'MANGA', charPage: 1, label: 'manga, headline cast' },
  { type: 'ANIME', charPage: 2, label: 'anime, supporting cast' },
  { type: 'MANGA', charPage: 2, label: 'manga, supporting cast' },
]

/** Total crawl steps: one request each, across every segment. */
export const TOTAL_STEPS = SEGMENTS.length * PAGES_PER_SEGMENT

/** Which segment and page a global step number lands on. */
function stepTarget(step: number): { segment: Segment; page: number } {
  const i = Math.floor((step - 1) / PAGES_PER_SEGMENT)
  return { segment: SEGMENTS[i], page: ((step - 1) % PAGES_PER_SEGMENT) + 1 }
}

/**
 * Seconds between crawl requests.
 *
 * The documented budget is 90 requests/minute but the observed one is far
 * tighter, and the old 1.1s gap (~54/min) spent most of the crawl being
 * refused and backing off. An instance that stays up has no reason to hurry:
 * at 15s a page the whole catalog lands in under an hour and a half, using
 * about four requests a minute, which leaves the upstream budget to the
 * players. Pages arrive most-popular-first, so the pool is worth rolling
 * against long before the crawl finishes.
 */
const CRAWL_DELAY_MS = Math.max(1000, Number(process.env.CRAWL_DELAY_MS ?? 15_000))

/**
 * Stop growing the catalog past this. Nothing here grows without bound: every
 * segment is a bounded sweep, and at roughly 390 bytes a row even the full
 * four-segment catalog settles well under 100 MB. The ceiling exists so a
 * runaway can only ever cost a bounded amount of a shared disk, not so it can
 * be hit in normal use.
 */
const MAX_DB_BYTES = Math.max(1024 * 1024, Number(process.env.MAX_DB_BYTES ?? 1024 * 1024 * 1024))

/** Size of the database as SQLite itself accounts for it. */
export function dbBytes(db: DB): number {
  const page = db.pragma('page_size', { simple: true }) as number
  const count = db.pragma('page_count', { simple: true }) as number
  return page * count
}

const MEDIA_QUERY = `
query ($page: Int, $perPage: Int, $type: MediaType, $charPage: Int, $charPerPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(sort: POPULARITY_DESC, type: $type) {
      title { romaji english }
      coverImage { large }
      characters(page: $charPage, perPage: $charPerPage, sort: FAVOURITES_DESC) {
        nodes {
          id
          name { full native alternative }
          image { large }
          gender
          favourites
        }
      }
    }
  }
}`

const SEARCH_QUERY = `
query ($search: String, $perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    characters(search: $search, sort: FAVOURITES_DESC) {
      id
      name { full native alternative }
      image { large }
      gender
      favourites
      media(perPage: 3, sort: POPULARITY_DESC) {
        nodes { title { romaji english } coverImage { large } }
      }
    }
  }
}`

export interface CatalogCharacter {
  id: number
  name: string
  nativeName: string | null
  image: string
  gender: string
  favourites: number
  series: string
  creditValue: number
  aliases: string[]
  covers: string[]
}

function normalizeGender(raw: string | null): string {
  if (!raw) return 'Other'
  const g = raw.trim().toLowerCase()
  if (g.startsWith('female')) return 'Female'
  if (g.startsWith('male')) return 'Male'
  return 'Other'
}

/**
 * AniList refused, as opposed to something in here being broken. Kept apart so
 * a search that runs into the upstream budget says so, instead of arriving as
 * a generic 500 that reads like an instance fault.
 */
export class UpstreamError extends Error {}

async function query(body: object): Promise<any> {
  // A refused connection or dead DNS is AniList being unreachable, not this
  // instance breaking, so it joins the same class as a 429 or a 502.
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {
    throw new UpstreamError('AniList could not be reached from this instance.')
  })
  if (res.status === 429) {
    throw new UpstreamError('AniList is rate limiting this instance. Try again in a minute.')
  }
  if (!res.ok) throw new UpstreamError(`AniList is not answering right now (${res.status}).`)
  const json: any = await res.json()
  if (json.errors?.length) throw new Error(json.errors[0].message ?? 'AniList query error')
  return json.data
}

function toCatalog(c: any, seriesName?: string, seriesCover?: string | null): CatalogCharacter | null {
  if (!c?.name?.full || !c?.image?.large) return null
  if (c.image.large.includes('/default.jpg')) return null
  const title = c.media?.nodes?.[0]?.title
  const aliases = (c.name.alternative ?? [])
    .filter((a: string | null) => !!a && a.trim().length > 0 && a.trim() !== c.name.full)
    .map((a: string) => a.trim())
  const covers = [seriesCover, ...(c.media?.nodes?.map((m: any) => m.coverImage?.large) ?? [])].filter(
    (u: unknown): u is string => typeof u === 'string' && u.length > 0,
  )
  return {
    id: c.id,
    name: c.name.full,
    nativeName: c.name.native ?? null,
    image: c.image.large,
    gender: normalizeGender(c.gender ?? null),
    favourites: c.favourites ?? 0,
    series: seriesName ?? title?.english ?? title?.romaji ?? 'Unknown series',
    creditValue: creditValue(c.favourites ?? 0),
    aliases: [...new Set<string>(aliases)].slice(0, 6),
    covers: [...new Set<string>(covers)].slice(0, 4),
  }
}

export function upsertCharacters(db: DB, chars: CatalogCharacter[]): number {
  const stmt = db.prepare(
    `INSERT INTO characters
       (id, name, native_name, image, gender, favourites, series, credit_value, aliases_json, covers_json, updated_at)
     VALUES (@id, @name, @nativeName, @image, @gender, @favourites, @series, @creditValue, @aliases, @covers, @now)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, native_name = excluded.native_name, image = excluded.image,
       gender = excluded.gender, favourites = excluded.favourites,
       -- Keep the first series a character was seen in. Segments sweep in
       -- descending popularity, so the first sighting is the work they are
       -- best known for; letting a later manga segment overwrite it would
       -- quietly re-file half the catalog under its source material.
       series = CASE WHEN characters.series = 'Unknown series'
                     THEN excluded.series ELSE characters.series END,
       credit_value = excluded.credit_value, aliases_json = excluded.aliases_json,
       covers_json = excluded.covers_json, updated_at = excluded.updated_at`,
  )
  const now = Date.now()
  const run = db.transaction((list: CatalogCharacter[]) => {
    for (const c of list) {
      stmt.run({
        id: c.id, name: c.name, nativeName: c.nativeName, image: c.image, gender: c.gender,
        favourites: c.favourites, series: c.series, creditValue: c.creditValue,
        aliases: JSON.stringify(c.aliases), covers: JSON.stringify(c.covers), now,
      })
    }
  })
  run(chars)
  return chars.length
}

async function fetchMediaPage(segment: Segment, page: number): Promise<CatalogCharacter[]> {
  const data = await query({
    query: MEDIA_QUERY,
    variables: {
      page,
      perPage: MEDIA_PER_PAGE,
      type: segment.type,
      charPage: segment.charPage,
      charPerPage: CHARS_PER_MEDIA,
    },
  })
  const out: CatalogCharacter[] = []
  for (const m of data.Page.media as any[]) {
    const series = m.title.english ?? m.title.romaji ?? 'Unknown series'
    for (const node of m.characters.nodes as any[]) {
      const c = toCatalog(node, series, m.coverImage?.large)
      if (c) out.push(c)
    }
  }
  return out
}

/** Search AniList directly (for the wishlist) and fold results into the catalog. */
export async function searchCharacters(db: DB, search: string): Promise<CatalogCharacter[]> {
  const data = await query({ query: SEARCH_QUERY, variables: { search, perPage: 12 } })
  const chars = (data.Page.characters as any[])
    .map((c) => toCatalog(c))
    .filter((c): c is CatalogCharacter => c !== null)
  if (chars.length > 0) upsertCharacters(db, chars)
  return chars
}

export interface CrawlStatus {
  page: number
  total: number
  characters: number
  running: boolean
  done: boolean
  error: string | null
  bytes: number
  maxBytes: number
}

let crawling = false
let lastError: string | null = null

export function catalogSize(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM characters').get() as { n: number }).n
}

export function crawlStatus(db: DB): CrawlStatus {
  const page = Number(getMeta(db, 'crawl_page') ?? '0')
  return {
    page,
    total: TOTAL_STEPS,
    characters: catalogSize(db),
    running: crawling,
    done: getMeta(db, 'crawl_done') === '1',
    error: lastError,
    bytes: dbBytes(db),
    maxBytes: MAX_DB_BYTES,
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Walk every segment once, resuming where a previous run stopped. Safe to call
 * on every boot: it returns immediately when the crawl is already done.
 *
 * Progress is one global step counter across all segments, so a restart picks
 * up mid-segment without needing to know which one it was in.
 */
export async function startCrawl(db: DB, force = false): Promise<void> {
  if (crawling) return
  if (!force && getMeta(db, 'crawl_done') === '1') return
  crawling = true
  lastError = null
  const from = force ? 1 : Number(getMeta(db, 'crawl_page') ?? '0') + 1
  const eta = Math.round(((TOTAL_STEPS - from + 1) * CRAWL_DELAY_MS) / 3_600_000)
  console.log(
    `[catalog] crawl starting at step ${from}/${TOTAL_STEPS}, ` +
      `${(CRAWL_DELAY_MS / 1000).toFixed(0)}s apart (about ${eta}h)`,
  )
  try {
    // A run of pages that all failed outright means AniList is down or the
    // shape of the query is wrong, and grinding on would burn hours to record
    // a catalog full of holes as "done". One bad page on its own is skipped:
    // over hundreds of requests, the odd refusal is normal, and it should not
    // cost the segments that come after it.
    let deadPages = 0
    for (let step = from; step <= TOTAL_STEPS; step++) {
      const size = dbBytes(db)
      if (size >= MAX_DB_BYTES) {
        lastError = `Database reached its ${(MAX_DB_BYTES / 1048576).toFixed(0)} MB ceiling; crawl stopped.`
        console.warn(`[catalog] ${lastError}`)
        return
      }
      const { segment, page } = stepTarget(step)
      let attempt = 0
      for (;;) {
        try {
          const chars = await fetchMediaPage(segment, page)
          upsertCharacters(db, chars)
          setMeta(db, 'crawl_page', String(step))
          deadPages = 0
          break
        } catch (e) {
          attempt++
          lastError = e instanceof Error ? e.message : String(e)
          if (attempt >= 5) {
            deadPages++
            console.warn(`[catalog] skipping ${segment.label} page ${page}: ${lastError}`)
            setMeta(db, 'crawl_page', String(step))
            if (deadPages >= 5) throw e
            break
          }
          // Back off hard on a rate limit; the crawl has nowhere to be.
          await sleep(5000 * attempt)
        }
      }
      if (step % 25 === 0) {
        console.log(
          `[catalog] step ${step}/${TOTAL_STEPS} (${segment.label} page ${page}), ` +
            `${catalogSize(db)} characters`,
        )
      }
      await sleep(CRAWL_DELAY_MS)
    }
    setMeta(db, 'crawl_done', '1')
    // The catalog just grew by tens of thousands of rows, which is exactly
    // when the planner's statistics stop being true. Raids count a series
    // against a collection and get this wrong by two orders of magnitude.
    db.pragma('optimize')
    lastError = null
    console.log(`[catalog] crawl complete, ${catalogSize(db)} characters`)
  } catch (e) {
    console.error('[catalog] crawl stopped:', e instanceof Error ? e.message : e)
  } finally {
    crawling = false
  }
}

const genderClause = (pref: RollGender) =>
  pref === 'everyone' ? '' : pref === 'female' ? "AND gender = 'Female'" : "AND gender = 'Male'"

/**
 * The favourites floor that defines "the top N characters". Cheap enough to
 * run per roll, and it makes poolSize mean exactly what it says, instead of
 * the page-window approximation the client used to make.
 *
 * The default pool is the whole catalog, which has no floor to find: skipping
 * the query there saves walking the entire favourites index on every roll to
 * learn that there is no thousandth-thousandth row.
 */
function poolFloor(db: DB, poolSize: number, pref: RollGender): number {
  if (poolSize >= POOL_EVERYTHING) return 0
  const row = db
    .prepare(
      `SELECT favourites FROM characters WHERE 1=1 ${genderClause(pref)}
        ORDER BY favourites DESC LIMIT 1 OFFSET ?`,
    )
    .get(Math.max(0, poolSize - 1)) as { favourites: number } | undefined
  return row?.favourites ?? 0
}

export interface PoolPick extends CatalogCharacter {}

function rowToCharacter(r: any): PoolPick {
  return {
    id: r.id,
    name: r.name,
    nativeName: r.native_name,
    image: r.image,
    gender: r.gender,
    favourites: r.favourites,
    series: r.series,
    creditValue: r.credit_value,
    aliases: JSON.parse(r.aliases_json),
    covers: JSON.parse(r.covers_json),
  }
}

export function getCharacter(db: DB, id: number): PoolPick | null {
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id)
  return row ? rowToCharacter(row) : null
}

/** Draw `count` distinct characters from a player's pool. */
export function drawFromPool(
  db: DB,
  count: number,
  pref: RollGender,
  poolSize: number,
): PoolPick[] {
  const floor = poolFloor(db, poolSize, pref)
  const rows = db
    .prepare(
      `SELECT * FROM characters
        WHERE favourites >= @floor ${genderClause(pref)}
        ORDER BY RANDOM() LIMIT @count`,
    )
    .all({ floor, count })
  return rows.map(rowToCharacter)
}

/**
 * Draw from one series.
 *
 * Backs Called Shot: a player who has named a series gets a share of every
 * pull from it, which is the only way in the game to collect on purpose rather
 * than by waiting. Ignores the pool floor -- the point of aiming is to reach
 * the cast of a series, and a raid asks for the whole cast, not the popular
 * half of it.
 */
export function drawFromSeries(db: DB, series: string, count: number): PoolPick[] {
  if (count <= 0) return []
  const rows = db
    .prepare(`SELECT * FROM characters WHERE series = @series ORDER BY RANDOM() LIMIT @count`)
    .all({ series, count })
  return (rows as any[]).map(rowToCharacter)
}

/**
 * Draw characters worth at least `minValue`, from the same pool a normal roll
 * uses. Backs the Emerald guarantee: a pack that came up short is topped up
 * rather than re-rolled, so the promise costs one query and never loops.
 * Returns fewer than asked -- possibly none -- when the pool holds nobody that
 * good, which is the honest answer on an instance whose crawl has barely
 * started.
 *
 * A whole pull's guarantees are drawn at once. Every wrapper promises its own
 * floor, so this used to run per wrapper, and a shuffle of the catalog against
 * a thousand already-dealt ids is not a cheap query: two dozen wrappers was
 * three quarters of a second of the summon spent asking the same question two
 * dozen times.
 */
export function drawAboveValue(
  db: DB,
  minValue: number,
  pref: RollGender,
  poolSize: number,
  exclude: number[],
  count: number,
): PoolPick[] {
  if (count <= 0) return []
  const floor = poolFloor(db, poolSize, pref)
  const holes = exclude.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT * FROM characters
        WHERE favourites >= @floor AND credit_value >= @min ${genderClause(pref)}
          ${exclude.length ? `AND id NOT IN (${holes})` : ''}
        ORDER BY RANDOM() LIMIT @count`,
    )
    .all({ floor, min: minValue, count }, ...exclude)
  return (rows as any[]).map(rowToCharacter)
}
