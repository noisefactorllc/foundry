import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// handleExport turns the workspace into a downloadable ZIP. dsl.txt is
// deliberately NOT copied into the archive, so effect.dsl is the only place the
// program itself travels in. It used to be gated on workspaceStore.images,
// which meant a DSL-only workspace (typed straight into the editor, no imported
// definition, no images) exported a ZIP containing no program at all.
//
// These tests run the real handleExport body in a sandbox with a fake JSZip
// and assert the archive layout. Run: npm test

const source = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8')
const start = source.indexOf('async function handleExport(')
const end = source.indexOf('// Edit in other apps')
assert.ok(start >= 0 && end > start, 'handleExport source slice found')

function runExport({ files, dsl, name = 'workspace' }) {
    const archives = []
    class FakeZip {
        constructor() { this.entries = new Map() }
        file(path, content) { this.entries.set(path, content) }
        async generateAsync() {
            archives.push(this)
            return { blob: true }
        }
    }
    const workspaceStore = {
        name,
        images: (JSON.parse(files['images.json'] || '[]')),
        toObject: () => ({ ...files })
    }
    const anchor = { click: () => {} }
    const context = vm.createContext({
        console,
        Blob,
        URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
        document: {
            createElement: () => anchor,
            body: { appendChild: () => {}, removeChild: () => {} }
        },
        window: { JSZip: FakeZip },
        workspaceStore,
        dslEditor: { value: dsl },
        toast: { success: () => {}, error: (message) => { throw new Error(message) } }
    })
    vm.runInContext(source.slice(start, end) + '\nglobalThis.subject = handleExport', context)
    return context.subject().then(() => archives[0])
}

test('export includes the program for a DSL-only workspace', { timeout: 3000 }, async () => {
    const dsl = 'search synth\n\nnoise().write(o0)\n\nrender(o0)'
    const zip = await runExport({ files: { 'dsl.txt': dsl }, dsl })
    assert.equal(zip.entries.get('effect.dsl'), dsl, 'the program must travel in the ZIP')
})

test('export keeps the image-composition layout (effect.dsl + images.json)', { timeout: 3000 }, async () => {
    const dsl = 'search synth\nmedia(url: "image:abc").write(o0)'
    const files = {
        'dsl.txt': dsl,
        'images.json': JSON.stringify([{ id: 'abc', dataUrl: 'data:image/png;base64,AQIDBA==' }])
    }
    const zip = await runExport({ files, dsl })
    assert.equal(zip.entries.get('effect.dsl'), dsl)
    assert.equal(zip.entries.get('images.json'), files['images.json'])
})

test('export injects the current DSL as defaultProgram and keeps effect.dsl', { timeout: 3000 }, async () => {
    const dsl = 'search synth\n\nsolid().write(o0)\n\nrender(o0)'
    const files = { 'dsl.txt': dsl, 'definition.json': '{"name":"Solid","func":"solid"}' }
    const zip = await runExport({ files, dsl })
    const def = JSON.parse(zip.entries.get('definition.json'))
    assert.equal(def.defaultProgram, dsl)
    assert.equal(zip.entries.get('effect.dsl'), dsl)
})

test('export omits dsl.txt and skips whitespace-only programs', { timeout: 3000 }, async () => {
    const zip = await runExport({ files: { 'dsl.txt': 'search synth' }, dsl: '   ' })
    assert.equal(zip.entries.has('dsl.txt'), false)
    assert.equal(zip.entries.has('effect.dsl'), false)
})
