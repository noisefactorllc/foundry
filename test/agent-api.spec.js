// End-to-end: the in-page agent API, window.FoundryAgent, and its WebMCP tools.
//
// Starts Foundry on a free local port and drives it headless. The commands run
// through the same paths as the editor: programs and custom effects compile,
// workspace files register the effect again, saved effects go to IndexedDB.
// The page shows nothing new for an agent: there is no command form.
//
// BROWSER picks chromium (default), firefox or webkit. PLAYWRIGHT_MODULE names
// another Playwright build to drive the browser with.
// Run: BROWSER=webkit node --test test/agent-api.spec.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { freePort, poll } from './seance-local.js'

const FOUNDRY = fileURLToPath(new URL('..', import.meta.url))
const BROWSER = process.env.BROWSER || 'chromium'

async function startFoundry(port) {
    const child = spawn(process.execPath, ['server/index.js'], { cwd: FOUNDRY, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', data => { stderr += data })
    try {
        await poll(() => fetch(`http://127.0.0.1:${port}/health`).then(r => r.ok, () => false), Boolean, { timeout: 10000, label: 'Foundry' })
    } catch {
        child.kill('SIGTERM')
        throw new Error(`Foundry did not start: ${stderr}`)
    }
    return child
}

// The custom effect llms.txt shows, with its program.
const STRIPES = {
    name: 'stripes', func: 'stripes', description: 'Moving stripes',
    globals: { count: { type: 'int', default: 8, min: 1, max: 64, uniform: 'count' } },
    passes: [{ name: 'render', program: 'stripes', inputs: {}, outputs: { fragColor: 'outputTex' } }],
    shaders: { stripes: { glsl: `#version 300 es
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform int count;
out vec4 fragColor;
const float TAU = 6.28318530718;
void main() {
    vec2 uv = gl_FragCoord.xy / resolution;
    float v = 0.5 + 0.5 * sin(TAU * (uv.x * float(count) + time));
    fragColor = vec4(vec3(v), 1.0);
}
` } },
}
const STRIPES_DSL = 'search user\nstripes(count: 12).write(o0)\nrender(o0)\n'

test(`${BROWSER}: window.FoundryAgent runs programs, custom effects and workspace files`, { timeout: 300000 }, async t => {
    const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
    const port = await freePort()
    const origin = `http://127.0.0.1:${port}`
    const foundry = await startFoundry(port)
    t.after(() => foundry.kill('SIGTERM'))
    const browser = await playwright[BROWSER].launch({
        headless: true,
        args: BROWSER !== 'chromium' ? [] : process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader'],
    })
    t.after(() => browser.close())
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    // A WebMCP host: the page registers its tools with it.
    await page.addInitScript(() => {
        window.__tools = new Map()
        Object.defineProperty(navigator, 'modelContext', { configurable: true, value: { registerTool: tool => { window.__tools.set(tool.name, tool) } } })
    })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    // ?agent=1 shows nothing: Foundry has no visible agent form.
    await page.goto(`${origin}/?agent=1`)
    await page.waitForFunction(() => window.effectWorkspace && document.getElementById('loading-screen')?.classList.contains('hidden'), null, { timeout: 90000 })
    await page.evaluate(() => window.FoundryAgent.ready)
    assert.equal(await page.locator('[id$="agent-console"], [aria-label$=" agent"]').count(), 0)
    const call = (name, args) => page.evaluate(([name, args]) => window.FoundryAgent[name](args), [name, args])

    const state = await call('getState')
    assert.equal(state.ok, true)
    assert.equal(state.apiVersion, '1.0')
    assert.equal(state.result.schemaVersion, '1.0')
    assert.equal(state.result.backend, 'webgl2')

    // Arguments are strict.
    assert.equal((await call('getState', { force: true })).error.code, 'INVALID_ARGS_UNKNOWN')
    assert.equal((await call('setProgram', {})).error.code, 'INVALID_ARGS_REQUIRED')

    // A program that does not compile is diagnosed and changes nothing.
    const before = (await call('getProgram')).result.dsl
    const bad = await call('validateProgram', { dsl: 'search synth\nnoise(mixAmt: 3).write(o0)\nrender(o0)' })
    assert.equal(bad.result.valid, false)
    assert.ok(bad.result.diagnostics.some(d => d.code === 'S001' && d.severity === 'error'))
    assert.equal((await call('setProgram', { dsl: 'search synth\nnoise(mixAmt: 3).write(o0)\nrender(o0)' })).error.code, 'INVALID_PROGRAM')
    assert.equal((await call('getProgram')).result.dsl, before)
    const syntax = await call('validateProgram', { dsl: 'search synth\nnoise(.write(o0)' })
    assert.equal(syntax.result.diagnostics[0].code, 'SYNTAX')

    // The custom effect from llms.txt runs with its program.
    assert.equal((await call('validateProgram', { dsl: STRIPES_DSL, effect: STRIPES })).result.valid, true)
    const set = await call('setProgram', { dsl: STRIPES_DSL, effect: STRIPES })
    assert.equal(set.ok, true, JSON.stringify(set.error))
    assert.equal(set.state.workspace.effect, 'stripes')
    assert.equal(set.state.program.running, true)
    const program = (await call('getProgram')).result
    assert.equal(program.dsl, STRIPES_DSL)
    assert.equal(program.effect.func, 'stripes')
    assert.equal(program.effect.shaders.stripes.glsl, STRIPES.shaders.stripes.glsl)
    assert.equal((await call('getEffectDefinition', { effectId: 'user/stripes' })).result.params[0].name, 'count')
    assert.ok((await call('searchEffects', { query: 'stripes' })).result.effects.some(e => e.effectId === 'user/stripes'))
    assert.equal((await call('setProgram', { dsl: STRIPES_DSL, effect: { func: 'bad-name', shaders: {} } })).error.code, 'INVALID_EFFECT')

    // A thumbnail of the canvas, with its bytes in base64.
    const thumb = await call('getThumbnail', { maxDimension: 32, format: 'png' })
    assert.equal(thumb.ok, true, JSON.stringify(thumb.error))
    assert.equal(Buffer.from(thumb.result.bytes, 'base64').subarray(1, 4).toString(), 'PNG')
    assert.equal(Math.max(thumb.result.width, thumb.result.height), 32)

    // Workspace files: a shader edit registers the effect again and compiles;
    // one that does not compile stays written and reports the error.
    const files = (await call('listFiles')).result.files.map(file => file.path)
    for (const path of ['definition.json', 'dsl.txt', 'glsl/stripes.glsl']) assert.ok(files.includes(path), path)
    const broken = await call('writeFile', { path: 'glsl/stripes.glsl', content: STRIPES.shaders.stripes.glsl.replace('vec3(v)', 'vec3(undefinedThing)') })
    assert.equal(broken.ok, true)
    assert.equal(broken.result.compiled.success, false)
    const fixed = await call('writeFile', { path: 'glsl/stripes.glsl', content: STRIPES.shaders.stripes.glsl.replace('vec3(v)', 'vec3(v, 0.0, 1.0 - v)') })
    assert.equal(fixed.result.compiled.success, true)
    assert.match((await call('readFile', { path: 'glsl/stripes.glsl' })).result.content, /1\.0 - v/)
    assert.equal((await call('writeFile', { path: '../escape.glsl', content: '' })).error.code, 'INVALID_ARGS_RANGE')
    assert.equal((await call('readFile', { path: 'nope.glsl' })).error.code, 'NOT_FOUND_FILE')

    // Undo goes back through the editor's history.
    assert.equal((await call('undo')).result.applied, true)

    // A library effect as the workspace's custom effect.
    const loaded = await call('loadEffect', { effectId: 'filter/vignette', name: 'myVignette' })
    assert.equal(loaded.ok, true, JSON.stringify(loaded.error))
    assert.equal(loaded.result.name, 'myVignette')
    assert.ok(loaded.result.files.some(path => path.startsWith('glsl/')))
    assert.equal((await call('loadEffect', { effectId: 'synth/noSuchEffect' })).error.code, 'NOT_FOUND_EFFECT')

    // Saved effects: the person's IndexedDB, through the page.
    const saved = await call('saveEffect', { name: 'agent test' })
    assert.equal(saved.result.saved, true)
    const list = (await call('listSavedEffects')).result.effects
    assert.ok(list.some(effect => effect.id === saved.result.id && effect.name === 'agent test'))
    assert.equal((await call('loadSavedEffect', { id: saved.result.id })).result.loaded, true)
    assert.equal((await call('deleteSavedEffect', { id: saved.result.id })).result.deleted, true)
    assert.equal((await call('loadSavedEffect', { id: saved.result.id })).error.code, 'NOT_FOUND_EFFECT')

    // Playback.
    assert.equal((await call('pause')).result.playing, false)
    assert.equal((await call('play')).result.playing, true)

    // WebMCP: one tool per command; an image comes back as an image block, not text.
    const tools = await page.evaluate(() => [...window.__tools.keys()])
    assert.ok(tools.includes('foundry_setProgram') && tools.includes('foundry_getThumbnail'))
    assert.equal(tools.length, Object.keys(await page.evaluate(() => Object.fromEntries(Object.keys(window.FoundryAgent).filter(k => typeof window.FoundryAgent[k] === 'function').map(k => [k, 1])))).length)
    const image = await page.evaluate(async () => {
        const out = await window.__tools.get('foundry_getThumbnail').execute({ maxDimension: 16, format: 'png' })
        return { types: out.content.map(block => block.type), text: out.content[0].text, mimeType: out.content[1]?.mimeType, isError: out.isError }
    })
    assert.deepEqual(image.types, ['text', 'image'])
    assert.equal(image.mimeType, 'image/png')
    assert.equal(image.isError, false)
    assert.equal(JSON.parse(image.text).result.bytes, undefined)

    // exportZip succeeds only for a ZIP that the browser downloads.
    const downloads = []
    page.on('download', download => downloads.push(download))
    const download = page.waitForEvent('download')
    const exported = await call('exportZip')
    assert.equal(exported.ok, true, JSON.stringify(exported.error))
    const zipFile = await download
    assert.equal(zipFile.suggestedFilename(), `${exported.result.name}.zip`)
    const zipBytes = await readFile(await zipFile.path())
    assert.equal(zipBytes.subarray(0, 2).toString(), 'PK')
    const entries = await page.evaluate(async bytes => Object.keys((await window.JSZip.loadAsync(new Uint8Array(bytes))).files), [...zipBytes])
    assert.ok(entries.includes('effect.dsl'), JSON.stringify(entries))

    // A ZIP that cannot be generated is a failure: the person sees the error toast and nothing downloads.
    await page.evaluate(() => {
        const generate = window.JSZip.prototype.generateAsync
        window.__restoreGenerate = () => { window.JSZip.prototype.generateAsync = generate }
        window.JSZip.prototype.generateAsync = () => Promise.reject(new Error('injected generation failure'))
    })
    const delivered = downloads.length
    const failed = await call('exportZip')
    await page.evaluate(() => window.__restoreGenerate())
    assert.equal(failed.ok, false)
    assert.equal(failed.error.code, 'EXPORT_FAILED')
    assert.match(failed.error.message, /injected generation failure/)
    await page.locator('.toast-error .toast-message', { hasText: 'Export failed: injected generation failure' }).waitFor()

    // Work with nothing to export is refused.
    await page.evaluate(() => {
        window.effectWorkspace.workspaceStore.clear()
        document.getElementById('dsl-editor').value = ''
    })
    const empty = await call('exportZip')
    assert.equal(empty.ok, false)
    assert.equal(empty.error.code, 'CONFLICT_NOTHING_TO_EXPORT')
    await page.waitForTimeout(500)
    assert.equal(downloads.length, delivered)
    assert.deepEqual(errors, [])
})
