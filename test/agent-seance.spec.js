// End-to-end: an agent joins the session a Foundry tab took online and drives
// that tab through the Seance agent relay (public/js/agent/relay.js).
//
// Starts Foundry and a local Seance server (see test/seance-local.js for
// SEANCE_ROOT, SEANCE_PYTHON and SEANCE_DIST_DIR) on free local ports. The
// connect-agent test runs its prompt's join line in /bin/sh with the shared
// agent tool (SEANCE_AGENT_CLI, default the sibling Noisedeck checkout's). The
// person's tab goes online through "go online..."; an agent written as the
// shared agent tool behaves joins from Node. Only the owner's tab answers,
// images travel as bytes, and commands that need the person at the browser
// answer REMOTE_UNAVAILABLE.
//
// BROWSER picks chromium (default), firefox or webkit. PLAYWRIGHT_MODULE names
// another Playwright build to drive the browser with.
// Run: BROWSER=webkit node --test test/agent-seance.spec.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { SeanceAgentClient, freePort, poll, routeHandfishDist, routeSeance, runJoinLine, startSeanceServer } from './seance-local.js'

const FOUNDRY = fileURLToPath(new URL('..', import.meta.url))
const BROWSER = process.env.BROWSER || 'chromium'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

/** A solid-color RGBA PNG. */
function png(size, [red, green, blue]) {
    const chunk = (type, data) => {
        const body = Buffer.concat([Buffer.from(type), data])
        let crc = 0xffffffff
        for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
        const length = Buffer.alloc(4), checksum = Buffer.alloc(4)
        length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
        return Buffer.concat([length, body, checksum])
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 4).map((_, i) => [red, green, blue, 255][i % 4])])
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.concat(Array(size).fill(row)))), chunk('IEND', Buffer.alloc(0))])
}

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

const VALID = 'search synth\n\nnoise(scaleX: 40, scaleY: 40)\n  .write(o0)\n\nrender(o0)\n'

// A custom effect that paints the canvas red, as a Portable effect.
const RED_EFFECT = {
    name: 'redfx',
    func: 'redfx',
    description: 'Solid red',
    globals: {},
    passes: [{ name: 'render', program: 'redfx', inputs: {}, outputs: { fragColor: 'outputTex' } }],
    shaders: { redfx: { glsl: '#version 300 es\nprecision highp float;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }\n' } },
}

/** Start Foundry, a local Seance server and a browser; everything stops when the test ends. */
async function setUp(t) {
    const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
    const port = await freePort()
    const origin = `http://127.0.0.1:${port}`
    const foundry = await startFoundry(port)
    t.after(() => foundry.kill('SIGTERM'))
    const seance = await startSeanceServer({ origins: [origin] })
    t.after(() => seance.stop())
    const browser = await playwright[BROWSER].launch({
        headless: true,
        args: BROWSER !== 'chromium' ? [] : process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader'],
    })
    t.after(() => browser.close())
    const agent = new SeanceAgentClient(seance.url, origin)
    t.after(() => agent.close())

    /** Open Foundry in a fresh context; `sent` collects the text the page's sockets send. */
    const open = async (url, sent = []) => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
        const page = await context.newPage()
        await routeHandfishDist(page)
        await routeSeance(page, seance.url)
        page.on('websocket', socket => socket.on('framesent', frame => sent.push(String(frame.payload))))
        // Every toast the page shows, kept after it fades (window.__toasts).
        await page.addInitScript(() => {
            window.__toasts = []
            new MutationObserver(records => {
                for (const record of records) {
                    for (const node of record.addedNodes) {
                        const message = node.querySelector?.('.toast-message')
                        if (message) window.__toasts.push(message.textContent)
                    }
                }
            }).observe(document, { childList: true, subtree: true })
        })
        await page.goto(url)
        await ready(page)
        return page
    }
    return { origin, seance, agent, open }
}

const ready = async page => {
    await page.waitForFunction(() => window.effectWorkspace && document.getElementById('loading-screen')?.classList.contains('hidden'), null, { timeout: 90000 })
    await page.evaluate(() => window.FoundryAgent.ready)
}

/** The person takes the work online through "go online..."; returns the session code. */
async function goOnline(page) {
    await page.evaluate(() => document.getElementById('goOnlineMenuItem').click())
    await page.locator('seance-dialog [data-action="take-online"]').click()
    const code = await poll(() => new URL(page.url()).searchParams.get('seance'), Boolean, { label: 'the session code in the address bar' })
    await poll(() => page.evaluate(() => document.getElementById('seanceDialog').state), state => state === 'online', { label: 'the online state' })
    return code
}

/** Wait until the page has shown a toast with this text. */
const toastShown = (target, text) => poll(() => target.evaluate(() => window.__toasts), shown => shown.includes(text), { label: `the "${text}" toast` })

/** Whether the menu hides "connect agent...", as it shows when the menu next opens. */
const connectAgentHidden = target => target.evaluate(() => {
    document.getElementById('menu').refresh()
    return document.getElementById('connectAgentMenuItem').hidden
})

// The output canvas's center pixel, from a frame rendered now.
const centerPixel = target => target.evaluate(() => {
    const renderer = window.effectWorkspaceRenderer
    renderer.render(0)
    const canvas = renderer.canvas, sample = document.createElement('canvas')
    sample.width = sample.height = 1
    const ctx = sample.getContext('2d')
    ctx.drawImage(canvas, canvas.width / 2, canvas.height / 2, 1, 1, 0, 0, 1, 1)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data)
})

test(`${BROWSER}: an agent in the online session drives the owner's Foundry tab`, { timeout: 300000 }, async t => {
    const { origin, agent, open } = await setUp(t)
    const ownerSent = []
    const page = await open(origin, ownerSent)
    const uploads = []
    page.on('request', request => {
        if (request.method() === 'POST' && /\/v1\/sessions\/[^/]+\/images$/.test(new URL(request.url()).pathname)) {
            uploads.push({ type: request.headers()['content-type'], body: request.postDataBuffer() })
        }
    })
    const code = await goOnline(page)

    await agent.join(code)
    const described = await agent.request('describe')
    assert.equal(described.app, 'foundry')
    assert.equal(described.envelope.ok, true)
    const tab = described.from
    // The person had no connect-agent dialog open: a toast confirms at once.
    await toastShown(page, 'Agent connected')
    const catalog = Object.fromEntries(described.envelope.result.commands.map(command => [command.name, command]))
    assert.deepEqual(catalog.setProgram.args.required, ['dsl'])
    assert.equal(catalog.getThumbnail.remote, true)
    for (const name of ['exportZip', 'listSavedEffects', 'setBackend', 'importComposition', 'newEffect', 'loadEffect']) {
        assert.equal(catalog[name].remote, false, name)
    }

    // A read command.
    const state = await agent.request('getState', {}, { to: tab })
    assert.equal(state.envelope.ok, true)
    assert.equal(state.envelope.result.schemaVersion, '1.0')

    // A program change shows in the page and in the session document.
    const set = await agent.request('setProgram', { dsl: VALID }, { to: tab })
    assert.equal(set.envelope.ok, true, JSON.stringify(set.envelope.error))
    assert.equal(await page.evaluate(() => document.getElementById('dsl-editor').value), VALID)
    await poll(() => agent.docs.get('main')?.text, text => text === VALID, { label: 'the session program' })
    assert.equal((await agent.request('getProgram', {}, { to: tab })).envelope.result.running, true)

    // An invalid program is refused and changes nothing.
    const refused = await agent.request('setProgram', { dsl: 'search synth\nnoise(mixAmt: 3).write(o0)\nrender(o0)' }, { to: tab })
    assert.equal(refused.envelope.ok, false)
    assert.equal(refused.envelope.error.code, 'INVALID_PROGRAM')
    assert.ok(refused.envelope.error.details.diagnostics.some(d => d.severity === 'error'))
    assert.equal(await page.evaluate(() => document.getElementById('dsl-editor').value), VALID)

    // Through the session an agent reads what the session holds, not text the
    // person has in the editor and has not run.
    await page.evaluate(() => { document.getElementById('dsl-editor').value = 'search synth\n// a private draft\n' })
    assert.equal((await agent.request('getProgram', {}, { to: tab })).envelope.result.dsl, VALID)
    await page.evaluate(dsl => { document.getElementById('dsl-editor').value = dsl }, VALID)

    // A custom effect moves in as a Portable effect, runs, and comes back out
    // of the session's effect document.
    const custom = await agent.request('setProgram', { dsl: 'search user\nredfx().write(o0)\nrender(o0)', effect: RED_EFFECT }, { to: tab })
    assert.equal(custom.envelope.ok, true, JSON.stringify(custom.envelope.error))
    await poll(() => centerPixel(page), pixel => pixel[0] > 240 && pixel[1] < 16 && pixel[2] < 16, { label: 'a red canvas' })
    const program = await agent.request('getProgram', {}, { to: tab })
    assert.equal(program.envelope.result.effect.func, 'redfx')
    assert.equal(program.envelope.result.effect.shaders.redfx.glsl, RED_EFFECT.shaders.redfx.glsl)
    assert.equal(JSON.parse(agent.docs.get('effect').text).func, 'redfx')
    const shader = await agent.request('readFile', { path: 'glsl/redfx.glsl' }, { to: tab })
    assert.equal(shader.envelope.result.content, RED_EFFECT.shaders.redfx.glsl)
    assert.equal(await page.evaluate(() => window.effectWorkspace.workspaceStore.getFile('glsl/redfx.glsl')), RED_EFFECT.shaders.redfx.glsl)

    // getThumbnail arrives as an uploaded PNG named by its SHA-256.
    const look = await agent.request('getThumbnail', { maxDimension: 48, format: 'png' }, { to: tab })
    assert.equal(look.envelope.ok, true, JSON.stringify(look.envelope.error))
    const shot = look.envelope.result
    assert.equal(shot.mimeType, 'image/png')
    assert.equal(Math.max(shot.width, shot.height), 48)
    assert.equal(shot.bytes, undefined)
    const frame = await agent.downloadImage(shot.image.id)
    assert.equal(frame.bytes.subarray(1, 4).toString(), 'PNG')
    assert.equal(digest(frame.bytes), shot.image.id)
    assert.ok(uploads.some(upload => upload.type === 'image/png' && (upload.body === null || upload.body.equals(frame.bytes))))
    assert.deepEqual(ownerSent.filter(text => text.includes(frame.bytes.toString('base64')) || /data:image|[A-Za-z0-9+/]{200,}/.test(text)), [])

    // An image the agent adds to the session reaches the program as bytes.
    const blue = png(2048, [0, 0, 255])
    const stored = await agent.uploadImage(blue, 'image/png')
    assert.equal(stored.id, digest(blue))
    const media = await agent.request('setProgram', { dsl: `search synth\nmedia(url: "image:${stored.id}").write(o0)\nrender(o0)` }, { to: tab })
    assert.equal(media.envelope.ok, true, JSON.stringify(media.envelope.error))
    assert.equal(media.envelope.warnings, undefined)
    await poll(() => centerPixel(page), pixel => pixel[2] > 240 && pixel[0] < 16 && pixel[1] < 16, { label: 'a blue canvas' })

    // An image never crosses the session as text.
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
    const asText = await agent.request('setProgram', { dsl: `search synth\nmedia(url: "${pixel}").write(o0)\nrender(o0)` }, { to: tab })
    assert.equal(asText.envelope.error.code, 'IMAGE_AS_TEXT')
    // Nor does a session make the person's browser fetch an outside link.
    const linked = await agent.request('setProgram', { dsl: 'search synth\nmedia(url: "https://example.com/a.png").write(o0)\nrender(o0)' }, { to: tab })
    assert.equal(linked.envelope.error.code, 'OUTSIDE_LINK')

    // Commands that need the person at the browser stay in the tab. Starting
    // or loading an effect would replace the person's whole workspace (its
    // other files, its images, its undo history), so it stays there too.
    const files = () => page.evaluate(() => [...window.effectWorkspace.workspaceStore.files.keys()].sort())
    const workspaceBefore = await files()
    for (const [command, args] of [['exportZip', {}], ['listSavedEffects', {}], ['newEffect', { name: 'fresh' }], ['loadEffect', { effectId: 'synth/noise' }]]) {
        const answer = await agent.request(command, args, { to: tab })
        assert.equal(answer.envelope.error?.code, 'REMOTE_UNAVAILABLE', command)
    }
    assert.deepEqual(await files(), workspaceBefore)
    assert.equal((await agent.request('noSuchCommand', {}, { to: tab })).envelope.error.code, 'NOT_FOUND_COMMAND')

    // A second person opens the session link: they get the program, the custom
    // effect does not leave their own workspace empty, and only the owner's tab answers.
    const visitorSent = []
    const visitor = await open(`${origin}/?seance=${code}`, visitorSent)
    await poll(() => visitor.evaluate(() => document.getElementById('seanceDialog').state), value => value === 'online', { label: 'the visitor online' })
    await poll(() => visitor.evaluate(() => document.getElementById('dsl-editor').value), value => value.includes(stored.id), { label: 'the session program in the visitor tab' })
    await poll(() => visitor.evaluate(() => window.effectWorkspace.workspaceStore.getFile('glsl/redfx.glsl')), value => value === RED_EFFECT.shaders.redfx.glsl, { label: 'the session effect in the visitor workspace' })
    await poll(() => centerPixel(visitor), value => value[2] > 240 && value[0] < 16 && value[1] < 16, { label: 'the session image in the visitor tab' })
    const before = agent.ignored.length
    const everyone = await agent.request('describe')
    assert.equal(everyone.from, tab)
    assert.equal((await agent.request('getState', {}, { to: tab })).from, tab)
    assert.equal(agent.ignored.length, before)
    assert.deepEqual(visitorSent.filter(text => text.includes('nf-agent/1')), [])
    assert.ok(ownerSent.some(text => text.includes('nf-agent/1')))
    // Only the tab that took the session online offers "connect agent...".
    assert.equal(await connectAgentHidden(page), false)
    assert.equal(await connectAgentHidden(visitor), true)

    // The person's tab leaves. Seance makes another participant the owner; the
    // visitor's tab did not take the session online, so no tab answers.
    const firstOwner = agent.owner
    await page.context().close()
    await poll(() => agent.owner, owner => owner && owner !== firstOwner, { label: 'a new session owner' })
    await assert.rejects(agent.request('describe', {}, { timeoutMs: 3000 }), /No response to describe/)
    assert.deepEqual(visitorSent.filter(text => text.includes('nf-agent/1')), [])
})

test(`${BROWSER}: the tab that took the session online answers again after a reload`, { timeout: 300000 }, async t => {
    const { origin, agent, open } = await setUp(t)
    const page = await open(origin)
    const code = await goOnline(page)
    await agent.join(code)
    const first = (await agent.request('describe')).from
    await page.reload()
    await ready(page)
    await poll(() => page.evaluate(() => document.getElementById('seanceDialog').state), state => state === 'online', { label: 'the reloaded tab online' })
    const again = await poll(() => agent.request('describe', {}, { timeoutMs: 5000 }).catch(() => null), reply => reply && reply.from !== first, { label: 'an answer from the reloaded tab' })
    const state = await agent.request('getState', {}, { to: again.from })
    assert.equal(state.envelope.ok, true)
    assert.equal(state.from, again.from)
})

test(`${BROWSER}: connect agent walks the person through going online, copying the prompt and the agent joining`, { timeout: 300000 }, async t => {
    const { origin, seance, open } = await setUp(t)
    const page = await open(origin)
    assert.equal(await connectAgentHidden(page), false)
    // The prompt the dialog copies, as the person's clipboard receives it.
    await page.evaluate(() => {
        window.__copied = []
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => { window.__copied.push(text); return Promise.resolve() } } })
    })
    await page.evaluate(() => document.getElementById('connectAgentMenuItem').click())
    const dialog = page.locator('#agentConnectDialog dialog')
    await dialog.waitFor({ state: 'visible' })
    const states = () => dialog.locator('.hf-agent-step').evaluateAll(items => items.map(item => item.dataset.state))
    assert.deepEqual(await states(), ['active', 'pending', 'pending'])

    await dialog.locator('[data-action="go-online"]').click()
    await poll(states, value => value.join() === 'done,active,pending', { label: 'the Go Online step done' })
    const code = new URL(page.url()).searchParams.get('seance')
    assert.ok(code)

    await dialog.locator('[data-action="copy-prompt"]').click()
    await poll(states, value => value.join() === 'done,done,active', { label: 'the Copy Prompt step done' })
    const [prompt] = await page.evaluate(() => window.__copied)
    // The shared wording comes from handfish; the app gives it its contract and the session link.
    const expected = await page.evaluate(([contractUrl, sessionUrl]) => import('handfish').then(handfish =>
        handfish.agentConnectPrompt({ app: 'Foundry', contractUrl, sessionUrl })), ['https://foundry.noisedeck.app/llms-full.txt', `${origin}/?seance=${code}`])
    assert.equal(prompt, expected)
    assert.ok(prompt.includes('https://foundry.noisedeck.app/llms-full.txt') && prompt.includes(`${origin}/?seance=${code}`))

    // The agent runs the prompt's last line in a shell, as written; its first
    // request confirms it.
    const tool = runJoinLine(prompt.trim().split('\n').at(-1), { server: seance.url, origin })
    t.after(tool.stop)
    const joined = await tool.joined
    assert.equal(joined.result.code, code)
    assert.equal(joined.result.app, 'foundry')
    await poll(states, value => value.join() === 'done,done,done', { label: 'the Confirm step done' })
    await dialog.waitFor({ state: 'hidden', timeout: 10000 })
    await toastShown(page, 'Agent connected')
    // The open dialog confirmed the agent; the app did not confirm it twice.
    assert.deepEqual((await page.evaluate(() => window.__toasts)).filter(text => text === 'Agent connected'), ['Agent connected'])
})
