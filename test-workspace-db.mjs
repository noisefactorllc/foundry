/**
 * IndexedDB persistence verification for the workspace layer (headless).
 *
 * Exercises the REAL workspace-db.js module against REAL IndexedDB in Chromium:
 *   1. Round-trip regression: save -> load -> list -> delete -> load-missing.
 *      (Characterizes the happy path; guards the lifecycle refactor.)
 *   2. Migration safety (the fix under test): a failed write must NOT leak an
 *      open DB connection, and an open connection must not block a future
 *      DB_VERSION upgrade. With the bug, a leaked v1 connection blocks the
 *      upgrade forever (we detect the hang via timeout). With the fix
 *      (close-on-error + db.onversionchange), the upgrade proceeds.
 *
 * Requires the dev server running (PORT 3456 by default here).
 * Run: node test-workspace-db.mjs
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

console.log(`Loading origin at ${URL} ...`)
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
// Let any app-boot DB connection open and close before we run isolated tests.
await page.waitForTimeout(1500)

// =============================================================================
console.log('Round-trip persistence (save / load / list / delete)')
// =============================================================================
const rt = await page.evaluate(async () => {
    const db = await import('/js/workspace/workspace-db.js')
    const { WorkspaceStore } = await import('/js/workspace/workspace-store.js')
    const ID = 'test-roundtrip'

    await db.deleteWorkspace(ID) // clean slate

    const store = new WorkspaceStore()
    store.name = 'RoundTrip Effect'
    store.setFile('glsl/main.glsl', '#version 300 es\nvoid main(){}')
    store.setFile('definition.json', '{"name":"rt"}')
    await db.saveWorkspace(store, ID)

    const loaded = new WorkspaceStore()
    const found = await db.loadWorkspace(loaded, ID)

    const list = await db.listWorkspaces()
    const inList = list.some(w => w.id === ID && w.name === 'RoundTrip Effect')

    const missing = await db.loadWorkspace(new WorkspaceStore(), 'no-such-id')

    await db.deleteWorkspace(ID)
    const foundAfterDelete = await db.loadWorkspace(new WorkspaceStore(), ID)

    return {
        found,
        name: loaded.name,
        glsl: loaded.getFile('glsl/main.glsl'),
        def: loaded.getFile('definition.json'),
        fileCount: loaded.listFiles().length,
        inList,
        missing,
        foundAfterDelete
    }
})

if (rt.found === true) ok('saved workspace loads back')
else fail('saved workspace did not load')

if (rt.name === 'RoundTrip Effect') ok('name persists')
else fail(`name not persisted (got ${JSON.stringify(rt.name)})`)

if (rt.glsl === '#version 300 es\nvoid main(){}' && rt.def === '{"name":"rt"}' && rt.fileCount === 2)
    ok('all files persist with exact content')
else fail(`file contents not persisted exactly (count=${rt.fileCount})`)

if (rt.inList === true) ok('listWorkspaces includes the saved workspace')
else fail('listWorkspaces missing the saved workspace')

if (rt.missing === false) ok('loadWorkspace returns false for a missing id')
else fail(`loadWorkspace(missing) returned ${rt.missing}`)

if (rt.foundAfterDelete === false) ok('deleteWorkspace removes the workspace')
else fail('workspace still present after delete')

// =============================================================================
console.log('Migration safety (no connection leak / no upgrade hang)')
// =============================================================================
const mig = await page.evaluate(async () => {
    const db = await import('/js/workspace/workspace-db.js')

    // (1) Force a failed write: a non-cloneable value makes put() throw a
    //     DataCloneError. The bug leaves the DB connection open afterwards.
    const badStore = { name: 'bad', files: new Map([['x', () => {}]]) }
    let saveThrew = false
    try {
        await db.saveWorkspace(badStore, 'test-bad')
    } catch (e) {
        saveThrew = true
    }

    await new Promise(r => setTimeout(r, 100))

    // (2) Request a version upgrade. A leaked older-version connection blocks
    //     this; if nothing closes it, the upgrade hangs (we time out at 4s).
    const result = await new Promise((resolve) => {
        let blocked = false
        let settled = false
        const done = (v) => { if (!settled) { settled = true; resolve(v) } }
        let req
        try {
            req = indexedDB.open('shade-workspace', 2)
        } catch (e) {
            done({ ok: false, error: String(e) }); return
        }
        req.onblocked = () => { blocked = true }
        req.onupgradeneeded = () => { /* keep existing store; just bump version */ }
        req.onsuccess = () => { req.result.close(); done({ ok: true, blocked }) }
        req.onerror = () => done({ ok: false, blocked, error: String(req.error) })
        setTimeout(() => done({ ok: false, blocked, timedOut: true }), 4000)
    })

    return { saveThrew, ...result }
})

if (mig.saveThrew === true) ok('a non-cloneable write rejects (error path exercised)')
else fail('expected the bad write to reject')

if (mig.ok === true && mig.timedOut !== true) {
    ok('version upgrade completes — no connection leak blocks the migration')
} else if (mig.timedOut) {
    fail('version upgrade HUNG (blocked=' + mig.blocked + ') — a connection leaked and blocked the migration')
} else {
    fail('version upgrade failed: ' + (mig.error || JSON.stringify(mig)))
}

// Fatal import/runtime errors would indicate a broken edit.
const fatal = consoleErrors.filter(e =>
    /Failed to (fetch|resolve|load) module|is not defined|Cannot find module|SyntaxError|Unexpected/i.test(e))
if (fatal.length === 0) ok('no fatal module/runtime errors')
else fail(`fatal errors:\n    ${fatal.join('\n    ')}`)

await browser.close()

console.log(failures === 0 ? '\nAll workspace-db checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
