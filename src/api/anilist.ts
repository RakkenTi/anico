import type { Gender, RolledCharacter, RollGender } from '../game/types'
import { creditValue } from '../game/economy'

const ENDPOINT = 'https://graphql.anilist.co'

const MEDIA_PER_PAGE = 15
/** AniList rejects offset pagination past 5000 entries; 5000/15 = 333 pages. */
const MAX_MEDIA_PAGE = 330
/** Rough usable characters yielded per media page (15 series x ~17 chars). */
const CHARS_PER_MEDIA_PAGE = 250

// AniList caps Page(...){characters} pagination at 5000 entries, so deep
// pools cannot be reached by paging characters directly. Instead we page the
// top series by popularity and pull each one's most-favourited characters --
// one request yields ~250 rollable characters and reaches far beyond the
// top-5000 cutoff.
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

interface ApiCharacter {
  id: number
  name: { full: string | null; native: string | null; alternative?: (string | null)[] }
  image: { large: string | null }
  gender: string | null
  favourites: number
  media?: {
    nodes: {
      title: { romaji: string | null; english: string | null }
      coverImage?: { large: string | null }
    }[]
  }
}

interface ApiMedia {
  title: { romaji: string | null; english: string | null }
  coverImage?: { large: string | null }
  characters: { nodes: ApiCharacter[] }
}

function normalizeGender(raw: string | null): Gender {
  if (!raw) return 'Other'
  const g = raw.trim().toLowerCase()
  if (g.startsWith('female')) return 'Female'
  if (g.startsWith('male')) return 'Male'
  return 'Other'
}

function toRolled(c: ApiCharacter, seriesName?: string, seriesCover?: string | null): RolledCharacter | null {
  if (!c.name.full || !c.image.large) return null
  if (c.image.large.includes('/default.jpg')) return null
  const title = c.media?.nodes[0]?.title
  const aliases = (c.name.alternative ?? [])
    .filter((a): a is string => !!a && a.trim().length > 0 && a.trim() !== c.name.full)
    .map((a) => a.trim())
  const covers = [
    seriesCover,
    ...(c.media?.nodes.map((m) => m.coverImage?.large) ?? []),
  ].filter((u): u is string => !!u)
  return {
    id: c.id,
    name: c.name.full,
    nativeName: c.name.native,
    image: c.image.large,
    gender: normalizeGender(c.gender),
    favourites: c.favourites,
    series: seriesName ?? title?.english ?? title?.romaji ?? 'Unknown series',
    creditValue: creditValue(c.favourites),
    aliases: [...new Set(aliases)].slice(0, 6),
    covers: [...new Set(covers)].slice(0, 4),
  }
}

export function matchesGender(char: RolledCharacter, pref: RollGender): boolean {
  if (pref === 'everyone') return true
  if (pref === 'female') return char.gender === 'Female'
  return char.gender === 'Male'
}

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
        nodes {
          title { romaji english }
          coverImage { large }
        }
      }
    }
  }
}`

async function query(body: object): Promise<any> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 429) {
    throw new Error('AniList rate limit reached. Wait a few seconds and try again.')
  }
  if (!res.ok) {
    throw new Error(`AniList request failed (${res.status}). Try again shortly.`)
  }
  const json = await res.json()
  if (json.errors?.length) {
    throw new Error(json.errors[0].message ?? 'AniList query error')
  }
  return json.data
}

/** Search characters by name, for the wishlist. */
export async function searchCharacters(search: string): Promise<RolledCharacter[]> {
  const data = await query({ query: SEARCH_QUERY, variables: { search, perPage: 12 } })
  const chars: ApiCharacter[] = data.Page.characters
  return chars.map((c) => toRolled(c)).filter((c): c is RolledCharacter => c !== null)
}

async function fetchMediaPage(page: number): Promise<RolledCharacter[]> {
  const data = await query({ query: MEDIA_QUERY, variables: { page, perPage: MEDIA_PER_PAGE } })
  const media: ApiMedia[] = data.Page.media
  const out: RolledCharacter[] = []
  for (const m of media) {
    const series = m.title.english ?? m.title.romaji ?? 'Unknown series'
    for (const c of m.characters.nodes) {
      const rolled = toRolled(c, series, m.coverImage?.large)
      if (rolled) out.push(rolled)
    }
  }
  return out
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Fetch a fresh batch of rollable characters. The pool ("top N characters")
 * is approximated as the top N/250 pages of series by popularity; a random
 * page within that range is fetched and its series' characters are filtered
 * by gender preference (and optionally owned-exclusion), deduped and
 * shuffled. One request yields a couple hundred candidates, so the buffer
 * lasts for many rolls between API calls.
 */
export async function fetchRollBatch(
  poolSize: number,
  pref: RollGender,
  exclude: Set<number>,
): Promise<RolledCharacter[]> {
  const maxPage = Math.min(MAX_MEDIA_PAGE, Math.max(1, Math.round(poolSize / CHARS_PER_MEDIA_PAGE)))
  const seen = new Set<number>()
  let batch: RolledCharacter[] = []
  for (let attempt = 0; attempt < 3 && batch.length < 30; attempt++) {
    let page = 1 + Math.floor(Math.random() * maxPage)
    while (seen.has(page) && seen.size < maxPage) page = 1 + Math.floor(Math.random() * maxPage)
    seen.add(page)
    const chars = await fetchMediaPage(page)
    batch = batch.concat(
      chars.filter((c) => matchesGender(c, pref) && !exclude.has(c.id)),
    )
    if (seen.size >= maxPage) break
  }
  if (batch.length === 0) {
    throw new Error('No rollable characters matched your filters. Try widening the pool or gender preference in Settings.')
  }
  const unique = [...new Map(batch.map((c) => [c.id, c])).values()]
  return shuffle(unique)
}
