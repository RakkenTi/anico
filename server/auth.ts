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
import { EMPTY_BADGES } from '../src/game/badges.js'
import { EMPTY_UPGRADES } from '../src/game/upgrades.js'
import { DEFAULT_SETTINGS, type ServerSettings } from './rules.js'

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
 * Judge a username.
 *
 * One place, because signing up and renaming have to agree: a name nobody
 * could have registered is a name nobody should be able to move to.
 */
export function checkUsername(name: string): string | null {
  if (name.length < 2 || name.length > 24) return 'Username must be 2 to 24 characters.'
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
    return 'Username may use letters, numbers, dot, dash and underscore.'
  }
  return null
}

/** Thrown inside the registration transaction when the invite ran out first. */
class InviteSpent extends Error {}

/**
 * Register an account. The first registration on a fresh instance becomes the
 * admin; every later one must present an invite with a seat left on it.
 */
export async function register(
  db: DB,
  username: string,
  password: string,
  invite: string | undefined,
): Promise<CreateResult | CreateError> {
  const name = username.trim()
  const badName = checkUsername(name)
  if (badName) return { ok: false, error: badName }
  if (password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' }
  }

  const first = playerCount(db) === 0
  let inviteRow: { code: string; max_uses: number; uses: number } | undefined
  if (!first) {
    const code = (invite ?? '').trim()
    if (!code) return { ok: false, error: 'An invite is required to register on this instance.' }
    inviteRow = db
      .prepare('SELECT code, max_uses, uses FROM invites WHERE code = ? AND revoked_at IS NULL')
      .get(code) as { code: string; max_uses: number; uses: number } | undefined
    if (!inviteRow) return { ok: false, error: 'That invite is not valid.' }
    if (inviteRow.max_uses > 0 && inviteRow.uses >= inviteRow.max_uses) {
      return { ok: false, error: 'That invite has been used up.' }
    }
  }

  const taken = db.prepare('SELECT 1 FROM players WHERE username_lower = ?').get(name.toLowerCase())
  if (taken) return { ok: false, error: 'That username is taken.' }

  const hash = await hashPassword(password)
  const now = Date.now()
  const settings: ServerSettings = { ...DEFAULT_SETTINGS }

  const player = db.transaction(() => {
    // Hashing a password takes long enough for two people to arrive on the
    // same link, so the seat is taken here rather than counted above: the
    // update only lands while there is one left, and no seat means no account.
    if (inviteRow) {
      const seat = db
        .prepare(
          `UPDATE invites SET uses = uses + 1
            WHERE code = ? AND revoked_at IS NULL AND (max_uses = 0 OR uses < max_uses)`,
        )
        .run(inviteRow.code).changes
      if (seat === 0) throw new InviteSpent()
    }
    const info = db
      .prepare(
        `INSERT INTO players (username, username_lower, password_hash, is_admin, sandbox, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(name, name.toLowerCase(), hash, first ? 1 : 0, first ? 1 : 0, now)
    const id = Number(info.lastInsertRowid)
    db.prepare(
      `INSERT INTO player_state (player_id, credits, badges_json, upgrades_json, settings_json)
       VALUES (?, 0, ?, ?, ?)`,
    ).run(id, JSON.stringify(EMPTY_BADGES), JSON.stringify(EMPTY_UPGRADES), JSON.stringify(settings))
    if (inviteRow) {
      db.prepare(
        'INSERT OR IGNORE INTO invite_uses (code, player_id, used_at) VALUES (?, ?, ?)',
      ).run(inviteRow.code, id, now)
    }
    return {
      id,
      username: name,
      is_admin: first ? 1 : 0,
      sandbox: first ? 1 : 0,
      sandbox_of: null,
      sandbox_active: 0,
    }
  })

  try {
    return { ok: true, player: player() }
  } catch (e) {
    if (e instanceof InviteSpent) return { ok: false, error: 'That invite has been used up.' }
    throw e
  }
}

/**
 * Change the name on an account.
 *
 * The account, never the sandbox shadow: the shadow wears its owner's name
 * with a tag on it and is renamed alongside, so leaving the sandbox does not
 * hand back a profile still labelled with the old one.
 */
export function renamePlayer(db: DB, owner: Player, username: string): CreateResult | CreateError {
  const name = username.trim()
  const bad = checkUsername(name)
  if (bad) return { ok: false, error: bad }
  const id = owner.sandbox_of ?? owner.id
  const lower = name.toLowerCase()
  const taken = db
    .prepare('SELECT 1 FROM players WHERE username_lower = ? AND id <> ?')
    .get(lower, id)
  if (taken) return { ok: false, error: 'That username is taken.' }

  db.transaction(() => {
    db.prepare('UPDATE players SET username = ?, username_lower = ? WHERE id = ?').run(name, lower, id)
    db.prepare('UPDATE players SET username = ? WHERE sandbox_of = ?').run(`${name} (sandbox)`, id)
  })()
  return { ok: true, player: { ...owner, username: name } }
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

/** Confirm a password against one account, without naming it. */
export async function checkPassword(db: DB, playerId: number, password: string): Promise<boolean> {
  const row = db.prepare('SELECT password_hash FROM players WHERE id = ?').get(playerId) as
    | { password_hash: string }
    | undefined
  // Hash on a miss too, so a bad id and a bad password cost the same.
  return verifyPassword(password, row?.password_hash ?? 'scrypt$00$00')
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
          `INSERT INTO player_state (player_id, credits, badges_json, upgrades_json, settings_json)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(
          id,
          250_000,
          JSON.stringify(EMPTY_BADGES),
          JSON.stringify(EMPTY_UPGRADES),
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

export const INVITE_USES_MAX = 1000

/**
 * Mint an invite.
 *
 * `maxUses` of zero is a standing link: the shape a group chat wants, where
 * the admin is not minting a code per person and chasing which one went to
 * whom. Anything else is a seat count, and the link stops working when the
 * seats are gone.
 */
export function createInvite(db: DB, adminId: number, maxUses = 1): Invite {
  const seats = Number.isFinite(maxUses)
    ? Math.min(INVITE_USES_MAX, Math.max(0, Math.floor(maxUses)))
    : 1
  const code = randomBytes(9).toString('base64url')
  db.prepare(
    'INSERT INTO invites (code, created_by, created_at, max_uses) VALUES (?, ?, ?, ?)',
  ).run(code, adminId, Date.now(), seats)
  return { code, created_at: Date.now(), max_uses: seats, uses: 0, revoked_at: null, used_by: [] }
}

export interface Invite {
  code: string
  created_at: number
  /** Seats on this link. Zero is unlimited. */
  max_uses: number
  uses: number
  revoked_at: number | null
  /** Everyone who joined through it, in the order they arrived. */
  used_by: string[]
}

export function listInvites(db: DB, limit = 50): Invite[] {
  const rows = db
    .prepare(
      `SELECT code, created_at, max_uses, uses, revoked_at
         FROM invites ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as Omit<Invite, 'used_by'>[]
  const names = db.prepare(
    `SELECT p.username FROM invite_uses u JOIN players p ON p.id = u.player_id
      WHERE u.code = ? ORDER BY u.used_at`,
  )
  return rows.map((r) => ({
    ...r,
    used_by: (names.all(r.code) as { username: string }[]).map((n) => n.username),
  }))
}

/**
 * Take a link out of circulation.
 *
 * One that nobody has used is deleted outright; one that somebody joined
 * through is marked instead, because it is the record of how that account came
 * to exist and deleting it would orphan them.
 */
export function revokeInvite(db: DB, code: string): boolean {
  const row = db.prepare('SELECT uses FROM invites WHERE code = ?').get(code) as
    | { uses: number }
    | undefined
  if (!row) return false
  if (row.uses === 0) db.prepare('DELETE FROM invites WHERE code = ?').run(code)
  else db.prepare('UPDATE invites SET revoked_at = ? WHERE code = ?').run(Date.now(), code)
  return true
}
