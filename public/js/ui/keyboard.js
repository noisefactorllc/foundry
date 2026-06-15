/**
 * Keyboard Shortcuts
 *
 * Global keyboard shortcut handler for Shade.
 *
 * @module ui/keyboard
 */

/**
 * Shortcut definition
 * @typedef {Object} Shortcut
 * @property {string} key - Key to match
 * @property {boolean} [meta] - Requires Cmd/Ctrl
 * @property {boolean} [shift] - Requires Shift
 * @property {boolean} [alt] - Requires Alt/Option
 * @property {boolean} [skipInInput] - Don't fire while a text input/editor is
 *   focused, even if it's a meta shortcut (e.g. undo/redo, so the editor's own
 *   native text-undo keeps working)
 * @property {string} description - Human-readable description
 * @property {function} action - Function to execute
 */

/**
 * KeyboardShortcuts class
 */
export class KeyboardShortcuts {
    constructor() {
        /** @type {Shortcut[]} */
        this.shortcuts = []
        this.enabled = true

        this._handleKeydown = this._handleKeydown.bind(this)
        document.addEventListener('keydown', this._handleKeydown)
    }

    /**
     * Register a shortcut
     * @param {Shortcut} shortcut
     */
    register(shortcut) {
        this.shortcuts.push(shortcut)
    }

    /**
     * Register multiple shortcuts
     * @param {Shortcut[]} shortcuts
     */
    registerAll(shortcuts) {
        shortcuts.forEach(s => this.register(s))
    }

    /**
     * Enable/disable shortcuts
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled
    }

    /**
     * Get all registered shortcuts for display
     * @returns {Array<{keys: string, description: string}>}
     */
    getShortcutList() {
        return this.shortcuts.map(s => ({
            keys: this._formatKeys(s),
            description: s.description
        }))
    }

    /**
     * Format shortcut keys for display
     * @private
     */
    _formatKeys(shortcut) {
        const parts = []
        if (shortcut.meta) parts.push('Cmd')
        if (shortcut.shift) parts.push('Shift')
        if (shortcut.alt) parts.push('Opt')
        
        let key = shortcut.key.toUpperCase()
        if (key === ' ') key = 'Space'
        if (key === 'ESCAPE') key = 'Esc'
        if (key === 'ENTER') key = 'Enter'
        
        parts.push(key)
        return parts.join('+')
    }

    /**
     * Handle keydown events
     * @private
     */
    _handleKeydown(e) {
        if (!this.enabled) return

        // Skip if typing in an input (unless it's a global shortcut with meta)
        const isInput = e.target.tagName === 'INPUT' ||
                       e.target.tagName === 'TEXTAREA' ||
                       e.target.isContentEditable === true

        for (const shortcut of this.shortcuts) {
            const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase()
            const metaMatch = !!shortcut.meta === (e.metaKey || e.ctrlKey)
            const shiftMatch = !!shortcut.shift === e.shiftKey
            const altMatch = !!shortcut.alt === e.altKey

            if (keyMatch && metaMatch && shiftMatch && altMatch) {
                // In a text input/editor, skip non-meta shortcuts AND any shortcut
                // that opts out via skipInInput (so the editor keeps its own native
                // behavior, e.g. text-undo for Cmd+Z).
                if (isInput && (!shortcut.meta || shortcut.skipInInput)) continue

                e.preventDefault()
                shortcut.action()
                return
            }
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        document.removeEventListener('keydown', this._handleKeydown)
    }
}

// Singleton instance
export const keyboard = new KeyboardShortcuts()
