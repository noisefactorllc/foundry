// End-to-end: Foundry shares images as files through a real sharing server.
//
// Starts the sharing service (SHARING_REPO, default ../../sharing) and Foundry
// on free local ports, routes https://sharing.noisedeck.app to the local
// service, and drives Foundry headless. Run: node --test test/share-files.spec.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { chromium } from 'playwright'

const FOUNDRY = fileURLToPath(new URL('..', import.meta.url))
const SHARING = process.env.SHARING_REPO || fileURLToPath(new URL('../../sharing', import.meta.url))
const TEXT_IMAGE = /base64|data:image|dataUrl/

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
function png(red, green, blue) {
    const chunk = (type, data) => {
        const body = Buffer.concat([Buffer.from(type), data])
        let crc = 0xffffffff
        for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
        const length = Buffer.alloc(4), checksum = Buffer.alloc(4)
        length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
        return Buffer.concat([length, body, checksum])
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6
    const row = [0, red, green, blue, 255, red, green, blue, 255]
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([...row, ...row]))), chunk('IEND', Buffer.alloc(0))])
}
const RED = png(255, 0, 0), BLUE = png(0, 0, 255)
const RED_ID = digest(RED), BLUE_ID = digest(BLUE)
const RED_PIXEL = [255, 0, 0, 255]

const freePort = () => new Promise((resolve, reject) => {
    const server = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
        const { port } = server.address()
        server.close(() => resolve(port))
    })
})

async function startServer(cwd, env, health) {
    const child = spawn(process.execPath, ['server/index.js'], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', data => { stderr += data })
    for (let i = 0; i < 100; i++) {
        if (await fetch(health).then(r => r.ok).catch(() => false)) return child
        if (child.exitCode !== null) break
        await new Promise(resolve => setTimeout(resolve, 100))
    }
    child.kill('SIGTERM')
    throw new Error(`${cwd} did not start: ${stderr}`)
}

const stopServer = child => new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve()
    child.once('exit', resolve)
    child.kill('SIGTERM')
})

test('Foundry shares images as files and reopens them from the sharing service', { timeout: 300000 }, async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'foundry-share-data-'))
    const imagesDir = await mkdtemp(join(tmpdir(), 'foundry-share-images-'))
    const sharingPort = await freePort(), foundryPort = await freePort()
    const SHARING_LOCAL = `http://127.0.0.1:${sharingPort}`
    const FOUNDRY_ORIGIN = `http://127.0.0.1:${foundryPort}`
    let sharing, foundry, browser
    try {
        sharing = await startServer(SHARING, {
            PORT: String(sharingPort), BASE_URL: 'https://sharing.noisedeck.app', SHARING_DATA_DIR: dataDir, SHARING_IMAGES_DIR: imagesDir
        }, `${SHARING_LOCAL}/api/health`)
        foundry = await startServer(FOUNDRY, { PORT: String(foundryPort), HOST: '127.0.0.1' }, `${FOUNDRY_ORIGIN}/health`)
        browser = await chromium.launch({
            headless: true,
            args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader']
        })

        // Every request a page sends to the sharing service: method, URL, type and body.
        const sent = []
        async function newFoundryContext() {
            const context = await browser.newContext()
            await context.route('https://sharing.noisedeck.app/**', async route => {
                const request = route.request()
                const url = new URL(request.url())
                if (request.method() === 'POST') {
                    sent.push({ method: 'POST', path: url.pathname, type: request.headers()['content-type'], body: request.postDataBuffer() || Buffer.alloc(0) })
                } else if (request.method() === 'GET') sent.push({ method: 'GET', path: url.pathname + url.search })
                const response = await route.fetch({ url: `${SHARING_LOCAL}${url.pathname}${url.search}` })
                await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': FOUNDRY_ORIGIN } })
            })
            // Edit-in opens the other app in a new window; it is not under test.
            for (const app of ['https://noisedeck.app/**', 'https://shade.noisedeck.app/**', 'https://polymorphic.noisedeck.app/**', 'https://noodles.noisedeck.app/**']) {
                await context.route(app, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }))
            }
            return context
        }

        async function openFoundry(context, query = '') {
            const page = await context.newPage()
            const errors = []
            page.on('pageerror', error => errors.push(error.message))
            await page.goto(`${FOUNDRY_ORIGIN}/${query}`)
            await page.waitForFunction(() => window.effectWorkspace && document.getElementById('loading-screen')?.classList.contains('hidden'), null, { timeout: 90000 })
            return { page, errors }
        }

        // Render one frame and read the center of the output canvas.
        const outputPixel = page => page.evaluate(() => {
            const canvas = document.getElementById('canvas')
            window.effectWorkspaceRenderer._renderer.render(0)
            const gl = canvas.getContext('webgl2'), pixel = new Uint8Array(4)
            gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
            return [...pixel]
        })
        async function waitForPixel(page, expected) {
            let pixel
            for (let i = 0; i < 150; i++) {
                pixel = await outputPixel(page)
                if (pixel.join() === expected.join()) return pixel
                await page.waitForTimeout(200)
            }
            return pixel
        }

        const stored = async code => {
            const dir = join(dataDir, code.slice(0, 2))
            return {
                entry: await readFile(join(dir, `${code}.json`), 'utf8'),
                screenshot: await readFile(join(dir, `${code}.jpg`)).catch(() => null)
            }
        }
        const storedImage = id => readFile(join(imagesDir, id.slice(0, 2), id))

        // The image records a page holds: each must hold its bytes as a Blob and no text.
        const heldImages = (page, holder) => page.evaluate(holder => {
            const images = holder === 'renderer' ? window.effectWorkspaceRenderer.images : window.effectWorkspace.workspaceStore.images
            return images.map(image => ({ id: image.id, blob: image.blob instanceof Blob, type: image.blob?.type, size: image.blob?.size, text: 'dataUrl' in image || /base64|data:image|dataUrl/.test(JSON.stringify(image)) }))
        }, holder)
        async function expectBlobImages(page, ids, label) {
            for (const holder of ['renderer', 'workspace']) {
                const held = await heldImages(page, holder)
                assert.deepEqual(held.map(image => image.id).sort(), [...ids].sort(), `${label}: ${holder} image ids`)
                for (const image of held) assert.deepEqual([image.blob, image.type, image.text], [true, 'image/png', false], `${label}: ${holder} holds ${image.id} as a Blob`)
            }
        }
        // The workspace saved in IndexedDB: its files, and its images as stored.
        const savedWorkspace = page => page.evaluate(() => new Promise((resolve, reject) => {
            const request = indexedDB.open('shade-workspace')
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
                const db = request.result
                const get = db.transaction('workspaces').objectStore('workspaces').get('current')
                get.onerror = () => { db.close(); reject(get.error) }
                get.onsuccess = () => {
                    db.close()
                    const data = get.result || {}
                    resolve({
                        files: Object.keys(data.files || {}).sort(),
                        filesText: JSON.stringify(data.files || {}),
                        images: (data.images || []).map(image => ({ id: image.id, blob: image.blob instanceof Blob, type: image.blob?.type, size: image.blob?.size, keys: Object.keys(image).sort() }))
                    })
                }
            }
        }))
        async function expectSavedBlobImages(page, ids, label) {
            // Autosave is debounced; poll the store until the images are written.
            let saved
            for (let i = 0; i < 100; i++) {
                saved = await savedWorkspace(page)
                if (saved.images.length === ids.length && !saved.files.includes('images.json')) break
                await page.waitForTimeout(100)
            }
            console.log(`${label} saved workspace:`, JSON.stringify(saved))
            assert.equal(saved.files.includes('images.json'), false, `${label}: no images.json file is saved`)
            assert.doesNotMatch(saved.filesText, TEXT_IMAGE, `${label}: saved files hold no image text`)
            assert.deepEqual(saved.images.map(image => image.id).sort(), [...ids].sort(), `${label}: saved image ids`)
            for (const image of saved.images) {
                assert.deepEqual([image.blob, image.type, image.keys], [true, 'image/png', ['blob', 'height', 'id', 'mimeType', 'width']], `${label}: ${image.id} is saved as a Blob`)
            }
            return saved
        }

        async function chooseMenuItem(page, menu, item) {
            await page.getByText(menu, { exact: true }).first().click()
            await page.getByText(item, { exact: true }).first().click()
        }

        async function expectNoImageText(label) {
            const posts = sent.filter(request => request.method === 'POST')
            assert.ok(posts.length > 0, `${label}: requests were recorded`)
            for (const request of posts) {
                assert.doesNotMatch(request.body.toString('latin1'), TEXT_IMAGE, `${label}: ${request.path} sends no image as text`)
            }
            const shares = posts.filter(request => request.path === '/api/embed/shorten')
            for (const share of shares) assert.equal('images' in JSON.parse(share.body.toString('utf8')), false, `${label}: share has no images field`)
            return posts
        }

        // 1. Load a solid-red image into a media step and share it through the Share dialog.
        const sender = await newFoundryContext()
        let sharedCode
        try {
            const { page, errors } = await openFoundry(sender)
            const program = `search synth\nmedia(url: "data:image/png;base64,${RED.toString('base64')}").write(o0)\nrender(o0)`
            await page.evaluate(dsl => {
                const editor = document.getElementById('canvas-editor')
                editor.value = dsl
                editor.dispatchEvent(new CustomEvent('forcerecompile'))
            }, program)
            assert.deepEqual(await waitForPixel(page, RED_PIXEL), RED_PIXEL, 'the red image renders before sharing')

            sent.length = 0
            await chooseMenuItem(page, 'effect', 'share publicly...')
            await page.locator('#share-title').fill('Red image')
            const shareResponse = page.waitForResponse(response => response.url().endsWith('/api/embed/shorten'))
            await page.locator('#share-submit-btn').click()
            const result = await (await shareResponse).json()
            await page.locator('#share-url').waitFor({ state: 'visible' })
            assert.equal(await page.locator('#share-url').inputValue(), result.shortUrl)
            sharedCode = result.code
            console.log('share dialog result:', JSON.stringify(result))
            assert.equal(result.imageCount, 1)

            const posts = await expectNoImageText('share dialog')
            console.log('share dialog requests:', JSON.stringify(posts.map(({ path, type, body }) => ({ path, type, bytes: body.length }))))
            const images = posts.filter(request => request.path === '/api/images')
            assert.deepEqual(images.map(request => request.type), ['image/png', 'image/jpeg'])
            assert.deepEqual(images[0].body, RED)
            const share = JSON.parse(posts.find(request => request.path === '/api/embed/shorten').body.toString('utf8'))
            console.log('share dialog body:', JSON.stringify(share))
            // The program names the red image by the id the upload returned.
            assert.match(share.dsl, new RegExp(`^search synth\\s+media\\(url: "image:${RED_ID}"\\)\\s+\\.write\\(o0\\)\\s+render\\(o0\\)$`))
            assert.equal(share.screenshot, digest(images[1].body))
            assert.equal(share.title, 'Red image')

            // The image file and a JPEG screenshot are stored; the entry holds no image text.
            const { entry, screenshot } = await stored(sharedCode)
            console.log('stored entry:', entry)
            assert.doesNotMatch(entry, TEXT_IMAGE)
            assert.deepEqual(JSON.parse(entry).images.map(image => image.id), [RED_ID])
            assert.deepEqual(await storedImage(RED_ID), RED)
            assert.ok(screenshot, 'screenshot stored')
            assert.deepEqual([...screenshot.subarray(0, 2)], [0xff, 0xd8])
            assert.deepEqual(screenshot, images[1].body)
            const screenshotPixel = await page.evaluate(async bytes => {
                const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }))
                const sample = new OffscreenCanvas(1, 1).getContext('2d')
                sample.drawImage(bitmap, bitmap.width / 2, bitmap.height / 2, 1, 1, 0, 0, 1, 1)
                return { size: [bitmap.width, bitmap.height], pixel: [...sample.getImageData(0, 0, 1, 1).data] }
            }, [...screenshot])
            console.log('stored screenshot:', JSON.stringify(screenshotPixel))
            assert.deepEqual(screenshotPixel.size, [1200, 630])
            assert.deepEqual(errors, [])
        } finally { await sender.close() }

        // 2. A fresh context opens the share with ?code= and renders the red image, then
        //    shares it again with Edit in Noisedeck.
        const receiver = await newFoundryContext()
        let editInCode
        try {
            sent.length = 0
            const { page, errors } = await openFoundry(receiver, `?code=${sharedCode}`)
            assert.ok(sent.some(request => request.path === `/api/composition/${sharedCode}?images=files`), 'composition asked for image files')
            assert.ok(sent.some(request => request.path === `/api/images/${RED_ID}`), 'image file fetched')
            const pixel = await waitForPixel(page, RED_PIXEL)
            console.log('reopened ?code= pixel:', JSON.stringify(pixel))
            assert.deepEqual(pixel, RED_PIXEL)
            await expectBlobImages(page, [RED_ID], 'reopened ?code=')

            sent.length = 0
            const popup = receiver.waitForEvent('page')
            await chooseMenuItem(page, 'effect', 'edit in Noisedeck...')
            const opened = await popup
            editInCode = new URL(opened.url()).searchParams.get('code')
            await opened.close()
            console.log('edit in Noisedeck opened:', opened.url())
            const posts = await expectNoImageText('edit in Noisedeck')
            const images = posts.filter(request => request.path === '/api/images')
            assert.deepEqual(images.map(request => request.type), ['image/png', 'image/jpeg'])
            assert.deepEqual(images[0].body, RED)
            const share = JSON.parse(posts.find(request => request.path === '/api/embed/shorten').body.toString('utf8'))
            console.log('edit in Noisedeck body:', JSON.stringify(share))
            assert.match(share.dsl, new RegExp(`media\\(url: "image:${RED_ID}"`))
            assert.equal(share.screenshot, digest(images[1].body))
            assert.equal(share.ttlMinutes, 60)
            const { entry, screenshot } = await stored(editInCode)
            assert.doesNotMatch(entry, TEXT_IMAGE)
            assert.deepEqual([...screenshot.subarray(0, 2)], [0xff, 0xd8])
            assert.deepEqual(errors, [])
        } finally { await receiver.close() }

        // 3. Open the Edit-in share in a fresh context.
        const editInReceiver = await newFoundryContext()
        try {
            const { page, errors } = await openFoundry(editInReceiver, `?code=${editInCode}`)
            const pixel = await waitForPixel(page, RED_PIXEL)
            console.log('edit-in share pixel:', JSON.stringify(pixel))
            assert.deepEqual(pixel, RED_PIXEL)
            assert.deepEqual(errors, [])
        } finally { await editInReceiver.close() }

        // 4. A share made the way Noisedeck makes it: image files and a screenshot id.
        const upload = async (bytes, type) => (await (await fetch(`${SHARING_LOCAL}/api/images`, { method: 'POST', headers: { 'Content-Type': type }, body: bytes })).json()).id
        assert.equal(await upload(RED, 'image/png'), RED_ID)
        assert.equal(await upload(BLUE, 'image/png'), BLUE_ID)
        const noisedeckShare = await (await fetch(`${SHARING_LOCAL}/api/embed/shorten`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dsl: `search synth\nmedia(url: "image:${RED_ID}").write(o0)\nmedia(url: "image:${BLUE_ID}").write(o1)\nrender(o0)`,
                title: 'Noisedeck Program',
                description: 'Created with Noisedeck',
                screenshot: await upload(await readFile(join(dataDir, sharedCode.slice(0, 2), `${sharedCode}.jpg`)), 'image/jpeg'),
                ttlMinutes: 60
            })
        })).json()
        console.log('noisedeck-format share:', JSON.stringify(noisedeckShare))
        assert.equal(noisedeckShare.imageCount, 2)

        // 5. A share an older client made with base64 images still opens, as files.
        const legacyShare = await (await fetch(`${SHARING_LOCAL}/api/embed/shorten`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dsl: `search synth\nmedia(url: "image:${RED_ID}").write(o0)\nrender(o0)`,
                images: [{ id: RED_ID, dataUrl: `data:image/png;base64,${RED.toString('base64')}` }]
            })
        })).json()
        assert.equal(legacyShare.imageCount, 1)

        for (const [label, code] of [['noisedeck-format share', noisedeckShare.code], ['legacy share', legacyShare.code]]) {
            const context = await newFoundryContext()
            try {
                const { page, errors } = await openFoundry(context, `?code=${code}`)
                const pixel = await waitForPixel(page, RED_PIXEL)
                console.log(`${label} pixel:`, JSON.stringify(pixel))
                assert.deepEqual(pixel, RED_PIXEL, label)
                await expectBlobImages(page, label === 'legacy share' ? [RED_ID] : [RED_ID, BLUE_ID], label)
                assert.deepEqual(errors, [], label)
            } finally { await context.close() }
        }

        // 6. The import-from-url dialog loads the share's image files too.
        const importer = await newFoundryContext()
        try {
            const { page, errors } = await openFoundry(importer)
            sent.length = 0
            await chooseMenuItem(page, 'effect', 'import from url...')
            await page.locator('.import-url-input').fill(`https://sharing.noisedeck.app/s/${sharedCode}`)
            await page.locator('.import-url-btn-primary').click()
            const pixel = await waitForPixel(page, RED_PIXEL)
            console.log('import-from-url pixel:', JSON.stringify(pixel))
            assert.deepEqual(pixel, RED_PIXEL)
            assert.ok(sent.some(request => request.path === `/api/composition/${sharedCode}?images=files`))
            await expectBlobImages(page, [RED_ID], 'import from url')
            const saved = await expectSavedBlobImages(page, [RED_ID], 'import from url')
            assert.equal(saved.images[0].size, RED.length)
            assert.deepEqual(errors, [])
        } finally { await importer.close() }

        // 7. A workspace saved before images were files lists its image as base64 text in an
        //    images.json file. It opens with the image as a Blob, renders it, and is saved
        //    again with the image as a Blob; sharing it sends the image as a file.
        const earlier = await newFoundryContext()
        try {
            const seed = await earlier.newPage()
            await seed.goto(`${FOUNDRY_ORIGIN}/health`)
            await seed.evaluate(record => new Promise((resolve, reject) => {
                const request = indexedDB.open('shade-workspace', 1)
                request.onupgradeneeded = () => request.result.createObjectStore('workspaces', { keyPath: 'id' })
                request.onerror = () => reject(request.error)
                request.onsuccess = () => {
                    const db = request.result
                    const tx = db.transaction('workspaces', 'readwrite')
                    tx.objectStore('workspaces').put(record)
                    tx.oncomplete = () => { db.close(); resolve() }
                    tx.onerror = () => { db.close(); reject(tx.error) }
                }
            }), {
                id: 'current',
                name: 'Earlier workspace',
                files: {
                    'dsl.txt': `search synth\nmedia(url: "image:${RED_ID}").write(o0)\nrender(o0)`,
                    'images.json': JSON.stringify([{ id: RED_ID, dataUrl: `data:image/png;base64,${RED.toString('base64')}`, mimeType: 'image/png', width: 2, height: 2 }])
                },
                savedAt: Date.now()
            })
            await seed.close()

            const { page, errors } = await openFoundry(earlier)
            const pixel = await waitForPixel(page, RED_PIXEL)
            console.log('earlier workspace pixel:', JSON.stringify(pixel))
            assert.deepEqual(pixel, RED_PIXEL)
            await expectBlobImages(page, [RED_ID], 'earlier workspace')
            assert.equal(await page.evaluate(() => window.effectWorkspace.workspaceStore.hasFile('images.json')), false)
            const saved = await expectSavedBlobImages(page, [RED_ID], 'earlier workspace')
            assert.deepEqual(saved.files, ['dsl.txt'])

            sent.length = 0
            await chooseMenuItem(page, 'effect', 'share publicly...')
            const shareResponse = page.waitForResponse(response => response.url().endsWith('/api/embed/shorten'))
            await page.locator('#share-submit-btn').click()
            const result = await (await shareResponse).json()
            assert.equal(result.imageCount, 1)
            const posts = await expectNoImageText('earlier workspace share')
            const images = posts.filter(request => request.path === '/api/images')
            assert.deepEqual(images.map(request => request.type), ['image/png', 'image/jpeg'])
            assert.deepEqual(images[0].body, RED)
            const { entry } = await stored(result.code)
            assert.doesNotMatch(entry, TEXT_IMAGE)
            assert.deepEqual(errors, [])
        } finally { await earlier.close() }
    } finally {
        await browser?.close()
        await stopServer(foundry)
        await stopServer(sharing)
        await rm(dataDir, { recursive: true, force: true })
        await rm(imagesDir, { recursive: true, force: true })
    }
})
