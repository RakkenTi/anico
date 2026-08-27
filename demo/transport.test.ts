/**
 * The drift guards.
 *
 * The demo is a build target, not a fork: everything in `server/` and `src/`
 * ships verbatim. That only stays true if a few assumptions hold, and all of
 * them are the kind that break silently -- the demo would still build, still
 * boot, and quietly do the wrong thing. So they are assertions.
 *
 *   node --experimental-strip-types --test demo/*.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(path)
  }
  return out
}

const clientFiles = walk(join(root, 'src'))
const serverFiles = walk(join(root, 'server'))
const read = (path: string) => readFileSync(path, 'utf8')
const relative = (path: string) => path.slice(root.length).replaceAll('\\', '/')

test('the client reaches the instance through src/api.ts and nowhere else', () => {
  const offenders = clientFiles
    .filter((f) => !relative(f).endsWith(`src${'/'}api.ts`))
    .filter((f) => /['"`]\/api[/'"`]/.test(read(f)))
  assert.deepEqual(
    offenders.map(relative),
    [],
    'a second path to /api works in the app and breaks the demo, which has no /api to call',
  )
})

test('nothing outside src/api.ts and src/game/sound.ts calls fetch', () => {
  // Sound pulls its samples from BASE_URL, which is a static asset and works
  // anywhere. Anything else is a request the demo cannot answer.
  const allowed = new Set([`src${'/'}api.ts`, `src${'/'}game${'/'}sound.ts`])
  const offenders = clientFiles
    .filter((f) => !allowed.has(relative(f)))
    .filter((f) => /\bfetch\(/.test(read(f)))
  assert.deepEqual(offenders.map(relative), [])
})

test('only the server modules the demo never loads reach for node', () => {
  const stubbed = new Set([
    `server${'/'}db.ts`,
    `server${'/'}auth.ts`,
    // The instance entry point, which the demo never imports.
    `server${'/'}index.ts`,
    // Backups are files in a directory, so they are the entry point's to make
    // and are handed to `createApp` rather than imported by it. The test below
    // is what keeps that true.
    `server${'/'}backups.ts`,
  ])
  const offenders = serverFiles
    .filter((f) => !stubbed.has(relative(f)))
    .filter((f) => /from ['"](node:[a-z_]+|fs|path|crypto|util)['"]/.test(read(f)))
  assert.deepEqual(
    offenders.map(relative),
    [],
    'a node import in the rules is a module the browser cannot load',
  )
})

test('the HTTP layer never imports the backup store', () => {
  /*
   * `routes.ts` is bundled into the demo, and `backups.ts` opens files. The
   * two are joined through `Config.backups`, the same way the demo's guest is
   * injected -- so the moment somebody imports it directly for convenience,
   * the demo stops building, in a browser, with a message about node:fs.
   */
  // `import type` is fine: it names the shape `Config` carries and is erased
  // before anything reaches a bundler. A value import is the one that lands.
  assert.doesNotMatch(
    read(join(root, 'server/routes.ts')),
    /^import\s+(?!type\b)[^\n]*from ['"]\.\/backups\.js['"]/m,
    'reach the backup store through Config, not by importing it',
  )
})

test('every mutating route still answers with the state it published', () => {
  /*
   * The assumption the whole approach rests on.
   *
   * The demo stubs the live stream, because a single tab cannot disagree with
   * itself. That is only safe while `sync()` returns the same snapshot it
   * pushes. If state ever moves to a push-only path, the demo goes stale
   * without an error anywhere.
   */
  const routes = read(join(root, 'server/routes.ts'))
  const sync = routes.slice(routes.indexOf('const sync ='), routes.indexOf('const sync =') + 240)
  assert.match(sync, /publish\(/)
  assert.match(sync, /return c\.json\(body\)/)
})

test('the demo build has an entry point, a config and a catalog', () => {
  for (const path of ['vite.demo.config.ts', 'demo/main.tsx', 'demo/instance.ts']) {
    assert.doesNotThrow(() => statSync(join(root, path)), `${path} is missing`)
  }
})
