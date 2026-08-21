/**
 * Drive the real client at end-game numbers and check it still behaves.
 *
 * Every performance problem this game has had turned up late: at a hundred
 * cards a pull everything is fine, and the trouble starts somewhere past ten
 * thousand, where a pull is seventeen wrappers holding eleven thousand cards
 * each and the machine is pressing the button twice a second. Nobody plays
 * there on the way to shipping, so nobody sees it, so it ships.
 *
 * This plays there. It stands up a throwaway instance, seeds a catalog the
 * size a real crawl reaches, and walks a player up several rungs of the
 * shop -- a hundred thousand cards a pull, half a million, four million,
 * two hundred million -- pulling at each one with a real browser and real
 * pointer events. What it checks is what has actually gone wrong before:
 *
 *   summon      how long from the press to wrappers on screen
 *   frames      the frame gap while a pull is emptying (60fps is 16.7ms)
 *   opening     how long the pull takes against what Open Speed promised
 *   sound       voices started in the same tenth of a second
 *   spread      whether the cards use the pane they were given
 *
 *   npm run stress                 # boots its own instance
 *   ANICO_STRESS_PORT=8099 npm run stress
 *
 * Needs a build first (`npm run build`) and a Chromium on the machine, same
 * as `npm run shots`.
 */

import { chromium } from 'playwright-core'
import Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'

const PORT = Number(process.env.ANICO_STRESS_PORT ?? 8099)
const USER = 'stress'
const PASS = 'correct-horse'
const OUT = process.env.ANICO_STRESS_SHOTS ?? 'shots/stress'
const CATALOG = Number(process.env.ANICO_STRESS_CATALOG ?? 6000)

/**
 * The rungs, in the order a player climbs them.
 *
 * `packs` is Pack Size and `multipack` is Extra Packs, so the pull is
 * 60 x 1.3^packs cards in (1 + multipack) wrappers; `haste` is Open Speed,
 * which is the rate the whole pull empties at.
 */
const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const RUNGS = [
  { name: 'mid', packs: 12, multipack: 6, haste: 14, budget: { summon: 1500, frame: 20 } },
  { name: 'late', packs: 20, multipack: 16, haste: 24, budget: { summon: 2500, frame: 22 } },
  { name: 'deep', packs: 24, multipack: 23, haste: 30, budget: { summon: 3000, frame: 24 } },
  { name: 'silly', packs: 34, multipack: 23, haste: 40, budget: { summon: 3000, frame: 24 } },
  // The screen most of this is actually played on, at the rung that hurt.
  { name: 'phone', packs: 20, multipack: 16, haste: 24, view: PHONE, budget: { summon: 2500, frame: 26 } },
]

/** ANICO_STRESS_RUNGS=late,phone runs just those, for chasing one down. */
const ONLY = (process.env.ANICO_STRESS_RUNGS ?? '').split(',').filter(Boolean)

/** Voices allowed to start inside the same tenth of a second, anywhere. */
const VOICE_PEAK = 8
/** How much of its pane a big spread has to use. */
const SPREAD_FILL = 0.9
/** How long a purchase may take to show on the shelf, machine running. */
const SHOP_ANSWER_MS = 800
/** How long the button that opens a pack may take to become pressable. */
const REACH_MS = 900

/* --------------------------------------------------------------- helpers */

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM
  const cache = join(homedir(), '.cache', 'ms-playwright')
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      for (const rel of [
        'chrome-linux64/chrome',
        'chrome-linux/chrome',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      ]) {
        const p = join(cache, dir, rel)
        if (existsSync(p)) return p
      }
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (existsSync(p)) return p
  }
  throw new Error('No Chromium found. `npx playwright install chromium` puts one in the cache.')
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** A catalog with as many characters in it as a crawl reaches in a good week. */
function seed(dbPath, n) {
  const db = new Database(dbPath)
  const series = ['Attack on Titan', 'Frieren', 'Bocchi the Rock!', 'JoJo', 'Monogatari', 'Kaguya-sama']
  const value = (f) => Math.min(1500, Math.round(15 + 7 * Math.pow(Math.max(f, 0), 0.45)))
  const art = (i) =>
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="hsl(${(i * 37) % 360} 40% 30%)"/><text x="100" y="160" font-size="72" text-anchor="middle" fill="rgba(255,255,255,.7)">${i % 10}</text></svg>`,
    )
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO characters
       (id, name, native_name, image, gender, favourites, series, credit_value, aliases_json, covers_json, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const now = Date.now()
  db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const favourites = Math.max(1, Math.round(90000 / (i + 1)))
      stmt.run(
        1000 + i,
        `Character Nameson ${i}`,
        `キャラクター ${i}`,
        art(i),
        ['Female', 'Male', 'Other'][i % 3],
        favourites,
        series[i % series.length],
        value(favourites),
        JSON.stringify([`Alias ${i}`]),
        JSON.stringify([]),
        now,
      )
    }
  })()
  db.close()
}

/** Put the player on a rung: every badge, and the upgrades this rung names. */
function climb(dbPath, rung) {
  const db = new Database(dbPath)
  const player = db.prepare('SELECT id FROM players WHERE username = ?').get(USER)
  if (!player) throw new Error(`no player ${USER}`)
  const badges = { bronze: 6, silver: 6, gold: 6, sapphire: 6, ruby: 6, emerald: 6 }
  const upgrades = {
    packs: rung.packs,
    multipack: rung.multipack,
    haste: rung.haste,
    appraisal: 40,
    fortune: 10,
    automaton: 10,
    nightshift: 11,
    alchemy: 20,
    divination: 10,
  }
  // `auto_spin` off as well: it is stored per account and adopted on sign-in,
  // so the Automaton switched on at the end of one rung would be pulling
  // before the next rung's first press and would open its own packs over the
  // top of whatever was being measured.
  db.prepare(
    `UPDATE player_state SET badges_json = ?, upgrades_json = ?, credits = ?, auto_spin = 0
      WHERE player_id = ?`,
  ).run(JSON.stringify(badges), JSON.stringify(upgrades), Number.MAX_SAFE_INTEGER, player.id)
  db.close()
}

/** Stop an instance and wait for the port to actually come free. */
async function stop(child) {
  if (!child) return
  // SIGKILL rather than SIGTERM: the server holds its listener open and a
  // polite signal leaves it running, which the next rung then talks to.
  child.kill('SIGKILL')
  await child.gone
  await wait(200)
}

function serve(dataDir) {
  const child = spawn(process.execPath, ['dist/server/server/index.js'], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), CRAWL_ON_BOOT: 'false', COOKIE_SECURE: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))
  // Signalled processes never set `exitCode`, so the wait is on the event.
  child.gone = new Promise((res) => child.once('exit', res))
  return child
}

async function up() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/catalog`)
      if (res.status < 500) return
    } catch {
      /* not yet */
    }
    await wait(200)
  }
  throw new Error('the instance never came up')
}

/* ------------------------------------------------------------------ run */

if (!existsSync('dist/server/server/index.js')) {
  console.error('Build first: npm run build')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'anico-stress-'))
let server = serve(dataDir)
await up()
await fetch(`http://127.0.0.1:${PORT}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
})
await stop(server)
seed(join(dataDir, 'anico.db'), CATALOG)

const browser = await chromium.launch({
  executablePath: findChromium(),
  // The sound budget is what is being measured, so the samples have to be
  // allowed to play without somebody clicking first.
  args: ['--autoplay-policy=no-user-gesture-required'],
})

const failures = []
const rows = []
for (const signal of ['exit', 'SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server?.kill('SIGKILL')
    rmSync(dataDir, { recursive: true, force: true })
  })
}

for (const rung of RUNGS.filter((r) => ONLY.length === 0 || ONLY.includes(r.name))) {
  climb(join(dataDir, 'anico.db'), rung)
  server = serve(dataDir)
  await up()

  const ctx = await browser.newContext({ viewport: rung.view ?? DESKTOP })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => failures.push(`${rung.name}: page error ${String(e).slice(0, 200)}`))
  // Count every voice that actually starts, and when.
  await page.addInitScript(() => {
    window.__voices = []
    const make = AudioContext.prototype.createBufferSource
    AudioContext.prototype.createBufferSource = function () {
      const src = make.call(this)
      const start = src.start.bind(src)
      src.start = (when, ...rest) => {
        window.__voices.push(when ?? 0)
        return start(when, ...rest)
      }
      return src
    }
  })
  await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' })
  await page.locator('input[autocomplete="username"]').fill(USER)
  await page.locator('input[type="password"]').fill(PASS)
  await page.locator('form button').click()
  await page.waitForSelector('.roll-actions')
  await page.mouse.click(720, 40)

  // Straight from the server, so the promise this is checked against is the
  // one the shop made rather than one this script worked out for itself.
  const state = await page.evaluate(() => fetch('/api/state').then((r) => r.json()))

  // ---- the press
  await page.evaluate(() => {
    window.__voices.length = 0
    window.__t = performance.now()
  })
  await page.locator('.roll-actions button').nth(1).click()
  await page.waitForSelector('.pack-area', { timeout: 60_000 })
  const summon = await page.evaluate(() => performance.now() - window.__t)
  const stacks = await page.locator('.pack-area').count()
  await page.screenshot({ path: join(OUT, `${rung.name}-sealed.png`) })

  // ---- the opening
  //
  // Timed from inside the page: the spread appearing is what ends a pull, and
  // waiting for it from out here would time this script's own sampling as
  // well, which at the top rungs takes longer than the pull does.
  await page.evaluate(() => {
    window.__voices.length = 0
    window.__done = 0
    const watch = new MutationObserver(() => {
      if (!window.__done && document.querySelector('.spread-slot')) {
        window.__done = performance.now()
        watch.disconnect()
      }
    })
    watch.observe(document.body, { subtree: true, childList: true })
    window.__t = performance.now()
  })
  /*
   * How long the button takes to become pressable, and then how long the pull
   * takes once it has been pressed.
   *
   * Both are worth knowing separately. A pull that empties on time is no use
   * if the control that starts it spent four seconds underneath a stack of
   * receipts, which is exactly what a phone at end game used to do -- and from
   * the other side of the screen that is indistinguishable from a game that
   * has locked up.
   */
  const reached = Date.now()
  await page.locator('.pack-skip').click()
  const reach = Date.now() - reached
  await page.evaluate(() => {
    window.__t = performance.now()
  })
  await wait(1500)
  const frames = await page.evaluate(
    () =>
      new Promise((res) => {
        const gaps = []
        let last = performance.now()
        let n = 0
        const tick = () => {
          const now = performance.now()
          gaps.push(now - last)
          last = now
          if (++n < 90) requestAnimationFrame(tick)
          else {
            gaps.sort((a, b) => a - b)
            res({ median: gaps[45], p90: gaps[80] })
          }
        }
        requestAnimationFrame(tick)
      }),
  )
  await page.screenshot({ path: join(OUT, `${rung.name}-opening.png`) })
  await page.waitForSelector('.spread-slot', { timeout: 300_000 })
  const opening = await page.evaluate(() => (window.__done || performance.now()) - window.__t)
  const voices = await page.evaluate(() => {
    const buckets = new Map()
    for (const t of window.__voices) {
      const k = Math.floor(t * 10)
      buckets.set(k, (buckets.get(k) ?? 0) + 1)
    }
    return { total: window.__voices.length, peak: Math.max(0, ...buckets.values()) }
  })
  await wait(600)
  await page.screenshot({ path: join(OUT, `${rung.name}-spread.png`) })
  const spread = (await page.evaluate(() => {
    const grid = document.querySelector('.roll-spread')
    const pane = document.querySelector('.spread-scroller') ?? grid?.parentElement
    if (!grid || !pane) return null
    return {
      fill: grid.getBoundingClientRect().width / pane.getBoundingClientRect().width,
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
    }
  })) ?? { fill: 0, columns: 0 }

  /*
   * The shop, with the machine grinding behind it.
   *
   * Buying something is one small request, but the screen it is bought from
   * has to stay awake while the Automaton pulls a couple of times a second --
   * and a pull used to answer with the player's entire collection, which by
   * this point is thousands of characters and their artwork, rebuilt and
   * re-sent every press. That is what made the shop feel stuck.
   */
  await page.getByRole('button', { name: /Automaton/i }).click()
  // `force`, because a pull's receipts pile up over the tab bar on a phone and
  // what is being timed is the shop, not whether a toast is in the way.
  await page.locator('.tab', { hasText: /shop/i }).click({ force: true })
  await page.waitForSelector('.shop-row')
  await wait(2500)
  const buy = page.locator('.shop-row.affordable button').first()
  const wasReading = (await buy.textContent()).replace(/\s+/g, ' ').trim().slice(0, 24)
  const pressed = Date.now()
  await buy.click()
  const bought = await page
    .waitForFunction(
      (x) => !document.querySelector('.shop-rows')?.textContent.includes(x),
      wasReading,
      { timeout: 15_000 },
    )
    .then(() => Date.now() - pressed)
    .catch(() => Infinity)
  await page.screenshot({ path: join(OUT, `${rung.name}-shop.png`) })

  /*
   * What the opening should have taken.
   *
   * Open Speed is quoted in cards a second and a pull holds what the wrappers
   * say, so the promise is one divided by the other, floored and capped the
   * way the opener does it. The allowance on top is the tear and the stagger
   * before any of it starts.
   */
  const promised = Math.min(8, Math.max(0.6, state.cardsPerPull / state.cardRate)) * 1000
  /*
   * On top of the throwing: the wrappers tearing themselves open, the stagger
   * between them, and the last card finishing its flight after the counter has
   * already reached zero. About a second and a half of ceremony, whatever the
   * numbers are, which is why it is added rather than scaled.
   */
  const ceremony = 2000
  const ok = (label, pass) => {
    if (!pass) failures.push(`${rung.name}: ${label}`)
    return pass ? '' : '  <-- over'
  }

  rows.push(
    [
      rung.name.padEnd(6),
      `${(state.cardsPerPull / 1000).toFixed(0)}K cards`.padStart(12),
      `${stacks} packs`.padStart(9),
      `${state.cardRate.toLocaleString()}/s`.padStart(12),
      `summon ${Math.round(summon)}ms`.padStart(15) + ok('summon', summon < rung.budget.summon),
      `frames ${frames.median.toFixed(1)}ms`.padStart(16) + ok('frames', frames.median < rung.budget.frame),
      `open ${(opening / 1000).toFixed(1)}s of ${(promised / 1000).toFixed(1)}s`.padStart(20) +
        ok('opening pace', opening < promised + ceremony && opening > promised * 0.5),
      `voices ${voices.peak}/100ms`.padStart(18) + ok('sound crowding', voices.peak <= VOICE_PEAK),
      `button reachable in ${reach}ms`.padStart(28) + ok('controls not buried', reach < REACH_MS),
      `spread ${(spread.fill * 100).toFixed(0)}% of the pane`.padStart(26) +
        ok('spread width', spread.fill >= SPREAD_FILL),
      `shop ${bought === Infinity ? 'never updated' : `${bought}ms to answer`}`.padStart(24) +
        ok('shop responsiveness', bought < SHOP_ANSWER_MS),
    ].join('\n        '),
  )

  await ctx.close()
  await stop(server)
}

await browser.close()
await stop(server)
rmSync(dataDir, { recursive: true, force: true })

console.log('')
for (const row of rows) console.log('  ' + row + '\n')
if (failures.length > 0) {
  console.error(`${failures.length} over budget:`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log(`  All rungs within budget. Screenshots in ${OUT}/.`)
