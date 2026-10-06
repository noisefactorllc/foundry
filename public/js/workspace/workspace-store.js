/**
 * WorkspaceStore - In-memory effect file store with history
 *
 * Manages the current effect workspace entirely client-side.
 * Files are stored in a Map and changes are tracked for undo/redo.
 *
 * @module workspace/workspace-store
 */

import { imageFileRecords, sameImages } from '../imageRecords.js'

// The file earlier workspaces and exported ZIPs list their images in.
const IMAGES_FILE = 'images.json'

/**
 * @typedef {Object} WorkspaceState
 * @property {string} name - Effect name
 * @property {Map<string, string>} files - File path -> content
 */

/**
 * @typedef {Object} HistoryEntry
 * @property {string} label - Description of the change
 * @property {Map<string, string>} files - Snapshot of all files
 * @property {Array<object>} images - Snapshot of the image records
 * @property {string} [dsl] - DSL source at this checkpoint
 * @property {object} [paramState] - ProgramState snapshot (serialized)
 * @property {number} timestamp - When the change was made
 */

/**
 * WorkspaceStore class
 *
 * @example
 * const store = new WorkspaceStore();
 * store.setFile('definition.js', 'export default {...}');
 * store.setFile('glsl/main.glsl', '#version 300 es...');
 * store.checkpoint('Initial setup');
 * store.undo();
 */
export class WorkspaceStore extends EventTarget {
    constructor() {
        super()

        /** @type {string} */
        this.name = ''

        /** @type {Map<string, string>} */
        this.files = new Map()

        /** @type {Array<object>} Image records; see `images` */
        this._images = []

        /** @type {HistoryEntry[]} */
        this.history = []

        /** @type {number} */
        this.historyIndex = -1

        /** @type {number} */
        this.maxHistory = 50
    }

    // =========================================================================
    // File Operations
    // =========================================================================

    /**
     * The images the program names as `image:<id>`, as `{ id, blob, mimeType,
     * width, height }` records that hold their bytes as Blobs. They share the
     * DSL's history and are saved with the workspace in IndexedDB as Blobs.
     * Assigned `{ id, dataUrl }` records, as earlier workspaces and shares
     * carry, are read into Blob records.
     * @type {Array<{id: string, blob: Blob, mimeType?: string, width?: number, height?: number}>}
     */
    get images() {
        return this._images
    }

    set images(images) {
        const next = imageFileRecords(images)
        if (sameImages(next, this._images)) return
        this._images = next
        this._dispatchChange('images-set', { count: next.length })
    }

    /**
     * Take the images that an earlier workspace or an exported ZIP lists in an
     * `images.json` file: the file is removed, and its `{ id, dataUrl }`
     * records are returned as Blob records. Images are never kept as a file.
     * @returns {Array<object>} The Blob records; empty when there is no file
     */
    takeImagesFile() {
        const content = this.files.get(IMAGES_FILE)
        if (content === undefined) return []
        this.files.delete(IMAGES_FILE)
        let listed
        try {
            listed = JSON.parse(content)
        } catch (error) {
            console.warn('[Workspace] images.json was not loaded:', error)
            return []
        }
        if (!Array.isArray(listed)) {
            console.warn('[Workspace] images.json was not loaded: not a list of images')
            return []
        }
        return imageFileRecords(listed)
    }

    /**
     * Get file content
     * @param {string} path - File path
     * @returns {string|undefined}
     */
    getFile(path) {
        return this.files.get(path)
    }

    /**
     * Set file content
     * @param {string} path - File path
     * @param {string} content - File content
     */
    setFile(path, content) {
        this.files.set(path, content)
        this._dispatchChange('file-set', { path, content })
    }

    /**
     * Delete a file
     * @param {string} path - File path
     * @returns {boolean} Whether the file existed
     */
    deleteFile(path) {
        const existed = this.files.delete(path)
        if (existed) {
            this._dispatchChange('file-delete', { path })
        }
        return existed
    }

    /**
     * Check if a file exists
     * @param {string} path - File path
     * @returns {boolean}
     */
    hasFile(path) {
        return this.files.has(path)
    }

    /**
     * List all file paths
     * @returns {string[]}
     */
    listFiles() {
        return [...this.files.keys()].sort()
    }

    /**
     * Get all files as an object
     * @returns {Object<string, string>}
     */
    toObject() {
        const obj = {}
        for (const [path, content] of this.files) {
            obj[path] = content
        }
        return obj
    }

    /**
     * Load files from an object
     * @param {Object<string, string>} obj - Files object
     * @param {string} [name] - Effect name
     * @param {Array<object>} [images] - Image records; when absent, the images
     *   an earlier workspace lists in `images.json` are read into Blob records
     */
    fromObject(obj, name = '', images) {
        this.files.clear()
        this.name = name
        for (const [path, content] of Object.entries(obj)) {
            this.files.set(path, content)
        }
        const listed = this.takeImagesFile()
        this._images = images === undefined ? listed : imageFileRecords(images)
        // Loading a different effect must start a fresh history, exactly like
        // clear(). Otherwise the previous effect's checkpoints survive and an
        // undo() would restore THAT effect's files over the just-loaded one
        // (cross-effect data corruption).
        this.history = []
        this.historyIndex = -1
        this._dispatchChange('load', { name })
    }

    /**
     * Clear the workspace
     */
    clear() {
        this.name = ''
        this.files.clear()
        this._images = []
        this.history = []
        this.historyIndex = -1
        this._dispatchChange('clear', {})
    }

    // =========================================================================
    // History Operations
    // =========================================================================

    /**
     * Save current state to history
     * @param {string} label - Description of this checkpoint
     * @param {object} [options] - Additional state to save
     * @param {string} [options.dsl] - Current DSL source
     * @param {object} [options.paramState] - ProgramState serialized snapshot
     */
    checkpoint(label, options = {}) {
        // Clone current files
        const snapshot = new Map()
        for (const [path, content] of this.files) {
            snapshot.set(path, content)
        }

        // Truncate any redo history
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1)
        }

        // Add new entry with optional DSL and param state. Image records are
        // never changed in place, so the list is its own snapshot.
        this.history.push({
            label,
            files: snapshot,
            images: this._images,
            dsl: options.dsl || null,
            paramState: options.paramState || null,
            timestamp: Date.now()
        })

        // Enforce max history
        if (this.history.length > this.maxHistory) {
            this.history.shift()
        } else {
            this.historyIndex++
        }

        this._dispatchChange('checkpoint', { label })
    }

    /**
     * Undo to previous state
     * @returns {boolean} Whether undo was performed
     */
    undo() {
        if (this.historyIndex <= 0) {
            return false
        }

        this.historyIndex--
        this._restoreFromHistory()
        return true
    }

    /**
     * Redo to next state
     * @returns {boolean} Whether redo was performed
     */
    redo() {
        if (this.historyIndex >= this.history.length - 1) {
            return false
        }

        this.historyIndex++
        this._restoreFromHistory()
        return true
    }

    /**
     * Check if undo is available
     * @returns {boolean}
     */
    canUndo() {
        return this.historyIndex > 0
    }

    /**
     * Check if redo is available
     * @returns {boolean}
     */
    canRedo() {
        return this.historyIndex < this.history.length - 1
    }

    /**
     * Get history for display
     * @returns {Array<{label: string, timestamp: number, current: boolean}>}
     */
    getHistory() {
        return this.history.map((entry, i) => ({
            label: entry.label,
            timestamp: entry.timestamp,
            current: i === this.historyIndex
        }))
    }
    
    /**
     * Get the current history entry (after undo/redo)
     * @returns {HistoryEntry|null}
     */
    getCurrentEntry() {
        return this.history[this.historyIndex] || null
    }

    /** @private */
    _restoreFromHistory() {
        const entry = this.history[this.historyIndex]
        if (!entry) return

        this.files.clear()
        for (const [path, content] of entry.files) {
            this.files.set(path, content)
        }
        this._images = entry.images || []

        // Include DSL and param state in restore event so listeners can use them
        this._dispatchChange('restore', { 
            label: entry.label,
            dsl: entry.dsl,
            paramState: entry.paramState
        })
    }

    // =========================================================================
    // Events
    // =========================================================================

    /** @private */
    _dispatchChange(type, detail) {
        this.dispatchEvent(new CustomEvent('change', {
            detail: { type, ...detail }
        }))
    }

    /**
     * Subscribe to changes
     * @param {function} callback - Called on any change
     * @returns {function} Unsubscribe function
     */
    onChange(callback) {
        const handler = (e) => callback(e.detail)
        this.addEventListener('change', handler)
        return () => this.removeEventListener('change', handler)
    }
}

// Singleton instance
export const workspaceStore = new WorkspaceStore()
