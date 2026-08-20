/**
 * Accounts, sessions and invites.
 *
 * Passwords are hashed with scrypt from node:crypto: no native dependency to
 * compile in the image, and no argument about parameters. Sessions are rows,
 * not tokens the server can't take back, so an admin can end one and logging
 * out actually ends it (see the ADR trail for why cookies over JWT).
 */

import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import type { DB } from './db.js'
import { DEFAULT_SETTINGS, PACING, type ServerSettings } from './rules.js'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const SCRYPT_KEYLEN = 64
const SESSION_DAYS = 30

export interface Player {
  id: number
  username: string
  is_admin: number
  sandbox: number
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(password, salt, SCRYPT_KEYLEN)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false
  const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN)
  const expected = Buffer.from(keyHex, 'hex')
  return key.length === expected.length && timingSafeEqual(key, expected)
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export function playerCount(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n
}

export interface CreateResult {
  ok: true
  player: Player
}
export interface CreateError {
  ok: false
  error: string
}

/**
 * Register an account. The first registration on a fresh instance becomes the
 * admin; every later one must present an unused invite.
 */
export async function register(
  db: DB,
  username: string,
  password: string,
  invite: string | undefined,
): Promise<CreateResult | CreateError> {
  const name = username.trim()
  if (name.length < 2 || name.length > 24) {
    return { ok: false, error: 'Username must be 2 to 24 characters.' }
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
    return { ok: false, error: 'Username may use letters, numbers, dot, dash and underscore.' }
  }
  if (password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' }
  }

  const first = playerCount(db) === 0
  let inviteRow: { code: string } | undefined
  if (!first) {
    const code = (invite ?? '').trim()
    if (!code) return { ok: false, error: 'An invite code is required to register on this instance.' }
    inviteRow = db
      .prepare('SELECT code FROM invites WHERE code = ? AND used_by IS NULL')
      .get(code) as { code: string } | undefined
    if (!inviteRow) return { ok: false, error: 'That invite code is not valid or has already been used.' }
  }

  const taken = db.prepare('SELECT 1 FROM players WHERE username_lower = ?').get(name.toLowerCase())
  if (taken) return { ok: false, error: 'That username is taken.' }

  const hash = await hashPassword(password)
  const now = Date.now()
  const settings: ServerSettings = { ...DEFAULT_SETTINGS }

  const player = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO players (username, username_lower, password_hash, is_admin, sandbox, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(name, name.toLowerCase(), hash, first ? 1 : 0, first ? 1 : 0, now)
    const id = Number(info.lastInsertRowid)
    db.prepare(
      `INSERT INTO player_state
         (player_id, credits, rolls_left, rolls_reset_at, badges_json, settings_json)
       VALUES (?, 0, ?, ?, ?, ?)`,
    ).run(
      id,
      PACING.rollsPerHour,
      now + PACING.rollResetMinutes * 60_000,
      JSON.stringify({ bronze: 0, silver: 0, gold: 0, sapphire: 0, ruby: 0, emerald: 0 }),
      JSON.stringify(settings),
    )
    if (inviteRow) {
      db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').run(id, now, inviteRow.code)
    }
    return { id, username: name, is_admin: first ? 1 : 0, sandbox: first ? 1 : 0 }
  })()

  return { ok: true, player }
}

export async function login(
  db: DB,
  username: string,
  password: string,
): Promise<CreateResult | CreateError> {
  const row = db
    .prepare('SELECT id, username, password_hash, is_admin, sandbox FROM players WHERE username_lower = ?')
    .get(username.trim().toLowerCase()) as
    | { id: number; username: string; password_hash: string; is_admin: number; sandbox: number }
    | undefined
  // Hash anyway on a miss so a wrong username and a wrong password cost the same.
  const stored = row?.password_hash ?? 'scrypt$00$00'
  const ok = await verifyPassword(password, stored)
  if (!row || !ok) return { ok: false, error: 'Wrong username or password.' }
  return { ok: true, player: { id: row.id, username: row.username, is_admin: row.is_admin, sandbox: row.sandbox } }
}

export function createSession(db: DB, playerId: number): string {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  db.prepare(
    'INSERT INTO sessions (token_hash, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(hashToken(token), playerId, now, now + SESSION_DAYS * 86_400_000)
  return token
}

export function playerForToken(db: DB, token: string | undefined): Player | null {
  if (!token) return null
  const row = db
    .prepare(
      `SELECT p.id, p.username, p.is_admin, p.sandbox, s.expires_at
         FROM sessions s JOIN players p ON p.id = s.player_id
        WHERE s.token_hash = ?`,
    )
    .get(hashToken(token)) as (Player & { expires_at: number }) | undefined
  if (!row) return null
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
    return null
  }
  return { id: row.id, username: row.username, is_admin: row.is_admin, sandbox: row.sandbox }
}

export function endSession(db: DB, token: string | undefined): void {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
}

/**
 * End every session belonging to one player, so a leaked or shared token can
 * actually be taken back. Sessions are rows precisely so this is possible.
 * Returns how many were revoked.
 */
export function endSessionsFor(db: DB, playerId: number): number {
  return db.prepare('DELETE FROM sessions WHERE player_id = ?').run(playerId).changes
}

export function purgeExpiredSessions(db: DB): void {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
}

export function createInvite(db: DB, adminId: number): string {
  const code = randomBytes(9).toString('base64url')
  db.prepare('INSERT INTO invites (code, created_by, created_at) VALUES (?, ?, ?)').run(
    code,
    adminId,
    Date.now(),
  )
  return code
}
