import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { shareExposureText } from '../public/js/ui/share-exposure.js'

// The sentence beside Share says what anyone with the link can open: the
// editable effect, and the original images and custom shader code only when
// the share carries them. The sentence decides each kind with the test the
// share itself applies. Run: npm test

const loaderSource = readFileSync(new URL('../public/js/sharingLoader.js', import.meta.url), 'utf8')
    .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/noisemaker\/bundle.js'/, 'const Effect = class {}; const registerEffect = () => {}; const registerOp = () => {}; const registerStarterOps = () => {}; const mergeIntoEnums = () => {}')
const loader = await import('data:text/javascript;base64,' + Buffer.from(loaderSource).toString('base64'))

// The real _createEffectZip and _carriesEffect bodies, in a sandbox with a fake JSZip.
const modalSource = readFileSync(new URL('../public/js/ui/share-modal.js', import.meta.url), 'utf8')
const start = modalSource.indexOf('    async _createEffectZip() {')
const end = modalSource.indexOf('    async _loadJSZip()', start)
assert.ok(start >= 0 && end > start, '_createEffectZip source slice found')
function sandboxModal(files) {
    class FakeZip {
        file() {}
        async generateAsync() { return { blob: true } }
    }
    const context = vm.createContext({ console: { log() {}, error() {} }, window: { JSZip: FakeZip }, workspaceStore: { toObject: () => ({ ...files }) } })
    vm.runInContext(`globalThis.subject = class ShareModalStub { ${modalSource.slice(start, end)} }`, context)
    const modal = new context.subject()
    modal._loadJSZip = async () => {}
    modal._blobToBase64 = async () => 'base64zip'
    return modal
}

test('the sentence names exactly the kinds the share carries, in each case', () => {
    const cases = [
        [{ images: true, shaders: true }, 'Anyone with the link can open the editable effect, including the original images and custom shader code it uses.'],
        [{ images: true, shaders: false }, 'Anyone with the link can open the editable effect, including the original images it uses.'],
        [{ images: false, shaders: true }, 'Anyone with the link can open the editable effect, including custom shader code it uses.'],
        [{ images: false, shaders: false }, 'Anyone with the link can open the editable effect.'],
    ]
    for (const [kinds, sentence] of cases) assert.equal(shareExposureText(kinds), sentence, JSON.stringify(kinds))
    assert.equal(shareExposureText(), cases[0][1], 'with nothing checked, the sentence names both kinds')
})

test('the share uploads images only when the program names a url', () => {
    assert.equal(loader.shareCarriesImages('search synth\nmedia(url: "data:image/png;base64,AA==").write(o0)\nrender(o0)'), true)
    assert.equal(loader.shareCarriesImages('search synth\nmedia().write(o0)\nrender(o0)'), false)
    assert.equal(loader.shareCarriesImages('search synth\nnoise().write(o0)\nrender(o0)'), false)
    assert.equal(loader.shareCarriesImages(''), false)
})

test('custom shader code is named exactly when the share packages the workspace effect', async () => {
    const definition = '{"name":"Blast","func":"blast"}'
    const cases = [
        [{}, false],
        [{ 'definition.json': definition }, false],
        [{ 'glsl/main.glsl': 'void main() {}' }, false],
        [{ 'definition.json': definition, 'glsl/main.glsl': 'void main() {}' }, true],
        [{ 'definition.json': definition, 'wgsl/main.wgsl': '@fragment fn main() {}' }, true],
        [{ 'definition.json': definition, 'glsl/main.vert': 'void main() {}', 'help.md': '# Blast' }, false],
        [{ 'definition.json': '', 'glsl/main.glsl': 'void main() {}' }, false],
    ]
    for (const [files, carried] of cases) {
        const modal = sandboxModal(files)
        assert.equal(modal._carriesEffect(files), carried, JSON.stringify(Object.keys(files)))
        assert.equal(await modal._createEffectZip() !== null, carried, `the effect ZIP agrees: ${JSON.stringify(Object.keys(files))}`)
    }
})
