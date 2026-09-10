import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Isolate browser-only storage and CDN imports; exercise the actual loader code.
class Effect {
    constructor(config) { Object.assign(this, config) }
    asyncInit() { return Promise.resolve() }
}
function load(path, exported) {
    const registered = new Map(), ops = new Map(), starters = [], enums = []
    const bareEffect = { builtin: true }
    registered.set('volumeTest', bareEffect)
    const stored = [], runtimeCalls = []
    const runtimeEnums = { user: { runtimeChoices: {} } }
    // The CDN owns operator/alias conversion; verify loaders delegate the full definition.
    class CanvasRenderer {
        registerEffectWithRuntime(effect) {
            runtimeCalls.push(effect)
            registered.set(effect.instance.func, effect.instance)
            registered.set(`${effect.namespace}.${effect.instance.func}`, effect.instance)
            registered.set(`${effect.namespace}/${effect.name}`, effect.instance)
            return runtimeEnums
        }
    }
    const manager = { _loadedEffects: new Map(), getEffect: async () => null,
        saveEffect: async (...args) => stored.push(args) }
    const files = new Map()
    const workspaceStore = { files, getFile: key => files.get(key), setFile: (key, value) => files.set(key, value) }
    const context = vm.createContext({ Effect, CanvasRenderer, console, URL, Blob, window: {}, eventBus: {},
        getEffect: key => registered.get(key),
        unregisterEffect: key => registered.delete(key),
        registerEffect: (key, value) => registered.set(key, value),
        registerOp: (key, value) => ops.set(key, value),
        registerStarterOps: value => starters.push(...value),
        mergeIntoEnums: value => enums.push(value),
        getUserEffectsManager: () => manager, workspaceStore })
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
        .replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
        .replace(/^export\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]\s*;?\s*$/gm, '')
        .replace(/^export /gm, '')
    vm.runInContext(source + `\nglobalThis.subject = ${exported}`, context)
    return { subject: context.subject, registered, ops, starters, enums, runtimeCalls, runtimeEnums, bareEffect, stored, files, context }
}
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const definition = {
    name: 'Volume test', func: 'volumeTest', namespace: 'filter3d', starter: false,
    globals: { volumeSize: { type: 'int', uniform: 'volumeSize' },
        mode: { type: 'int', default: 1, choices: { 'Modes:': null, soft: 1 } },
        external: { type: 'int', default: 2, enum: 'shared.modes', choices: { hard: 2 } } },
    passes: [{ program: 'volumeTest', inputs: { inputTex3d: 'inputTex3d' }, outputs: { color: 'volume' } }],
    textures: { volume: { width: { param: 'volumeSize' }, height: { param: 'volumeSize', power: 2 }, format: 'rgba16f' } },
    paramAliases: { oldMode: 'mode' },
    outputTex3d: 'volume', outputGeo: 'geometry', uniformLayout: [{ name: 'volumeSize', type: 'i32' }],
    uniformLayouts: { volumeTest: [{ name: 'volumeSize', type: 'i32' }] },
    defaultProgram: 'noise3d().volumeTest().render3d().write(o0)\nrender(o0)',
    shaders: { volumeTest: { glsl: 'GLSL', wgsl: 'WGSL' } }
}
function verify(harness) {
    const instance = harness.registered.get('user.volumeTest')
    assert.ok(instance instanceof Effect, 'registration requires an Effect instance')
    assert.equal(instance.asyncInit, Effect.prototype.asyncInit)
    for (const key of ['textures', 'outputTex3d', 'outputGeo', 'uniformLayout', 'uniformLayouts', 'defaultProgram', 'paramAliases']) {
        assert.deepEqual(plain(instance[key]), plain(definition[key]), key)
    }
    assert.equal(instance.namespace, 'user')
    assert.equal(harness.registered.get('volumeTest'), harness.bareEffect, 'retain built-in bare registrations')
    assert.equal(harness.starters.includes('user.volumeTest'), false)
    assert.equal(harness.runtimeCalls.length, 1, 'use canonical runtime registration for parameter aliases')
    assert.equal(harness.runtimeCalls[0].instance, instance)
    assert.deepEqual(plain(instance.globals), definition.globals)
    assert.equal(instance.globals.volumeSize.default, undefined, 'volumeSize must inherit')
    assert.equal(harness.enums.at(-1), harness.runtimeEnums, 'merge enums returned by the runtime')
}

test('workspace registration preserves volume contract even when DSL starts with a processor', { timeout: 3000 }, () => {
    const h = load('../public/js/workspace/index.js', 'registerEffectFromWorkspace')
    h.files.set('definition.json', JSON.stringify(definition))
    h.files.set('glsl/volumeTest.glsl', 'GLSL')
    assert.equal(h.subject(null, 'volumeTest().write(o0)\nrender(o0)'), true)
    verify(h)
})
test('sharing registration preserves volume contract and explicit enum paths', { timeout: 3000 }, () => {
    const h = load('../public/js/sharingLoader.js', 'registerPortableEffect')
    h.subject(definition)
    verify(h)
})

for (const route of ['workspace', 'sharing']) {
    test(`${route} registration does not create a bare effect key`, { timeout: 3000 }, () => {
        const h = route === 'workspace'
            ? load('../public/js/workspace/index.js', 'registerEffectFromWorkspace')
            : load('../public/js/sharingLoader.js', 'registerPortableEffect')
        h.registered.delete('volumeTest')
        if (route === 'workspace') {
            h.files.set('definition.json', JSON.stringify(definition))
            h.files.set('glsl/volumeTest.glsl', 'GLSL')
            assert.equal(h.subject(), true)
        } else {
            h.subject(definition)
        }
        assert.equal(h.registered.has('volumeTest'), false)
        assert.equal(h.registered.has('user.volumeTest'), true)
    })
}

test('library import exports layouts with renamed shader keys and its default program', { timeout: 3000 }, async () => {
    const files = new Map()
    const noop = () => {}
    const source = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8')
    const functionSource = source.slice(source.indexOf('function renameEffectCalls(') >= 0 ? source.indexOf('function renameEffectCalls(') : source.indexOf('async function loadEffectToWorkspace('), source.indexOf('// Canvas Overlay Management'))
    const originalProgram = definition.defaultProgram
    definition.defaultProgram = `search synth3d, filter3d, render\n\nvolumeTest3d().volumeTest(volumeTest: mode.volumeTest).text(text: \"volumeTest()\").write(o0)\n// volumeTest()\nrender(o0)`
    const expectedProgram = `search user, synth3d, filter3d, render\n\nvolumeTest3d().renamedVolume(volumeTest: mode.volumeTest).text(text: \"volumeTest()\").write(o0)\n// volumeTest()\nrender(o0)`
    const context = vm.createContext({ console,
        renderer: { loadEffect: async () => ({ name: definition.func, namespace: 'filter3d', instance: definition }),
            getEffectManifest: () => ({}), buildDslSource: () => definition.defaultProgram },
        workspaceStore: { clear: noop, setFile: (key, value) => files.set(key, value), checkpoint: noop },
        updateMenuFilename: noop, addRecentEffect: noop, registerEffectFromWorkspace: noop,
        paramControls: { setEffect: noop }, fileBrowser: { render: noop }, dslEditor: {}, canvasEditor: null,
        compileAndRun: async () => ({ success: true }), toast: { success: noop, error: noop },
        handleError: error => { throw error }, ErrorType: {}, currentEffect: null })
    vm.runInContext(functionSource + '\nglobalThis.subject = loadEffectToWorkspace', context)
    assert.equal(await context.subject('filter3d/volumeTest', 'renamedVolume'), true)
    const saved = JSON.parse(files.get('definition.json'))
    assert.deepEqual(saved.paramAliases, definition.paramAliases)
    assert.deepEqual(saved.uniformLayout, definition.uniformLayout)
    assert.deepEqual(saved.uniformLayouts, { renamedVolume: definition.uniformLayouts.volumeTest })
    assert.equal(saved.defaultProgram, expectedProgram)
    assert.equal(files.get('dsl.txt'), expectedProgram)
    assert.equal(files.get('wgsl/renamedVolume.wgsl'), 'WGSL')
    assert.equal(definition.uniformLayouts.volumeTest[0].name, 'volumeSize')

    // Keeping the library function name must still select the workspace copy.
    definition.defaultProgram = 'search synth3d, filter3d, user, render\nnoise3d().volumeTest().render3d().write(o0)\nrender(o0)'
    const unrenamedProgram = 'search user, synth3d, filter3d, render\nnoise3d().volumeTest().render3d().write(o0)\nrender(o0)'
    assert.equal(await context.subject('filter3d/volumeTest'), true)
    assert.equal(JSON.parse(files.get('definition.json')).defaultProgram, unrenamedProgram)
    assert.equal(files.get('dsl.txt'), unrenamedProgram)
    definition.defaultProgram = originalProgram
})

test('infers 3D processor starter status from its input contract', { timeout: 3000 }, async () => {
    const h = load('../public/js/workspace/index.js', 'registerEffectFromWorkspace')
    const def = { ...definition, starter: undefined, passes: [{ program: 'volumeTest', inputs: {"inputTex3d": "inputTex3d"}, outputs: { color: 'volume' } }] }
    h.files.set('definition.json', JSON.stringify(def))
    h.files.set('glsl/volumeTest.glsl', 'GLSL')
    assert.equal(h.subject(null, 'volumeTest()'), true)
    assert.equal(h.starters.includes('user.volumeTest'), false)
})
test('infers 2D filter starter status from its input contract', { timeout: 3000 }, async () => {
    const h = load('../public/js/workspace/index.js', 'registerEffectFromWorkspace')
    const def = { ...definition, starter: undefined, passes: [{ program: 'volumeTest', inputs: {"inputTex": "inputTex"}, outputs: { color: 'volume' } }] }
    h.files.set('definition.json', JSON.stringify(def))
    h.files.set('glsl/volumeTest.glsl', 'GLSL')
    assert.equal(h.subject(null, 'volumeTest()'), true)
    assert.equal(h.starters.includes('user.volumeTest'), false)
})
test('infers generator starter status from its input contract', { timeout: 3000 }, async () => {
    const h = load('../public/js/workspace/index.js', 'registerEffectFromWorkspace')
    const def = { ...definition, starter: undefined, passes: [{ program: 'volumeTest', inputs: {}, outputs: { color: 'volume' } }] }
    h.files.set('definition.json', JSON.stringify(def))
    h.files.set('glsl/volumeTest.glsl', 'GLSL')
    assert.equal(h.subject(null, 'volumeTest()'), true)
    assert.equal(h.starters.includes('user.volumeTest'), true)
})

test('geometry-only filters infer processor status and preserve explicit starter overrides', { timeout: 3000 }, () => {
    for (const route of ['workspace', 'sharing']) {
        for (const starter of [undefined, false, true]) {
            const h = route === 'workspace'
                ? load('../public/js/workspace/index.js', 'registerEffectFromWorkspace')
                : load('../public/js/sharingLoader.js', 'registerPortableEffect')
            const def = { ...definition, starter,
                passes: [{ program: 'volumeTest', inputs: { geometry: 'inputGeo' }, outputs: { color: 'volume' } }] }
            if (route === 'workspace') {
                h.files.set('definition.json', JSON.stringify(def))
                h.files.set('glsl/volumeTest.glsl', 'GLSL')
                assert.equal(h.subject(), true)
            } else {
                h.subject(def)
            }
            assert.equal(h.starters.includes('user.volumeTest'), starter === true, `${route}: ${starter}`)
            assert.equal(h.registered.get('user.volumeTest').starter, starter === true, `${route}: ${starter}`)
        }
    }
})


for (const [route, marker] of [['share code', "const shareCode = getCodeFromUrl()"], ['URL import', "console.log('[Foundry] Loaded composition from URL:"]]) {
    test(`${route} hydration preserves exported definition and subsequent registration`, { timeout: 3000 }, () => {
        const h = load('../public/js/workspace/index.js', 'registerEffectFromWorkspace')
        const source = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8')
        const start = source.indexOf('// Clear existing workspace', source.indexOf(marker))
        const end = source.indexOf('// Checkpoint the initial state', start)
        assert.ok(start >= 0 && end > start)
        h.context.workspaceStore.clear = () => h.files.clear()
        h.context.effectData = definition
        vm.runInContext(source.slice(start, end), h.context)
        const saved = JSON.parse(h.files.get('definition.json'))
        for (const key of ['textures', 'outputTex3d', 'outputGeo', 'uniformLayout', 'uniformLayouts', 'defaultProgram', 'paramAliases', 'starter']) {
            assert.deepEqual(saved[key], definition[key], `${route}: ${key}`)
        }
        assert.equal(saved.namespace, 'user')
        assert.equal(h.files.get('glsl/volumeTest.glsl'), 'GLSL')
        assert.equal(h.files.get('wgsl/volumeTest.wgsl'), 'WGSL')
        assert.equal(h.subject(null, definition.defaultProgram), true)
        verify(h)
    })
}
