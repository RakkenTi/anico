/**
 * Thin wrapper over the instance API. Every call carries the session cookie,
 * and every failure arrives as an ApiError with the server's own message, so
 * the UI can show what actually happened instead of "something went wrong".
 */

import type { OwnedCharacter, RolledCharacter } from './game/types'
import type { Badges } from './game/badges'
import type { Upgrades } from './game/upgrades'
import type { Contract, Musterer } from './game/contracts'
import type { Ranks } from './game/ranks'

export type { RankBoard, RankRow, RankUnit, Ranks } from './game/ranks'

/** An invite link, as the admin panel sees it. */
export interface Invite {
  code: string
  created_at: number
  /** Seats on this link. Zero is a standing link with no limit. */
  max_uses: number
  uses: number
  revoked_at: number | null
  /** Everyone who joined through it, in the order they arrived. */
  used_by: string[]
}

export type AutoSell = 'off' | 'rare' | 'epic' | 'legendary' | 'mythic'

export interface ServerSettings {
  rollGender: 'female' | 'male' | 'everyone'
  /** Sell every pull below this rarity as it lands. */
  autoSell: AutoSell
  /** Let Auto Aim point Called Shot at the closest contracts. */
  autoAim: boolean
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
  /** What one card is worth to this player: every payout is quoted against it. */
  creditsPerCard: number
  /** The series Called Shot is pointed at. */
  aimSeries: string[]
  board: Contract[]
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

/**
 * Where `/api` is.
 *
 * Normally it is over the wire, at the origin that served this bundle. The
 * demo build hands over a whole instance running in the tab instead, so the
 * two calls below are the only place in the client that has to know which.
 * `listen` is absent there: a tab cannot disagree with itself, and every
 * mutating route already answers with the authoritative snapshot.
 */
export interface Instance {
  fetch: (path: string, init?: RequestInit) => Promise<Response>
  listen?: (onState: (s: Snapshot) => void, onBuild: (id: string) => void) => () => void
}

let instance: Instance | null = null

export function useInstance(next: Instance): void {
  instance = next
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const options: RequestInit = {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  }
  const res = instance ? await instance.fetch(path, options) : await fetch(`/api${path}`, options)
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
export function listenForState(
  onState: (s: Snapshot) => void,
  onBuild: (id: string) => void,
): () => void {
  if (instance) return instance.listen ? instance.listen(onState, onBuild) : () => {}
  if (typeof EventSource === 'undefined') return () => {}
  const source = new EventSource('/api/events')
  source.addEventListener('state', (e) => {
    try {
      onState(JSON.parse((e as MessageEvent).data) as Snapshot)
    } catch {
      /* a half-written frame is not worth a crash */
    }
  })
  /*
   * The instance says what it is on every stream it opens, and EventSource
   * opens a new one by itself the moment the old one drops. So a restart on a
   * new image announces itself here, with no polling and nothing to schedule.
   */
  source.addEventListener('version', (e) => {
    try {
      onBuild(String((JSON.parse((e as MessageEvent).data) as { build: string }).build))
    } catch {
      /* likewise */
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
  /** What the instance is running. Compared against what this tab booted on. */
  version: () => request<{ build: string }>('/version'),
  ranks: () => request<Ranks>('/ranks'),
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
  setAim: (series: string[]) => post<{ state: Snapshot }>('/aim', { series }),
  /** `count` is levels, or 'max' for as many as the balance covers. */
  buyUpgrade: (key: string, count: number | 'max' = 1) =>
    post<{ state: Snapshot }>('/upgrade', { key, count }),
  updateSettings: (patch: Partial<ServerSettings>) =>
    request<{ state: Snapshot }>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  grant: (amount: number) => post<{ state: Snapshot }>('/grant', { amount }),
  reset: (username: string, password: string) =>
    post<{ state: Snapshot }>('/reset', { username, password }),
  rename: (username: string, password: string) =>
    post<{ state: Snapshot }>('/rename', { username, password }),

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
  adminInvites: () => request<{ invites: Invite[] }>('/admin/invites'),
  /** `maxUses` of 0 is a standing link with no seat count. */
  createInvite: (maxUses: number) => post<{ invite: Invite }>('/admin/invites', { maxUses }),
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
