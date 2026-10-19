// A real local Seance server for the agent relay spec, and an agent that joins
// its sessions from Node the way the shared agent tool does.
//
// SEANCE_ROOT is a Seance checkout (default ../seance), SEANCE_PYTHON the
// Python that runs it, and SEANCE_DIST_DIR the browser SDK bundle that the
// app's SDK URL is answered with.
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const FOUNDRY = fileURLToPath(new URL('..', import.meta.url))
const seanceRoot = resolve(process.env.SEANCE_ROOT || join(FOUNDRY, '../seance'))
const seanceDist = resolve(process.env.SEANCE_DIST_DIR || join(seanceRoot, 'dist'))
const seancePython = process.env.SEANCE_PYTHON || join(seanceRoot, '.venv/bin/python')
const SDK_PREFIX = 'https://seance.noisefactor.io/sdk/0/'

export const freePort = () => new Promise((done, fail) => {
    const server = createServer().once('error', fail).listen(0, '127.0.0.1', () => {
        const { port } = server.address()
        server.close(() => done(port))
    })
})

/** Poll `read` until `accept` takes its value, or fail after `timeout` ms. */
export async function poll(read, accept = Boolean, { timeout = 30000, interval = 100, label = 'condition' } = {}) {
    const deadline = Date.now() + timeout
    let last
    for (;;) {
        last = await read()
        if (accept(last)) return last
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(last)?.slice(0, 500)}`)
        await new Promise(done => setTimeout(done, interval))
    }
}

/** Start a Seance server that accepts pages and agents from `origins`. */
export async function startSeanceServer({ origins }) {
    if (!existsSync(join(seanceDist, 'index.js')) || !existsSync(seancePython)) {
        throw new Error('Set SEANCE_ROOT, SEANCE_DIST_DIR and SEANCE_PYTHON to a local Seance build for this integration test.')
    }
    const port = await freePort()
    const directory = mkdtempSync(join(tmpdir(), 'foundry-seance-'))
    const proc = spawn(seancePython, [join(seanceRoot, 'bin/app.py')], {
        cwd: seanceRoot,
        env: {
            ...process.env,
            PYTHONPATH: [seanceRoot, process.env.PYTHONPATH].filter(Boolean).join(':'),
            SEANCE_BIND: `127.0.0.1:${port}`,
            SEANCE_SECRET: randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
            SEANCE_DB: join(directory, 'seance.db'),
            SEANCE_ALLOWED_ORIGINS: origins.join(','),
            SEANCE_TRUSTED_PROXIES: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let logs = ''
    proc.stdout.on('data', data => { logs += data })
    proc.stderr.on('data', data => { logs += data })
    const url = `http://127.0.0.1:${port}`
    const stop = async () => {
        if (proc.exitCode === null) {
            proc.kill('SIGTERM')
            await new Promise(done => {
                const timer = setTimeout(() => { proc.kill('SIGKILL'); done() }, 1500)
                proc.once('exit', () => { clearTimeout(timer); done() })
            })
        }
        rmSync(directory, { recursive: true, force: true })
    }
    try {
        await poll(async () => {
            if (proc.exitCode !== null) throw new Error(`Seance startup failed: ${logs}`)
            return fetch(`${url}/up`, { signal: AbortSignal.timeout(1000) }).then(response => response.ok, () => false)
        }, Boolean, { timeout: 15000, label: 'the Seance server' })
        return { url, stop }
    } catch (error) {
        await stop()
        throw error
    }
}

/** Point a page's online session at a local Seance server, with the SDK bundle from SEANCE_DIST_DIR. */
export async function routeSeance(page, url) {
    await page.addInitScript(seanceUrl => { window.__FOUNDRY_SEANCE_CONFIG__ = { seanceUrl } }, url)
    await page.route(`${SDK_PREFIX}**`, route => {
        const relative = new URL(route.request().url()).pathname.slice('/sdk/0/'.length)
        const file = resolve(seanceDist, relative)
        if (!file.startsWith(`${seanceDist}${sep}`) || !existsSync(file)) return route.fulfill({ status: 404 })
        return route.fulfill({ path: file, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } })
    })
}

const RELAY = 'nf-agent/1'

/**
 * Joins a Seance session from Node as a software agent does, sends agent
 * relay requests to the app tab, and moves images as bytes through the
 * session's image endpoints. Like the shared agent tool, it trusts relay
 * frames only from the session owner, by the user id the server stamps on
 * each frame; `ignored` collects relay frames from anyone else, and `events`
 * collects announce and bye frames.
 */
export class SeanceAgentClient {
    constructor(server, origin) {
        this.server = server
        this.origin = origin
        this.events = []
        this.ignored = []
        this.owner = null
        this.docs = new Map()
        this._pending = new Map()
        this._partial = new Map()
        this._lastSend = 0
        this._token = null
    }

    async join(code) {
        const probe = await fetch(`${this.server}/v1/sessions/${encodeURIComponent(code)}`, { headers: { Origin: this.origin } })
        if (!probe.ok) throw new Error(`The session probe answered ${probe.status}`)
        this.sessionId = (await probe.json()).id
        this.ws = new WebSocket(`${this.server.replace(/^http/, 'ws')}/v1/sessions/${encodeURIComponent(this.sessionId)}/ws`, { headers: { Origin: this.origin } })
        await new Promise((done, fail) => {
            this.ws.addEventListener('open', () => this.ws.send(JSON.stringify({ type: 'hello', protocol: 1, dialects: ['noisemaker-dsl'] })))
            this.ws.addEventListener('message', event => {
                const frame = JSON.parse(String(event.data))
                this._handle(frame)
                if (frame.type === 'session-snapshot') done()
            })
            this.ws.addEventListener('close', event => fail(new Error(`The session closed the agent socket (${event.code})`)))
        })
    }

    _handle(frame) {
        if (frame.type === 'welcome') {
            if (frame.anon_token) this._token = frame.anon_token
            this.owner = frame.owner?.user_id || null
        }
        if (frame.type === 'owner-changed') this.owner = frame.user_id || null
        if (frame.type === 'session-snapshot' || frame.type === 'doc-snapshot') {
            for (const doc of frame.docs || []) this.docs.set(doc.id, { text: doc.text, rev: doc.rev })
        }
        if (frame.type === 'doc-edit') {
            const doc = this.docs.get(frame.docId)
            const { start, end, text } = frame.edit || {}
            if (!doc || frame.rev !== doc.rev + 1) {
                this.ws.send(JSON.stringify({ type: 'session-state' }))
                return
            }
            this.docs.set(frame.docId, { text: doc.text.slice(0, start) + text + doc.text.slice(end), rev: frame.rev })
        }
        if (frame.type !== 'clicked-button' || frame.relay !== RELAY || frame.kind === 'request') return
        if (!this.owner || frame.user_id !== this.owner) {
            this.ignored.push(frame)
            return
        }
        const body = this._assemble(frame)
        if (body === undefined) return
        if (frame.kind === 'response') this._pending.get(frame.id)?.({ from: frame.from, app: frame.app, envelope: body })
        else this.events.push({ kind: frame.kind, from: frame.from, app: frame.app, body })
    }

    // A body too large for one frame arrives as JSON text slices.
    _assemble(frame) {
        if (frame.body !== undefined) return frame.body
        const key = `${frame.kind}:${frame.id}:${frame.from}`
        const entry = this._partial.get(key) || { slices: new Array(frame.parts), count: 0 }
        if (entry.slices[frame.part] === undefined) entry.count += 1
        entry.slices[frame.part] = frame.chunk
        this._partial.set(key, entry)
        if (entry.count < frame.parts) return undefined
        this._partial.delete(key)
        return JSON.parse(entry.slices.join(''))
    }

    /** Send one relay request and resolve with the first response. */
    async request(command, args = {}, { to = '*', timeoutMs = 60000 } = {}) {
        // The control lane refills five frames a second.
        const wait = this._lastSend + 250 - Date.now()
        if (wait > 0) await new Promise(done => setTimeout(done, wait))
        this._lastSend = Date.now()
        const id = randomUUID()
        return new Promise((done, fail) => {
            const timer = setTimeout(() => {
                this._pending.delete(id)
                fail(new Error(`No response to ${command} within ${timeoutMs} ms`))
            }, timeoutMs)
            this._pending.set(id, reply => {
                clearTimeout(timer)
                this._pending.delete(id)
                done(reply)
            })
            this.ws.send(JSON.stringify({ type: 'clicked-button', relay: RELAY, kind: 'request', id, to, body: { command, args } }))
        })
    }

    _headers(extra = {}) {
        return { Origin: this.origin, ...(this._token ? { 'X-Seance-Anon': this._token } : {}), ...extra }
    }

    async uploadImage(bytes, mimeType) {
        const response = await fetch(`${this.server}/v1/sessions/${encodeURIComponent(this.sessionId)}/images`, {
            method: 'POST', headers: this._headers({ 'Content-Type': mimeType }), body: bytes,
        })
        if (!response.ok) throw new Error(`The image upload answered ${response.status}`)
        return response.json()
    }

    async downloadImage(id) {
        const response = await fetch(`${this.server}/v1/sessions/${encodeURIComponent(this.sessionId)}/images/${id}`, { headers: this._headers() })
        if (!response.ok) throw new Error(`The image download answered ${response.status}`)
        return { bytes: Buffer.from(await response.arrayBuffer()), mimeType: (response.headers.get('content-type') || '').split(';')[0] }
    }

    close() {
        try { this.ws?.close() } catch { /* already closed */ }
    }
}
