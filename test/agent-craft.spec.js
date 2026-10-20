// Focused real-GPU coverage of shader-craft agent commands and their Seance boundary.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { freePort, poll, startSeanceServer, routeSeance, routeHandfishDist, SeanceAgentClient } from './seance-local.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const dsl = 'search user\ncraftProbe().write(o0)\nrender(o0)'
const effect = {
    name: 'craftProbe', func: 'craftProbe', starter: true, globals: {},
    passes: [{ name: 'main', program: 'craftProbe', inputs: {}, outputs: { fragColor: 'outputTex' } }],
    shaders: { craftProbe: {
        glsl: 'precision highp float; uniform float time; out vec4 fragColor; void main(){fragColor=vec4(time,1.0-time,0.25,1.0);}',
        wgsl: '@group(0) @binding(0) var<uniform> time:f32; @fragment fn main()->@location(0) vec4f{return vec4f(time,1.0-time,0.25,1.0);}',
    } },
}

const pixel = page => page.evaluate(async () => {
    const pipeline = window.effectWorkspaceRenderer._renderer.pipeline
    const raw = await pipeline.backend.readPixels(pipeline.surfaces.get('o0').read)
    const index = (Math.floor(raw.height / 2) * raw.width + Math.floor(raw.width / 2)) * 4
    const sample = [...raw.data.slice(index, index + 4)]
    return raw.data instanceof Uint8Array ? sample : sample.map(value => Math.round(value * 255))
})
const imagePixel = (page, bytes) => page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, bitmap.width / 2, bitmap.height / 2, 1, 1, 0, 0, 1, 1)
    bitmap.close()
    return [...context.getImageData(0, 0, 1, 1).data]
}, [...bytes])

test('shader-craft agent commands use the GPU and preserve session-visible work', { timeout: 240000 }, async t => {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
    const port = await freePort(), origin = `http://127.0.0.1:${port}`
    const app = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
    t.after(() => app.kill('SIGTERM'))
    await poll(() => fetch(`${origin}/health`).then(r => r.ok, () => false), Boolean, { label: 'Foundry startup' })
    const seance = await startSeanceServer({ origins: [origin] })
    t.after(() => seance.stop())
    const browser = await chromium.launch({ headless: true, args: process.platform === 'darwin'
        ? ['--use-angle=metal', '--enable-gpu', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader', '--enable-unsafe-webgpu'] })
    t.after(() => browser.close())
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    await routeHandfishDist(page)
    await routeSeance(page, seance.url)
    if (process.env.SHADER_CRAFT_MODULE) {
        const body = await readFile(process.env.SHADER_CRAFT_MODULE, 'utf8')
        await page.route(`${origin}/vendor/shade-mcp/knowledge/shader-craft.js`, route => route.fulfill({ body, contentType: 'text/javascript' }))
    }
    await page.goto(origin)
    await page.waitForFunction(() => window.effectWorkspace && document.getElementById('loading-screen')?.classList.contains('hidden'), null, { timeout: 90000 })
    await page.evaluate(() => window.FoundryAgent.ready)
    await page.evaluate(() => document.getElementById('goOnlineMenuItem').click())
    await page.locator('seance-dialog [data-action="take-online"]').click()
    const code = await poll(() => new URL(page.url()).searchParams.get('seance'), Boolean, { label: 'session code' })
    await poll(() => page.evaluate(() => document.getElementById('seanceDialog').state), s => s === 'online')
    const agent = new SeanceAgentClient(seance.url, origin)
    t.after(() => agent.close())
    await agent.join(code)
    const tab = (await agent.request('describe')).from
    const call = async (name, args = {}) => (await agent.request(name, args, { to: tab })).envelope
    assert.equal((await call('setProgram', { dsl, effect })).ok, true)
    await poll(() => agent.docs.get('effect')?.text, text => text && JSON.parse(text).func === effect.func)

    const run = async (name, action) => {
        if (!process.env.CRAFT_CASES || new RegExp(process.env.CRAFT_CASES).test(name)) await t.test(name, action)
    }

    await run('newline-terminated shared programs do not create an editor draft', async () => {
        const source = `\n${dsl}\n`
        assert.equal((await call('setProgram', { dsl: source, effect })).ok, true)
        assert.equal(await page.evaluate(() => document.getElementById('canvas-editor').value), source)
        for (const [name, args] of [
            ['setLoopDuration', { seconds: 3.84 }],
            ['renderAt', { time: 0.39, maxDimension: 32, format: 'png' }],
        ]) {
            const answer = await call(name, args)
            assert.equal(answer.ok, true, JSON.stringify(answer.error))
        }
        await page.evaluate(source => { document.getElementById('canvas-editor').value = source + '// PRIVATE' }, source)
        assert.equal((await call('renderAt', { time: 0.5 })).error?.code, 'REMOTE_UNAVAILABLE')
        assert.equal((await call('setProgram', { dsl, effect })).ok, true)
    })

    await run('bundle writes revalidate work and shader versions after module loading', async () => {
        const moduleUrl = `${origin}/vendor/shade-mcp/knowledge/shader-craft.js`
        let releaseModule, moduleRequested
        const held = new Promise(resolve => { releaseModule = resolve })
        const requested = new Promise(resolve => { moduleRequested = resolve })
        await page.route(moduleUrl, async route => {
            moduleRequested()
            await held
            await route.continue()
        })
        t.after(() => releaseModule())
        const pending = call('bundleShader', { path: 'glsl/craftProbe.glsl', write: true })
        await requested
        const privateDraft = dsl + '\n// PRIVATE_DURING_IMPORT'
        await page.evaluate(draft => { document.getElementById('canvas-editor').value = draft }, privateDraft)
        releaseModule()
        const refused = await pending
        assert.equal(refused.error?.code, 'REMOTE_UNAVAILABLE')
        assert.equal(await page.evaluate(() => document.getElementById('canvas-editor').value), privateDraft)
        assert.equal(await page.evaluate(() => window.effectWorkspace.workspaceStore.getFile('glsl/craftProbe.glsl')), effect.shaders.craftProbe.glsl)
        await page.unroute(moduleUrl)
        await page.evaluate(dsl => { document.getElementById('canvas-editor').value = dsl }, dsl)

        // Even a completed import yields. A newer shared file and matching workspace must not be replaced
        // by a bundle calculated from the older source that this invocation originally read.
        const changed = await page.evaluate(async ({ effect }) => {
            const { bundleShader } = await import('/js/agent/commands.js')
            const ctx = { ...window.FoundryAgent._ctx, remote: true }
            const originalSessionText = ctx.sessionText
            const pending = bundleShader({ path: 'glsl/craftProbe.glsl', write: true }, ctx)
            const updated = JSON.parse(originalSessionText('effect'))
            updated.shaders.craftProbe.glsl += '\n// NEW_SHARED_SHADER_VERSION'
            ctx.sessionText = id => id === 'effect' ? JSON.stringify(updated) : originalSessionText(id)
            window.effectWorkspace.workspaceStore.setFile('glsl/craftProbe.glsl', updated.shaders.craftProbe.glsl)
            try { await pending; return { refused: false } }
            catch (err) { return { refused: true, code: err.__agentError?.code,
                shader: window.effectWorkspace.workspaceStore.getFile('glsl/craftProbe.glsl') } }
            finally { window.effectWorkspace.workspaceStore.setFile('glsl/craftProbe.glsl', effect.shaders.craftProbe.glsl) }
        }, { effect })
        assert.equal(changed.refused, true)
        assert.equal(changed.code, 'REMOTE_UNAVAILABLE')
        assert.equal(changed.shader, effect.shaders.craftProbe.glsl + '\n// NEW_SHARED_SHADER_VERSION')
    })
    await run('renderAt and session backend switching produce stable paused frames on both backends', async () => {
        await call('pause')
        const rendered = {}
        for (const backend of ['webgl2', 'webgpu']) {
            const switched = await call('setBackend', { backend })
            assert.equal(switched.ok, true, JSON.stringify(switched.error))
            assert.equal(switched.state.backend, backend)
            assert.equal(switched.state.playback.playing, false)
            rendered[backend] = []
            for (const time of [0, 0.25, 0.75, 1]) {
                const before = await page.evaluate(() => window.effectWorkspaceRenderer._renderer.frameCount)
                const frame = await call('renderAt', { time, maxDimension: 32, format: 'png' })
                assert.equal(frame.ok, true, JSON.stringify(frame.error))
                assert.equal(frame.result.time, time)
                assert.equal(frame.result.bytes, undefined)
                assert.equal(frame.result.mimeType, 'image/png')
                assert.equal(Math.max(frame.result.width, frame.result.height), 32)
                const image = await agent.downloadImage(frame.result.image.id)
                assert.equal(image.bytes.subarray(1, 4).toString(), 'PNG')
                assert.equal(createHash('sha256').update(image.bytes).digest('hex'), frame.result.image.id)
                assert.equal(frame.state.playback.playing, false)
                assert.equal(frame.state.playback.time, time)
                const count = await page.evaluate(() => window.effectWorkspaceRenderer._renderer.frameCount)
                assert.equal(count, before + 1)
                const sample = await pixel(page)
                assert.deepEqual(await imagePixel(page, image.bytes), sample)
                assert.ok(Math.abs(sample[0] - time * 255) <= 1, JSON.stringify({ backend, time, sample }))
                assert.ok(Math.abs(sample[1] - (1 - time) * 255) <= 1, JSON.stringify({ backend, time, sample }))
                await page.waitForTimeout(80)
                assert.equal(await page.evaluate(() => window.effectWorkspaceRenderer._renderer.frameCount), count)
                assert.deepEqual(await pixel(page), sample)
                rendered[backend].push(sample)
            }
        }
        assert.deepEqual(rendered.webgl2, rendered.webgpu)
        console.log(`GPU paired paused samples: ${JSON.stringify(rendered)}`)
    })
    await run('loop duration preserves paused time and validates finite positive seconds', async () => {
        await call('pause')
        const frameCount = await page.evaluate(() => window.effectWorkspaceRenderer._renderer.frameCount)
        const before = await pixel(page)
        const changed = await call('setLoopDuration', { seconds: 2.5 })
        assert.equal(changed.ok, true, JSON.stringify(changed.error))
        assert.equal(changed.state.playback.loopDuration, 2.5)
        assert.equal(changed.state.playback.playing, false)
        assert.deepEqual(await pixel(page), before)
        assert.equal(await page.evaluate(() => window.effectWorkspaceRenderer._renderer.frameCount), frameCount)
        for (const seconds of [0, -1]) assert.equal((await call('setLoopDuration', { seconds })).error.code, 'INVALID_ARGS_RANGE')
        for (const time of [-0.1, 1.1]) assert.equal((await call('renderAt', { time, maxDimension: 32, format: 'png' })).error.code, 'INVALID_ARGS_RANGE')
        for (const time of [NaN, Infinity]) {
            const answer = await page.evaluate(time => window.FoundryAgent.renderAt({ time }), time)
            assert.equal(answer.error.code, 'INVALID_ARGS_TYPE')
        }
    })
    await run('check and bundle use only visible shader inputs and write only on request', async () => {
        assert.equal((await call('setBackend', { backend: 'webgpu' })).ok, true)
        const checked = await call('checkShader', { source: 'fract(sin(x)*43758.5453)', language: 'glsl' })
        assert.equal(checked.ok, true, JSON.stringify(checked.error))
        assert.equal(checked.result.advisory, true)
        assert.ok(checked.result.findings.some(f => f.rule === 'sine-hash'))
        assert.equal((await call('checkShader', { path: 'wgsl/craftProbe.wgsl' })).result.language, 'wgsl')
        assert.equal((await call('checkShader', { source: 'x', path: 'glsl/craftProbe.glsl' })).ok, false)
        assert.equal((await call('checkShader', { source: 'x' })).ok, false)
        assert.equal((await call('bundleShader', { source: 'tonemapAgX(vec3(1.0));', language: 'glsl', write: true })).ok, false)
        const source = effect.shaders.craftProbe.glsl.replace('vec4(time,1.0-time,0.25,1.0)', 'vec4(tonemapAgX(vec3(time)),1.0)')
        const bundled = await call('bundleShader', { source, language: 'glsl' })
        assert.equal(bundled.ok, true, JSON.stringify(bundled.error))
        assert.ok(bundled.result.added.includes('tonemapAgX(vec3)'))
        assert.equal(bundled.result.written, false)
        assert.equal((await call('readFile', { path: 'glsl/craftProbe.glsl' })).result.content, effect.shaders.craftProbe.glsl)
        const next = structuredClone(effect)
        next.shaders.craftProbe.glsl = source
        assert.equal((await call('setProgram', { dsl, effect: next })).ok, true)
        const written = await call('bundleShader', { path: 'glsl/craftProbe.glsl', write: true })
        assert.equal(written.ok, true, JSON.stringify(written.error))
        assert.equal(written.result.written, true)
        assert.equal(written.result.compiled.success, true)
        await poll(() => agent.docs.get('effect')?.text, text => text && JSON.parse(text).shaders.craftProbe.glsl.includes('shader-craft credits'))
        assert.equal((await call('bundleShader', { path: 'glsl/craftProbe.glsl' })).result.added.length, 0)
        assert.equal((await call('setBackend', { backend: 'webgl2' })).ok, true)
        assert.equal((await call('renderAt', { time: 0.25, maxDimension: 32, format: 'png' })).ok, true)
        assert.equal((await call('setProgram', { dsl, effect })).ok, true)
    })
    await run('session commands preserve unflushed canvas editor buffers', async () => {
        await page.evaluate(() => document.querySelector('seance-dialog dialog')?.close())
        for (const path of ['dsl.txt', 'glsl/craftProbe.glsl', 'definition.json']) {
            await page.evaluate(() => document.getElementById('workspaceFilesMenuItem').click())
            await page.locator('.workspace-files-search').fill(path)
            await page.locator('.workspace-files-item').first().click()
            assert.equal((await call('setProgram', { dsl, effect })).ok, true)
            const stored = await page.evaluate(path => path === 'dsl.txt'
                ? document.getElementById('dsl-editor').value : window.effectWorkspace.workspaceStore.getFile(path), path)
            const draft = stored + '\n// UNFLUSHED_PRIVATE_BUFFER'
            // The component changes immediately; its input handler saves only after the debounce.
            // Hold that actual buffer state without firing the timer, so transport timing cannot hide it.
            await page.evaluate(draft => {
                const editor = document.getElementById('canvas-editor')
                editor.value = draft
                editor.style.display = 'none'
            }, draft)
            for (const [name, args] of [
                ['bundleShader', { path: 'glsl/craftProbe.glsl', write: true }],
                ['setBackend', { backend: 'webgl2' }], ['renderAt', { time: 0.5 }], ['setLoopDuration', { seconds: 3 }],
            ]) {
                const refused = await call(name, args)
                assert.equal(refused.error?.code, 'REMOTE_UNAVAILABLE', `${path}: ${name}`)
                assert.equal(JSON.stringify(refused).includes('UNFLUSHED_PRIVATE_BUFFER'), false)
                assert.equal(await page.evaluate(() => document.getElementById('canvas-editor').value), draft)
            }
            assert.deepEqual((await call('checkShader', { path: 'glsl/craftProbe.glsl' })).result.findings, [])
            await page.evaluate(stored => { document.getElementById('canvas-editor').value = stored }, stored)
            assert.equal((await call('setLoopDuration', { seconds: 2.5 })).ok, true, `${path}: restored editor`)
        }
    })
    await run('session commands do not expose or overwrite private workspace drafts', async () => {
        const privateShader = effect.shaders.craftProbe.glsl + '\nfloat privateHash(float x){return fract(sin(x)*43758.5453);}'
        await page.evaluate(({ privateShader }) => {
            const { workspaceStore } = window.effectWorkspace
            workspaceStore.setFile('glsl/private.glsl', 'PRIVATE_LIBRARY_DRAFT')
            workspaceStore.setFile('glsl/craftProbe.glsl', privateShader)
            document.getElementById('dsl-editor').value = '// private unrun DSL'
        }, { privateShader })
        const checked = await call('checkShader', { path: 'glsl/craftProbe.glsl' })
        assert.equal(checked.ok, true, JSON.stringify(checked.error))
        assert.deepEqual(checked.result.findings, [])
        for (const name of ['checkShader', 'bundleShader']) {
            const hidden = await call(name, { path: 'glsl/private.glsl' })
            assert.equal(hidden.error.code, 'NOT_FOUND_FILE')
            assert.equal(JSON.stringify(hidden).includes('PRIVATE_LIBRARY_DRAFT'), false)
        }
        for (const [name, args] of [['bundleShader', { path: 'glsl/craftProbe.glsl', write: true }], ['setBackend', { backend: 'webgl2' }], ['renderAt', { time: 0.5 }]]) {
            const refused = await call(name, args)
            assert.equal(refused.error?.code, 'REMOTE_UNAVAILABLE', name)
        }
        assert.equal(await page.evaluate(() => window.effectWorkspace.workspaceStore.getFile('glsl/craftProbe.glsl')), privateShader)
        assert.equal(await page.evaluate(() => window.effectWorkspace.workspaceStore.getFile('glsl/private.glsl')), 'PRIVATE_LIBRARY_DRAFT')
        assert.equal(await page.evaluate(() => document.getElementById('dsl-editor').value), '// private unrun DSL')
    })
})
