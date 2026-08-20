/**
 * Screenshot the running instance at a desktop and a phone size.
 *
 * A layout that reads fine in a terminal can be unusable on a phone, and every
 * mobile problem in this app so far was found by looking rather than by
 * reasoning. This drives the real client with real pointer events, so the
 * states that only exist mid-gesture -- a pack half torn, a card mid-throw --
 * can be looked at too.
 *
 *   npm start                       # in another shell
 *   npm run shots
 *
 * ANICO_URL, ANICO_USER and ANICO_PASS override the defaults. Output lands in
 * shots/ which is not tracked.
 *
 * Uses playwright-core, which ships no browsers of its own: it borrows a
 * Chromium that is already on the machine. `npx playwright install chromium`
 * puts one in the cache if there is none.
 */

import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const URL = process.env.ANICO_URL ?? 'http://127.0.0.1:8080'
const USER = process.env.ANICO_USER ?? 'mark'
const PASS = process.env.ANICO_PASS ?? 'correct-horse'
const OUT = process.env.ANICO_SHOTS ?? 'shots'

/** Any Chromium already on this machine: the cache first, then the system. */
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM
  const cache = join(homedir(), '.cache', 'ms-playwright')
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = join(cache, dir, rel)
        if (existsSync(p)) return p
      }
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (existsSync(p)) return p
  }
  return null
}

const executablePath = findChromium()
if (!executablePath) {
  console.error(
    'No Chromium found. Install one with:  npx playwright install chromium\n' +
      'or point PLAYWRIGHT_CHROMIUM at an existing binary.',
  )
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath })

async function run(label, viewport, touch) {
  const ctx = await browser.newContext({
    viewport,
    isMobile: touch,
    hasTouch: touch,
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error(`  [${label}] page error:`, String(e).slice(0, 200)))
  const shot = (n) => page.screenshot({ path: join(OUT, `${label}-${n}.png`) })

  await page.goto(URL, { waitUntil: 'networkidle' })
  // The username field carries no explicit type, so match it by autocomplete.
  await page.locator('input[autocomplete="username"]').fill(USER)
  await page.locator('input[type="password"]').fill(PASS)
  await page.locator('form button').click()
  await page.waitForSelector('.roll-actions', { timeout: 15000 })
  await shot('1-idle')

  // A single summon is the default and, until the shop opens packs, the only
  // one. It renders through the same spread the pack does.
  await page.locator('.roll-actions button').first().click()
  // The store refuses a fresh roll until the deal animation has finished, so
  // this waits it out rather than losing the next click to it.
  await page.waitForTimeout(1600)
  await shot('1b-single')

  // Packs are bought, so the second button only exists once Sapphire does.
  const packButton = page.locator('.roll-actions button').nth(1)
  if ((await packButton.count()) === 0) {
    console.log(`  ${label}: packs locked on this account, skipping the pack states`)
    await ctx.close()
    return
  }
  await packButton.click()
  await page.waitForTimeout(700)
  await shot('2-sealed')

  // Tear it by hand, stopping partway so the seam can be seen mid-rip.
  const box = await page.locator('.pack-area').boundingBox()
  if (box) {
    const y = box.y + box.height * 0.18
    await page.mouse.move(box.x + 14, y)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(box.x + 14 + i * (box.width / 8), y + (i % 2 ? 3 : -3))
      await page.waitForTimeout(30)
    }
    await shot('3-tearing')
    await page.mouse.up()
    await page.waitForTimeout(600)
  }
  await shot('4-stack')

  await page.locator('.pack-skip').click()
  await page.waitForTimeout(2600)
  await shot('5-spread')

  const geom = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }
    }
    return {
      viewport: { w: innerWidth, h: innerHeight },
      pageWidth: document.documentElement.scrollWidth,
      header: box('.header'),
      dock: box('.tabs'),
      rail: box('.roll-rail'),
      spread: box('.roll-spread'),
    }
  })
  console.log(`  ${label}:`, JSON.stringify(geom))

  // The other screens a phone has to survive: a grid of owned cards, the same
  // grid in bulk mode with its bar, the wishlist's search row, and the shop.
  await page.locator('.tab').nth(1).click()
  await page.waitForTimeout(400)
  await shot('6-collection')
  const selectBtn = page.locator('.col-bulk-toggle')
  if (await selectBtn.count()) {
    await selectBtn.click()
    const cards = page.locator('.collection-grid .char-card')
    for (let i = 0; i < Math.min(3, await cards.count()); i++) await cards.nth(i).click()
    await page.waitForTimeout(200)
    await shot('7-bulk')
    await page.locator('.bulk-actions .btn-quiet').click()
  }
  await page.locator('.tab').nth(2).click()
  await page.waitForTimeout(300)
  await shot('8-wishes')
  await page.locator('.tab').nth(3).click()
  await page.waitForTimeout(300)
  await shot('9-shop')

  const overflow = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }))
  if (overflow.pageWidth > overflow.viewport) {
    console.warn(`  ${label}: page is ${overflow.pageWidth}px wide in a ${overflow.viewport}px viewport`)
  }
  await ctx.close()
}

console.log(`shooting ${URL} -> ${OUT}/`)
await run('desktop', { width: 1280, height: 860 }, false)
await run('mobile', { width: 390, height: 844 }, true)
await run('small', { width: 360, height: 640 }, true)
await browser.close()
console.log('done')
