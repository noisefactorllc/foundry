/**
 * Storage Service - LocalStorage/IndexedDB utilities
 *
 * Provides persistence for preferences, and application state.
 *
 * @module utils/storage
 */

const STORAGE_PREFIX = 'shade:'

/**
 * Storage keys
 */
export const StorageKey = {
    PREFERENCES: 'preferences',
    RECENT_EFFECTS: 'recent_effects',
    UI_STATE: 'ui_state'
}

/**
 * StorageService class
 */
class StorageService {
    constructor() {
        /** @type {boolean} */
        this.available = this._checkAvailability()
    }

    /**
     * Check if localStorage is available
     * @private
     */
    _checkAvailability() {
        try {
            const test = '__storage_test__'
            localStorage.setItem(test, test)
            localStorage.removeItem(test)
            return true
        } catch (e) {
            return false
        }
    }

    /**
     * Get full key with prefix
     * @private
     */
    _key(key) {
        return STORAGE_PREFIX + key
    }

    /**
     * Get item from storage
     * @param {string} key - Storage key
     * @param {*} [defaultValue=null] - Default value if not found
     * @returns {*}
     */
    get(key, defaultValue = null) {
        if (!this.available) return defaultValue

        try {
            const item = localStorage.getItem(this._key(key))
            if (item === null) return defaultValue
            return JSON.parse(item)
        } catch (e) {
            console.error(`[Storage] Failed to parse storage key "${key}":`, e.message)
            console.error(`[Storage] Raw content:`, localStorage.getItem(this._key(key)))
            return defaultValue
        }
    }

    /**
     * Set item in storage
     * @param {string} key - Storage key
     * @param {*} value - Value to store
     * @returns {boolean} Success
     */
    set(key, value) {
        if (!this.available) return false

        try {
            localStorage.setItem(this._key(key), JSON.stringify(value))
            return true
        } catch (e) {
            console.warn(`Failed to set storage key "${key}":`, e)
            return false
        }
    }

    /**
     * Remove item from storage
     * @param {string} key - Storage key
     */
    remove(key) {
        if (!this.available) return
        localStorage.removeItem(this._key(key))
    }

    /**
     * Clear all Shade storage
     */
    clear() {
        if (!this.available) return

        const keys = Object.keys(localStorage).filter(k => k.startsWith(STORAGE_PREFIX))
        keys.forEach(k => localStorage.removeItem(k))
    }

    /**
     * Get storage usage in bytes
     * @returns {number}
     */
    getUsage() {
        if (!this.available) return 0

        let total = 0
        for (const key of Object.keys(localStorage)) {
            if (key.startsWith(STORAGE_PREFIX)) {
                total += localStorage.getItem(key).length * 2 // UTF-16
            }
        }
        return total
    }
}

// Singleton
export const storage = new StorageService()

// ============================================================================
// Preferences
// ============================================================================

/**
 * @typedef {Object} ShadePreferences
 * @property {string} backend - 'webgl2' or 'webgpu'
 * @property {number} duration - Loop duration in seconds
 * @property {boolean} darkMode - Theme preference
 * @property {number} fontSize - Editor font size
 * @property {boolean} autoCompile - Auto-compile on change
 */

const DEFAULT_PREFERENCES = {
    backend: 'webgl2',
    duration: 10,
    darkMode: true,
    fontSize: 14,
    autoCompile: false
}

/**
 * Get all preferences
 * @returns {ShadePreferences}
 */
export function getPreferences() {
    return { ...DEFAULT_PREFERENCES, ...storage.get(StorageKey.PREFERENCES, {}) }
}

/**
 * Set a preference
 * @param {string} key - Preference key
 * @param {*} value - Preference value
 */
export function setPreference(key, value) {
    const prefs = getPreferences()
    prefs[key] = value
    storage.set(StorageKey.PREFERENCES, prefs)
}

/**
 * Reset preferences to defaults
 */
export function resetPreferences() {
    storage.set(StorageKey.PREFERENCES, DEFAULT_PREFERENCES)
}

// ============================================================================
// Recent Effects
// ============================================================================

/**
 * @typedef {Object} RecentEffect
 * @property {string} id - Effect ID
 * @property {string} name - Effect name
 * @property {number} lastUsed - Timestamp
 */

/**
 * Get recent effects
 * @param {number} [limit=10]
 * @returns {RecentEffect[]}
 */
export function getRecentEffects(limit = 10) {
    const effects = storage.get(StorageKey.RECENT_EFFECTS, [])
    return effects.slice(0, limit)
}

/**
 * Add an effect to recent list
 * @param {string} id - Effect ID
 * @param {string} name - Effect name
 */
export function addRecentEffect(id, name) {
    let effects = storage.get(StorageKey.RECENT_EFFECTS, [])
    
    // Remove if already exists
    effects = effects.filter(e => e.id !== id)
    
    // Add to front
    effects.unshift({ id, name, lastUsed: Date.now() })
    
    // Keep only 20
    effects = effects.slice(0, 20)
    
    storage.set(StorageKey.RECENT_EFFECTS, effects)
}

// ============================================================================
// UI State
// ============================================================================

/**
 * @typedef {Object} UIState
 * @property {string} dsl - Last DSL code
 * @property {boolean} sidebarCollapsed - Sidebar state
 */

/**
 * Save UI state
 * @param {Partial<UIState>} state
 */
export function saveUIState(state) {
    const current = storage.get(StorageKey.UI_STATE, {})
    storage.set(StorageKey.UI_STATE, { ...current, ...state })
}

/**
 * Load UI state
 * @returns {UIState}
 */
export function loadUIState() {
    return storage.get(StorageKey.UI_STATE, {
        dsl: '',
        sidebarCollapsed: false
    })
}
