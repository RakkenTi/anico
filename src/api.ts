/**
 * Thin wrapper over the instance API. Every call carries the session cookie,
 * and every failure arrives as an ApiError with the server's own message, so
 * the UI can show what actually happened instead of "something went wrong".
 */

import type { OwnedCharacter, RolledCharacter } from './game/types'
import type { Badges } from './game/badges'
import type { Upgrades } from './game/upgrades'
import type { Works } from './game/industry'
import type { Contract, Musterer, Pinned } from './game/contracts'

export type AutoSell = 'off' | 'rare' | 'epic' | 'legendary' | 'mythic'

export interface ServerSettings {
  rollGender: 'female' | 'male' | 'everyone'
  /** Sell every pull below this rarity as it lands. */
  autoSell: AutoSell
  skipOwned: boolean
}

/** What a demand paid, and who the instance says went out to earn it. */
export interface RaidPayout {
  reward: number
  series: string
  breadth: number
  depth: number
  roster: Musterer[]
}

export interface Snapshot {
  username: string
  isAdmin: boolean
  sandbox: boolean
  sandboxAllowed: boolean
  credits: number
  /** How wide a net every roll on this instance casts. The admin sets it. */
  poolSize: number
  /** Moves whenever the collection changes, including on another device. */
  collectionRev: number
  /** The works: see ADR 0014. Spare fractions short of a whole scrap. */
  /** Everything the works are doing right now (ADR 0014). */
  works: Works
  /** What one card is worth to this player: every payout is quoted against it. */
  creditsPerCard: number
  /** The series Called Shot is pointed at. */
  aimSeries: string | null
  board: { raids: Contract[]; commissions: Pinned[] }
  /** Cards a pack deals, or 0 while the shop has not unlocked them yet. */
  packSize: number
  /** Packs torn at a single press. */
  packsPerPull: number
  /** Cards one press draws, ceiling applied. */
  cardsPerPull: number
  /** What one press costs: every card in the pull. */
  packPrice: number
  /** Milliseconds between automatic pulls, or 0 while the Automaton is unbought. */
  autoSpinMs: number
  /** The Automaton is switched on. Server-side, so a closed tab keeps it running. */
  autoSpin: boolean
  /** Cards a second the opening animation manages (Swift Hands). */
  cardRate: number
  lastDailyAt: number
  dailyStreak: number
  totalRolls: number
  totalClaims: number
  badges: Badges
  upgrades: Upgrades
  settings: ServerSettings
  wishes: RolledCharacter[]
  /** Present only on calls that could have changed it. */
  collection?: OwnedCharacter[]
  /** What the Automaton did while the tab was closed. Absent when it did nothing. */
  offline?: { pulls: number; credits: number; minutes: number }
  serverNow: number
}

export interface RollResult {
  char: RolledCharacter
  owned: boolean
  wished: boolean
  compensation: number
  /** Granted by the pack that just produced it, rather than already owned. */
  fresh?: boolean
  /** The star of the stack this card joined, if it joined one. */
  stars?: number
  /** Queued by auto-sell: sold when the next summon starts, unless locked. */
  willSell?: boolean
  /** Kept on purpose. Set optimistically by the lock button. */
  locked?: boolean
}

/** Everything one press produced, beyond the cards it put on screen. */
export interface RollSummary {
  pack: boolean
  /** Stacks laid side by side on screen, each with its own wrapper. */
  packCount: number
  /** Cards in each of those stacks that arrive as real cards. */
  perPack: number
  /** Cards each pack actually holds: the number printed on the wrapper. */
  heldPerPack: number
  claimed: number
  bonus: number
  coins: number
  /** Cards this summon queued for auto-sell. */
  queued: number
  /** Cards the previous summon's queue just sold, and what they fetched. */
  swept: number
  sweptFor: number
  merged: number
  /** Wishes fulfilled, series sets completed: anything worth saying out loud. */
  notes: string[]
  /** Cards the pull held beyond what it dealt: appraised rather than shown. */
  hidden: number
  hiddenFor: number
  /** Spare fractions this pull shed, milled on arrival (ADR 0014). */
  spares: number
  /** Scrap the Press got out of them. */
  scrap: number
  /** Credits the Factory and the caravans paid on the back of this press. */
  melted: number
}

export interface SessionInfo {
  player: { username: string; isAdmin: boolean; sandbox: boolean } | null
  /** True on a fresh instance: the first account created becomes the admin. */
  needsSetup: boolean
}

export interface CatalogStatus {
  page: number
  total: number
  characters: number
  running: boolean
  done: boolean
  bytes: number
  maxBytes: number
  error: string | null
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status}).`, res.status)
  return data as T
}

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

/**
 * Live snapshots from the instance.
 *
 * One account can be open on several devices, each of them acting: the server
 * decides the order and pushes the result here, so a phone and a desktop never
 * disagree about the balance. `onState` is called with an authoritative
 * snapshot, minus the collection, which is fetched separately when its
 * revision moves.
 */
export function listenForState(onState: (s: Snapshot) => void): () => void {
  if (typeof EventSource === 'undefined') return () => {}
  const source = new EventSource('/api/events')
  source.addEventListener('state', (e) => {
    try {
      onState(JSON.parse((e as MessageEvent).data) as Snapshot)
    } catch {
      /* a half-written frame is not worth a crash */
    }
  })
  return () => source.close()
}

export const api = {
  me: () => request<SessionInfo>('/auth/me'),
  register: (username: string, password: string, invite?: string) =>
    post<{ player: SessionInfo['player'] }>('/auth/register', { username, password, invite }),
  login: (username: string, password: string) =>
    post<{ player: SessionInfo['player'] }>('/auth/login', { username, password }),
  logout: () => post<{ ok: true }>('/auth/logout'),

  state: () => request<Snapshot>('/state'),
  catalog: () => request<CatalogStatus>('/catalog'),

  /** `packs` is how many wrappers to tear: zero is the free single card. */
  roll: (packs: number) =>
    post<RollSummary & { results: RollResult[]; state: Snapshot }>('/roll', { packs }),
  autoSpin: (on: boolean) => post<{ state: Snapshot }>('/auto', { on }),
  sandbox: (on: boolean) => post<{ state: Snapshot }>('/sandbox', { on }),
  daily: () => post<{ state: Snapshot; amount: number; streak: number }>('/daily'),
  lock: (characterId: number, locked: boolean) =>
    post<{ state: Snapshot }>('/lock', { characterId, locked }),
  sell: (ids: number[]) => post<{ state: Snapshot; total: number; sold: number }>('/sell', { ids }),
  addWish: (characterId: number) => post<{ state: Snapshot }>('/wish', { characterId }),
  removeWish: (characterId: number) =>
    request<{ state: Snapshot }>(`/wish/${characterId}`, { method: 'DELETE' }),
  search: (q: string) => request<{ results: RolledCharacter[] }>(`/search?q=${encodeURIComponent(q)}`),
  buyBadge: (key: string) => post<{ state: Snapshot }>('/badge', { key }),

  /* The board (ADR 0013). */
  raid: (id: number) => post<{ state: Snapshot } & RaidPayout>(`/raid/${id}`),
  accept: (id: number) => post<{ state: Snapshot }>(`/commission/${id}`),
  claimCommission: (id: number) =>
    post<{ state: Snapshot } & RaidPayout>(`/commission/${id}/claim`),
  abandon: (id: number) => request<{ state: Snapshot }>(`/commission/${id}`, { method: 'DELETE' }),
  slam: () => post<{ state: Snapshot; melted: number; paid: number }>('/works/slam'),
  sendExpedition: (route: string) => post<{ state: Snapshot }>('/expedition', { route }),
  collectExpedition: (id: number) =>
    post<{ state: Snapshot; paid: number; route: string }>(`/expedition/${id}/collect`),
  setAim: (series: string | null) => post<{ state: Snapshot }>('/aim', { series }),
  buyUpgrade: (key: string) => post<{ state: Snapshot }>('/upgrade', { key }),
  updateSettings: (patch: Partial<ServerSettings>) =>
    request<{ state: Snapshot }>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  grant: (amount: number) => post<{ state: Snapshot }>('/grant', { amount }),
  reset: (username: string, password: string) =>
    post<{ state: Snapshot }>('/reset', { username, password }),

  adminUsers: () =>
    request<{
      users: {
        id: number
        username: string
        is_admin: number
        sandbox: number
        claims: number
        sessions: number
      }[]
    }>('/admin/users'),
  adminInvites: () =>
    request<{ invites: { code: string; created_at: number; used_at: number | null; used_by: string | null }[] }>(
      '/admin/invites',
    ),
  createInvite: () => post<{ code: string }>('/admin/invites'),
  setSandbox: (id: number, sandbox: boolean) =>
    request<{ ok: true }>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ sandbox }) }),
  revokeSessions: (id: number) =>
    request<{ revoked: number }>(`/admin/users/${id}/sessions`, { method: 'DELETE' }),
  deleteInvite: (code: string) =>
    request<{ ok: true }>(`/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  recrawl: () => post<{ ok: true }>('/admin/crawl'),
  setPool: (poolSize: number) =>
    request<{ poolSize: number }>('/admin/instance', {
      method: 'PATCH',
      body: JSON.stringify({ poolSize }),
    }),
}
