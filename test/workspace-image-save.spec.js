// End-to-end: a workspace image is saved to IndexedDB and renders again after a reload.
//
// Starts Foundry on a free local port and drives it in a fresh, ephemeral browser
// context: WebKit's ephemeral contexts, like Safari's private browsing, refuse a
// Blob or File in IndexedDB but take an ArrayBuffer. A ZIP whose effect uses a
// solid red PNG, kept as an image file, is imported; the reloaded page must render
// the image red, and the saved bytes must be the PNG's own bytes.
//
// BROWSER picks chromium (default), firefox or webkit. PLAYWRIGHT_MODULE names
// another Playwright build to drive the browser with.
// Run: BROWSER=webkit node --test test/workspace-image-save.spec.js
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

/** A ZIP archive of files, stored without compression. */
function zip(files) {
    const local = [], central = []
    let offset = 0
    for (const [name, content] of Object.entries(files)) {
        const nameBytes = Buffer.from(name), data = Buffer.from(content), crc = crc32(data)
        const header = Buffer.alloc(30)
        header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4)
        header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22)
        header.writeUInt16LE(nameBytes.length, 26)
        local.push(header, nameBytes, data)
        const entry = Buffer.alloc(46)
        entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6)
        entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24)
        entry.writeUInt16LE(nameBytes.length, 28); entry.writeUInt32LE(offset, 42)
        central.push(entry, nameBytes)
        offset += header.length + nameBytes.length + data.length
    }
    const centralBytes = Buffer.concat(central), end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10)
    end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16)
    return Buffer.concat([...local, centralBytes, end])
}

// Large enough to cover the whole canvas, which the media step draws it over at its own size.
const RED = png(2048, [255, 0, 0])
const RED_ID = digest(RED)

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

test(`${BROWSER}: a saved workspace image renders after a reload, with its bytes unchanged`, { timeout: 240000 }, async t => {
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

    // A fresh context is ephemeral: in WebKit it refuses a Blob or File in IndexedDB.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    // A refused save, including the one made as the page unloads, is reported as a storage error.
    page.on('console', message => { if (message.type() === 'error' && /Error - storage|IndexedDB/i.test(message.text())) errors.push(message.text()) })
    const ready = () => page.waitForFunction(() => window.effectWorkspace && document.getElementById('loading-screen')?.classList.contains('hidden'), null, { timeout: 90000 })

    // A pixel of the output canvas that no panel covers: the editor sits top left,
    // the documentation panel on the right, and notices at the bottom center. A
    // frame is rendered first, since a slow headless renderer pauses its loop.
    const centerPixel = async () => {
        const box = await page.locator('#canvas').boundingBox()
        await page.evaluate(() => { const engine = window.effectWorkspaceRenderer._renderer; engine.stop(); engine.render(0) })
        return pngPixel(await page.screenshot({ clip: { x: box.x + box.width / 4, y: box.y + box.height * 3 / 4, width: 1, height: 1 } }))
    }
    const waitForRed = async label => {
        let pixel
        for (let i = 0; i < 120; i++) {
            pixel = await centerPixel()
            if (pixel[0] > 240 && pixel[1] < 16 && pixel[2] < 16) return pixel
            await page.waitForTimeout(250)
        }
        assert.fail(`${label}: output pixel is ${pixel}, not red`)
    }

    // The saved workspace's images as IndexedDB holds them, with the SHA-256 of their bytes.
    const savedImages = () => page.evaluate(textImage => new Promise((resolve, reject) => {
        const TEXT = new RegExp(textImage)
        const open = indexedDB.open('shade-workspace')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
            const db = open.result
            const get = db.transaction('workspaces').objectStore('workspaces').get('current')
            get.onerror = () => { db.close(); reject(get.error) }
            get.onsuccess = async () => {
                db.close()
                const images = get.result?.images || []
                const hex = async buffer => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), byte => byte.toString(16).padStart(2, '0')).join('')
                resolve(await Promise.all(images.map(async image => {
                    const bytes = image.bytes instanceof ArrayBuffer ? image.bytes : image.blob instanceof Blob ? await image.blob.arrayBuffer() : null
                    return {
                        id: image.id,
                        bytes: image.bytes instanceof ArrayBuffer,
                        blob: image.blob instanceof Blob,
                        type: image.type || image.blob?.type,
                        size: bytes?.byteLength,
                        sha256: bytes && await hex(bytes),
                        text: TEXT.test(JSON.stringify({ ...image, bytes: undefined })),
                    }
                })))
            }
        }
    }), TEXT_IMAGE.source)

    await page.goto(ORIGIN)
    await ready()

    // Import an effect whose DSL draws the red image, kept in the ZIP as an image file.
    const archive = zip({
        'solid/definition.json': JSON.stringify({
            name: 'Solid', namespace: 'user', func: 'solid', globals: {},
            passes: [{ name: 'render', program: 'solid', inputs: {}, outputs: { fragColor: 'outputTex' } }],
        }),
        'solid/glsl/solid.glsl': '#version 300 es\nprecision highp float;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }\n',
        'solid/dsl.txt': `search synth\nmedia(url: "image:${RED_ID}").write(o0)\nrender(o0)`,
        [`solid/images/${RED_ID}.png`]: RED,
    })
    await page.getByText('file', { exact: true }).first().click()
    await page.getByText('import effect from zip...', { exact: true }).first().click()
    await page.locator('.import-effect-file-input').setInputFiles({ name: 'solid.zip', mimeType: 'application/zip', buffer: archive })
    await page.locator('.import-effect-btn-primary:not([disabled])').click()
    // The import saves the workspace, then closes the dialog. A refused save leaves it open with an error.
    await page.waitForFunction(() => !document.querySelector('.import-effect-btn-primary') || document.querySelector('.import-effect-error.visible'), null, { timeout: 30000 })
    const importError = await page.evaluate(() => document.querySelector('.import-effect-error.visible')?.textContent ?? null)
    assert.equal(importError, null, `the import was refused: ${importError}`)
    console.log(`${BROWSER} before reload pixel:`, await waitForRed('before reload'))

    let saved
    for (let i = 0; i < 100; i++) {
        saved = await savedImages()
        if (saved.length) break
        await page.waitForTimeout(100)
    }
    console.log(`${BROWSER} saved before reload:`, JSON.stringify(saved))

    // Reload: the workspace and its image come back from IndexedDB.
    await page.reload()
    await ready()
    console.log(`${BROWSER} after reload pixel:`, await waitForRed('after reload'))
    saved = await savedImages()
    console.log(`${BROWSER} saved after reload:`, JSON.stringify(saved))
    // The image is stored as its file's bytes in an ArrayBuffer, with its type, and no text.
    assert.deepEqual(saved, [{ id: RED_ID, bytes: true, blob: false, type: 'image/png', size: RED.length, sha256: RED_ID, text: false }])

    // The workspace holds it again as a Blob of the same bytes.
    const held = await page.evaluate(async () => Promise.all(window.effectWorkspace.workspaceStore.images.map(async image => ({
        id: image.id,
        blob: image.blob instanceof Blob,
        type: image.blob?.type,
        sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await image.blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join(''),
    }))))
    assert.deepEqual(held, [{ id: RED_ID, blob: true, type: 'image/png', sha256: RED_ID }])
    assert.deepEqual(errors, [])
    await context.close()
})
