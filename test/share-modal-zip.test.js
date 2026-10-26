import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// ShareModal._createEffectZip packages the effect a share carries. The
// "edit in Shade/Noisedeck/Noodles/Polymorphic" handlers in app.js package
// definition.json plus every GLSL and WGSL shader plus help.md; the share
// dialog used to package only GLSL shaders, so a WGSL-carrying effect lost its
// shaders and any effect lost its help.md when shared publicly.
//
// These tests run the real _createEffectZip body in a sandbox with a fake
// JSZip and assert the archive layout. Run: npm test

const source = readFileSync(new URL('../public/js/ui/share-modal.js', import.meta.url), 'utf8')
const start = source.indexOf('    async _createEffectZip() {')
const end = source.indexOf('    async _loadJSZip()', start)
assert.ok(start >= 0 && end > start, '_createEffectZip source slice found')

function runCreateEffectZip({ files }) {
    const archives = []
    class FakeZip {
        constructor() { this.entries = new Map() }
        file(path, content) { this.entries.set(path, content) }
        async generateAsync() {
            archives.push(this)
            return { blob: true }
        }
    }
    const workspaceStore = { toObject: () => ({ ...files }) }
    const context = vm.createContext({
        console,
        window: { JSZip: FakeZip },
        workspaceStore
    })
    vm.runInContext(`globalThis.subject = class ShareModalStub { ${source.slice(start, end)} }`, context)
    const modal = new context.subject()
    modal._loadJSZip = async () => {}
    modal._blobToBase64 = async () => 'base64zip'
    return modal._createEffectZip().then(base64 => ({ zip: archives[0], base64 }))
}

test('a WGSL-carrying effect shares its shaders in the effect ZIP', { timeout: 3000 }, async () => {
    const files = {
        'definition.json': '{"name":"Blast","func":"blast"}',
        'wgsl/blast.wgsl': '@group(0) @binding(0) var s: sampler;'
    }
    const { zip } = await runCreateEffectZip({ files })
    assert.ok(zip, 'the effect ZIP is built')
    assert.deepEqual([...zip.entries.keys()].sort(), ['definition.json', 'wgsl/blast.wgsl'])
    assert.equal(zip.entries.get('wgsl/blast.wgsl'), files['wgsl/blast.wgsl'])
})

test('a GLSL effect shares its shaders and its help.md', { timeout: 3000 }, async () => {
    const files = {
        'definition.json': '{"name":"Solid","func":"solid"}',
        'glsl/solid.glsl': 'void main() {}',
        'help.md': '# Solid'
    }
    const { zip } = await runCreateEffectZip({ files })
    assert.ok(zip, 'the effect ZIP is built')
    assert.deepEqual([...zip.entries.keys()].sort(), ['definition.json', 'glsl/solid.glsl', 'help.md'])
    assert.equal(zip.entries.get('help.md'), files['help.md'])
})

test('an effect with no shader files still shares no effect ZIP', { timeout: 3000 }, async () => {
    const files = { 'definition.json': '{"name":"Solid","func":"solid"}', 'help.md': '# Solid' }
    const { zip, base64 } = await runCreateEffectZip({ files })
    assert.equal(zip, undefined)
    assert.equal(base64, null)
})
