/**
 * Startup compile-count verification (headless).
 *
 * On a returning user's startup the workspace is restored from IndexedDB, which
 * took the "restored" branch in init() that compiled the program, and THEN the
 * unconditional compile at the end of init() compiled the same program again —
 * two full shader compiles per load. This verifies a restored startup compiles
 * exactly once.
 *
 * Technique: trap the window.effectWorkspaceRenderer assignment (which happens at
 * module-eval, before init() runs) and wrap renderer.compile with a counter.
 *
 * Requires the dev server running (PORT 3456 by default here).
 * Run: node test-startup-compile.mjs
 */
import { chromium } from 'playwright'

const URL = process.env.TEST_URL || 'http://127.0.0.1:3456'
let failures = 0
const fail = (m) => { console.error(`  FAIL - ${m}`); failures++ }
const ok = (m) => console.log(`  ok - ${m}`)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

// Runs before page scripts on EVERY navigation (incl. reload); resets the counter
// and re-wraps compile on the freshly-constructed renderer each time.
await page.addInitScript(() => {
    window.__compileCount = 0
    let _r
    Object.defineProperty(window, 'effectWorkspaceRenderer', {
        configurable: true,
        get() { return _r },
        set(v) {
            _r = v
            if (v && typeof v.compile === 'function' && !v.__countPatched) {
                const orig = v.compile.bind(v)
                v.compile = (...args) => { window.__compileCount++; return orig(...args) }
                v.__countPatched = true
            }
        }
    })
})

const consoleErrors = []
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

console.log(`Loading app at ${URL} (first run) ...`)
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(4000)
if (await page.evaluate(() => !!window.effectWorkspaceRenderer)) ok('app booted (first run)')
else { fail('app did not boot'); await browser.close(); process.exit(1) }

// Persist a workspace (with a dsl.txt) so the reload takes the restored branch.
await page.evaluate(async () => {
    const ws = window.effectWorkspace.workspaceStore
    if (!ws.getFile('dsl.txt')) {
        ws.setFile('dsl.txt', 'search synth\n\nsolid()\n  .write(o0)\n\nrender(o0)')
    }
    const { saveWorkspace } = await import('/js/workspace/workspace-db.js')
    await saveWorkspace(ws)
})

console.log('Reloading (restored-workspace path) ...')
await page.reload({ waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(4000)

const r = await page.evaluate(() => ({
    booted: !!window.effectWorkspaceRenderer,
    compiles: window.__compileCount,
    dslOk: !!((window.effectWorkspaceRenderer && window.effectWorkspaceRenderer.currentDsl) || '').trim()
}))

if (r.booted) ok('app booted (restored reload)')
else fail('app did not boot after reload')

// Note: render-loop running-state is not asserted — headless Chromium backgrounds
// the page and pauses the RAF loop regardless of code. currentDsl proves the
// program compiled successfully on the restored path.
if (r.dslOk) ok('renderer compiled successfully after restored reload')
else fail('renderer has no compiled DSL after reload')

if (r.compiles === 1) ok(`restored startup compiles exactly once (count=${r.compiles})`)
else fail(`restored startup compiled ${r.compiles}x (expected 1 — redundant double-compile)`)

const fatal = consoleErrors.filter(e => /is not defined|SyntaxError|Unexpected|Cannot find/i.test(e))
if (fatal.length === 0) ok('no fatal errors')
else fail(`fatal errors: ${fatal.join('; ')}`)

await browser.close()
console.log(failures === 0 ? '\nAll startup-compile checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
