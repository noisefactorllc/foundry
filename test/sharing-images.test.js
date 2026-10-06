import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import vm from 'node:vm'

// The sharing service's image helpers, stubbed per test through globalThis.portableImages.
const portableImagesStub = ['prepareImageFile', 'prepareImagesForShare', 'imageToBlob', 'replaceMediaUrls']
    .map(name => `export const ${name} = (...args) => globalThis.portableImages.${name}(...args)`).join('\n')
const sharingLoaderSource = await readFile(new URL('../public/js/sharingLoader.js', import.meta.url), 'utf8')
const HELPER_URL = "'https://sharing.noisedeck.app/js/portableImages.js?v=images-20261006'"
assert.equal(sharingLoaderSource.split(HELPER_URL).length, 2, 'sharingLoader.js names the helper URL once')
const source = sharingLoaderSource
    .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/noisemaker\/bundle.js'/, 'const Effect = class {}; const registerEffect = () => {}; const registerOp = () => {}; const registerStarterOps = () => {}; const mergeIntoEnums = () => {}')
    .replaceAll(HELPER_URL, `'data:text/javascript;base64,${Buffer.from(portableImagesStub).toString('base64')}'`)
const loader = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

// The real sharing image helpers (SHARING_REPO, default ../../sharing).
const SHARING = process.env.SHARING_REPO || fileURLToPath(new URL('../../sharing', import.meta.url))
const helper = await import(pathToFileURL(`${SHARING}/public/js/portableImages.js`).href)
const { imageFileRecords } = await import('../public/js/imageRecords.js')

/** A 2x2 PNG of one color, its SHA-256 id, and the base64 data URL earlier records carried. */
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
    const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([...row, ...row]))), chunk('IEND', Buffer.alloc(0))])
    return { bytes, id: createHash('sha256').update(bytes).digest('hex'), dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }
}
const RED_PNG = png(255, 0, 0), BLUE_PNG = png(0, 0, 255)
const fileRecord = ({ id, bytes }) => ({ id, blob: new Blob([bytes], { type: 'image/png' }), mimeType: 'image/png', width: 2, height: 2 })

/** Assert that every record holds its image bytes as a Blob and no text. */
async function assertBlobRecords(images, expected) {
    assert.deepEqual(images.map(image => image.id), expected.map(image => image.id))
    for (const [index, image] of images.entries()) {
        assert.ok(image.blob instanceof Blob, `${image.id} holds a Blob`)
        assert.equal('dataUrl' in image, false, `${image.id} has no dataUrl`)
        assert.deepEqual(Buffer.from(await image.blob.arrayBuffer()), expected[index].bytes)
        assert.equal(image.blob.type, 'image/png')
    }
    assert.doesNotMatch(JSON.stringify(images), /base64|data:image|dataUrl/)
}

test('composition imports hold image bytes as Blobs, reading older base64 records into Blobs', async t => {
    const previous = globalThis.fetch
    const listed = [
        { id: RED_PNG.id, dataUrl: RED_PNG.dataUrl, mimeType: 'image/png', width: 2, height: 2 },
        { id: BLUE_PNG.id, dataUrl: RED_PNG.dataUrl }
    ]
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ code: 'abcdef', dsl: 'media().write(o0)', images: listed }) })
    globalThis.portableImages = helper
    const warn = console.warn
    const warnings = []
    console.warn = message => warnings.push(message)
    t.after(() => { globalThis.fetch = previous; console.warn = warn; delete globalThis.portableImages })
    // The record whose bytes do not match its id is left out.
    await assertBlobRecords((await loader.loadFromCode('abcdef')).images, [RED_PNG])
    assert.deepEqual(warnings, [`Shared image ${BLUE_PNG.id} was not loaded:`])
})

const { WorkspaceStore } = await import('../public/js/workspace/workspace-store.js')
test('URL import checkpoints the composition DSL and images together after clearing an old workspace', async () => {
    const app = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8')
    const handler = app.match(/async function handleLoadFromUrl\(composition\) \{[\s\S]*?\n\}/)[0]
    const store = new WorkspaceStore()
    store.setFile('dsl.txt', 'old program')
    store.images = [fileRecord(BLUE_PNG)]
    const images = [fileRecord(RED_PNG)]
    const dsl = `search synth\nmedia(url: "image:${images[0].id}").write(o0)`
    let compilations = 0
    const renderer = {}
    const context = vm.createContext({
        renderer, workspaceStore: store, dslEditor: {}, canvasEditor: null, fileBrowser: null, console,
        writePortableEffectToWorkspace: effect => store.setFile('definition.json', JSON.stringify(effect)),
        setAgentStatus() {}, hideCompilerError() {}, toast: { success() {} },
        recompileFromEditor: async () => {
            ++compilations
            assert.equal(store.getFile('dsl.txt'), dsl)
            assert.deepEqual(store.images, images)
            return { success: true }
        }
    })
    await vm.runInContext(`(${handler})`, context)({ dsl, images, rawEffects: [{ name: 'imageEffect' }] })
    assert.equal(compilations, 1)
    assert.equal(store.hasFile('images.json'), false, 'images are not kept as a file')
    store.setFile('dsl.txt', 'replacement')
    store.images = []
    store.checkpoint('replacement')
    store.undo()
    assert.equal(store.getFile('dsl.txt'), dsl)
    assert.deepEqual(store.images, images)
    await assertBlobRecords(store.images, [RED_PNG])
})

test('workspace save and history retain original images with the DSL', async () => {
    const images = [fileRecord(RED_PNG)]
    const dsl = `search synth\nmedia(url: "image:${images[0].id}").write(o0)`
    const store = new WorkspaceStore()
    const changes = []
    store.onChange(detail => changes.push(detail.type))
    store.setFile('dsl.txt', dsl)
    store.images = images
    // Assigning the same records again is not a change.
    store.images = [...images]
    assert.deepEqual(changes, ['file-set', 'images-set'])
    store.checkpoint('with image')
    // The files hold no image; the images travel beside them.
    assert.deepEqual(Object.keys(store.toObject()), ['dsl.txt'])
    const reopened = new WorkspaceStore()
    reopened.fromObject(JSON.parse(JSON.stringify(store.toObject())), '', store.images)
    assert.equal(reopened.getFile('dsl.txt'), dsl)
    assert.deepEqual(reopened.images, images)
    store.images = []
    store.checkpoint('cleared')
    store.undo()
    assert.deepEqual(store.images, images)
    store.clear()
    assert.deepEqual(store.images, [])
})

test('an earlier workspace that lists its images as base64 in images.json loads them as Blobs', async () => {
    const warn = console.warn
    const warnings = []
    console.warn = message => warnings.push(message)
    try {
        const files = {
            'dsl.txt': `search synth\nmedia(url: "image:${RED_PNG.id}").write(o0)`,
            'images.json': JSON.stringify([
                { id: RED_PNG.id, dataUrl: RED_PNG.dataUrl, mimeType: 'image/png', width: 2, height: 2 },
                { id: 'd'.repeat(64), dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' }
            ])
        }
        const store = new WorkspaceStore()
        store.fromObject(files, 'earlier')
        assert.equal(store.hasFile('images.json'), false, 'the images.json file is taken out of the files')
        assert.deepEqual(store.listFiles(), ['dsl.txt'])
        await assertBlobRecords(store.images, [RED_PNG])
        assert.deepEqual([store.images[0].mimeType, store.images[0].width, store.images[0].height], ['image/png', 2, 2])
        // An image that cannot be read as a PNG, JPEG, GIF or WebP is left out, not kept as text.
        assert.deepEqual(warnings, [`Image ${'d'.repeat(64)} was not loaded:`])

        // A ZIP import puts images.json among the files; the import takes it the same way.
        const imported = new WorkspaceStore()
        imported.files.set('images.json', files['images.json'])
        imported.images = imported.takeImagesFile()
        assert.equal(imported.hasFile('images.json'), false)
        await assertBlobRecords(imported.images, [RED_PNG])

        // An unreadable images.json loads no images instead of failing the load.
        const broken = new WorkspaceStore()
        broken.fromObject({ 'images.json': '{not json' })
        assert.deepEqual(broken.images, [])
        assert.equal(broken.hasFile('images.json'), false)
    } finally { console.warn = warn }
})

test('image records: earlier base64 records are read into Blobs and Blob records pass through', async () => {
    const record = fileRecord(BLUE_PNG)
    const records = imageFileRecords([record, { id: RED_PNG.id, dataUrl: RED_PNG.dataUrl, width: 2, height: 2 }, null])
    assert.equal(records[0], record)
    await assertBlobRecords(records, [BLUE_PNG, RED_PNG])
    assert.deepEqual(imageFileRecords(undefined), [])
})

test('workspace ZIP import preserves image assets and composition DSL', async t => {
    const oldDocument = globalThis.document
    const oldZip = globalThis.JSZip
    globalThis.document = { getElementById: () => ({}) }
    t.after(() => { globalThis.document = oldDocument; globalThis.JSZip = oldZip })
    const { ImportEffectDialog } = await import('../public/js/ui/import-effect-dialog.js')
    const files = {
        'effect/definition.json': '{"name":"imageEffect"}',
        'effect/glsl/main.glsl': 'void main() {}',
        'effect/images.json': '[{"id":"original","dataUrl":"data:image/png;base64,AQIDBA=="}]',
        'effect/effect.dsl': 'search synth\nmedia(url: "image:original").write(o0)'
    }
    globalThis.JSZip = { loadAsync: async () => ({ files: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, { dir: false, async: async () => content }])) }) }
    const el = () => ({ classList: { add() {}, remove() {} }, textContent: '' })
    const dialog = Object.assign(Object.create(ImportEffectDialog.prototype), {
        _error: el(), _info: el(), _importBtn: {}, _infoName: el(), _infoDetails: el()
    })
    await dialog._processFile({})
    assert.equal(dialog.pendingZip?.files['images.json'], files['effect/images.json'])
    assert.equal(dialog.pendingZip?.files['effect.dsl'], files['effect/effect.dsl'])
    // The workspace takes the listed images as Blob records when the ZIP is imported.
    const app = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8')
    const onImport = app.slice(app.indexOf('importEffectDialog.onEffectImport('), app.indexOf('// Get DSL from definition\'s defaultProgram'))
    assert.match(onImport, /workspaceStore\.images = workspaceStore\.takeImagesFile\(\)/)
})

// Sharing images as files: no image is sent or stored as base64 text.
const RED_ID = 'a'.repeat(64), SERVICE_ID = 'b'.repeat(64), SHOT_ID = 'c'.repeat(64)
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]), JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
const TEXT_IMAGE = /base64|data:image|dataUrl/

/** A fake sharing service: records each request and answers uploads with `ids`. */
function sharingService(t, { ids = {}, fail = {} } = {}) {
    const previous = globalThis.fetch
    const requests = []
    globalThis.fetch = async (url, init = {}) => {
        const request = { url: String(url), method: init.method || 'GET', type: init.headers?.['Content-Type'], body: init.body }
        requests.push(request)
        if (request.url.endsWith('/api/images') && request.method === 'POST') {
            const bytes = new Uint8Array(await request.body.arrayBuffer())
            if (fail[request.type]) return new Response(JSON.stringify({ error: fail[request.type] }), { status: 415 })
            return new Response(JSON.stringify({ id: ids[request.type], url: `https://sharing.noisedeck.app/api/images/${ids[request.type]}`, size: bytes.length }), { status: 201 })
        }
        throw new Error(`unexpected request ${request.url}`)
    }
    t.after(() => { globalThis.fetch = previous; delete globalThis.portableImages })
    return requests
}

function portableImages(overrides = {}) {
    globalThis.portableImages = {
        prepareImagesForShare: async (dsl, images, options) => {
            // Shares ask for every prepared image as a Blob record.
            assert.deepEqual(options, { files: true })
            return {
                dsl: dsl.replace('https://images.example/red.png', `image:${RED_ID}`),
                images: [{ id: RED_ID, blob: new Blob([PNG], { type: 'image/png' }), mimeType: 'image/png', width: 2, height: 2 }]
            }
        },
        imageToBlob: () => { throw new Error('prepared images already hold Blobs') },
        replaceMediaUrls: (dsl, replace) => dsl.replace(/"(image:[a-f0-9]{64})"/g, (match, url) => JSON.stringify(replace(url, 0) ?? url)),
        ...overrides
    }
}

const jpegCanvas = { toBlob(done, type, quality) { assert.equal(type, 'image/jpeg'); assert.equal(quality, 0.85); done(new Blob([JPEG], { type })) } }

test('a share uploads each image and the screenshot as files and sends only their ids', async t => {
    const requests = sharingService(t, { ids: { 'image/png': SERVICE_ID, 'image/jpeg': SHOT_ID } })
    portableImages()
    const payload = { dsl: 'search synth\nmedia(url: "https://images.example/red.png").write(o0)\nrender(o0)', title: 'Red', ttlMinutes: 60 }
    assert.equal(await loader.attachShareFiles(payload, { images: [], screenshot: jpegCanvas }), payload)

    assert.deepEqual(requests.map(r => [r.method, r.url, r.type]), [
        ['POST', 'https://sharing.noisedeck.app/api/images', 'image/png'],
        ['POST', 'https://sharing.noisedeck.app/api/images', 'image/jpeg']
    ])
    // The request bodies are the image files themselves.
    assert.deepEqual(new Uint8Array(await requests[0].body.arrayBuffer()), PNG)
    assert.deepEqual(new Uint8Array(await requests[1].body.arrayBuffer()), JPEG)
    // The program names the image by the id the service returned.
    assert.equal(payload.dsl, `search synth\nmedia(url: "image:${SERVICE_ID}").write(o0)\nrender(o0)`)
    assert.equal(payload.screenshot, SHOT_ID)
    assert.equal('images' in payload, false)
    assert.doesNotMatch(JSON.stringify(payload), TEXT_IMAGE)
})

test('image references keep their ids when the service returns the same ids', async t => {
    sharingService(t, { ids: { 'image/png': RED_ID, 'image/jpeg': SHOT_ID } })
    portableImages({ replaceMediaUrls: () => { throw new Error('nothing to rename') } })
    const payload = { dsl: `search synth\nmedia(url: "image:${RED_ID}").write(o0)\nrender(o0)` }
    await loader.attachShareFiles(payload, { images: [{ id: RED_ID, blob: new Blob([PNG], { type: 'image/png' }) }], screenshot: jpegCanvas })
    assert.equal(payload.dsl, `search synth\nmedia(url: "image:${RED_ID}").write(o0)\nrender(o0)`)
    assert.doesNotMatch(JSON.stringify(payload), TEXT_IMAGE)
})

test('a program without media URLs uploads only the screenshot', async t => {
    const requests = sharingService(t, { ids: { 'image/jpeg': SHOT_ID } })
    portableImages({ prepareImagesForShare: () => { throw new Error('no images to prepare') } })
    const payload = { dsl: 'search synth\nnoise().write(o0)\nrender(o0)' }
    await loader.attachShareFiles(payload, { screenshot: jpegCanvas })
    assert.deepEqual(requests.map(r => r.type), ['image/jpeg'])
    assert.deepEqual(payload, { dsl: 'search synth\nnoise().write(o0)\nrender(o0)', screenshot: SHOT_ID })
})

test('the screenshot is best-effort: a failed capture or upload shares without it', async t => {
    const requests = sharingService(t, { ids: { 'image/png': RED_ID }, fail: { 'image/jpeg': 'Unsupported image' } })
    portableImages()
    const warn = console.warn
    const warnings = []
    console.warn = message => warnings.push(message)
    t.after(() => { console.warn = warn })
    const failures = [
        null,
        { toBlob(done) { done(null) } },
        { toBlob() { throw new Error('tainted canvas') } },
        jpegCanvas // the upload is refused
    ]
    for (const screenshot of failures) {
        const payload = { dsl: 'media(url: "https://images.example/red.png").write(o0)' }
        await loader.attachShareFiles(payload, { screenshot })
        assert.equal('screenshot' in payload, false)
        assert.equal(payload.dsl, `media(url: "image:${RED_ID}").write(o0)`)
    }
    assert.equal(requests.filter(r => r.type === 'image/jpeg').length, 1)
    assert.deepEqual(warnings, ['Share screenshot was not uploaded:', 'Share screenshot was not uploaded:'])
})

test('a refused image upload fails the share with the service error', async t => {
    sharingService(t, { fail: { 'image/png': 'Image exceeds the 8MiB byte limit' } })
    portableImages()
    await assert.rejects(loader.attachShareFiles({ dsl: 'media(url: "https://images.example/red.png").write(o0)' }, { screenshot: jpegCanvas }), /8MiB/)
})

test('opening a share asks for image files and loads each one checked against its id', async t => {
    const previous = globalThis.fetch
    const fetched = []
    const files = {
        [`https://sharing.noisedeck.app/api/images/${RED_ID}`]: new Response(new Blob([PNG], { type: 'image/png' })),
        [`https://sharing.noisedeck.app/api/images/${SERVICE_ID}`]: new Response(new Blob([PNG], { type: 'image/png' })),
        [`https://sharing.noisedeck.app/api/images/${SHOT_ID}`]: new Response('{}', { status: 404 })
    }
    const listed = [RED_ID, SERVICE_ID, SHOT_ID].map(id => ({ id, url: `https://sharing.noisedeck.app/api/images/${id}`, mimeType: 'image/png', width: 2, height: 2 }))
    globalThis.fetch = async url => {
        fetched.push(String(url))
        if (String(url).includes('/api/composition/')) return new Response(JSON.stringify({ code: 'abcdef', dsl: `media(url: "image:${RED_ID}").write(o0)`, images: listed }))
        return files[url]
    }
    const prepared = []
    globalThis.portableImages = { prepareImageFile: async blob => (prepared.push(blob), { id: RED_ID, blob, mimeType: blob.type, width: 2, height: 2 }) }
    const warn = console.warn
    const warnings = []
    console.warn = (...args) => warnings.push(args[0])
    t.after(() => { globalThis.fetch = previous; console.warn = warn; delete globalThis.portableImages })

    const composition = await loader.loadFromCode('abcdef')
    assert.equal(fetched[0], 'https://sharing.noisedeck.app/api/composition/abcdef?images=files')
    // The red file matches its id; a file whose bytes have another id, and a missing file, are left out.
    assert.deepEqual(composition.images, [{ id: RED_ID, blob: prepared[0], mimeType: 'image/png', width: 2, height: 2 }])
    assert.ok(composition.images[0].blob instanceof Blob)
    assert.deepEqual(new Uint8Array(await composition.images[0].blob.arrayBuffer()), PNG)
    assert.equal(composition.dsl, `media(url: "image:${RED_ID}").write(o0)`)
    assert.equal(warnings.length, 2)
})

test('a share sends inline and earlier base64 images as files, with the real sharing helpers', async t => {
    const requests = sharingService(t, { ids: { 'image/png': undefined, 'image/jpeg': SHOT_ID } })
    // The fake service answers each upload with the SHA-256 of its bytes, as the service does.
    const service = globalThis.fetch
    globalThis.fetch = async (url, init = {}) => {
        const response = await service(url, init)
        if (!String(url).endsWith('/api/images') || init.headers?.['Content-Type'] !== 'image/png') return response
        return new Response(JSON.stringify({ id: createHash('sha256').update(new Uint8Array(await init.body.arrayBuffer())).digest('hex') }), { status: 201 })
    }
    globalThis.portableImages = helper
    const payload = { dsl: `search synth\nmedia(url: "${RED_PNG.dataUrl}").write(o0)\nmedia(url: "image:${BLUE_PNG.id}").write(o1)\nrender(o0)` }
    // The renderer's images, as an earlier record that carries base64 text.
    await loader.attachShareFiles(payload, { images: [{ id: BLUE_PNG.id, dataUrl: BLUE_PNG.dataUrl }], screenshot: jpegCanvas })
    const uploads = requests.filter(request => request.type === 'image/png')
    assert.deepEqual(await Promise.all(uploads.map(async request => Buffer.from(await request.body.arrayBuffer()))), [RED_PNG.bytes, BLUE_PNG.bytes])
    for (const request of requests) assert.ok(request.body instanceof Blob, 'every upload body is a file')
    assert.equal(payload.dsl, `search synth\nmedia(url: "image:${RED_PNG.id}").write(o0)\nmedia(url: "image:${BLUE_PNG.id}").write(o1)\nrender(o0)`)
    assert.equal(payload.screenshot, SHOT_ID)
    assert.doesNotMatch(JSON.stringify(payload), TEXT_IMAGE)
})

test('every share request goes through the file upload helper', async () => {
    const app = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8')
    const modal = await readFile(new URL('../public/js/ui/share-modal.js', import.meta.url), 'utf8')
    for (const [name, text, posts] of [['app.js', app, 4], ['share-modal.js', modal, 1]]) {
        assert.equal(text.match(/fetch\(SHARE_API_URL/g).length, posts, `${name} share requests`)
        assert.equal(text.match(/await attachShareFiles\(payload, \{ images: renderer\??\.images \|\| \[\], screenshot \}\)/g).length, posts, `${name} uploads files`)
        assert.doesNotMatch(text, /prepareImagesForShare|payload\.screenshot = screenshot/, name)
    }
    // Only the share dialog's preview image still reads the screenshot as a data URL.
    assert.doesNotMatch(app, /toDataURL/)
    assert.deepEqual(modal.match(/.*toDataURL.*/g).map(line => line.trim()), ["previewImg.src = this.screenshot.toDataURL('image/jpeg', 0.85)"])
    for (const handler of ['handleEditInShade', 'handleEditInNoisedeck', 'handleEditInNoodles', 'handleEditInPolymorphic']) {
        const body = app.match(new RegExp(`async function ${handler}\\(\\) \\{[\\s\\S]*?\\n\\}`))[0]
        assert.ok(body.indexOf('attachShareFiles(') < body.indexOf('fetch(SHARE_API_URL'), `${handler} uploads before it shares`)
    }
})
