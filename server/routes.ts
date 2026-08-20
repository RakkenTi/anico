/**
 * HTTP surface. Every mutating route resolves the session first and hands the
 * player to the rules in game.ts; nothing here decides anything about the game.
 */

import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { DB } from './db.js'
import {
  createInvite,
  createSession,
  endSession,
  login,
  playerCount,
  playerForToken,
  register,
  type Player,
} from './auth.js'
import * as game from './game.js'
import { GameError } from './game.js'
import { crawlStatus, searchCharacters, startCrawl } from './catalog.js'

const COOKIE = 'anico_session'

export interface Config {
  cookieSecure: boolean
}

/** Crude login throttle: enough to make guessing pointless on a home server. */
const attempts = new Map<string, { n: number; until: number }>()
const THROTTLE_WINDOW = 15 * 60_000
const THROTTLE_MAX = 10

function throttled(key: string): boolean {
  const rec = attempts.get(key)
  if (!rec) return false
  if (Date.now() > rec.until) {
    attempts.delete(key)
    return false
  }
  return rec.n >= THROTTLE_MAX
}
function noteFailure(key: string): void {
  const rec = attempts.get(key)
  if (!rec || Date.now() > rec.until) attempts.set(key, { n: 1, until: Date.now() + THROTTLE_WINDOW })
  else rec.n++
}

export function createApp(db: DB, config: Config) {
  const app = new Hono<{ Variables: { player: Player } }>()

  const setSessionCookie = (c: any, token: string) =>
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.cookieSecure,
      path: '/',
      maxAge: 30 * 86_400,
    })

  const api = new Hono<{ Variables: { player: Player } }>()

  /* ------------------------------------------------------------------ auth */

  api.get('/auth/me', (c) => {
    const player = playerForToken(db, getCookie(c, COOKIE))
    return c.json({
      player: player
        ? { username: player.username, isAdmin: !!player.is_admin, sandbox: !!player.sandbox }
        : null,
      // A fresh instance tells the client to offer "create the admin account".
      needsSetup: playerCount(db) === 0,
    })
  })

  api.post('/auth/register', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const result = await register(db, String(body.username ?? ''), String(body.password ?? ''), body.invite)
    if (!result.ok) return c.json({ error: result.error }, 400)
    setSessionCookie(c, createSession(db, result.player.id))
    return c.json({
      player: {
        username: result.player.username,
        isAdmin: !!result.player.is_admin,
        sandbox: !!result.player.sandbox,
      },
    })
  })

  api.post('/auth/login', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const username = String(body.username ?? '')
    const key = username.toLowerCase()
    if (throttled(key)) return c.json({ error: 'Too many attempts. Wait a few minutes.' }, 429)
    const result = await login(db, username, String(body.password ?? ''))
    if (!result.ok) {
      noteFailure(key)
      return c.json({ error: result.error }, 401)
    }
    attempts.delete(key)
    setSessionCookie(c, createSession(db, result.player.id))
    return c.json({
      player: {
        username: result.player.username,
        isAdmin: !!result.player.is_admin,
        sandbox: !!result.player.sandbox,
      },
    })
  })

  api.post('/auth/logout', (c) => {
    endSession(db, getCookie(c, COOKIE))
    deleteCookie(c, COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  /* ------------------------------------------------------- authed game API */

  api.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/')) return next()
    const player = playerForToken(db, getCookie(c, COOKIE))
    if (!player) return c.json({ error: 'Not signed in.' }, 401)
    c.set('player', player)
    await next()
  })

  const body = async (c: any) => (await c.req.json().catch(() => ({}))) as any

  api.get('/state', (c) => c.json(game.fullState(db, c.get('player'))))

  api.get('/catalog', (c) => c.json(crawlStatus(db)))

  api.post('/roll', async (c) => {
    const b = await body(c)
    const { results, snapshot } = game.roll(db, c.get('player'), Number(b.count ?? 1))
    return c.json({ results, state: snapshot })
  })

  api.post('/claim', async (c) => {
    const b = await body(c)
    const { snapshot, notes } = game.claim(db, c.get('player'), Number(b.characterId))
    return c.json({ state: snapshot, notes })
  })

  api.post('/claim-all', (c) => {
    const { snapshot, claimed, bonus } = game.claimAll(db, c.get('player'))
    return c.json({ state: snapshot, claimed, bonus })
  })

  api.post('/gem', (c) => c.json({ state: game.collectGem(db, c.get('player')) }))

  api.post('/daily', (c) => {
    const { snapshot, amount, streak } = game.claimDaily(db, c.get('player'))
    return c.json({ state: snapshot, amount, streak })
  })

  api.post('/ritual', (c) => c.json({ state: game.claimRitual(db, c.get('player')) }))

  api.post('/sell', async (c) => {
    const b = await body(c)
    const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter(Number.isFinite)
    const { snapshot, total, sold } = game.sell(db, c.get('player'), ids, !!b.bulk)
    return c.json({ state: snapshot, total, sold })
  })

  api.post('/wish', async (c) => {
    const b = await body(c)
    return c.json({ state: game.addWish(db, c.get('player'), Number(b.characterId)) })
  })

  api.delete('/wish/:id', (c) =>
    c.json({ state: game.removeWish(db, c.get('player'), Number(c.req.param('id'))) }),
  )

  api.get('/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim()
    if (q.length < 2) return c.json({ results: [] })
    return c.json({ results: await searchCharacters(db, q) })
  })

  api.post('/badge', async (c) => {
    const b = await body(c)
    return c.json({ state: game.buyBadge(db, c.get('player'), b.key) })
  })

  api.post('/item', async (c) => {
    const b = await body(c)
    return c.json({ state: game.buyConsumable(db, c.get('player'), b.key) })
  })

  api.patch('/settings', async (c) => {
    const b = await body(c)
    return c.json({ state: game.updateSettings(db, c.get('player'), b) })
  })

  api.post('/grant', async (c) => {
    const b = await body(c)
    return c.json({ state: game.grantCredits(db, c.get('player'), Number(b.amount ?? 1000)) })
  })

  api.post('/reset', (c) => c.json({ state: game.resetPlayer(db, c.get('player')) }))

  /* ----------------------------------------------------------------- admin */

  const adminOnly = async (c: any, next: any) => {
    if (!c.get('player')?.is_admin) return c.json({ error: 'Admins only.' }, 403)
    await next()
  }

  api.get('/admin/users', adminOnly, (c) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.username, p.is_admin, p.sandbox, p.created_at,
                (SELECT COUNT(*) FROM claims WHERE player_id = p.id) AS claims
           FROM players p ORDER BY p.created_at`,
      )
      .all()
    return c.json({ users: rows })
  })

  api.get('/admin/invites', adminOnly, (c) => {
    const rows = db
      .prepare(
        `SELECT i.code, i.created_at, i.used_at, p.username AS used_by
           FROM invites i LEFT JOIN players p ON p.id = i.used_by
          ORDER BY i.created_at DESC LIMIT 50`,
      )
      .all()
    return c.json({ invites: rows })
  })

  api.post('/admin/invites', adminOnly, (c) =>
    c.json({ code: createInvite(db, c.get('player').id) }),
  )

  api.patch('/admin/users/:id', adminOnly, async (c) => {
    const b = await body(c)
    const id = Number(c.req.param('id'))
    if (typeof b.sandbox === 'boolean') {
      db.prepare('UPDATE players SET sandbox = ? WHERE id = ?').run(b.sandbox ? 1 : 0, id)
    }
    return c.json({ ok: true })
  })

  api.post('/admin/crawl', adminOnly, (c) => {
    void startCrawl(db, true)
    return c.json({ ok: true })
  })

  app.route('/api', api)

  app.onError((err, c) => {
    if (err instanceof GameError) return c.json({ error: err.message }, 400)
    console.error('[api]', err)
    return c.json({ error: 'Something went wrong on the server.' }, 500)
  })

  return app
}
