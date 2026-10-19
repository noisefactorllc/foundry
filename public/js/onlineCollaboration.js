/**
 * Foundry <-> Seance online collaboration.
 *
 * "go online..." takes the work online as one Seance session in the default
 * `noisemaker-dsl` dialect, so Noisedeck, Polymorphic and Visualize tabs can
 * join a Foundry session and Foundry can join theirs. The session holds two
 * documents:
 *   - `main` (default): the program, as DSL text.
 *   - `effect`: the workspace's custom effect, as Portable effect JSON (empty
 *     when the workspace has none). Apps that know only `main` leave it alone.
 * An agent in the session reaches this tab through the agent relay
 * (js/agent/relay.js), which rides the SDK's own socket; only the tab that took
 * the session online answers it.
 *
 * Images are images: the images a program names as `image:<sha256>` go to the
 * session as their own bytes, and images the session holds come back as Blobs.
 * A program that arrives from the session never makes this tab upload an image
 * that only the person's own storage holds.
 *
 * @module onlineCollaboration
 */

export const DEFAULT_SEANCE_URL = 'https://seance.noisefactor.io'
// Bypass browsers that cached the older alias without Cache-Control, and SDKs
// from before seed images could be Blobs.
export const DEFAULT_SEANCE_SDK_URL = 'https://seance.noisefactor.io/sdk/0/index.js?v=images-20261006'
export const PROGRAM_DOC = 'main'
export const EFFECT_DOC = 'effect'
const IMAGE_REF = /image:([a-f0-9]{64})/g

/** The image ids a program names as `image:<sha256>`, in order, once each. */
export function imageIds(dsl) {
    return [...new Set([...String(dsl || '').matchAll(IMAGE_REF)].map(match => match[1]))]
}

/**
 * Copy for a server refusal, chosen by the wire `code`, never by message text.
 * `forbidden` covers several situations that share one code, so its `detail`
 * refines the wording, and only the wording.
 *
 * @param {Object} frame - error frame or Error carrying `.code` / `.frame`
 * @returns {string|null} copy for the person, or null when this is not a refusal
 */
export function refusalMessage(frame) {
    const code = frame?.code || frame?.frame?.code
    const detail = String(frame?.detail || frame?.frame?.detail || '')
    switch (code) {
        case 'unknown_session':
            return 'that session has expired or does not exist'
        case 'dialect_mismatch':
            return 'that session belongs to a different app'
        case 'unauthorized':
            return 'that session did not accept your identity'
        case 'forbidden':
            if (detail.includes('roster full') || detail.includes('too many connections')) return 'that session is full'
            if (detail.includes('locked')) return 'that session is locked'
            if (detail.includes('banned')) return 'you cannot rejoin that session'
            return 'that session refused the connection'
        default:
            return null
    }
}

/**
 * @param {object} options
 * @param {HTMLElement} options.dialog - The handfish <seance-dialog>.
 * @param {(message: string, type?: string) => void} options.notify - Shows a notice.
 * @param {() => string} options.getDsl - The program text.
 * @param {(text: string) => void} options.setDsl - Puts program text in the editor without compiling.
 * @param {() => string} options.getEffectText - The workspace's custom effect as Portable effect JSON, or ''.
 * @param {(text: string) => void} options.setEffectText - Puts a Portable effect's JSON in the workspace.
 * @param {(options: {remote: boolean}) => Promise<object>} options.compile - Compiles the editor's program.
 * @param {() => Array<{id: string, blob: Blob}>} options.heldImages - The image records this tab has.
 * @param {(records: Array<object>) => void} options.addImages - Keeps image records the session sent.
 * @param {(options: object) => ({WebSocket: typeof WebSocket, sessionCreated: (id: string) => void} | null)} [options.createAgentRelay]
 */
export function createOnlineCollaboration({ dialog, notify, getDsl, setDsl, getEffectText, setEffectText, compile, heldImages, addImages, createAgentRelay }) {
    const config = globalThis.__FOUNDRY_SEANCE_CONFIG__ || {}
    const sdkUrl = config.sdkUrl || DEFAULT_SEANCE_SDK_URL
    const seanceUrl = config.seanceUrl || DEFAULT_SEANCE_URL
    let online = null
    let agentRelay = null
    let layerPromise = null
    let intent = 0
    let busy = false
    let refusalShown = false
    let sdkReportsDisconnect = false
    const uploaded = new Set()
    // The documents the joined session has, and the text this tab last saw or
    // sent for each: what an agent in the session reads.
    let sessionDocs = null
    const sessionText = new Map()
    // Remote changes apply newest first: a rebuild costs more than a peer's typing rate.
    let pending = null
    let applying = null

    const status = () => online?.getStatus?.() || 'offline'
    const connected = () => ['online', 'readonly'].includes(status())

    function sync() {
        if (!dialog) return
        const state = status()
        const shown = state === 'online' || state === 'readonly'
        dialog.state = shown ? state : (state === 'connecting' ? 'connecting' : 'offline')
        dialog.sessionId = shown ? (online?.getSessionId?.() || '') : ''
        dialog.sessionUrl = shown ? (online?.getShareUrl?.() || '') : ''
    }

    function writeUrl(sessionId) {
        if (!online?.writeSessionToUrl) return
        try {
            history.replaceState(null, '', online.writeSessionToUrl(location, sessionId || null))
        } catch (err) {
            console.warn('[Seance] failed to update the address bar', err)
        }
    }

    // The program is the session's default document: `main` in sessions that
    // Foundry, Noisedeck or Polymorphic made, deck A in Visualize's.
    function adoptDocs(docs) {
        if (!Array.isArray(docs)) return
        sessionDocs = new Set(docs.map(doc => doc?.id).filter(Boolean))
        const program = docs.find(doc => doc?.id === PROGRAM_DOC) || docs.find(doc => doc?.default) || docs[0]
        if (typeof program?.text === 'string') sessionText.set(PROGRAM_DOC, program.text)
        const effect = docs.find(doc => doc?.id === EFFECT_DOC)
        if (typeof effect?.text === 'string') sessionText.set(EFFECT_DOC, effect.text)
    }

    /** Fetch the session's copy of every image `dsl` names that this tab does not hold. */
    async function resolveImages(dsl) {
        const held = new Set(heldImages().map(image => image.id))
        const missing = []
        const found = []
        for (const id of imageIds(dsl).filter(id => !held.has(id))) {
            if (!online || !connected()) {
                missing.push(id)
                continue
            }
            try {
                const blob = await online.getImage(id)
                found.push({ id, blob, mimeType: blob.type })
                uploaded.add(id)
            } catch (err) {
                console.warn(`[Seance] image ${id} is not in the session`, err)
                missing.push(id)
            }
        }
        if (found.length) addImages(found)
        return { missing }
    }

    // The images `dsl` names that this tab holds and the session does not have yet.
    function unsentImages(dsl) {
        const ids = new Set(imageIds(dsl))
        return heldImages().filter(image => ids.has(image.id) && image.blob instanceof Blob && !uploaded.has(image.id))
    }

    function queueRemote(change) {
        pending = { ...pending, ...change }
        if (!applying) {
            applying = (async () => {
                while (pending) {
                    const next = pending
                    pending = null
                    try {
                        if (typeof next.effect === 'string' && next.effect.trim()) setEffectText(next.effect)
                        await resolveImages(getDsl())
                        const outcome = await compile({ remote: true })
                        if (!outcome?.success) console.warn('[Seance] the session program did not compile; the last program keeps running', outcome?.error)
                    } catch (err) {
                        console.error('[Seance] failed to apply the session program', err)
                    }
                }
            })().finally(() => { applying = null })
        }
        return applying
    }

    async function ensureLayer() {
        if (online) return online
        if (!layerPromise) {
            layerPromise = import(sdkUrl).then(sdk => {
                if (online) return online
                // An agent in the session reaches this tab over the SDK's own
                // socket: the app wraps the socket class the SDK would use.
                agentRelay = createAgentRelay?.({ uploadImage: blob => online.uploadImage(blob) }) || null
                online = sdk.createOnlineDslLayer({
                    seanceUrl,
                    location,
                    publicAppUrl: location.href,
                    ...(agentRelay ? { WebSocket: agentRelay.WebSocket } : {}),
                })
                online.on('status', sync)
                online.on('snapshot', info => {
                    adoptDocs(info?.docs)
                    sync()
                })
                online.on('disconnect', info => {
                    sdkReportsDisconnect = true
                    const message = refusalMessage(info) || refusalMessage(info?.error)
                    if (message && !refusalShown) {
                        refusalShown = true
                        notify(message, 'error')
                    }
                    sync()
                })
                online.on('error', err => {
                    console.warn('[Seance]', err?.message || err)
                    const message = refusalMessage(err)
                    if (message && status() === 'connecting') {
                        // A refused join is terminal; the deployed SDK retries it.
                        // Stop, and say why once.
                        if (!sdkReportsDisconnect) online.goOffline?.()
                        if (!refusalShown) {
                            refusalShown = true
                            notify(message, 'error')
                        }
                    }
                    sync()
                })
                // No docId: the program binds to whatever document the session
                // calls default, so Foundry also joins a Visualize session.
                online.bindEditor({
                    editor: document.getElementById('dsl-editor'),
                    getText: () => getDsl(),
                    setText: text => setDsl(text),
                    onRemoteText: text => {
                        sessionText.set(PROGRAM_DOC, text)
                        queueRemote({ dsl: true })
                    },
                })
                // The custom effect's document has no editor of its own; a
                // detached element stands in for one.
                online.bindEditor({
                    docId: EFFECT_DOC,
                    editor: document.createElement('textarea'),
                    getText: () => sessionText.get(EFFECT_DOC) ?? getEffectText(),
                    setText: () => {},
                    onRemoteText: text => {
                        sessionText.set(EFFECT_DOC, text)
                        queueRemote({ effect: text })
                    },
                })
                sync()
                return online
            }).catch(err => {
                layerPromise = null
                throw err
            })
        }
        return layerPromise
    }

    async function takeOnline() {
        if (busy) return null
        busy = true
        const mine = ++intent
        refusalShown = false
        try {
            const layer = await ensureLayer()
            if (mine !== intent) return null
            const dsl = getDsl()
            const effect = getEffectText()
            const images = unsentImages(dsl)
            const docs = [
                { id: PROGRAM_DOC, title: 'Program', kind: 'noisemaker-dsl', text: dsl, default: true },
                { id: EFFECT_DOC, title: 'Custom effect', kind: 'portable-effect', text: effect, default: false },
            ]
            const result = await layer.takeOnline(images.length ? { docs, images } : docs)
            if (mine !== intent) return null
            agentRelay?.sessionCreated(layer.getSessionId?.())
            adoptDocs(docs)
            for (const image of images) uploaded.add(image.id)
            writeUrl(layer.getSessionId?.())
            sync()
            notify('online session ready', 'success')
            return result
        } catch (err) {
            console.error('[Seance] take online failed', err)
            if (!refusalShown) notify(`online failed: ${refusalMessage(err) || err?.message || err}`, 'error')
            return null
        } finally {
            busy = false
        }
    }

    async function joinSession(sessionId) {
        const id = String(sessionId || '').trim()
        if (!id || busy) return null
        busy = true
        const mine = ++intent
        refusalShown = false
        try {
            const layer = await ensureLayer()
            if (mine !== intent) return null
            const result = await layer.joinSession(id)
            if (mine !== intent) return null
            const docs = Array.isArray(result?.docs) ? result.docs : []
            adoptDocs(docs)
            const program = sessionText.get(PROGRAM_DOC)
            const effect = sessionText.get(EFFECT_DOC)
            if (typeof program === 'string' && program !== getDsl()) setDsl(program)
            await queueRemote({ dsl: true, ...(effect ? { effect } : {}) })
            writeUrl(id)
            sync()
            notify(`joined online session ${id}`, 'success')
            return result
        } catch (err) {
            console.error('[Seance] join failed', err)
            if (!refusalShown) notify(`join failed: ${refusalMessage(err) || err?.message || err}`, 'error')
            return null
        } finally {
            busy = false
        }
    }

    async function joinFromUrlIfPresent() {
        const id = new URL(location.href).searchParams.get('seance')
        return id ? joinSession(id) : null
    }

    function goOffline() {
        intent += 1
        pending = null
        uploaded.clear()
        sessionDocs = null
        sessionText.clear()
        if (online) online.goOffline()
        writeUrl(null)
        sync()
        notify('online session closed', 'info')
    }

    /**
     * Send the program and the custom effect as they now stand to the session.
     * With `uploadImages`, the images the program names go first, as bytes; a
     * change that came from the session sends none of the person's own images.
     */
    async function publish({ uploadImages = true } = {}) {
        if (status() !== 'online') return
        try {
            const dsl = getDsl()
            if (uploadImages) {
                for (const image of unsentImages(dsl)) {
                    await online.uploadImage(image.blob)
                    uploaded.add(image.id)
                }
            }
            if (status() !== 'online') return
            online.updateLocalText(undefined, dsl, { source: 'local' })
            sessionText.set(PROGRAM_DOC, dsl)
            if (sessionDocs?.has(EFFECT_DOC)) {
                const effect = getEffectText()
                online.updateLocalText(EFFECT_DOC, effect, { source: 'local' })
                sessionText.set(EFFECT_DOC, effect)
            }
        } catch (err) {
            console.warn('[Seance] could not send the program to the session', err)
        }
    }

    dialog?.addEventListener('take-online', () => { takeOnline() })
    dialog?.addEventListener('join-session', event => { joinSession(event.detail?.sessionId) })
    dialog?.addEventListener('go-offline', () => goOffline())
    dialog?.addEventListener('copy-url', async event => {
        const url = event.detail?.sessionUrl || online?.getShareUrl?.()
        if (!url) return
        try {
            await navigator.clipboard.writeText(url)
            notify('online URL copied', 'success')
        } catch {
            notify(url, 'info')
        }
    })
    sync()

    return {
        takeOnline,
        joinSession,
        joinFromUrlIfPresent,
        goOffline,
        publish,
        resolveImages,
        /** The session's text of a document, as this tab last saw or sent it; null offline. */
        sessionText: docId => (connected() ? sessionText.get(docId) ?? null : null),
        getOnlineLayer: () => online,
        getStatus: status,
    }
}
