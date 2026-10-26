/**
 * Error-surfacing verification (headless).
 *
 * Previously the global error/unhandledrejection handlers swallowed failures
 * silently (showToast=false) and storage.js swallowed write failures (set()
 * returned false, callers ignored it). This verifies that:
 *   - a clean boot shows NO error/warning toast (no spurious spam),
 *   - an unhandled rejection surfaces a toast,
 *   - identical errors are de-duplicated (no toast storm),
 *   - a localStorage write failure (quota) surfaces a Storage toast.
 *
 * Requires the dev server running (PORT 3456 by default here).
 * Run: node test/test-error-surfacing.mjs
 */
import { chromium } from 'playwright'

const URL = process.env.TEST_URL || 'http://127.0.0.1:3456'
let failures = 0
const fail = (m) => { console.error(`  FAIL - ${m}`); failures++ }
const ok = (m) => console.log(`  ok - ${m}`)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.on('pageerror', () => {}) // expected: we deliberately trigger rejections

console.log(`Loading app at ${URL} ...`)
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(4000)

const errToasts = () => page.evaluate(() =>
    [...document.querySelectorAll('#toast-container .toast-error, #toast-container .toast-warning')]
        .map(t => (t.querySelector('.toast-message') || {}).textContent || ''))

// 1) Clean boot — no ERROR toasts (the global-handler flip surfaces uncaught
// errors as .toast-error; warnings like the headless FPS "performance pause"
// are deliberate and unrelated, so this guards specifically against error spam).
console.log('Clean boot')
const bootErrors = await page.evaluate(() =>
    [...document.querySelectorAll('#toast-container .toast-error')]
        .map(t => (t.querySelector('.toast-message') || {}).textContent || ''))
if (bootErrors.length === 0) ok('no error toasts on a clean boot (no spurious surfacing)')
else fail(`unexpected boot error toasts: ${JSON.stringify(bootErrors)}`)

// 2) Unhandled rejection surfaces a toast
console.log('Unhandled rejection')
await page.evaluate(() => { Promise.reject(new Error('TEST_UNHANDLED_xyz')) })
await page.waitForTimeout(600)
let t = await errToasts()
if (t.some(m => m.includes('TEST_UNHANDLED_xyz'))) ok('unhandled rejection surfaces an error toast')
else fail(`no toast for unhandled rejection (toasts: ${JSON.stringify(t)})`)

// 3) Dedupe — identical errors within the window produce one toast
console.log('De-duplication')
await page.evaluate(() => {
    Promise.reject(new Error('DEDUPE_TEST_msg'))
    Promise.reject(new Error('DEDUPE_TEST_msg'))
})
await page.waitForTimeout(600)
t = await errToasts()
const dupes = t.filter(m => m.includes('DEDUPE_TEST_msg')).length
if (dupes === 1) ok('identical errors are de-duplicated to a single toast')
else fail(`expected 1 deduped toast, got ${dupes}`)

// 4) localStorage write failure (quota) surfaces a Storage toast
console.log('Storage write failure')
const storageResult = await page.evaluate(async () => {
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError') }
    try {
        const { storage } = await import('/js/utils/storage.js')
        storage.set('test_quota_key', { big: 'data' })
        await new Promise(r => setTimeout(r, 400))
        return [...document.querySelectorAll('#toast-container .toast')]
            .map(el => (el.querySelector('.toast-message') || {}).textContent || '')
    } finally {
        Storage.prototype.setItem = orig
    }
})
if (storageResult.some(m => /storage|quota/i.test(m))) ok('storage write failure surfaces a Storage toast')
else fail(`no Storage toast on quota failure (toasts: ${JSON.stringify(storageResult)})`)

// 5) Non-Error rejection reasons render readably (not "[object Object]")
console.log('Non-Error rejection reason')
await page.evaluate(() => { Promise.reject({ code: 'OBJ_REASON_test', detail: 'x' }) })
await page.waitForTimeout(600)
t = await errToasts()
if (t.some(m => m.includes('OBJ_REASON_test')) && !t.some(m => m.trim() === '[object Object]')) {
    ok('non-Error rejection reason renders readably (no "[object Object]")')
} else {
    fail(`object reason not rendered readably (toasts: ${JSON.stringify(t)})`)
}

await browser.close()
console.log(failures === 0 ? '\nAll error-surfacing checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
