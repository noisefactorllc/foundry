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
        request.onsuccess = () => resolve(request.result)

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
 * Save workspace to IndexedDB
 * @param {import('./workspace-store.js').WorkspaceStore} store - Workspace store
 * @param {string} [id='current'] - Workspace ID
 * @returns {Promise<void>}
 */
export async function saveWorkspace(store, id = CURRENT_KEY) {
    const db = await openDB()

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const objectStore = tx.objectStore(STORE_NAME)

        // Convert Map to object for storage
        const filesObj = {}
        for (const [path, content] of store.files) {
            filesObj[path] = content
        }

        const data = {
            id,
            name: store.name,
            files: filesObj,
            savedAt: Date.now()
        }

        const request = objectStore.put(data)

        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            db.close()
            resolve()
        }
    })
}

/**
 * Load workspace from IndexedDB
 * @param {import('./workspace-store.js').WorkspaceStore} store - Workspace store
 * @param {string} [id='current'] - Workspace ID
 * @returns {Promise<boolean>} Whether a workspace was loaded
 */
export async function loadWorkspace(store, id = CURRENT_KEY) {
    const db = await openDB()

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const objectStore = tx.objectStore(STORE_NAME)

        const request = objectStore.get(id)

        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            db.close()

            const data = request.result
            if (!data) {
                resolve(false)
                return
            }

            store.fromObject(data.files, data.name)
            resolve(true)
        }
    })
}

/**
 * Delete workspace from IndexedDB
 * @param {string} [id='current'] - Workspace ID
 * @returns {Promise<void>}
 */
export async function deleteWorkspace(id = CURRENT_KEY) {
    const db = await openDB()

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const objectStore = tx.objectStore(STORE_NAME)

        const request = objectStore.delete(id)

        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            db.close()
            resolve()
        }
    })
}

/**
 * List all saved workspaces
 * @returns {Promise<Array<{id: string, name: string, savedAt: number}>>}
 */
export async function listWorkspaces() {
    const db = await openDB()

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const objectStore = tx.objectStore(STORE_NAME)

        const request = objectStore.getAll()

        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            db.close()
            resolve(request.result.map(w => ({
                id: w.id,
                name: w.name,
                savedAt: w.savedAt
            })))
        }
    })
}

/**
 * Check if IndexedDB is available
 * @returns {boolean}
 */
export function isIndexedDBAvailable() {
    return typeof indexedDB !== 'undefined'
}
