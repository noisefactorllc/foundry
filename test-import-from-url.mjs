/**
 * Import-from-URL result handling (headless).
 *
 * `handleLoadFromUrl` rebuilt the pipeline by calling `recompileFromEditor()`
 * WITHOUT awaiting it and then showed `toast.success("Loaded: ...")`
 * unconditionally. So importing a composition whose DSL fails to compile showed
 * a green "Loaded" toast (claiming success) while the canvas silently broke and
 * NO compiler error was surfaced.
 *
 * This drives the REAL import dialog end-to-end (open dialog -> type code ->
 * click load) and only mocks the external sharing API at the network boundary
 * (page.route). It verifies:
 *   - a composition with INVALID dsl -> no success toast + compiler error shown
 *   - a composition with VALID dsl   -> success toast + no compiler error
 *
 * Requires the dev server running (PORT 3456 by default here).
 * Run: node test-import-from-url.mjs   (or TEST_URL=https://foundry.noisedeck.app ...)
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
if (!await page.evaluate(() => !!window.effectWorkspace)) { fail('app did not boot'); await browser.close(); process.exit(1) }

// Capture a known-good DSL straight from the booted app (it is currently
// compiled and rendering, so it is guaranteed valid in this environment).
const goodDsl = await page.evaluate(() => document.getElementById('dsl-editor')?.value || '')
if (!goodDsl.trim()) { fail('could not capture a known-good DSL from boot'); await browser.close(); process.exit(1) }

// Drive a full import through the real dialog, with the sharing API mocked to
// return a composition carrying `dsl`. Returns the observable UI outcome.
async function importComposition(dsl) {
    await page.route('**/api/composition/**', route =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ dsl, title: 'RouteTest', effects: [] })
        }))
    try {
        // Clear the UI state we assert on.
        await page.evaluate(() => {
            document.querySelectorAll('.toast').forEach(t => t.remove())
            document.getElementById('compiler-error')?.classList.remove('visible')
        })
        await page.evaluate(() => document.getElementById('importFromUrlMenuItem')?.click())
        await page.waitForSelector('.import-url-input', { timeout: 5000 })
        await page.fill('.import-url-input', 'testcode1')   // alnum 4-10 -> enables load
        await page.click('.import-url-btn-primary')
        // Wait for the import to settle to a definite outcome rather than a fixed
        // sleep (sturdier on slow machines / live): a "Loaded" success toast, an
        // error toast, or the compiler-error bar becoming visible. If nothing
        // settles, fall through and let the assertions report it.
        await page.waitForFunction(() => {
            const success = Array.from(document.querySelectorAll('.toast-success .toast-message'))
                .some(el => /loaded/i.test(el.textContent || ''))
            return success || !!document.querySelector('#compiler-error.visible') || !!document.querySelector('.toast-error')
        }, { timeout: 8000 }).catch(() => {})
        return await page.evaluate(() => ({
            successToast: !!Array.from(document.querySelectorAll('.toast-success .toast-message'))
                .find(el => /loaded/i.test(el.textContent || '')),
            compilerError: !!document.querySelector('#compiler-error.visible')
        }))
    } finally {
        await page.unroute('**/api/composition/**')
        // The dialog is a singleton that auto-closes ~500ms after a successful
        // fetch and removes its overlay ~150ms after that. Let those timers fully
        // flush before the next import opens a fresh overlay — otherwise the prior
        // cycle's stale close() stomps the new overlay (test-only race; a real
        // user never imports twice within ~650ms).
        await page.waitForTimeout(800)
    }
}

// 1) Invalid DSL: must NOT claim success, MUST surface the compiler error.
console.log('Importing a composition with INVALID dsl')
const bad = await importComposition('!@#$ not a valid program (((')
if (!bad.successToast) ok('invalid import does NOT show a false "Loaded" success toast')
else fail('invalid import wrongly showed a "Loaded" success toast')
if (bad.compilerError) ok('invalid import surfaces the compiler error (#compiler-error visible)')
else fail('invalid import did NOT surface the compiler error')

// 2) Valid DSL: success toast, no compiler error (happy path must be preserved).
console.log('Importing a composition with VALID dsl')
const good = await importComposition(goodDsl)
if (good.successToast) ok('valid import shows the success toast')
else fail('valid import did NOT show the success toast')
if (!good.compilerError) ok('valid import shows no compiler error')
else fail('valid import wrongly showed a compiler error')

await browser.close()
console.log(failures === 0 ? '\nAll import-from-url checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
