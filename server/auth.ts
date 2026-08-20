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
  /** Permission to enter sandbox mode, not a state of being in it. */
  sandbox: number
  /** Set on a shadow profile: the account it belongs to. Null on real players. */
  sandbox_of: number | null
  /** Set on a real player: whether they are currently playing in the sandbox. */
  sandbox_active: number
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
    return {
      id,
      username: name,
      is_admin: first ? 1 : 0,
      sandbox: first ? 1 : 0,
      sandbox_of: null,
      sandbox_active: 0,
    }
  })()

  return { ok: true, player }
}

export async function login(
  db: DB,
  username: string,
  password: string,
): Promise<CreateResult | CreateError> {
  const row = db
    .prepare(
      `SELECT id, username, password_hash, is_admin, sandbox, sandbox_of, sandbox_active
         FROM players WHERE username_lower = ?`,
    )
    .get(username.trim().toLowerCase()) as
    | { id: number; username: string; password_hash: string; is_admin: number; sandbox: number }
    | undefined
  // Hash anyway on a miss so a wrong username and a wrong password cost the same.
  const stored = row?.password_hash ?? 'scrypt$00$00'
  const ok = await verifyPassword(password, stored)
  if (!row || !ok) return { ok: false, error: 'Wrong username or password.' }
  return { ok: true, player: toPlayer(row) }
}

/** Confirm a player's own password, for actions that should not be one click. */
export async function verifyPlayerPassword(
  db: DB,
  player: Player,
  username: string,
  password: string,
): Promise<boolean> {
  const row = db
    .prepare('SELECT username_lower, password_hash FROM players WHERE id = ?')
    .get(player.sandbox_of ?? player.id) as
    | { username_lower: string; password_hash: string }
    | undefined
  if (!row) return false
  if (row.username_lower !== username.trim().toLowerCase()) {
    // Hash anyway, so a wrong name and a wrong password take the same time.
    await verifyPassword(password, row.password_hash)
    return false
  }
  return verifyPassword(password, row.password_hash)
}

export function createSession(db: DB, playerId: number): string {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  db.prepare(
    'INSERT INTO sessions (token_hash, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(hashToken(token), playerId, now, now + SESSION_DAYS * 86_400_000)
  return token
}

const PLAYER_COLS = 'p.id, p.username, p.is_admin, p.sandbox, p.sandbox_of, p.sandbox_active'

const toPlayer = (r: any): Player => ({
  id: r.id,
  username: r.username,
  is_admin: r.is_admin,
  sandbox: r.sandbox,
  sandbox_of: r.sandbox_of ?? null,
  sandbox_active: r.sandbox_active ?? 0,
})

export function playerForToken(db: DB, token: string | undefined): Player | null {
  if (!token) return null
  const row = db
    .prepare(
      `SELECT ${PLAYER_COLS}, s.expires_at
         FROM sessions s JOIN players p ON p.id = s.player_id
        WHERE s.token_hash = ?`,
    )
    .get(hashToken(token)) as any
  if (!row) return null
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
    return null
  }
  return toPlayer(row)
}

/**
 * The profile a player's game actions apply to.
 *
 * With sandbox switched on this is a shadow profile carrying its own credits,
 * collection and wishes, so anything done while testing lands there instead of
 * on the collection they care about. It is created on demand and destroyed the
 * moment sandbox is switched off.
 */
export function activeProfile(db: DB, player: Player): Player {
  if (!player.sandbox_active || !player.sandbox) return player
  const row = db
    .prepare(`SELECT ${PLAYER_COLS} FROM players p WHERE p.sandbox_of = ?`)
    .get(player.id) as any
  return row ? toPlayer(row) : player
}

/**
 * Enter or leave sandbox mode.
 *
 * Entering mints a shadow profile with an empty collection and a pile of
 * credits to play with. Leaving deletes it outright, taking its claims and
 * wishes with it: sandbox progress is meant to evaporate, and keeping it would
 * turn a testing toy into a second save nobody asked to maintain.
 */
export function setSandboxActive(db: DB, player: Player, on: boolean): void {
  if (!player.sandbox) throw new Error('Sandbox is not enabled for this account.')
  db.transaction(() => {
    if (on) {
      const existing = db
        .prepare('SELECT id FROM players WHERE sandbox_of = ?')
        .get(player.id) as { id: number } | undefined
      if (!existing) {
        const now = Date.now()
        const info = db
          .prepare(
            `INSERT INTO players
               (username, username_lower, password_hash, is_admin, sandbox, sandbox_of, created_at)
             VALUES (?, ?, '', ?, 1, ?, ?)`,
          )
          // No usable password hash: a shadow profile is reached by toggling,
          // never by logging into it.
          .run(`${player.username} (sandbox)`, `${player.id}\u0000sandbox`, player.is_admin, player.id, now)
        const id = Number(info.lastInsertRowid)
        const settings: ServerSettings = { ...DEFAULT_SETTINGS }
        db.prepare(
          `INSERT INTO player_state
             (player_id, credits, rolls_left, rolls_reset_at, badges_json, settings_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          25_000,
          PACING.rollsPerHour,
          now + PACING.rollResetMinutes * 60_000,
          JSON.stringify({ bronze: 0, silver: 0, gold: 0, sapphire: 0, ruby: 0, emerald: 0 }),
          JSON.stringify(settings),
        )
      }
      db.prepare('UPDATE players SET sandbox_active = 1 WHERE id = ?').run(player.id)
    } else {
      db.prepare('DELETE FROM players WHERE sandbox_of = ?').run(player.id)
      db.prepare('UPDATE players SET sandbox_active = 0 WHERE id = ?').run(player.id)
    }
  })()
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
