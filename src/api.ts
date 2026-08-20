/**
 * Thin wrapper over the instance API. Every call carries the session cookie,
 * and every failure arrives as an ApiError with the server's own message, so
 * the UI can show what actually happened instead of "something went wrong".
 */

import type { OwnedCharacter, RolledCharacter } from './game/types'
import type { Badges } from './game/badges'

export type Mode = 'fun' | 'normal'

export interface ServerSettings {
  mode: Mode
  rollGender: 'female' | 'male' | 'everyone'
  poolSize: number
  skipOwned: boolean
}

export interface Snapshot {
  username: string
  isAdmin: boolean
  sandbox: boolean
  sandboxAllowed: boolean
  credits: number
  rollsLeft: number
  rollsMax: number
  rollsResetAt: number
  /** When the once-a-day multi summon comes back around. */
  multiReadyAt: number
  multiSize: number
  nextClaimAt: number
  lastDailyAt: number
  dailyStreak: number
  lastRitualAt: number
  totalRolls: number
  totalClaims: number
  badges: Badges
  settings: ServerSettings
  pendingCoins: { tier: string; amount: number } | null
  wishes: RolledCharacter[]
  /** Present only on calls that could have changed it. */
  collection?: OwnedCharacter[]
  serverNow: number
}

export interface RollResult {
  char: RolledCharacter
  owned: boolean
  wished: boolean
  compensation: number
  /** Granted by the pack that just produced it, rather than already owned. */
  fresh?: boolean
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

export const api = {
  me: () => request<SessionInfo>('/auth/me'),
  register: (username: string, password: string, invite?: string) =>
    post<{ player: SessionInfo['player'] }>('/auth/register', { username, password, invite }),
  login: (username: string, password: string) =>
    post<{ player: SessionInfo['player'] }>('/auth/login', { username, password }),
  logout: () => post<{ ok: true }>('/auth/logout'),

  state: () => request<Snapshot>('/state'),
  catalog: () => request<CatalogStatus>('/catalog'),

  roll: (count: number) =>
    post<{ results: RollResult[]; pack: boolean; claimed: number; bonus: number; state: Snapshot }>(
      '/roll',
      { count },
    ),
  claim: (characterId: number) => post<{ state: Snapshot; notes: string[] }>('/claim', { characterId }),
  claimAll: () => post<{ state: Snapshot; claimed: number; bonus: number }>('/claim-all'),
  coins: () => post<{ state: Snapshot }>('/coins'),
  sandbox: (on: boolean) => post<{ state: Snapshot }>('/sandbox', { on }),
  daily: () => post<{ state: Snapshot; amount: number; streak: number }>('/daily'),
  ritual: () => post<{ state: Snapshot }>('/ritual'),
  sell: (ids: number[], bulk = false) =>
    post<{ state: Snapshot; total: number; sold: number }>('/sell', { ids, bulk }),
  addWish: (characterId: number) => post<{ state: Snapshot }>('/wish', { characterId }),
  removeWish: (characterId: number) =>
    request<{ state: Snapshot }>(`/wish/${characterId}`, { method: 'DELETE' }),
  search: (q: string) => request<{ results: RolledCharacter[] }>(`/search?q=${encodeURIComponent(q)}`),
  buyBadge: (key: string) => post<{ state: Snapshot }>('/badge', { key }),
  buyItem: (key: string) => post<{ state: Snapshot }>('/item', { key }),
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
}
