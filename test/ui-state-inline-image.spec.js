// End-to-end: an image the DSL editor holds inline is never saved to localStorage as text.
//
// Starts Foundry on a free local port and drives it in fresh browser contexts.
// The editor state is saved to localStorage. An image the program carries as a
// `data:image/...;base64,...` media URL must be saved there as
// `image:<sha256>`, with its bytes kept in IndexedDB among the workspace
// images. Editor state saved before that, with the image as text, must still
// load: the program renders the image, and the stored copy is rewritten.
//
// BROWSER picks chromium (default), firefox or webkit. PLAYWRIGHT_MODULE names
// another Playwright build to drive the browser with.
// Run: BROWSER=webkit node --test test/ui-state-inline-image.spec.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const FOUNDRY = fileURLToPath(new URL('..', import.meta.url))
const BROWSER = process.env.BROWSER || 'chromium'
const TEXT_IMAGE = /base64|data:image|dataUrl/

const digest = bytes => createHash('sha256').update(bytes).digest('hex')

function crc32(bytes) {
    let crc = 0xffffffff
    for (const byte of bytes) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    return (crc ^ 0xffffffff) >>> 0
}

/** A solid-color RGBA PNG. */
function png(size, [red, green, blue]) {
    const chunk = (type, data) => {
        const body = Buffer.concat([Buffer.from(type), data])
        const length = Buffer.alloc(4), checksum = Buffer.alloc(4)
        length.writeUInt32BE(data.length)
        checksum.writeUInt32BE(crc32(body))
        return Buffer.concat([length, body, checksum])
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 4).map((_, i) => [red, green, blue, 255][i % 4])])
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.concat(Array(size).fill(row)))),
        chunk('IEND', Buffer.alloc(0)),
    ])
}

/** The first pixel of a PNG screenshot, as [r, g, b]. */
function pngPixel(bytes) {
    let offset = 8, colorType, data = []
    while (offset < bytes.length) {
        const length = bytes.readUInt32BE(offset), type = bytes.toString('latin1', offset + 4, offset + 8)
        const body = bytes.subarray(offset + 8, offset + 8 + length)
        if (type === 'IHDR') colorType = body[9]
        if (type === 'IDAT') data.push(body)
        offset += 12 + length
    }
    assert.ok(colorType === 2 || colorType === 6, `unexpected PNG color type ${colorType}`)
    // In the first pixel of the first row every filter predicts zero.
    return [...inflateSync(Buffer.concat(data)).subarray(1, 4)]
}

// Large enough to cover the whole canvas, which the media step draws it over at its own size.
const RED = png(2048, [255, 0, 0])
const RED_ID = digest(RED)
const program = url => `search synth\nmedia(url: "${url}").write(o0)\nrender(o0)`
const INLINE_PROGRAM = program(`data:image/png;base64,${RED.toString('base64')}`)
const STORED_PROGRAM = program(`image:${RED_ID}`)

const freePort = () => new Promise((resolve, reject) => {
    const server = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
        const { port } = server.address()
        server.close(() => resolve(port))
    })
})

async function startFoundry(port) {
    const child = spawn(process.execPath, ['server/index.js'], { cwd: FOUNDRY, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', data => { stderr += data })
    for (let i = 0; i < 100; i++) {
        if (await fetch(`http://127.0.0.1:${port}/health`).then(r => r.ok).catch(() => false)) return child
        if (child.exitCode !== null) break
        await new Promise(resolve => setTimeout(resolve, 100))
    }
    child.kill('SIGTERM')
    throw new Error(`Foundry did not start: ${stderr}`)
}

/** Everything localStorage holds, and the workspace images IndexedDB holds, with the SHA-256 of their bytes. */
const storedState = page => page.evaluate(() => new Promise((resolve, reject) => {
    const local = Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]))
    const open = indexedDB.open('shade-workspace')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
        const db = open.result
        if (!db.objectStoreNames.contains('workspaces')) {
            db.close()
            resolve({ local, images: [] })
            return
        }
        const get = db.transaction('workspaces').objectStore('workspaces').get('current')
        get.onerror = () => { db.close(); reject(get.error) }
        get.onsuccess = async () => {
            db.close()
            const hex = async buffer => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), byte => byte.toString(16).padStart(2, '0')).join('')
            const images = await Promise.all((get.result?.images || []).map(async image => {
                const bytes = image.bytes instanceof ArrayBuffer ? image.bytes : image.blob instanceof Blob ? await image.blob.arrayBuffer() : null
                return { id: image.id, sha256: bytes && await hex(bytes) }
            }))
            resolve({ local, images })
        }
    }
}))

/** Wait until the stored state passes `check`; return it. */
async function waitForStoredState(page, check, label) {
    let state
    for (let i = 0; i < 150; i++) {
        state = await storedState(page)
        if (check(state)) return state
        await page.waitForTimeout(100)
    }
    return assert.fail(`${label}: ${JSON.stringify(state, (key, value) => typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value)}`)
}

const uiStateDsl = state => {
    try {
        return JSON.parse(state.local['shade:ui_state'] ?? 'null')?.dsl
    } catch {
        return undefined
    }
}
const noImageText = state => Object.values(state.local).every(value => !TEXT_IMAGE.test(value))
const holdsRedBytes = state => state.images.some(image => image.id === RED_ID && image.sha256 === RED_ID)

test(`${BROWSER}: the DSL editor saves an inline image by its id, and editor state saved with one still loads`, { timeout: 240000 }, async t => {
    const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
    const port = await freePort()
    const ORIGIN = `http://127.0.0.1:${port}`
    const foundry = await startFoundry(port)
    const browser = await playwright[BROWSER].launch({
        headless: true,
        args: BROWSER !== 'chromium' ? [] : process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader']
    })
    t.after(async () => {
        await browser.close()
        foundry.kill('SIGTERM')
    })

    const openFoundry = async ({ uiState } = {}) => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        if (uiState) {
            await page.addInitScript(value => {
                if (!sessionStorage.getItem('ui-state-seeded')) {
                    sessionStorage.setItem('ui-state-seeded', '1')
                    localStorage.setItem('shade:ui_state', value)
                }
            }, JSON.stringify(uiState))
        }
        await page.goto(ORIGIN)
        await page.waitForFunction(() => window.effectWorkspace && document.getElementById('loading-screen')?.classList.contains('hidden'), null, { timeout: 90000 })
        return { context, page, errors }
    }

    await t.test('an inline image typed into the editor is saved by its id', async () => {
        const { context, page, errors } = await openFoundry()
        await page.evaluate(dsl => {
            const editor = document.getElementById('dsl-editor')
            editor.value = dsl
            editor.dispatchEvent(new Event('input', { bubbles: true }))
        }, INLINE_PROGRAM)
        const state = await waitForStoredState(page, state => uiStateDsl(state) === STORED_PROGRAM && holdsRedBytes(state),
            'localStorage names the image by its id and IndexedDB holds its bytes')
        assert.ok(noImageText(state), 'localStorage holds no image as text')
        assert.equal(await page.evaluate(() => document.getElementById('dsl-editor').value), INLINE_PROGRAM, 'the editor text is unchanged')
        assert.deepEqual(errors, [])
        await context.close()
    })

    await t.test('editor state saved with an inline image still loads, and is stored by its id', async () => {
        const { context, page, errors } = await openFoundry({ uiState: { dsl: INLINE_PROGRAM, sidebarCollapsed: false, lastOpenedFile: 'dsl.txt' } })
        assert.equal(await page.evaluate(() => document.getElementById('dsl-editor').value), INLINE_PROGRAM, 'the saved program is in the editor')

        // A pixel of the output canvas that no panel covers, after a rendered frame:
        // the editor, which wraps the inline image's text, fills the left side and
        // the documentation panel the right, short of the corner.
        const box = await page.locator('#canvas').boundingBox()
        let pixel
        for (let i = 0; i < 120; i++) {
            await page.evaluate(() => { const engine = window.effectWorkspaceRenderer._renderer; engine.stop(); engine.render(0) })
            pixel = pngPixel(await page.screenshot({ clip: { x: box.x + box.width - 6, y: box.y + box.height - 6, width: 1, height: 1 } }))
            if (pixel[0] > 240 && pixel[1] < 16 && pixel[2] < 16) break
            await page.waitForTimeout(250)
        }
        assert.ok(pixel[0] > 240 && pixel[1] < 16 && pixel[2] < 16, `the saved program renders its image: output pixel is ${pixel}`)

        const state = await waitForStoredState(page, state => uiStateDsl(state) === STORED_PROGRAM && holdsRedBytes(state),
            'the stored editor state names the image by its id and IndexedDB holds its bytes')
        assert.ok(noImageText(state), 'localStorage holds no image as text')
        assert.deepEqual(errors, [])
        await context.close()
    })
})
