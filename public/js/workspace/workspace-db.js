/**
 * WorkspaceDB - IndexedDB persistence for WorkspaceStore
 *
 * Provides save/load functionality for the workspace using IndexedDB.
 * This allows the workspace to persist across browser sessions.
 *
 * @module workspace/workspace-db
 */

const DB_NAME = 'shade-workspace'
const DB_VERSION = 1
const STORE_NAME = 'workspaces'
const CURRENT_KEY = 'current'

/**
 * Open the IndexedDB database
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)

        request.onerror = () => reject(request.error)

        // If another tab/connection requests a version upgrade while this one is
        // open, the upgrade is BLOCKED until we close. Without a handler the
        // first DB_VERSION bump would hang every existing session forever.
        request.onblocked = () =>
            reject(new Error('IndexedDB upgrade blocked: another connection is holding an older version open'))

        request.onsuccess = () => {
            const db = request.result
            // Auto-close when another connection needs to upgrade the schema, so
            // we never block a future migration (and never serve a stale schema).
            db.onversionchange = () => db.close()
            resolve(db)
        }

        request.onupgradeneeded = (event) => {
            const db = event.target.result

            // Create workspaces store if it doesn't exist
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' })
            }
        }
    })
}

/**
 * Run a single transaction against the workspaces store, with correct
 * connection lifecycle: the DB is always closed afterwards (success OR
 * failure), and write transactions resolve on `tx.oncomplete` (durable commit)
 * rather than on the request's `onsuccess` (which fires before commit).
 *
 * @param {IDBTransactionMode} mode - 'readonly' or 'readwrite'
 * @param {(store: IDBObjectStore, capture: (value: any) => void) => void} run -
 *   Issues the request(s); call `capture(value)` to set the resolved value.
 * @returns {Promise<any>} Resolves with the captured value on tx completion.
 */
function withStore(mode, run) {
    return new Promise((resolve, reject) => {
        let settled = false
        let db = null
        const settle = (fn, arg) => {
            if (settled) return
            settled = true
            if (db) { try { db.close() } catch (_) { /* already closing */ } }
            fn(arg)
        }

        openDB().then((opened) => {
            db = opened
            let tx
            try {
                tx = db.transaction(STORE_NAME, mode)
            } catch (err) {
                settle(reject, err)
                return
            }

            let result
            tx.oncomplete = () => settle(resolve, result)
            tx.onerror = () => settle(reject, tx.error || new Error('IndexedDB transaction failed'))
            tx.onabort = () => settle(reject, tx.error || new Error('IndexedDB transaction aborted'))

            try {
                run(tx.objectStore(STORE_NAME), (value) => { result = value })
            } catch (err) {
                // Synchronous failures (e.g. DataCloneError from put()) don't
                // always abort the tx on their own — do it so the connection
                // closes and the promise rejects deterministically.
                try { tx.abort() } catch (_) { /* may already be aborting */ }
                settle(reject, err)
            }
        }).catch((err) => settle(reject, err))
    })
}

// The bytes of each image Blob this page has saved or loaded. The app saves
// once more as the page unloads, and WebKit refuses to read a Blob then.
const imageBytes = new WeakMap()

/** @param {Blob} blob @returns {Promise<ArrayBuffer>} */
async function bytesOf(blob) {
    let bytes = imageBytes.get(blob)
    if (!bytes) {
        bytes = await blob.arrayBuffer()
        imageBytes.set(blob, bytes)
    }
    return bytes
}

/**
 * The image records to store with a workspace: each holds its file's bytes in
 * an ArrayBuffer with its media type. WebKit's private browsing refuses a Blob
 * or File in IndexedDB but takes an ArrayBuffer. No image is stored as text.
 *
 * Every file is read here, before a transaction opens: awaiting inside one
 * would let it commit early.
 * @param {Array<object>} [images]
 * @returns {Promise<Array<{id: string, type: string, bytes: ArrayBuffer, mimeType?: string, width?: number, height?: number}>>}
 */
function storedImages(images) {
    return Promise.all((images || [])
        .filter(image => image?.blob instanceof Blob)
        .map(async ({ id, blob, mimeType, width, height }) => ({ id, type: blob.type, bytes: await bytesOf(blob), mimeType, width, height })))
}

/**
 * Stored image records as the Blob records a workspace holds. Records saved
 * earlier with a Blob are returned as they are.
 * @param {Array<object>} [images]
 * @returns {Array<object>|undefined}
 */
function loadedImages(images) {
    if (!Array.isArray(images)) return images
    return images.map(image => {
        if (!(image?.bytes instanceof ArrayBuffer)) return image
        const { bytes, type, ...record } = image
        const blob = new Blob([bytes], { type: type || record.mimeType || '' })
        imageBytes.set(blob, bytes)
        return { ...record, blob }
    })
}

/**
 * Save workspace to IndexedDB
 * @param {import('./workspace-store.js').WorkspaceStore} store - Workspace store
 * @param {string} [id='current'] - Workspace ID
 * @returns {Promise<void>}
 */
export async function saveWorkspace(store, id = CURRENT_KEY) {
    // Convert Map to object for storage
    const filesObj = {}
    for (const [path, content] of store.files) {
        filesObj[path] = content
    }

    const data = {
        id,
        name: store.name,
        files: filesObj,
        images: await storedImages(store.images),
        savedAt: Date.now()
    }

    await withStore('readwrite', (objectStore) => {
        objectStore.put(data)
    })
}

/**
 * Load workspace from IndexedDB
 *
 * Images are stored as their bytes and loaded as Blob records. A workspace
 * saved before images were files lists its images as base64 text in an
 * `images.json` file. Its images are read into Blob records, and the saved
 * workspace is rewritten with them as bytes.
 *
 * @param {import('./workspace-store.js').WorkspaceStore} store - Workspace store
 * @param {string} [id='current'] - Workspace ID
 * @returns {Promise<boolean>} Whether a workspace was loaded
 */
export async function loadWorkspace(store, id = CURRENT_KEY) {
    const data = await withStore('readonly', (objectStore, capture) => {
        const request = objectStore.get(id)
        request.onsuccess = () => capture(request.result)
    })

    if (!data) {
        return false
    }

    store.fromObject(data.files, data.name, loadedImages(data.images))
    if (data.files && Object.hasOwn(data.files, 'images.json')) {
        const { 'images.json': _imagesFile, ...files } = data.files
        try {
            const images = await storedImages(store.images)
            await withStore('readwrite', (objectStore) => {
                objectStore.put({ ...data, files, images })
            })
        } catch (err) {
            console.warn('[WorkspaceDB] Could not rewrite the workspace images as files:', err)
        }
    }
    return true
}

/**
 * Delete workspace from IndexedDB
 * @param {string} [id='current'] - Workspace ID
 * @returns {Promise<void>}
 */
export async function deleteWorkspace(id = CURRENT_KEY) {
    await withStore('readwrite', (objectStore) => {
        objectStore.delete(id)
    })
}

/**
 * List all saved workspaces
 * @returns {Promise<Array<{id: string, name: string, savedAt: number}>>}
 */
export async function listWorkspaces() {
    const all = await withStore('readonly', (objectStore, capture) => {
        const request = objectStore.getAll()
        request.onsuccess = () => capture(request.result)
    })

    return (all || []).map(w => ({
        id: w.id,
        name: w.name,
        savedAt: w.savedAt
    }))
}

/**
 * Check if IndexedDB is available
 * @returns {boolean}
 */
export function isIndexedDBAvailable() {
    return typeof indexedDB !== 'undefined'
}
