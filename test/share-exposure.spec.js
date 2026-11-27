// End-to-end: the sentence beside Share says what anyone with the link can
// open. It names the original images and custom shader code only when the
// share carries them, follows the program and the workspace while the dialog
// is open, and keeps what a running share carries until that share ends.
// Starts Foundry on a free local port. The test answers the share API's
// requests; the sharing service's image helper module loads as in the app.
// Run: node --test test/share-exposure.spec.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const FOUNDRY = fileURLToPath(new URL('..', import.meta.url))
const SENTENCE = {
    all: 'Anyone with the link can open the editable effect, including the original images and custom shader code it uses.',
    images: 'Anyone with the link can open the editable effect, including the original images it uses.',
    shaders: 'Anyone with the link can open the editable effect, including custom shader code it uses.',
    effect: 'Anyone with the link can open the editable effect.',
}
// A 1x1 PNG, inline, so the program names an image without a network request.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
const PLAIN = 'search synth\nsolid(color: #ffff00).write(o0)\nrender(o0)'
const PICTURE = `search synth\nmedia(url: "${PIXEL}").write(o0)\nrender(o0)`
const DEFINITION = JSON.stringify({ name: 'exposureProbe', func: 'exposureProbe', namespace: 'user', globals: {}, passes: [{ name: 'main', program: 'main', outputs: { fragColor: 'outputTex' } }] })
const SHADER = '#version 300 es\nprecision highp float;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(0.2, 0.4, 0.6, 1.0); }'

const freePort = () => new Promise((resolve, reject) => {
    const server = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
        const { port } = server.address()
        server.close(() => resolve(port))
    })
})

let foundry, browser, origin
test.before(async () => {
    const port = await freePort()
    origin = `http://127.0.0.1:${port}`
    foundry = spawn(process.execPath, ['server/index.js'], { cwd: FOUNDRY, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
    let ready = false
    for (let i = 0; i < 100 && !ready; i++) {
        ready = await fetch(`${origin}/health`).then(response => response.ok).catch(() => false)
        if (!ready) await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(ready, 'Foundry started')
    browser = await chromium.launch({
        headless: true,
        args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader']
    })
})

test.after(async () => {
    await browser?.close()
    if (foundry && foundry.exitCode === null) {
        await new Promise(resolve => { foundry.once('exit', resolve); foundry.kill('SIGTERM') })
    }
})

// A fresh page with an empty workspace and the given program. Each shorten
// request waits until the test answers it.
async function openFoundry(program) {
    const context = await browser.newContext()
    const held = []
    let arrived = () => {}
    await context.route('https://sharing.noisedeck.app/api/images', route => route.fulfill({ status: 201, json: { id: 'f'.repeat(64), url: 'unused', mimeType: 'image/jpeg', width: 1, height: 1 } }))
    await context.route('https://sharing.noisedeck.app/api/embed/shorten', route => { held.push(route); arrived() })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin)
    await page.waitForFunction(() => window.effectWorkspace && document.getElementById('loading-screen')?.classList.contains('hidden'), null, { timeout: 90000 })
    await page.evaluate(() => window.effectWorkspace.workspaceStore.clear())
    await setProgram(page, program)
    const nextShare = async () => {
        if (!held.length) await new Promise(resolve => { arrived = resolve })
        return held.shift()
    }
    const noErrors = () => assert.deepEqual(errors, [], 'no page errors')
    return { page, errors, noErrors, nextShare, close: () => context.close() }
}

// Compiles the program straight through the renderer and waits until that
// compile ends. It writes no workspace file.
async function setProgram(page, program) {
    const result = await page.evaluate(dsl => window.effectWorkspaceRenderer.compile(dsl), program)
    assert.equal(result?.success, true, `the program compiles: ${result?.error ?? ''}`)
}

// Opens the Share dialog. Its 250 ms check is captured instead of scheduled,
// so a test sees what the change notices alone do, and runs the check itself
// with runDialogCheck.
async function openShare(page) {
    await page.evaluate(() => {
        const schedule = window.setInterval
        window.__dialogChecks = []
        window.setInterval = (callback, ms, ...rest) => {
            if (ms !== 250) return schedule(callback, ms, ...rest)
            window.__dialogChecks.push(callback)
            return 0
        }
        window.__restoreInterval = () => { window.setInterval = schedule }
    })
    await page.getByText('effect', { exact: true }).first().click()
    await page.getByText('share publicly...', { exact: true }).first().click()
    await page.locator('#share-exposure').waitFor({ state: 'visible' })
    assert.equal(await page.evaluate(() => { window.__restoreInterval(); return window.__dialogChecks.length }), 1, 'the dialog schedules its check')
}
const runDialogCheck = page => page.evaluate(() => window.__dialogChecks.forEach(check => check()))

const sentence = page => page.locator('#share-exposure').textContent()
async function expectSentence(page, expected, label) {
    await page.waitForFunction(text => document.getElementById('share-exposure')?.textContent === text, expected, { timeout: 5000 })
        .catch(async () => assert.fail(`${label}: the sentence is ${JSON.stringify(await sentence(page))}`))
}
const writeEffect = page => page.evaluate(({ definition, shader }) => {
    const store = window.effectWorkspace.workspaceStore
    store.setFile('definition.json', definition)
    store.setFile('glsl/main.glsl', shader)
}, { definition: DEFINITION, shader: SHADER })

test('the sentence names only what the share carries', { timeout: 180000 }, async () => {
    const plain = await openFoundry(PLAIN)
    try {
        await openShare(plain.page)
        await expectSentence(plain.page, SENTENCE.effect, 'no image and no workspace effect')
        plain.noErrors()
    } finally { await plain.close() }

    const picture = await openFoundry(PICTURE)
    try {
        await openShare(picture.page)
        await expectSentence(picture.page, SENTENCE.images, 'a program with an image')
        picture.noErrors()
    } finally { await picture.close() }
})

test('the sentence follows the workspace and the program while the dialog is open', { timeout: 180000 }, async () => {
    const { page, noErrors, close } = await openFoundry(PLAIN)
    try {
        await openShare(page)
        await expectSentence(page, SENTENCE.effect, 'at open')
        // A check that finds no change writes nothing, so a selection in the sentence survives it.
        assert.equal(await page.evaluate(() => {
            const before = document.getElementById('share-exposure').firstChild
            window.__dialogChecks.forEach(check => check())
            return document.getElementById('share-exposure').firstChild === before
        }), true, 'a check with no change leaves the sentence as it is')
        await writeEffect(page)
        await expectSentence(page, SENTENCE.shaders, 'after the workspace gains an effect')
        await page.evaluate(() => window.effectWorkspace.workspaceStore.deleteFile('glsl/main.glsl'))
        await expectSentence(page, SENTENCE.effect, 'after the effect loses its shader')
        // A write that sends no change notice: the dialog's own check finds it.
        await page.evaluate(shader => window.effectWorkspace.workspaceStore.files.set('wgsl/main.wgsl', shader), SHADER)
        assert.equal(await sentence(page), SENTENCE.effect, 'no notice, so no change before the check')
        await runDialogCheck(page)
        await expectSentence(page, SENTENCE.shaders, 'after a write with no notice')
        // This compile writes no workspace file: the program's own events carry it.
        await setProgram(page, PICTURE)
        await expectSentence(page, SENTENCE.all, 'after the program names an image')
        noErrors()
    } finally { await close() }
})

test('a running share keeps what it carries, and a failed share follows again', { timeout: 180000 }, async () => {
    const { page, noErrors, nextShare, close } = await openFoundry(PLAIN)
    try {
        await openShare(page)
        await expectSentence(page, SENTENCE.effect, 'at open')
        await page.locator('#share-submit-btn').click()
        const share = await nextShare()
        assert.equal('effects' in share.request().postDataJSON(), false, 'this share packages no effect')
        // The workspace notice reaches the dialog inside setFile, and the
        // program's events inside the compile, so the sentence has heard both
        // changes when they return.
        await writeEffect(page)
        await setProgram(page, PICTURE)
        await runDialogCheck(page)
        assert.equal(await sentence(page), SENTENCE.effect, 'the running share keeps what it carries')
        await share.fulfill({ status: 503, json: { error: 'unavailable' } })
        await page.locator('#share-submit-btn:not([disabled])').waitFor()
        await expectSentence(page, SENTENCE.all, 'after the share failed')
        noErrors()
    } finally { await close() }
})

test('a dialog removed without its close stops following', { timeout: 180000 }, async () => {
    const { page, noErrors, close } = await openFoundry(PLAIN)
    try {
        // Open, close, and open again in the same task: the close stops the
        // first dialog's check at once, and its delayed removal then takes the
        // second dialog away, for which no close runs.
        const result = await page.evaluate(async () => {
            const { shareModal } = await import('/js/ui/share-modal.js')
            const store = window.effectWorkspace.workspaceStore
            const programState = window.effectWorkspaceRenderer.programState
            const schedule = window.setInterval, unschedule = window.clearInterval
            const subscribe = store.onChange, off = programState.off
            // Each stop the dialog makes: its check, its workspace listener,
            // and each program event listener.
            const checks = [], stopped = [], fakeIds = new Set([4241, 4242])
            let nextId = 4241
            window.setInterval = (callback, ms, ...rest) => {
                if (ms !== 250) return schedule(callback, ms, ...rest)
                checks.push(callback)
                return nextId++
            }
            window.clearInterval = id => {
                if (!fakeIds.has(id)) return unschedule(id)
                stopped.push(`check ${id}`)
            }
            store.onChange = function (callback) {
                const unsubscribe = subscribe.call(this, callback)
                return () => { stopped.push('workspace'); unsubscribe() }
            }
            programState.off = function (event, callback) {
                stopped.push(`program ${event}`)
                return off.call(this, event, callback)
            }
            const options = { dsl: '', canvas: document.getElementById('canvas'), renderer: window.effectWorkspaceRenderer }
            let reopened, atClose
            try {
                shareModal.open(options)
                shareModal.close()
                atClose = [...stopped]
                shareModal.open(options)
                reopened = shareModal.modal
            } finally {
                window.setInterval = schedule
                store.onChange = subscribe
            }
            await new Promise(resolve => {
                const gone = () => reopened.isConnected ? requestAnimationFrame(gone) : resolve()
                gone()
            })
            checks.forEach(check => check())
            window.clearInterval = unschedule
            programState.off = off
            return { atClose, afterRemoval: stopped.slice(atClose.length) }
        })
        const stops = id => [`check ${id}`, 'program change', 'program load', 'program stepchange', 'program structurechange', 'workspace']
        assert.deepEqual([...result.atClose].sort(), stops(4241), 'the close stops everything its dialog follows')
        assert.deepEqual([...result.afterRemoval].sort(), stops(4242), 'the removed dialog stops everything it follows')
        noErrors()
    } finally { await close() }
})

test('a share sends the program and effect it named at the click', { timeout: 180000 }, async () => {
    const { page, noErrors, nextShare, close } = await openFoundry(PLAIN)
    try {
        await openShare(page)
        await expectSentence(page, SENTENCE.effect, 'no image and no workspace effect')
        // The program gains an image with no event, and the workspace an effect
        // with no notice, before the dialog's check runs: the click itself reads
        // what the share carries.
        await page.evaluate(({ program, definition, shader }) => {
            window.effectWorkspaceRenderer.programState.toDsl = () => program
            const files = window.effectWorkspace.workspaceStore.files
            files.set('definition.json', definition)
            files.set('glsl/main.glsl', shader)
        }, { program: PICTURE, definition: DEFINITION, shader: SHADER })
        assert.equal(await sentence(page), SENTENCE.effect, 'no change before the click')
        await page.locator('#share-submit-btn').click()
        await expectSentence(page, SENTENCE.all, 'the click names what the share carries')
        const share = await nextShare()
        const payload = share.request().postDataJSON()
        assert.match(payload.dsl, /media\(url: "image:/, 'the share names its uploaded image')
        assert.equal(payload.effects?.length, 1, 'the share packages the workspace effect')
        await share.fulfill({ json: { shortUrl: 'https://sharing.noisedeck.app/s/probe' } })
        await page.locator('#share-url').waitFor({ state: 'visible' })
        noErrors()
    } finally { await close() }
})
