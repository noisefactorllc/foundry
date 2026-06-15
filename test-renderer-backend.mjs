/**
 * Backend-switch behavior verification for ShadeRenderer (headless, real engine).
 *
 * renderer.js wraps the external WebGL2/WebGPU engine (loaded from the CDN), so
 * it can only be exercised in a real browser with the engine present. This boots
 * the app and drives renderer.switchBackend() directly.
 *
 * Verifies two fixes:
 *   B) Live parameter edits are PRESERVED across a backend switch. switchBackend
 *      must recompile the CURRENT program (programState.toDsl(), which bakes in
 *      live values) rather than the stale last-compiled DSL (original defaults).
 *   C) A FAILED switch must not leave a frozen canvas: if the engine switch
 *      throws while the loop was running, the render loop must be restarted.
 *
 * Requires the dev server running (PORT 3456 by default here).
 * Run: node test-renderer-backend.mjs
 */
import { chromium } from 'playwright'

const URL = process.env.TEST_URL || 'http://127.0.0.1:3456'
let failures = 0
const fail = (m) => { console.error(`  FAIL - ${m}`); failures++ }
const ok = (m) => console.log(`  ok - ${m}`)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

const consoleErrors = []
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

console.log(`Loading app at ${URL} ...`)
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(4000) // app init + first compile

const booted = await page.evaluate(() => !!window.effectWorkspaceRenderer)
if (booted) ok('app initialized (renderer present)')
else { fail('app did not initialize'); await browser.close(); process.exit(1) }

// =============================================================================
console.log('B) Parameter values preserved across backend switch')
// =============================================================================
const preserve = await page.evaluate(async () => {
    const renderer = window.effectWorkspaceRenderer
    // Two distinct, both-valid programs. A stands in for "what was last compiled";
    // B stands in for "the live program with the user's edits" (what toDsl()
    // would return after the user changed params).
    const dslA = 'search synth\n\nsolid()\n  .write(o0)\n\nrender(o0)'
    const dslB = 'search synth\n\nnoise()\n  .write(o0)\n\nrender(o0)'

    const compiledA = await renderer.compile(dslA)

    // Simulate live edits having updated the program state: toDsl() now reports B.
    const origToDsl = renderer.programState.toDsl.bind(renderer.programState)
    renderer.programState.toDsl = () => dslB

    let switchResult
    try {
        switchResult = await renderer.switchBackend('webgl2') // same backend → recompile path
    } finally {
        renderer.programState.toDsl = origToDsl
    }

    const after = renderer.currentDsl.trim()
    return {
        compiledA: compiledA.success,
        switchOk: switchResult.success,
        preservedLive: after === dslB.trim(),
        revertedToStale: after === dslA.trim()
    }
})

if (preserve.compiledA && preserve.switchOk) ok('compile + same-backend switch succeed')
else fail(`setup failed (compiledA=${preserve.compiledA}, switchOk=${preserve.switchOk})`)

if (preserve.preservedLive) ok('switch recompiles the LIVE program (param edits preserved)')
else if (preserve.revertedToStale) fail('switch reverted to the stale last-compiled DSL (param edits lost)')
else fail('switch produced an unexpected DSL')

// =============================================================================
console.log('C) Render loop restored after a failed switch')
// =============================================================================
const recover = await page.evaluate(async () => {
    const renderer = window.effectWorkspaceRenderer
    await renderer.compile('search synth\n\nsolid()\n  .write(o0)\n\nrender(o0)')
    renderer.start()
    const wasRunning = renderer.isRunning

    // Force the underlying engine switch to throw.
    const inner = renderer._renderer
    const orig = inner.switchBackend.bind(inner)
    inner.switchBackend = () => { throw new Error('forced engine switch failure') }

    let result
    try {
        result = await renderer.switchBackend('webgpu')
    } finally {
        inner.switchBackend = orig
    }

    const stillRunning = renderer.isRunning
    renderer.stop()
    return { wasRunning, failedAsExpected: result.success === false, stillRunning }
})

if (recover.wasRunning && recover.failedAsExpected) ok('failed switch returns success:false (as expected)')
else fail(`setup unexpected (wasRunning=${recover.wasRunning}, failed=${recover.failedAsExpected})`)

if (recover.stillRunning) ok('render loop restarted after the failed switch (no frozen canvas)')
else fail('render loop left STOPPED after a failed switch (canvas would freeze)')

// Restore a clean running default program for any later checks.
await page.evaluate(async () => {
    const r = window.effectWorkspaceRenderer
    try { await r.compile('search synth\n\nsolid()\n  .write(o0)\n\nrender(o0)') } catch (_) {}
})

const fatal = consoleErrors.filter(e =>
    /Failed to (fetch|resolve|load) module|is not defined|Cannot find module|SyntaxError|Unexpected/i.test(e))
if (fatal.length === 0) ok('no fatal module/runtime errors')
else fail(`fatal errors:\n    ${fatal.join('\n    ')}`)

await browser.close()
console.log(failures === 0 ? '\nAll backend-switch checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
