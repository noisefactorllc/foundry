import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { imageFilePath } from '../public/js/imageRecords.js'

// handleExport turns the workspace into a downloadable ZIP. dsl.txt is
// deliberately NOT copied into the archive, so effect.dsl is the only place the
// program itself travels in. It used to be gated on workspaceStore.images,
// which meant a DSL-only workspace (typed straight into the editor, no imported
// definition, no images) exported a ZIP containing no program at all.
//
// These tests run the real handleExport body in a sandbox with a fake JSZip
// and assert the archive layout, the outcome it resolves to and its toasts.
// Run: npm test

const source = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8')
const start = source.indexOf('async function handleExport(')
const end = source.indexOf('// Edit in other apps')
assert.ok(start >= 0 && end > start, 'handleExport source slice found')

function exportRun({ files, dsl, name = 'workspace', images = [], generate, options }) {
    const archives = []
    const toasts = []
    const downloads = []
    class FakeZip {
        constructor() { this.entries = new Map() }
        get files() { return Object.fromEntries(this.entries) }
        file(path, content) { this.entries.set(path, content) }
        async generateAsync() {
            archives.push(this)
            return generate ? generate() : { blob: true }
        }
    }
    const workspaceStore = {
        name,
        images,
        toObject: () => ({ ...files })
    }
    const anchor = { click() { downloads.push(this.download) } }
    const context = vm.createContext({
        console,
        Blob,
        imageFilePath,
        URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
        document: {
            createElement: () => anchor,
            body: { appendChild: () => {}, removeChild: () => {} }
        },
        window: { JSZip: FakeZip },
        loadJSZip: async () => {},
        workspaceStore,
        dslEditor: { value: dsl },
        toast: { success: (message) => toasts.push(['success', message]), error: (message) => toasts.push(['error', message]) }
    })
    vm.runInContext(source.slice(start, end) + '\nglobalThis.subject = handleExport', context)
    // The outcome comes from the sandbox's realm; spread it into this one to compare it.
    return context.subject(options).then(outcome => ({ archive: archives[0], outcome: { ...outcome }, toasts, downloads }))
}

async function runExport(args) {
    const { archive, toasts } = await exportRun(args)
    const failure = toasts.find(([type]) => type === 'error')
    if (failure) throw new Error(failure[1])
    return archive
}

const PROGRAM = 'search synth\n\nnoise().write(o0)\n\nrender(o0)'

test('export resolves to success with the workspace name once the browser has the download', { timeout: 3000 }, async () => {
    const run = await exportRun({ files: { 'dsl.txt': PROGRAM }, dsl: PROGRAM, name: 'stripes' })
    assert.deepEqual(run.outcome, { success: true, name: 'stripes' })
    assert.deepEqual(run.downloads, ['stripes.zip'])
    assert.deepEqual(run.toasts, [['success', 'Exported workspace']])
})

test('a ZIP that cannot be generated resolves to a failure after the same error toast, and nothing downloads', { timeout: 3000 }, async () => {
    const run = await exportRun({ files: { 'dsl.txt': PROGRAM }, dsl: PROGRAM, generate: () => Promise.reject(new Error('generation failed')) })
    assert.deepEqual(run.outcome, { success: false, error: 'generation failed' })
    assert.deepEqual(run.downloads, [])
    assert.deepEqual(run.toasts, [['error', 'Export failed: generation failed']])
})

test('with requireContent, work with nothing to export is refused before any archive, download or toast', { timeout: 3000 }, async () => {
    const run = await exportRun({ files: { 'dsl.txt': '' }, dsl: '   ', options: { requireContent: true } })
    assert.deepEqual(run.outcome, { success: false, empty: true })
    assert.equal(run.archive, undefined)
    assert.deepEqual(run.downloads, [])
    assert.deepEqual(run.toasts, [])
})

test('without requireContent, file > export effect to zip still downloads empty work', { timeout: 3000 }, async () => {
    const run = await exportRun({ files: { 'dsl.txt': '' }, dsl: '   ' })
    assert.deepEqual(run.outcome, { success: true, name: 'workspace' })
    assert.deepEqual(run.downloads, ['workspace.zip'])
    assert.deepEqual(run.toasts, [['success', 'Exported workspace']])
})

test('export includes the program for a DSL-only workspace', { timeout: 3000 }, async () => {
    const dsl = 'search synth\n\nnoise().write(o0)\n\nrender(o0)'
    const zip = await runExport({ files: { 'dsl.txt': dsl }, dsl })
    assert.equal(zip.entries.get('effect.dsl'), dsl, 'the program must travel in the ZIP')
})

test('export writes each image as a binary file images/<id>.<ext>, with no images.json or base64', { timeout: 3000 }, async () => {
    // The workspace holds its images as Blobs; the exported archive keeps
    // each one as its own image file, in the layout Shade's ZIPs use.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const id = bytes => createHash('sha256').update(bytes).digest('hex')
    const images = [
        { id: id(png), blob: new Blob([png], { type: 'image/png' }), mimeType: 'image/png', width: 2, height: 2 },
        { id: id(jpeg), blob: new Blob([jpeg], { type: 'image/jpeg' }), mimeType: 'image/jpeg', width: 1, height: 1 }
    ]
    const dsl = `search synth\nmedia(url: "image:${images[0].id}").write(o0)\nmedia(url: "image:${images[1].id}").write(o1)`
    const zip = await runExport({ files: { 'dsl.txt': dsl }, dsl, images })
    assert.equal(zip.entries.get('effect.dsl'), dsl)
    assert.deepEqual([...zip.entries.keys()].sort(), ['effect.dsl', `images/${images[0].id}.png`, `images/${images[1].id}.jpg`].sort())
    assert.equal(zip.entries.has('images.json'), false)
    for (const [image, bytes] of [[images[0], png], [images[1], jpeg]]) {
        const entry = zip.entries.get(imageFilePath(image))
        assert.ok(entry instanceof Blob, 'the image file is binary')
        assert.deepEqual(new Uint8Array(await entry.arrayBuffer()), bytes)
    }
    for (const [path, entry] of zip.entries) {
        if (typeof entry === 'string') assert.doesNotMatch(entry, /base64|data:image|dataUrl/, path)
    }
})

test('export without images writes no images.json', { timeout: 3000 }, async () => {
    const dsl = 'search synth\n\nnoise().write(o0)\n\nrender(o0)'
    const zip = await runExport({ files: { 'dsl.txt': dsl }, dsl })
    assert.equal(zip.entries.has('images.json'), false)
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
