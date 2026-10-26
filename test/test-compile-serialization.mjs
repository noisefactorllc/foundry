/**
 * Compile serialization verification (headless).
 *
 * ShadeRenderer.compile() mutates shared wrapper state across await points
 * (_uniformValues, _textCanvases.clear()+repopulate, _currentDsl, _lastGoodDsl,
 * _hasCorruptedState, and a conditional pipeline dispose). Several UI paths can
 * fire compile() while a previous one is still in flight (window resize storm,
 * Cmd+Enter double-dispatch, opening a saved effect). Overlapping compiles
 * corrupt that state -> blank canvas, missing text textures, stuck-"corrupted".
 *
 * This verifies compile() serializes: overlapping calls run strictly one at a
 * time (the inner engine compile never re-enters), and the LAST caller's DSL
 * still wins (no API/visual change — only intermediate frames are skipped).
 *
 * Requires the dev server running (PORT 3456 by default here).
 * Run: node test/test-compile-serialization.mjs
 *   or TEST_URL=https://foundry.noisedeck.app node test/test-compile-serialization.mjs
 */
import { chromium } from 'playwright'

const URL = process.env.TEST_URL || 'http://127.0.0.1:3456'
let failures = 0
const fail = (m) => { console.error(`  FAIL - ${m}`); failures++ }
const ok = (m) => console.log(`  ok - ${m}`)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

page.on('pageerror', () => {})
console.log(`Loading app at ${URL} ...`)
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(4000)
if (!await page.evaluate(() => !!window.effectWorkspace?.renderer)) {
    fail('app did not boot'); await browser.close(); process.exit(1)
}

console.log('Concurrent compiles serialize (no inner re-entrancy)')
const result = await page.evaluate(async () => {
    const renderer = window.effectWorkspace.renderer
    const inner = renderer._renderer

    const dslA = 'search synth, filter\n\nnoise().write(o0)\n\nrender(o0)'
    const dslB = 'search synth, filter\n\nsolid().write(o0)\n\nrender(o0)'

    // Preload both effects (sequentially) so the ONLY async gap during the
    // concurrent phase is our injected delay below — otherwise a slow first-time
    // effect load would mask the overlap behind network latency.
    await renderer.compile(dslA)
    await renderer.compile(dslB)

    // Instrument the inner engine compile to detect overlap, and widen the race
    // window with a delay so overlap is deterministic if it can happen at all.
    let concurrent = 0
    let maxConcurrent = 0
    const origCompile = inner.compile.bind(inner)
    inner.compile = async (...args) => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        try {
            await new Promise(r => setTimeout(r, 150))
            return await origCompile(...args)
        } finally {
            concurrent--
        }
    }

    // Fire both WITHOUT awaiting the first — this is the concurrent case.
    const [ra, rb] = await Promise.all([
        renderer.compile(dslA),
        renderer.compile(dslB)
    ])

    inner.compile = origCompile
    return {
        maxConcurrent,
        current: renderer.currentDsl,
        dslB,
        raOk: ra?.success === true,
        rbOk: rb?.success === true
    }
})

if (!result.raOk || !result.rbOk) {
    fail(`both compiles should succeed (got A=${result.raOk}, B=${result.rbOk}) — check test DSLs`)
} else {
    ok('both concurrent compiles resolved successfully')
}

if (result.maxConcurrent === 1) {
    ok(`inner compile never re-entered (max concurrency = ${result.maxConcurrent})`)
} else {
    fail(`inner compile overlapped (max concurrency = ${result.maxConcurrent}, expected 1) — compile() is not serialized`)
}

if (result.current === result.dslB) {
    ok('last compile wins (currentDsl === last DSL)')
} else {
    fail(`last compile did not win: currentDsl = ${JSON.stringify(result.current)} (expected ${JSON.stringify(result.dslB)})`)
}

await browser.close()
console.log(failures === 0 ? '\nAll compile-serialization checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
