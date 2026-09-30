import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = (await readFile(new URL('../public/js/sharingLoader.js', import.meta.url), 'utf8'))
    .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/noisemaker\/bundle.js'/, 'const Effect = class {}; const registerEffect = () => {}; const registerOp = () => {}; const registerStarterOps = () => {}; const mergeIntoEnums = () => {}')
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
