/**
 * The demo, in a real browser.
 *
 * A demo can build cleanly, boot cleanly, and be a blank page: the instance
 * runs inside the tab now, so nothing on the server side can tell you it is
 * broken. So this serves `dist/demo` and plays it -- the instance has to
 * start, the catalog has to load, a summon has to grant a card, every tab has
 * to render, and the pages the demo cannot honestly offer have to be the ones
 * that are shut.
 *
 *   npm run build:demo && npm run smoke:demo
 *
 * Exits non-zero on the first thing that is wrong, and writes what it saw to
 * shots/demo/ either way.
 */

import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

const DIST = resolve('dist/demo')
const OUT = process.env.ANICO_DEMO_SHOTS ?? 'shots/demo'
const BASE_PATH = process.env.ANICO_DEMO_BASE ?? '/anico/'
/* Not 8099: that is the stress harness's, and the two would collide. */
const PORT = Number(process.env.ANICO_DEMO_PORT ?? 8098)

if (!existsSync(DIST)) throw new Error('dist/demo is missing. Run `npm run build:demo` first.')
mkdirSync(OUT, { recursive: true })

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM
  const cache = join(homedir(), '.cache', 'ms-playwright')
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        if (existsSync(join(cache, d, rel))) return join(cache, d, rel)
      }
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (existsSync(p)) return p
  }
  throw new Error('No Chromium found. `npx playwright install chromium` puts one in the cache.')
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.db': 'application/octet-stream',
  '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml',
}

/* Served under the same base path Pages will use, because a demo that only
   works at the site root is a demo that will not work where it is going. */
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const rel = path.startsWith(BASE_PATH) ? path.slice(BASE_PATH.length) : path.slice(1)
  const file = join(DIST, rel === '' ? 'index.html' : rel)
  if (!file.startsWith(DIST) || !existsSync(file)) {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(PORT, r))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const stat = async () =>
  page.evaluate(() => document.querySelector('.header-stats')?.textContent?.trim().slice(0, 80))
const problems = []
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`)
  if (!ok) problems.push(what)
}

const browser = await chromium.launch({ executablePath: findChromium() })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()

page.on('pageerror', (e) => problems.push(`page error: ${String(e).slice(0, 200)}`))
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console error: ${m.text().slice(0, 200)}`)
})

/* The demo must not talk to anything but the page it was served from. Art is
   the exception: cards are hot-linked to AniList's CDN, as they are in an
   instance. The AniList *API* is a different host and must never appear. */
const hosts = new Set()
page.on('request', (r) => {
  const u = new URL(r.url())
  if (u.protocol !== 'data:' && u.port !== String(PORT)) hosts.add(u.host)
})

const url = `http://127.0.0.1:${PORT}${BASE_PATH}`
const began = Date.now()
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tabs', { timeout: 60_000 })
const boot = Date.now() - began

console.log(`\n  the instance starts in the tab`)
check(boot < 15_000, `boots to playable in ${boot}ms`)

await page.evaluate(() =>
  localStorage.setItem(
    'anico-ui',
    JSON.stringify({ state: { soundEnabled: false, soundVolume: 0 }, version: 0 }),
  ),
)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tabs', { timeout: 60_000 })
await wait(500)

console.log(`\n  the loop`)
await page.locator('.roll-actions .btn-summon').first().click()
await wait(2000)
check((await page.locator('.char-card').count()) > 0, 'a free summon deals a card')

await page.locator('.tab', { hasText: /collection/i }).click()
await wait(1500)
const held = await page.locator('.char-card').count()
check(held > 0, `the card is in the collection (${held})`)

/*
 * The board.
 *
 * Reachable in a demo because the guest starts with credits, and worth
 * reaching: posting a contract runs a random pick over the catalog, counts a
 * series' cast, and profiles the collection at five star depths. None of that
 * is touched by a summon, so without this the shim's hardest queries only ever
 * run in front of a visitor.
 */
console.log(`\n  the contract board`)
await page.locator('.tab', { hasText: /shop/i }).click()
await wait(600)
/* By name, not by price: Sapphire is what unlocks packs and it is gated on
   one level each of the three above it, so a loop that always buys the
   cheapest affordable row spends the whole balance on Bronze. */
async function buyBadge(name, times = 1) {
  for (let i = 0; i < times; i++) {
    const btn = page
      .locator('.col-badges .shop-row', { hasText: new RegExp(name, 'i') })
      .first()
      .locator('.row-buy')
    if (await btn.isDisabled()) return
    await btn.click({ force: true })
    await wait(350)
  }
}
for (const name of ['Bronze', 'Silver', 'Gold']) await buyBadge(name)
await buyBadge('Sapphire', 4)
console.log(`  (badges: ${(await page.locator('.col-badges .row-lv').allTextContents()).join(' ')})`)
await page.locator('.tab', { hasText: /summon/i }).click()
// RollView clears its deal timer when it unmounts, so the summon buttons come
// back disabled for one more beat after a tab change.
await wait(3000)
for (let pull = 0; pull < 8; pull++) {
  const pack = page.locator('.roll-actions .btn-summon.btn-pack').first()
  if (!(await pack.count())) { console.log('  (no pack button)'); break }
  if (await pack.isDisabled()) { await wait(2000) }
  if (await pack.isDisabled()) { console.log('  (pack button stayed disabled)'); break }
  await pack.click()
  await page.waitForSelector('.pack-stack', { timeout: 15_000 }).catch(() => {})
  await page.keyboard.press('Space')
  await page.waitForSelector('.pack-stack', { state: 'detached', timeout: 20_000 }).catch(() => {})
  await wait(1200)
  if (await page.locator('.tab', { hasText: /contracts/i }).count()) break
}
console.log(`  (collection: ${(await stat()) ?? ''})`)
const board = page.locator('.tab', { hasText: /contracts/i })
await page.screenshot({ path: join(OUT, 'board-attempt.png'), fullPage: true })
check((await board.count()) > 0, 'the board opens once there is a collection to measure')
if (await board.count()) {
  await board.click()
  await wait(1200)
  const rows = await page.locator('.contract-row').count()
  check(rows > 0, `contracts are posted (${rows})`)
  await page.screenshot({ path: join(OUT, 'contracts.png'), fullPage: true })
}

console.log(`\n  every tab renders`)
for (const [tab, root] of [
  ['summon', '.roll-view'],
  ['collection', '.collection-view'],
  ['wishes', '.wishes-view'],
  ['shop', '.shop-view'],
  ['stats', '.stats-view'],
  ['settings', '.settings-view'],
]) {
  await page.locator('.tab', { hasText: new RegExp(tab, 'i') }).click()
  await wait(600)
  check((await page.locator(root).count()) > 0, `${tab}`)
  await page.screenshot({ path: join(OUT, `${tab}.png`), fullPage: true })
}

console.log(`\n  what the demo cannot offer is shut, and says so`)
await page.locator('.tab', { hasText: /wishes/i }).click()
await wait(500)
check((await page.locator('.locked-panel').count()) === 1, 'wishes is locked')
check((await page.locator('.search-row').count()) === 0, 'the AniList search is gone with it')
await page.locator('.tab', { hasText: /settings/i }).click()
await wait(500)
check((await page.locator('.btn-danger').count()) === 0, 'no danger zone without an account')
check((await page.locator('.admin-view').count()) === 0, 'no admin panel for a guest')
check((await page.locator('.demo-note').count()) === 1, 'the demo says it is a demo')
check(
  (await page.locator('.stat-user').textContent()).includes('real thing'),
  'the header points at the real thing',
)

console.log(`\n  nothing is asked of anybody else`)
const outside = [...hosts].filter((h) => !/(^|\.)(googleapis|gstatic)\.com$/.test(h))
check(
  outside.every((h) => /anilist\.co$/.test(h)),
  `only card art leaves the page (${outside.join(', ') || 'nothing'})`,
)
check(!outside.includes('graphql.anilist.co'), 'the AniList API is never called')

await ctx.close()
await browser.close()
server.close()

console.log('')
if (problems.length > 0) {
  for (const p of problems) console.log(`  ${p}`)
  console.log(`\n  ${problems.length} problem(s). Screenshots in ${OUT}/`)
  process.exit(1)
}
console.log(`  The demo works. Screenshots in ${OUT}/`)
