/**
 * One command for a working game: an instance and a client, both watching.
 *
 * `npm run dev` used to be Vite alone, proxying `/api` at port 8080 and
 * showing "Cannot reach the instance" until you remembered to start a server
 * in another terminal. Worse than that: 8080 is where a real instance runs, so
 * the reward for remembering was a dev client pointed at the save you actually
 * play. This boots its own, on its own port, against its own database.
 *
 *   npm run dev                        # instance on :8090, client on :5173
 *   ANICO_DEV_PORT=9001 npm run dev
 *   ANICO_API=http://host:8080 npm run dev   # no instance; point at that one
 *
 * The database is `devdata/`, which is gitignored and disposable: delete it to
 * start the game over. It is seeded from the demo's baked catalog, so there
 * are ten thousand real characters to pull on the first summon and the crawl
 * never runs. Nothing here reaches AniList unless you ask it to.
 */

import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

/* The tools' entry scripts, run under this Node. The node_modules/.bin shims
   are shell wrappers that Windows cannot execute, and `npx` prints npm's
   warnings over every line this script is trying to keep readable. */
const bin = (name) =>
  join(root, 'node_modules', { tsc: 'typescript/bin/tsc', vite: 'vite/bin/vite.js' }[name])
const node = process.execPath

const PORT = Number(process.env.ANICO_DEV_PORT ?? 8090)
const DATA = process.env.ANICO_DEV_DATA ?? join(root, 'devdata')
const SEED = join(root, 'demo', 'public', 'catalog.db')
/* Somebody else's instance, named on the command line. Then this script has
   nothing to run but the client, and must not start a second server. */
const EXTERNAL = process.env.ANICO_API

const paint = (tag, colour) => (line) => `\x1b[${colour}m${tag}\x1b[0m ${line}`
const say = paint('[dev]   ', 36)
const log = (line) => console.log(say(line))

/** Pipe a child's output through a tag, dropping the blank lines watchers emit. */
function tag(child, label, colour) {
  const mark = paint(label, colour)
  for (const stream of [child.stdout, child.stderr]) {
    let rest = ''
    stream?.on('data', (chunk) => {
      const lines = (rest + chunk).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) console.log(mark(line))
    })
  }
}

const children = []
function run(command, args, env) {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  return child
}

let closing = false
function stop(code = 0) {
  if (closing) return
  closing = true
  for (const child of children) child.kill('SIGTERM')
  // Long enough for the instance to fold its write-ahead log into the file.
  setTimeout(() => process.exit(code), 400)
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0))

/* ------------------------------------------------------------ the database */

if (!EXTERNAL) {
  mkdirSync(DATA, { recursive: true })
  const db = join(DATA, 'anico.db')
  if (!existsSync(db)) {
    if (existsSync(SEED)) {
      copyFileSync(SEED, db)
      log(`seeded ${db} from the demo catalog`)
    } else {
      log(`no catalog at ${SEED}; the instance will start empty`)
      log('run `npm run bake:catalog`, or set ANICO_DEV_CRAWL=true to fill it from AniList')
    }
  }
}

/** A directory with no client in it, made once so the server can be told to serve it. */
function emptyClientDir() {
  const dir = join(DATA, 'no-client')
  mkdirSync(dir, { recursive: true })
  return dir
}

/* -------------------------------------------------------------- the server */

if (!EXTERNAL) {
  // Once, up front: `node --watch` needs something to watch before it starts,
  // and a first compile is the difference between a working command and a
  // restart loop on a fresh clone.
  log('compiling the server…')
  const built = spawnSync(node, [bin('tsc'), '-p', 'tsconfig.server.json'], { cwd: root, stdio: 'inherit' })
  if (built.status !== 0) {
    console.error(say('the server did not compile; fix the errors above and try again'))
    process.exit(built.status ?? 1)
  }

  tag(run(node, [bin('tsc'), '-p', 'tsconfig.server.json', '--watch', '--preserveWatchOutput']), '[tsc]   ', 35)
  tag(
    run('node', ['--watch', 'dist/server/server/index.js'], {
      PORT: String(PORT),
      DATA_DIR: DATA,
      // Plain HTTP, so a Secure cookie would be dropped and signing in would
      // look like it silently did nothing.
      COOKIE_SECURE: 'false',
      // Dev talks to nobody. The seeded catalog is what you pull from.
      CRAWL_ON_BOOT: process.env.ANICO_DEV_CRAWL ?? 'false',
      // No built client to serve: Vite is the client. Empty rather than
      // absent so the static middleware does not warn about it, and pointedly
      // not `dist/client`, which would leave the page comparing itself against
      // whatever a build left behind.
      CLIENT_DIR: emptyClientDir(),
    }),
    '[server]',
    32,
  )
}

/* -------------------------------------------------------------- the client */

const api = EXTERNAL ?? `http://127.0.0.1:${PORT}`
tag(run(node, [bin('vite')], { ANICO_API: api, FORCE_COLOR: '1' }), '[client]', 34)

log(EXTERNAL ? `client only, /api goes to ${api}` : `instance on ${api}, data in ${DATA}`)
if (!EXTERNAL) log('first run: create the admin account. It needs no invite. Delete devdata/ to start over')

for (const child of children) {
  child.on('exit', (code) => {
    if (closing) return
    console.error(say(`a process exited (${code}); stopping the rest`))
    stop(code ?? 1)
  })
}
