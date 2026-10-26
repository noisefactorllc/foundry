import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))

test('the browser starts and exports a ZIP using only local and Noise Factor runtime assets', { timeout: 120000 }, async () => {
    const reservation = createServer().listen(0, '127.0.0.1')
    await new Promise(resolve => reservation.once('listening', resolve))
    const port = reservation.address().port
    await new Promise(resolve => reservation.close(resolve))
    const origin = `http://127.0.0.1:${port}`
    const server = spawn(process.execPath, ['server/index.js'], {
        cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore',
    })
    let browser
    try {
        let ready = false
        for (let attempt = 0; attempt < 100; attempt++) {
            if (await fetch(`${origin}/health`).then(response => response.ok).catch(() => false)) { ready = true; break }
            if (server.exitCode !== null) throw new Error('Foundry exited before becoming ready')
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        assert.ok(ready, 'Foundry server did not become ready')
        browser = await chromium.launch({ headless: true, args: process.platform === 'darwin'
            ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
            : ['--enable-unsafe-swiftshader'] })
        const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
        const errors = [], externalHosts = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('request', request => {
            const url = new URL(request.url())
            if (!['http:', 'https:'].includes(url.protocol)) return
            if (url.origin === origin) return
            if (['noisefactor.io', 'noisedeck.app'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return
            externalHosts.push(url.hostname)
        })
        const revision = 'a'.repeat(40)
        await page.route(`${origin}/deployment-meta.json`, route => route.fulfill({
            contentType: 'application/json', body: JSON.stringify({ git_hash: revision, date: 1 }),
        }))
        await page.goto(origin, { waitUntil: 'networkidle' })
        await page.waitForFunction(() => window.effectWorkspace && document.getElementById('loading-screen')?.classList.contains('hidden'))
        const startup = await page.evaluate(async () => {
            await window.FoundryAgent.ready
            return window.FoundryAgent.getState()
        })
        assert.equal(startup.ok, true)
        assert.equal(startup.state.compile?.ok, true, startup.state.compile?.error)
        assert.equal(startup.state.program.running, true)
        assert.ok(startup.state.canvas.width > 0 && startup.state.canvas.height > 0)
        await page.evaluate(async () => {
            const { aboutModal } = await import('/js/ui/about-modal.js')
            aboutModal.open()
        })
        await page.locator(`a[href="https://github.com/noisefactorllc/foundry/tree/${revision.slice(0, 8)}"]`).waitFor({ state: 'visible' })
        await page.keyboard.press('Escape')
        const zipResponse = page.waitForResponse(response => response.url() === `${origin}/js/lib/jszip.min.js` && response.status() === 200)
        const downloaded = page.waitForEvent('download')
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+e' : 'Control+e')
        await zipResponse
        const download = await downloaded
        const chunks = []
        for await (const chunk of await download.createReadStream()) chunks.push(chunk)
        const bytes = Buffer.concat(chunks)
        assert.equal(bytes.readUInt32LE(0), 0x04034b50, 'export is a ZIP archive')
        const entries = await page.evaluate(async bytes => {
            const zip = await window.JSZip.loadAsync(new Uint8Array(bytes))
            return Object.keys(zip.files)
        }, [...bytes])
        assert.ok(entries.includes('effect.dsl'), 'export contains the current program')
        assert.deepEqual(errors, [])
        assert.deepEqual(externalHosts, [])
    } finally {
        await browser?.close()
        if (server.exitCode === null) {
            const stopped = new Promise(resolve => server.once('exit', resolve))
            server.kill('SIGTERM')
            await stopped
        }
    }
})
