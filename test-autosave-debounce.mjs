/**
 * Autosave debounce verification (headless).
 *
 * The workspace autosave fired a full serialize + IndexedDB put on EVERY change
 * (workspaceStore.onChange → saveWorkspace), and undo checkpoints / param drags
 * amplify that. This verifies the autosave is debounced (a burst of rapid changes
 * collapses to a single write) while staying durable (a change is still persisted,
 * and is flushed immediately when the tab is hidden).
 *
 * Requires the dev server running (PORT 3456 by default here).
 * Run: node test-autosave-debounce.mjs
 */
import { chromium } from 'playwright'

const URL = process.env.TEST_URL || 'http://127.0.0.1:3456'
let failures = 0
const fail = (m) => { console.error(`  FAIL - ${m}`); failures++ }
const ok = (m) => console.log(`  ok - ${m}`)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

// Count IndexedDB writes to the 'workspaces' store (i.e. saveWorkspace puts).
await page.addInitScript(() => {
    window.__wsPuts = 0
    const origPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'workspaces') window.__wsPuts++
        return origPut.apply(this, args)
    }
})

// Every check runs inside try/finally: an in-page throw (or a rejected
// page.evaluate) would otherwise propagate at top level and leave chromium
// running headless with nobody to close it.
try {
    page.on('pageerror', () => {})
    console.log(`Loading app at ${URL} ...`)
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(4000)
    if (!await page.evaluate(() => !!window.effectWorkspace)) { fail('app did not boot'); await browser.close(); process.exit(1) }

    // 1) A burst of rapid changes collapses to a single write.
    console.log('Debounced autosave')
    const burst = await page.evaluate(async () => {
        window.__wsPuts = 0
        const ws = window.effectWorkspace.workspaceStore
        for (let i = 0; i < 5; i++) ws.setFile('probe' + i, String(i))
        await new Promise(r => setTimeout(r, 800)) // > debounce window
        return window.__wsPuts
    })
    if (burst === 1) ok(`5 rapid changes → 1 write (got ${burst})`)
    else fail(`5 rapid changes produced ${burst} writes (expected 1 — autosave not debounced)`)

    // 2) Durability: the debounced change WAS persisted (at least one write happened).
    if (burst >= 1) ok('debounced change is still persisted (not dropped)')
    else fail('debounced change was never written')

    // 3) Flush on tab-hide: a change is written promptly when the page is hidden,
    //    without waiting out the debounce window.
    console.log('Flush on tab hide')
    const flushed = await page.evaluate(async () => {
        window.__wsPuts = 0
        const ws = window.effectWorkspace.workspaceStore
        ws.setFile('probe-hide', 'x')            // starts the debounce timer (no write yet)
        await new Promise(r => setTimeout(r, 50)) // well within the debounce window
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
        await new Promise(r => setTimeout(r, 150)) // still < debounce window
        return window.__wsPuts
    })
    if (flushed >= 1) ok('hiding the tab flushes a pending save immediately')
    else fail('pending save was NOT flushed on tab hide (durability gap)')

    // 4) The DSL editor's own autosave (ui_state.dsl in localStorage) must get the
    //    same flush guarantee as the workspace. It runs on a slower timer, so
    //    without a flush the last edits are lost when the tab closes.
    console.log('Flush of the editor UI state on tab hide')
    const uiFlushed = await page.evaluate(async () => {
        const editor = document.getElementById('dsl-editor')
        if (!editor) return { skipped: true }
        localStorage.removeItem('shade:ui_state')
        const typed = 'osc(freq: 42) // durability probe'
        editor.value = typed
        editor.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(r => setTimeout(r, 50))   // well inside the save timer
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
        await new Promise(r => setTimeout(r, 150))  // still inside the save timer
        const raw = localStorage.getItem('shade:ui_state')
        return { stored: raw ? (JSON.parse(raw).dsl || '') : '', typed }
    })
    if (uiFlushed.skipped) fail('no #dsl-editor in the page — cannot verify UI-state durability')
    else if (uiFlushed.stored === uiFlushed.typed) ok('hiding the tab flushes the pending editor state')
    else fail(`editor state was NOT flushed on tab hide (stored ${JSON.stringify(uiFlushed.stored)})`)

    // 5) A save that fails must not drop the change. The dirty flag is cleared
    //    before the write resolves, so a rejected write used to lose the edit
    //    permanently — nothing retried it and nothing reported it.
    console.log('A failed save is retried, not dropped')
    const retried = await page.evaluate(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))

        const realPut = IDBObjectStore.prototype.put
        let failNext = true
        IDBObjectStore.prototype.put = function (...args) {
            if (this.name === 'workspaces' && failNext) {
                failNext = false
                throw new DOMException('forced failure', 'DataCloneError')
            }
            return realPut.apply(this, args)
        }
        try {
            window.effectWorkspace.workspaceStore.setFile('probe-fail', 'v1')
            await new Promise(r => setTimeout(r, 700))  // debounce fires; that write fails
            const failureFired = !failNext        // the throwing put was consumed
            window.__wsPuts = 0
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
            document.dispatchEvent(new Event('visibilitychange'))
            await new Promise(r => setTimeout(r, 250))
            return { failureFired, puts: window.__wsPuts }
        } finally {
            IDBObjectStore.prototype.put = realPut
        }
    })
    if (!retried.failureFired) fail('the forced write failure never fired — check is not exercising the rejection path')
    else if (retried.puts >= 1) ok('a change whose save failed is still pending and gets retried')
    else fail('a failed save silently dropped the change (no retry on the next flush)')

    // 6) The editor autosave must persist what the editor holds at save time. The
    //    value is also assigned programmatically (undo, opening an effect) without
    //    an input event, so a snapshot taken at keystroke time goes stale and
    //    overwrites the newer content.
    console.log('Editor autosave writes the live value, not a stale snapshot')
    const liveValue = await page.evaluate(async () => {
        const editor = document.getElementById('dsl-editor')
        if (!editor) return { skipped: true }
        localStorage.removeItem('shade:ui_state')
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))

        editor.value = 'TYPED_HALF_EDIT'
        editor.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(r => setTimeout(r, 50))
        editor.value = 'PROGRAMMATIC_NEW_DSL'      // e.g. applyRestoredState / loadEffect
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
        await new Promise(r => setTimeout(r, 150))
        const raw = localStorage.getItem('shade:ui_state')
        return { stored: raw ? (JSON.parse(raw).dsl || '') : '', expected: editor.value }
    })
    if (liveValue.skipped) fail('no #dsl-editor in the page — cannot verify the saved value')
    else if (liveValue.stored === liveValue.expected) ok('the value saved is the editor\'s current content')
    else fail(`stale editor snapshot persisted: stored ${JSON.stringify(liveValue.stored)}, editor holds ${JSON.stringify(liveValue.expected)}`)

    // 7) localStorage can refuse a write (QuotaExceededError). storage.set reports
    //    that by returning false rather than throwing, so a discarded result loses
    //    the edit exactly the way the IndexedDB path used to.
    console.log('A refused editor-state write stays pending')
    const uiRetried = await page.evaluate(async () => {
        const editor = document.getElementById('dsl-editor')
        if (!editor) return { skipped: true }
        localStorage.removeItem('shade:ui_state')
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))

        const realSet = Storage.prototype.setItem
        let refusals = 0
        Storage.prototype.setItem = function (key, value) {
            if (key === 'shade:ui_state') {
                refusals++
                throw new DOMException('quota', 'QuotaExceededError')
            }
            return realSet.call(this, key, value)
        }
        try {
            editor.value = 'EDIT_THROUGH_A_FULL_DISK'
            editor.dispatchEvent(new Event('input', { bubbles: true }))
            await new Promise(r => setTimeout(r, 50))
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
            document.dispatchEvent(new Event('visibilitychange'))
            await new Promise(r => setTimeout(r, 100))
        } finally {
            Storage.prototype.setItem = realSet
        }
        if (refusals === 0) return { refusals }
        // Storage works again; the still-pending edit must reach it on the next flush.
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
        await new Promise(r => setTimeout(r, 100))
        const raw = localStorage.getItem('shade:ui_state')
        return { refusals, stored: raw ? (JSON.parse(raw).dsl || '') : '' }
    })
    if (uiRetried.skipped) fail('no #dsl-editor in the page — cannot verify the refused write')
    else if (uiRetried.refusals === 0) fail('the forced quota failure never fired — check is not exercising the path')
    else if (uiRetried.stored === 'EDIT_THROUGH_A_FULL_DISK') ok('an edit refused by localStorage is written on the next flush')
    else fail(`a refused editor-state write was dropped (stored ${JSON.stringify(uiRetried.stored)})`)
} finally {
    await browser.close()
}

console.log(failures === 0 ? '\nAll autosave-debounce checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
