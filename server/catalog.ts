/**
 * The catalog: the instance's own table of characters.
 *
 * AniList is reached from the server, never the browser. One instance shares
 * one ~90 request/minute budget, so uncoordinated per-player calls would trip
 * limits nobody could diagnose. A background crawl at first boot walks the
 * reachable pool (330 pages x ~250 characters, a few minutes) and after that
 * rolls are a local SELECT: instant, and unaffected by AniList being down.
 */

import type { DB } from './db.js'
import { getMeta, setMeta } from './db.js'
import { creditValue } from '../src/game/economy.js'
import type { RollGender } from './rules.js'

const ENDPOINT = 'https://graphql.anilist.co'
const MEDIA_PER_PAGE = 15
/** AniList rejects offset pagination past 5000 entries; 5000/15 = 333 pages. */
export const MAX_MEDIA_PAGE = 330
/** Stay well under the documented 90/min so other traffic is never starved. */
const CRAWL_DELAY_MS = 1100

const MEDIA_QUERY = `
query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(sort: POPULARITY_DESC, type: ANIME) {
      title { romaji english }
      coverImage { large }
      characters(page: 1, perPage: 20, sort: FAVOURITES_DESC) {
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
       gender = excluded.gender, favourites = excluded.favourites, series = excluded.series,
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

async function fetchMediaPage(page: number): Promise<CatalogCharacter[]> {
  const data = await query({ query: MEDIA_QUERY, variables: { page, perPage: MEDIA_PER_PAGE } })
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
    total: MAX_MEDIA_PAGE,
    characters: catalogSize(db),
    running: crawling,
    done: getMeta(db, 'crawl_done') === '1',
    error: lastError,
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Walk the reachable pool once, resuming where a previous run stopped. Safe to
 * call on every boot: it returns immediately when the crawl is already done.
 */
export async function startCrawl(db: DB, force = false): Promise<void> {
  if (crawling) return
  if (!force && getMeta(db, 'crawl_done') === '1') return
  crawling = true
  lastError = null
  const from = force ? 1 : Number(getMeta(db, 'crawl_page') ?? '0') + 1
  console.log(`[catalog] crawl starting at page ${from}/${MAX_MEDIA_PAGE}`)
  try {
    for (let page = from; page <= MAX_MEDIA_PAGE; page++) {
      let attempt = 0
      for (;;) {
        try {
          const chars = await fetchMediaPage(page)
          upsertCharacters(db, chars)
          setMeta(db, 'crawl_page', String(page))
          break
        } catch (e) {
          attempt++
          lastError = e instanceof Error ? e.message : String(e)
          if (attempt >= 5) throw e
          // Back off hard on a rate limit; the crawl has nowhere to be.
          await sleep(5000 * attempt)
        }
      }
      if (page % 25 === 0) {
        console.log(`[catalog] page ${page}/${MAX_MEDIA_PAGE}, ${catalogSize(db)} characters`)
      }
      await sleep(CRAWL_DELAY_MS)
    }
    setMeta(db, 'crawl_done', '1')
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
 */
function poolFloor(db: DB, poolSize: number, pref: RollGender): number {
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
  excludeOwnedBy: number | null,
): PoolPick[] {
  const floor = poolFloor(db, poolSize, pref)
  const exclude = excludeOwnedBy
    ? 'AND id NOT IN (SELECT character_id FROM claims WHERE player_id = @player)'
    : ''
  const rows = db
    .prepare(
      `SELECT * FROM characters
        WHERE favourites >= @floor ${genderClause(pref)} ${exclude}
        ORDER BY RANDOM() LIMIT @count`,
    )
    .all({ floor, count, player: excludeOwnedBy ?? 0 })
  return rows.map(rowToCharacter)
}
