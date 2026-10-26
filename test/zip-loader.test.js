import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

for (const [file, name, marker] of [
    ['app.js', 'loadJSZip', '\n/**'],
    ['ui/share-modal.js', '_loadJSZip', '\n    /**'],
]) {
    test(`${file} loads the bundled ZIP library from the app origin`, async () => {
        const source = await readFile(new URL(`../public/js/${file}`, import.meta.url), 'utf8')
        const start = source.indexOf(`async ${name === 'loadJSZip' ? 'function ' : ''}${name}()`)
        const method = source.slice(start, source.indexOf(marker, start)).trim()
        const fn = name === 'loadJSZip' ? method : method.replace('async _loadJSZip', 'async function _loadJSZip')
        let requested
        const sandbox = { window: {}, document: {
            createElement: () => ({}),
            head: { appendChild: script => { requested = new URL(script.src, 'https://foundry.example/'); script.onload() } },
        } }
        await vm.runInNewContext(`${fn}\n${name}()`, sandbox)
        assert.equal(requested.origin, 'https://foundry.example')
        assert.equal(requested.pathname, '/js/lib/jszip.min.js')
        const bundled = await readFile(new URL(`../public${requested.pathname}`, import.meta.url), 'utf8')
        const context = vm.createContext({ setTimeout, clearTimeout })
        vm.runInContext(bundled, context)
        assert.equal(typeof context.JSZip, 'function')
    })
}
