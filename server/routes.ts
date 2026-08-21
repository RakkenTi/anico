/**
 * HTTP surface. Every mutating route resolves the session first and hands the
 * player to the rules in game.ts; nothing here decides anything about the game.
 */

import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { DB } from './db.js'
import {
  activeProfile,
  createInvite,
  createSession,
  endSession,
  endSessionsFor,
  login,
  playerCount,
  playerForToken,
  register,
  setSandboxActive,
  verifyPlayerPassword,
  type Player,
} from './auth.js'
import * as game from './game.js'
import { setInstancePool } from './rules.js'
import { GameError } from './game.js'
import { UpstreamError, crawlStatus, searchCharacters, startCrawl } from './catalog.js'
import { publish, streamsFor, subscribe } from './bus.js'
import { streamSSE } from 'hono/streaming'

const COOKIE = 'anico_session'

export interface Config {
  cookieSecure: boolean
  /**
   * Who is making this request.
   *
   * Absent means the ordinary thing: read the session cookie and look the
   * account up. The demo build, which has no accounts and no cookies, hands
   * back a fixed guest instead -- injected here rather than branched on inside
   * the middleware, so the only build that knows a guest exists is the one that
   * makes one.
   */
  resolvePlayer?: (c: { req: { path: string } }) => Player | null
}

/**
 * Fixed-window counters, shared by the login throttle and the search limit.
 *
 * Keys are attacker-supplied on the login path (whatever username arrived), so
 * the map is capped rather than left to grow: an unbounded Map keyed by
 * anything a stranger sends is a slow memory leak with their hand on the tap.
 * Every window is the same length, so insertion order is expiry order and the
 * sweep can work from the front.
 */
const MAX_KEYS = 5_000

function counter(max: number, windowMs: number) {
  const rows = new Map<string, { n: number; until: number }>()

  const live = (key: string) => {
    const rec = rows.get(key)
    if (!rec) return undefined
    if (Date.now() >= rec.until) {
      rows.delete(key)
      return undefined
    }
    return rec
  }

  // Drop expired keys, then the oldest live ones until back under the cap.
  const sweep = () => {
    const now = Date.now()
    for (const [key, rec] of rows) {
      if (now < rec.until && rows.size < MAX_KEYS) break
      rows.delete(key)
    }
  }

  return {
    over: (key: string) => (live(key)?.n ?? 0) >= max,
    note: (key: string) => {
      const rec = live(key)
      if (rec) {
        rec.n++
        return
      }
      if (rows.size >= MAX_KEYS) sweep()
      rows.set(key, { n: 1, until: Date.now() + windowMs })
    },
    clear: (key: string) => rows.delete(key),
  }
}

/** Crude login throttle: enough to make guessing pointless on a home server. */
const loginFailures = counter(10, 15 * 60_000)

/**
 * Search reaches AniList, and the whole instance shares one upstream budget
 * with the crawler. The documented ceiling is 90 requests/minute but the
 * observed one is far tighter: a burst of eight searches was enough to draw a
 * 429 in testing. Ten a minute is still more than anyone types by hand, and it
 * leaves room for the other players and the crawl.
 */
const searches = counter(10, 60_000)

export function createApp(db: DB, config: Config) {
  const app = new Hono<{ Variables: { player: Player; owner: Player } }>()

  const setSessionCookie = (c: any, token: string) =>
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.cookieSecure,
      path: '/',
      maxAge: 30 * 86_400,
    })

  const api = new Hono<{ Variables: { player: Player; owner: Player } }>()

  /**
   * Answer, and tell this player's other devices.
   *
   * Every mutation goes out through here, so a phone and a desktop on one
   * account never disagree about the balance. The snapshot pushed is the same
   * authoritative one the caller gets, minus the collection (see bus.ts).
   */
  /** The one place a request is turned into an account. See `Config`. */
  const whoIs = (c: any): Player | null =>
    config.resolvePlayer ? config.resolvePlayer(c) : playerForToken(db, getCookie(c, COOKIE))

  const sync = <T extends { state: unknown }>(c: any, body: T) => {
    publish(c.get('player').id, body.state)
    return c.json(body)
  }

  /* ------------------------------------------------------------------ auth */

  api.get('/auth/me', (c) => {
    const player = whoIs(c)
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
    if (loginFailures.over(key)) {
      return c.json({ error: 'Too many attempts. Wait a few minutes.' }, 429)
    }
    const result = await login(db, username, String(body.password ?? ''))
    if (!result.ok) {
      loginFailures.note(key)
      return c.json({ error: result.error }, 401)
    }
    loginFailures.clear(key)
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

  // `player` is whoever the game should act as, which is the sandbox shadow
  // profile while sandbox is switched on. `owner` is always the real account,
  // so admin rights and anything that outlives a sandbox session key off it.
  api.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/')) return next()
    const owner = whoIs(c)
    if (!owner) return c.json({ error: 'Not signed in.' }, 401)
    c.set('owner', owner)
    c.set('player', activeProfile(db, owner))
    await next()
  })

  const body = async (c: any) => (await c.req.json().catch(() => ({}))) as any

  api.get('/state', (c) => c.json(game.fullState(db, c.get('player'))))

  /**
   * Live snapshots, one stream per open tab.
   *
   * The client applies whatever arrives and never merges anything: the server
   * decided the order, and this is the result. Nothing is sent that the caller
   * could not ask for with GET /state.
   */
  api.get('/events', (c) => {
    const player = c.get('player')
    const playerId = player.id
    return streamSSE(c, async (stream) => {
      let alive = true
      // The first stream is the account coming back: settle whatever the
      // machine earned while nothing at all was connected, and push the
      // receipt to this device.
      const arriving = streamsFor(playerId) === 0 ? game.markOnline(db, player) : null
      const off = subscribe(playerId, (payload) => {
        void stream.writeSSE({ data: payload, event: 'state' })
      })
      if (arriving) await stream.writeSSE({ data: JSON.stringify(arriving), event: 'state' })
      stream.onAbort(() => {
        alive = false
        off()
        // The last one out starts the offline clock.
        if (streamsFor(playerId) === 0) game.markOffline(db, player)
      })
      // A comment every half minute, so an idle connection is not tidied away
      // by whatever proxy the instance is sitting behind.
      while (alive) {
        await stream.sleep(30_000)
        if (!alive) break
        await stream.writeSSE({ data: '', event: 'ping' })
      }
      off()
    })
  })

  api.get('/catalog', (c) => c.json(crawlStatus(db)))

  api.post('/roll', async (c) => {
    const b = await body(c)
    const { snapshot, ...roll } = game.roll(db, c.get('player'), Number(b.packs ?? 0))
    return sync(c, { ...roll, state: snapshot })
  })

  api.post('/auto', async (c) => {
    const b = await c.req.json<{ on?: boolean }>().catch(() => ({}) as { on?: boolean })
    return sync(c, { state: game.setAutoSpin(db, c.get('player'), !!b.on) })
  })

  api.post('/sandbox', async (c) => {
    const owner = c.get('owner')
    if (!owner.sandbox) return c.json({ error: 'Sandbox is not enabled for this account.' }, 403)
    const b = await body(c)
    setSandboxActive(db, owner, !!b.on)
    const next = playerForToken(db, getCookie(c, COOKIE))!
    return c.json({ state: game.fullState(db, activeProfile(db, next)) })
  })

  api.post('/daily', (c) => {
    const { snapshot, amount, streak } = game.claimDaily(db, c.get('player'))
    return sync(c, { state: snapshot, amount, streak })
  })

  api.post('/lock', async (c) => {
    const b = await c.req.json<{ characterId?: number; locked?: boolean }>()
    return sync(c, {
      state: game.setLocked(db, c.get('player'), Number(b.characterId), !!b.locked),
    })
  })

  api.post('/sell', async (c) => {
    const b = await body(c)
    const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter(Number.isFinite)
    const { snapshot, total, sold } = game.sell(db, c.get('player'), ids)
    return sync(c, { state: snapshot, total, sold })
  })

  /* ------------------------------------------------------------- the board */

  api.post('/raid/:id', (c) => {
    const { snapshot, ...paid } = game.attemptRaid(db, c.get('player'), Number(c.req.param('id')))
    return sync(c, { state: snapshot, ...paid })
  })

  api.post('/aim', async (c) => {
    const b = await body(c)
    const list = Array.isArray(b.series) ? b.series.map((x: unknown) => String(x)) : []
    return sync(c, { state: game.setAim(db, c.get('player'), list) })
  })

  api.post('/wish', async (c) => {
    const b = await body(c)
    return sync(c, { state: game.addWish(db, c.get('player'), Number(b.characterId)) })
  })

  api.delete('/wish/:id', (c) =>
    sync(c, { state: game.removeWish(db, c.get('player'), Number(c.req.param('id'))) }),
  )

  api.get('/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim()
    // Short queries never leave the instance, so they cost nothing and count
    // for nothing; the limit only guards calls that actually reach AniList.
    if (q.length < 2) return c.json({ results: [] })
    const key = String(c.get('player').id)
    if (searches.over(key)) {
      return c.json({ error: 'Too many searches in a row. Give it a minute.' }, 429)
    }
    searches.note(key)
    return c.json({ results: await searchCharacters(db, q) })
  })

  api.post('/badge', async (c) => {
    const b = await body(c)
    return sync(c, { state: game.buyBadge(db, c.get('player'), b.key) })
  })

  api.post('/upgrade', async (c) => {
    const b = await body(c)
    // `count` is a number of levels or the string 'max'. Absent means one,
    // which is what every client sent before the shop grew bulk buttons.
    const count = b.count === 'max' ? 'max' : Number(b.count ?? 1)
    return sync(c, { state: game.buyUpgrade(db, c.get('player'), b.key, count) })
  })

  api.patch('/settings', async (c) => {
    const b = await body(c)
    return sync(c, { state: game.updateSettings(db, c.get('player'), b) })
  })

  api.post('/grant', async (c) => {
    const b = await body(c)
    return sync(c, { state: game.grantCredits(db, c.get('player'), Number(b.amount ?? 1000)) })
  })

  api.post('/reset', async (c) => {
    const b = await body(c)
    const owner = c.get('owner')
    const ok = await verifyPlayerPassword(db, owner, String(b.username ?? ''), String(b.password ?? ''))
    if (!ok) return c.json({ error: 'That username and password do not match this account.' }, 403)
    return sync(c, { state: game.resetPlayer(db, c.get('player')) })
  })

  /* ----------------------------------------------------------------- admin */

  // Deliberately `owner`: a sandbox profile inherits admin so the panel stays
  // reachable while testing, but every admin action must be recorded against
  // the real account, which outlives the shadow.
  const adminOnly = async (c: any, next: any) => {
    if (!c.get('owner')?.is_admin) return c.json({ error: 'Admins only.' }, 403)
    await next()
  }

  api.get('/admin/users', adminOnly, (c) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.username, p.is_admin, p.sandbox, p.created_at,
                (SELECT COUNT(*) FROM claims WHERE player_id = p.id) AS claims,
                (SELECT COUNT(*) FROM sessions
                  WHERE player_id = p.id AND expires_at > ?) AS sessions
           FROM players p WHERE p.sandbox_of IS NULL ORDER BY p.created_at`,
      )
      .all(Date.now())
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
    c.json({ code: createInvite(db, c.get('owner').id) }),
  )

  /**
   * Withdraw an invite that has not been used. A used one stays: it is the
   * record of how an account came to exist, and deleting it would orphan that.
   */
  api.delete('/admin/invites/:code', adminOnly, (c) => {
    const code = c.req.param('code')
    const row = db.prepare('SELECT used_by FROM invites WHERE code = ?').get(code) as
      | { used_by: number | null }
      | undefined
    if (!row) return c.json({ error: 'No such invite.' }, 404)
    if (row.used_by !== null) {
      return c.json({ error: 'That invite has already been used, so it is a record now.' }, 400)
    }
    db.prepare('DELETE FROM invites WHERE code = ?').run(code)
    return c.json({ ok: true })
  })

  /** The one rule an admin owns rather than a player: how wide the pool is. */
  api.patch('/admin/instance', adminOnly, async (c) => {
    const b = await body(c)
    const poolSize = setInstancePool(db, b.poolSize)
    return c.json({ poolSize })
  })

  api.patch('/admin/users/:id', adminOnly, async (c) => {
    const b = await body(c)
    const id = Number(c.req.param('id'))
    if (typeof b.sandbox === 'boolean') {
      db.prepare('UPDATE players SET sandbox = ? WHERE id = ?').run(b.sandbox ? 1 : 0, id)
    }
    return c.json({ ok: true })
  })

  /**
   * Sign a player out of everywhere. The only recourse when a session token
   * leaks, and the reason sessions are rows instead of self-contained tokens.
   */
  api.delete('/admin/users/:id/sessions', adminOnly, (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return c.json({ error: 'Unknown player.' }, 400)
    return c.json({ revoked: endSessionsFor(db, id) })
  })

  api.post('/admin/crawl', adminOnly, (c) => {
    void startCrawl(db, true)
    return c.json({ ok: true })
  })

  app.route('/api', api)

  app.onError((err, c) => {
    if (err instanceof GameError) return c.json({ error: err.message }, 400)
    // Upstream trouble is not this instance falling over, and saying so is the
    // difference between "wait a minute" and "something is wrong with the server".
    if (err instanceof UpstreamError) return c.json({ error: err.message }, 503)
    console.error('[api]', err)
    return c.json({ error: 'Something went wrong on the server.' }, 500)
  })

  return app
}
