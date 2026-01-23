/**
 * Delete Effect Dialog
 *
 * A search-based dialog for finding and deleting saved effect workspaces.
 *
 * @module ui/delete-effect-dialog
 */

import { listWorkspaces, deleteWorkspace } from '../workspace/index.js'
import { confirmDialog } from './name-dialog.js'

// Inject styles once into document head
const DELETE_EFFECT_DIALOG_STYLES_ID = 'delete-effect-dialog-styles'
if (!document.getElementById(DELETE_EFFECT_DIALOG_STYLES_ID)) {
    const styleEl = document.createElement('style')
    styleEl.id = DELETE_EFFECT_DIALOG_STYLES_ID
    styleEl.textContent = `
        .delete-effect-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: flex-start;
            justify-content: center;
            padding-top: 15vh;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.15s ease-out;
        }

        .delete-effect-overlay.visible {
            opacity: 1;
        }

        .delete-effect-dialog {
            background: var(--color-surface, #1a1a2e);
            border: 1px solid var(--color-border, #333);
            border-radius: 8px;
            width: min(600px, 90vw);
            max-height: 60vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
            transform: translateY(-10px) scale(0.98);
            transition: transform 0.15s ease-out;
        }

        .delete-effect-overlay.visible .delete-effect-dialog {
            transform: translateY(0) scale(1);
        }

        .delete-effect-header {
            padding: 12px 16px;
            border-bottom: 1px solid var(--color-border, #333);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .delete-effect-header-icon {
            color: var(--color-error, #ff6b6b);
            font-size: 1.25rem;
        }

        .delete-effect-header-title {
            font-weight: 500;
            color: var(--color-text, #e0e0e0);
        }

        .delete-effect-search-container {
            padding: 12px;
            border-bottom: 1px solid var(--color-border, #333);
        }

        .delete-effect-search {
            width: 100%;
            padding: 12px 16px;
            font-size: 1rem;
            font-family: inherit;
            background: var(--color-bg, #0d0d1a);
            border: 1px solid var(--color-border, #333);
            border-radius: 4px;
            color: var(--color-text, #e0e0e0);
            outline: none;
        }

        .delete-effect-search:focus {
            border-color: var(--color-accent, #00d4ff);
            box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.2);
        }

        .delete-effect-search::placeholder {
            color: var(--color-text-muted, #666);
        }

        .delete-effect-results {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
        }

        .delete-effect-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.1s;
        }

        .delete-effect-item:hover,
        .delete-effect-item.selected {
            background: var(--color-surface-hover, #2a2a3e);
        }

        .delete-effect-item.selected {
            outline: 1px solid var(--color-error, #ff6b6b);
        }

        .delete-effect-icon {
            font-size: 1.25rem;
            color: var(--color-error, #ff6b6b);
            opacity: 0.7;
        }

        .delete-effect-info {
            flex: 1;
            min-width: 0;
        }

        .delete-effect-name {
            font-weight: 500;
            color: var(--color-text, #e0e0e0);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .delete-effect-date {
            font-size: 0.8rem;
            color: var(--color-text-muted, #888);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .delete-effect-empty {
            padding: 24px;
            text-align: center;
            color: var(--color-text-muted, #666);
        }

        .delete-effect-hint {
            padding: 8px 12px;
            border-top: 1px solid var(--color-border, #333);
            font-size: 0.75rem;
            color: var(--color-text-muted, #666);
            display: flex;
            gap: 16px;
        }

        .delete-effect-hint kbd {
            background: var(--color-surface-hover, #2a2a3e);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: inherit;
            font-size: 0.7rem;
        }
    `
    document.head.appendChild(styleEl)
}

/**
 * DeleteEffectDialog class
 */
export class DeleteEffectDialog {
    constructor() {
        this.overlay = null
        this.searchInput = null
        this.resultsContainer = null
        this.isOpen = false
        this.effects = []
        this.filteredEffects = []
        this.selectedIndex = 0
        this.onDelete = null
    }

    /**
     * Set the callback for when an effect is deleted
     * @param {Function} callback
     */
    onEffectDelete(callback) {
        this.onDelete = callback
    }

    /**
     * Refresh the list of saved effects
     */
    async refresh() {
        try {
            const workspaces = await listWorkspaces()
            // Filter out 'current' and sort by savedAt descending
            this.effects = workspaces
                .filter(e => e.id !== 'current')
                .sort((a, b) => b.savedAt - a.savedAt)
        } catch (err) {
            console.error('[DeleteEffectDialog] Failed to list workspaces:', err)
            this.effects = []
        }
    }

    /**
     * Open the dialog
     */
    async open() {
        if (this.isOpen) return

        await this.refresh()

        this._createDialog()
        document.body.appendChild(this.overlay)

        // Animate in
        requestAnimationFrame(() => {
            this.overlay.classList.add('visible')
            this.searchInput.focus()
        })

        this.isOpen = true
        this._updateResults('')
    }

    /**
     * Close the dialog
     */
    close() {
        if (!this.isOpen) return

        this.overlay.classList.remove('visible')
        setTimeout(() => {
            this.overlay.remove()
            this.overlay = null
            this.searchInput = null
            this.resultsContainer = null
        }, 150)

        this.isOpen = false
    }

    /**
     * Toggle the dialog
     */
    toggle() {
        if (this.isOpen) {
            this.close()
        } else {
            this.open()
        }
    }

    /**
     * Create the dialog DOM
     * @private
     */
    _createDialog() {
        this.overlay = document.createElement('div')
        this.overlay.className = 'delete-effect-overlay'

        const dialog = document.createElement('div')
        dialog.className = 'delete-effect-dialog'
        dialog.setAttribute('role', 'dialog')
        dialog.setAttribute('aria-label', 'Delete Effect')

        // Header
        const header = document.createElement('div')
        header.className = 'delete-effect-header'
        header.innerHTML = `
            <span class="delete-effect-header-icon icon-material">delete</span>
            <span class="delete-effect-header-title">Delete Effect</span>
        `

        // Search container
        const searchContainer = document.createElement('div')
        searchContainer.className = 'delete-effect-search-container'

        this.searchInput = document.createElement('input')
        this.searchInput.type = 'text'
        this.searchInput.className = 'delete-effect-search'
        this.searchInput.placeholder = 'Search saved effects...'
        this.searchInput.setAttribute('aria-label', 'Search effects')
        this.searchInput.autocomplete = 'off'
        this.searchInput.spellcheck = false

        searchContainer.appendChild(this.searchInput)

        // Results container
        this.resultsContainer = document.createElement('div')
        this.resultsContainer.className = 'delete-effect-results'
        this.resultsContainer.setAttribute('role', 'listbox')

        // Hint bar
        const hint = document.createElement('div')
        hint.className = 'delete-effect-hint'
        hint.innerHTML = `
            <span><kbd>↑↓</kbd> Navigate</span>
            <span><kbd>Enter</kbd> Delete</span>
            <span><kbd>Esc</kbd> Close</span>
        `

        dialog.appendChild(header)
        dialog.appendChild(searchContainer)
        dialog.appendChild(this.resultsContainer)
        dialog.appendChild(hint)
        this.overlay.appendChild(dialog)

        // Event handlers
        this._attachEventListeners()
    }

    /**
     * Attach event listeners
     * @private
     */
    _attachEventListeners() {
        // Close on overlay click
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.close()
            }
        })

        // Search input
        this.searchInput.addEventListener('input', (e) => {
            this._updateResults(e.target.value)
        })

        // Keyboard navigation
        this.searchInput.addEventListener('keydown', (e) => {
            switch (e.key) {
                case 'Escape':
                    e.preventDefault()
                    this.close()
                    break
                case 'ArrowDown':
                    e.preventDefault()
                    this._selectNext()
                    break
                case 'ArrowUp':
                    e.preventDefault()
                    this._selectPrev()
                    break
                case 'Enter':
                    e.preventDefault()
                    this._confirmSelection()
                    break
            }
        })
    }

    /**
     * Update the results list
     * @param {string} query
     * @private
     */
    _updateResults(query) {
        const q = query.toLowerCase().trim()
        
        if (!q) {
            // Show all effects when no query
            this.filteredEffects = this.effects.slice(0, 50)
        } else {
            // Filter by name
            this.filteredEffects = this.effects
                .filter(e => 
                    (e.name || '').toLowerCase().includes(q) ||
                    e.id.toLowerCase().includes(q)
                )
                .slice(0, 50)
        }

        this.selectedIndex = 0
        this._renderResults()
    }

    /**
     * Render the results list
     * @private
     */
    _renderResults() {
        if (this.filteredEffects.length === 0) {
            this.resultsContainer.innerHTML = `
                <div class="delete-effect-empty">
                    No saved effects found
                </div>
            `
            return
        }

        this.resultsContainer.innerHTML = this.filteredEffects.map((effect, i) => `
            <div class="delete-effect-item${i === this.selectedIndex ? ' selected' : ''}" 
                 data-index="${i}" 
                 data-id="${effect.id}"
                 role="option"
                 aria-selected="${i === this.selectedIndex}">
                <span class="delete-effect-icon icon-material">folder</span>
                <div class="delete-effect-info">
                    <div class="delete-effect-name">${this._escapeHtml(effect.name || 'Untitled')}</div>
                    <div class="delete-effect-date">${this._formatDate(effect.savedAt)}</div>
                </div>
            </div>
        `).join('')

        // Click handlers
        this.resultsContainer.querySelectorAll('.delete-effect-item').forEach(item => {
            item.addEventListener('click', () => {
                this.selectedIndex = parseInt(item.dataset.index, 10)
                this._confirmSelection()
            })
            item.addEventListener('mouseenter', () => {
                this.selectedIndex = parseInt(item.dataset.index, 10)
                this._updateSelection()
            })
        })
    }

    /**
     * Update the visual selection
     * @private
     */
    _updateSelection() {
        const items = this.resultsContainer.querySelectorAll('.delete-effect-item')
        items.forEach((item, i) => {
            item.classList.toggle('selected', i === this.selectedIndex)
            item.setAttribute('aria-selected', i === this.selectedIndex ? 'true' : 'false')
        })

        // Scroll selected item into view
        const selected = items[this.selectedIndex]
        if (selected) {
            selected.scrollIntoView({ block: 'nearest' })
        }
    }

    /**
     * Select next item
     * @private
     */
    _selectNext() {
        if (this.filteredEffects.length === 0) return
        this.selectedIndex = (this.selectedIndex + 1) % this.filteredEffects.length
        this._updateSelection()
    }

    /**
     * Select previous item
     * @private
     */
    _selectPrev() {
        if (this.filteredEffects.length === 0) return
        this.selectedIndex = (this.selectedIndex - 1 + this.filteredEffects.length) % this.filteredEffects.length
        this._updateSelection()
    }

    /**
     * Confirm the current selection (show delete confirmation)
     * @private
     */
    async _confirmSelection() {
        const effect = this.filteredEffects[this.selectedIndex]
        if (!effect) return

        const confirmed = await confirmDialog.show({
            title: 'Delete Effect',
            message: `Delete "${effect.name || 'Untitled'}"? This cannot be undone.`,
            icon: 'delete',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            danger: true
        })

        if (confirmed) {
            await deleteWorkspace(effect.id)
            
            // Callback
            if (this.onDelete) {
                this.onDelete(effect.id)
            }

            // Refresh the list
            await this.refresh()
            this._updateResults(this.searchInput?.value || '')

            // Close if no more effects
            if (this.effects.length === 0) {
                this.close()
            }
        }
    }

    /**
     * Format date from timestamp
     * @param {number} timestamp
     * @returns {string}
     * @private
     */
    _formatDate(timestamp) {
        if (!timestamp) return ''
        const date = new Date(timestamp)
        const now = new Date()
        const diff = now - date
        
        if (diff < 60000) return 'Just now'
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
        
        return date.toLocaleDateString()
    }

    /**
     * Escape HTML
     * @param {string} str
     * @returns {string}
     * @private
     */
    _escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
}

// Singleton instance
export const deleteEffectDialog = new DeleteEffectDialog()
