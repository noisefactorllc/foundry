/**
 * Startup canvas-resolution verification (headless).
 *
 * resizeCanvas() sizes the canvas backing store to its laid-out (CSS) size,
 * DPR-adjusted. It was only wired to the window 'resize' event, so on first
 * load the canvas rendered at its construction-time resolution until the user
 * resized the window. This verifies the canvas is sized to its container at
 * startup (backing store derived from clientWidth/clientHeight).
 *
 * Requires the dev server running (PORT 3456 by default here).
 * Run: node test-startup-resize.mjs
 */
import { chromium } from 'playwright'

const URL = process.env.TEST_URL || 'http://127.0.0.1:3456'
let failures = 0
const fail = (m) => { console.error(`  FAIL - ${m}`); failures++ }
const ok = (m) => console.log(`  ok - ${m}`)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', () => {})

console.log(`Loading app at ${URL} ...`)
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(4000)

const r = await page.evaluate(() => {
    const c = (window.effectWorkspaceRenderer && window.effectWorkspaceRenderer.canvas)
        || document.querySelector('canvas')
    if (!c) return { noCanvas: true }
    // Replicate resizeCanvas()'s math from the laid-out size.
    const baseDpr = window.devicePixelRatio || 1
    const width = c.clientWidth || 1024
    const height = c.clientHeight || 1024
    const isHighRes = width * baseDpr > 1920 || height * baseDpr > 1080
    const dpr = isHighRes ? baseDpr * 0.5 : baseDpr
    return {
        clientWidth: c.clientWidth,
        clientHeight: c.clientHeight,
        canvasWidth: c.width,
        canvasHeight: c.height,
        expectedW: Math.floor(width * dpr),
        expectedH: Math.floor(height * dpr),
        devicePixelRatio: window.devicePixelRatio
    }
})

console.log('  ', JSON.stringify(r))

if (r.noCanvas) { fail('no canvas found'); await browser.close(); process.exit(1) }

if (r.clientWidth > 0 && r.clientHeight > 0) ok(`canvas is laid out (${r.clientWidth}x${r.clientHeight} css px)`)
else fail('canvas has no layout size — test cannot distinguish')

if (r.canvasWidth === r.expectedW && r.canvasHeight === r.expectedH) {
    ok(`canvas backing store sized to container at startup (${r.canvasWidth}x${r.canvasHeight})`)
} else {
    fail(`canvas backing store ${r.canvasWidth}x${r.canvasHeight} != container-derived ${r.expectedW}x${r.expectedH} (not resized at startup)`)
}

await browser.close()
console.log(failures === 0 ? '\nAll startup-resize checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
