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
console.log('Images are saved as bytes; earlier Blob records still load; an earlier base64 images.json is rewritten as bytes')
// =============================================================================
const img = await page.evaluate(async () => {
    const db = await import('/js/workspace/workspace-db.js')
    const { WorkspaceStore } = await import('/js/workspace/workspace-store.js')
    const TEXT = /base64|data:image|dataUrl/
    const raw = async (id) => {
        const opened = await new Promise((resolve, reject) => {
            const request = indexedDB.open('shade-workspace', 1)
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
        })
        try {
            return await new Promise((resolve, reject) => {
                const tx = opened.transaction('workspaces', 'readwrite')
                const store = tx.objectStore('workspaces')
                if (typeof id === 'object') { store.put(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); return }
                const get = store.get(id)
                get.onsuccess = () => resolve(get.result)
                get.onerror = () => reject(get.error)
            })
        } finally { opened.close() }
    }
    // A 1x1 PNG.
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))
    const id = 'f'.repeat(64)
    const blob = new Blob([bytes], { type: 'image/png' })

    const store = new WorkspaceStore()
    store.name = 'Image Effect'
    store.setFile('dsl.txt', `search synth\nmedia(url: "image:${id}").write(o0)`)
    store.images = [{ id, blob, mimeType: 'image/png', width: 1, height: 1 }]
    await db.saveWorkspace(store, 'test-images')
    const record = await raw('test-images')
    const loaded = new WorkspaceStore()
    await db.loadWorkspace(loaded, 'test-images')
    const loadedBytes = [...new Uint8Array(await loaded.images[0].blob.arrayBuffer())]

    // A record saved before images were stored as bytes holds a Blob.
    await raw({ id: 'test-blob', name: 'Blob', files: { 'dsl.txt': 'x' }, images: [{ id, blob, mimeType: 'image/png', width: 1, height: 1 }], savedAt: 1 })
    const blobLoaded = new WorkspaceStore()
    await db.loadWorkspace(blobLoaded, 'test-blob')
    const blobBytes = [...new Uint8Array(await blobLoaded.images[0].blob.arrayBuffer())]

    // An earlier record: the image listed as base64 text in images.json.
    const dataUrl = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
    await raw({ id: 'test-earlier', name: 'Earlier', files: { 'dsl.txt': 'x', 'images.json': JSON.stringify([{ id, dataUrl, mimeType: 'image/png', width: 1, height: 1 }]) }, savedAt: 1 })
    const earlier = new WorkspaceStore()
    await db.loadWorkspace(earlier, 'test-earlier')
    const rewritten = await raw('test-earlier')
    const earlierBytes = [...new Uint8Array(await earlier.images[0].blob.arrayBuffer())]
    await db.deleteWorkspace('test-images')
    await db.deleteWorkspace('test-earlier')
    await db.deleteWorkspace('test-blob')
    const saved = record.images[0]
    return {
        savedBytes: record.images.length === 1 && saved.bytes instanceof ArrayBuffer && !('blob' in saved) && saved.type === 'image/png' &&
            [...new Uint8Array(saved.bytes)].join() === [...bytes].join() && saved.mimeType === 'image/png' && saved.width === 1 && saved.height === 1,
        savedText: TEXT.test(JSON.stringify(record)) || 'images.json' in record.files,
        loadedBlob: loaded.images.length === 1 && loaded.images[0].blob instanceof Blob && loaded.images[0].blob.type === 'image/png' &&
            !('dataUrl' in loaded.images[0]) && !('bytes' in loaded.images[0]) && loaded.images[0].width === 1,
        loadedBytesMatch: loadedBytes.join() === [...bytes].join(),
        blobRecordLoads: blobLoaded.images.length === 1 && blobLoaded.images[0].blob instanceof Blob && blobBytes.join() === [...bytes].join(),
        earlierBlob: earlier.images.length === 1 && earlier.images[0].blob instanceof Blob && !('dataUrl' in earlier.images[0]),
        earlierBytesMatch: earlierBytes.join() === [...bytes].join(),
        earlierFiles: earlier.listFiles(),
        rewrittenBytes: rewritten.images?.length === 1 && rewritten.images[0].bytes instanceof ArrayBuffer && !('blob' in rewritten.images[0]),
        rewrittenText: TEXT.test(JSON.stringify(rewritten)) || 'images.json' in rewritten.files,
        rewrittenKept: rewritten.name === 'Earlier' && rewritten.savedAt === 1 && rewritten.files['dsl.txt'] === 'x'
    }
})

if (img.savedBytes && !img.savedText) ok('images are saved as their bytes in an ArrayBuffer with their type, with no Blob and no image text')
else fail(`saved images not bytes (bytes=${img.savedBytes}, text=${img.savedText})`)

if (img.loadedBlob && img.loadedBytesMatch) ok('saved images load back as Blob records with the same bytes')
else fail(`loaded images wrong (blob=${img.loadedBlob}, bytes=${img.loadedBytesMatch})`)

if (img.blobRecordLoads) ok('an image saved earlier as a Blob still loads with the same bytes')
else fail('an image saved earlier as a Blob did not load')

if (img.earlierBlob && img.earlierBytesMatch && img.earlierFiles.join() === 'dsl.txt') ok('an earlier base64 images.json loads as Blob records')
else fail(`earlier images wrong (blob=${img.earlierBlob}, bytes=${img.earlierBytesMatch}, files=${img.earlierFiles})`)

if (img.rewrittenBytes && !img.rewrittenText && img.rewrittenKept) ok('the earlier saved workspace is rewritten with image bytes and no image text')
else fail(`earlier workspace not rewritten (bytes=${img.rewrittenBytes}, text=${img.rewrittenText}, kept=${img.rewrittenKept})`)

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
