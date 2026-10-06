import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// The sharing service's image helpers, stubbed per test through globalThis.portableImages.
const portableImagesStub = ['prepareImage', 'prepareImagesForShare', 'imageToBlob', 'replaceMediaUrls']
    .map(name => `export const ${name} = (...args) => globalThis.portableImages.${name}(...args)`).join('\n')
const source = (await readFile(new URL('../public/js/sharingLoader.js', import.meta.url), 'utf8'))
    .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/noisemaker\/bundle.js'/, 'const Effect = class {}; const registerEffect = () => {}; const registerOp = () => {}; const registerStarterOps = () => {}; const mergeIntoEnums = () => {}')
    .replaceAll("'https://sharing.noisedeck.app/js/portableImages.js?v=images-20260929'", `'data:text/javascript;base64,${Buffer.from(portableImagesStub).toString('base64')}'`)
const loader = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
test('composition imports retain image bytes for rendering and reshare', async t => {
    const previous = globalThis.fetch
    const images = [{ id: 'a'.repeat(64), dataUrl: 'data:image/png;base64,AAAA' }]
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ code: 'abcdef', dsl: 'media().write(o0)', images }) })
    t.after(() => { globalThis.fetch = previous })
    assert.deepEqual((await loader.loadFromCode('abcdef')).images, images)
})

const { WorkspaceStore } = await import('../public/js/workspace/workspace-store.js')
test('URL import checkpoints the composition DSL and images together after clearing an old workspace', async () => {
    const app = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8')
    const handler = app.match(/async function handleLoadFromUrl\(composition\) \{[\s\S]*?\n\}/)[0]
    const store = new WorkspaceStore()
    store.setFile('dsl.txt', 'old program')
    store.images = [{ id: 'old' }]
    const images = [{ id: 'a'.repeat(64), dataUrl: 'data:image/png;base64,AQIDBA==' }]
    const dsl = `search synth\nmedia(url: "image:${images[0].id}").write(o0)`
    let compilations = 0
    const context = vm.createContext({
        renderer: {}, workspaceStore: store, dslEditor: {}, canvasEditor: null, fileBrowser: null, console,
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
    store.setFile('dsl.txt', 'replacement')
    store.images = []
    store.checkpoint('replacement')
    store.undo()
    assert.equal(store.getFile('dsl.txt'), dsl)
    assert.deepEqual(store.images, images)
})

test('workspace save and history retain original images with the DSL', () => {
    const images = [{ id: 'a'.repeat(64), dataUrl: 'data:image/png;base64,AQIDBA==' }]
    const dsl = `search synth\nmedia(url: "image:${images[0].id}").write(o0)`
    const store = new WorkspaceStore()
    store.setFile('dsl.txt', dsl)
    store.images = images
    store.checkpoint('with image')
    const reopened = new WorkspaceStore()
    reopened.fromObject(JSON.parse(JSON.stringify(store.toObject())))
    assert.equal(reopened.getFile('dsl.txt'), dsl)
    assert.deepEqual(reopened.images, images)
    store.images = []
    store.checkpoint('cleared')
    store.undo()
    assert.deepEqual(store.images, images)
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
        prepareImagesForShare: async dsl => ({
            dsl: dsl.replace('https://images.example/red.png', `image:${RED_ID}`),
            images: [{ id: RED_ID, dataUrl: 'data:image/png;base64,iVBORw==', mimeType: 'image/png', width: 2, height: 2 }]
        }),
        imageToBlob: () => new Blob([PNG], { type: 'image/png' }),
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
    await loader.attachShareFiles(payload, { images: [{ id: RED_ID, dataUrl: 'data:image/png;base64,iVBORw==' }], screenshot: jpegCanvas })
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
    globalThis.portableImages = { prepareImage: async blob => ({ id: RED_ID, dataUrl: 'data:image/png;base64,iVBORw==', mimeType: blob.type, width: 2, height: 2 }) }
    const warn = console.warn
    const warnings = []
    console.warn = (...args) => warnings.push(args[0])
    t.after(() => { globalThis.fetch = previous; console.warn = warn; delete globalThis.portableImages })

    const composition = await loader.loadFromCode('abcdef')
    assert.equal(fetched[0], 'https://sharing.noisedeck.app/api/composition/abcdef?images=files')
    // The red file matches its id; a file whose bytes have another id, and a missing file, are left out.
    assert.deepEqual(composition.images, [{ id: RED_ID, dataUrl: 'data:image/png;base64,iVBORw==', mimeType: 'image/png', width: 2, height: 2 }])
    assert.equal(composition.dsl, `media(url: "image:${RED_ID}").write(o0)`)
    assert.equal(warnings.length, 2)
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
