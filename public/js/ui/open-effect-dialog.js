/**
 * Open Effect Dialog
 *
 * A search-based "Open File" style dialog for finding and loading effects.
 * Similar to VS Code's Quick Open (Ctrl+O) or Command Palette.
 *
 * @module ui/open-effect-dialog
 */

// Inject styles once into document head
const OPEN_EFFECT_DIALOG_STYLES_ID = 'open-effect-dialog-styles'
if (!document.getElementById(OPEN_EFFECT_DIALOG_STYLES_ID)) {
    const styleEl = document.createElement('style')
    styleEl.id = OPEN_EFFECT_DIALOG_STYLES_ID
    styleEl.textContent = `
        .open-effect-overlay {
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

        .open-effect-overlay.visible {
            opacity: 1;
        }

        .open-effect-dialog {
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

        .open-effect-overlay.visible .open-effect-dialog {
            transform: translateY(0) scale(1);
        }

        .open-effect-search-container {
            padding: 12px;
            border-bottom: 1px solid var(--color-border, #333);
        }

        .open-effect-search {
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

        .open-effect-search:focus {
            border-color: var(--color-accent, #00d4ff);
            box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.2);
        }

        .open-effect-search::placeholder {
            color: var(--color-text-muted, #666);
        }

        .open-effect-results {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
        }

        .open-effect-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.1s;
        }

        .open-effect-item:hover,
        .open-effect-item.selected {
            background: var(--color-surface-hover, #2a2a3e);
        }

        .open-effect-item.selected {
            outline: 1px solid var(--color-accent, #00d4ff);
        }

        .open-effect-icon {
            font-size: 1.25rem;
            color: var(--color-accent, #00d4ff);
            opacity: 0.7;
        }

        .open-effect-info {
            flex: 1;
            min-width: 0;
        }

        .open-effect-name {
            font-weight: 500;
            color: var(--color-text, #e0e0e0);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .open-effect-namespace {
            font-size: 0.8rem;
            color: var(--color-text-muted, #888);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .open-effect-empty {
            padding: 24px;
            text-align: center;
            color: var(--color-text-muted, #666);
        }

        .open-effect-hint {
            padding: 8px 12px;
            border-top: 1px solid var(--color-border, #333);
            font-size: 0.75rem;
            color: var(--color-text-muted, #666);
            display: flex;
            gap: 16px;
        }

        .open-effect-hint kbd {
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
 * OpenEffectDialog class
 */
export class OpenEffectDialog {
    constructor() {
        this.overlay = null
        this.searchInput = null
        this.resultsContainer = null
        this.isOpen = false
        this.effects = []
        this.filteredEffects = []
        this.selectedIndex = 0
        this.onSelect = null
    }

    /**
     * Set the list of available effects
     * @param {Array<{id: string, namespace: string, name: string}>} effects
     */
    setEffects(effects) {
        this.effects = effects
    }

    /**
     * Set the callback for when an effect is selected
     * @param {Function} callback
     */
    onEffectSelect(callback) {
        this.onSelect = callback
    }

    /**
     * Open the dialog
     */
    open() {
        if (this.isOpen) return

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
        this.overlay.className = 'open-effect-overlay'

        const dialog = document.createElement('div')
        dialog.className = 'open-effect-dialog'
        dialog.setAttribute('role', 'dialog')
        dialog.setAttribute('aria-label', 'Open Effect')

        // Search container
        const searchContainer = document.createElement('div')
        searchContainer.className = 'open-effect-search-container'

        this.searchInput = document.createElement('input')
        this.searchInput.type = 'text'
        this.searchInput.className = 'open-effect-search'
        this.searchInput.placeholder = 'Search effects by name...'
        this.searchInput.setAttribute('aria-label', 'Search effects')
        this.searchInput.autocomplete = 'off'
        this.searchInput.spellcheck = false

        searchContainer.appendChild(this.searchInput)

        // Results container
        this.resultsContainer = document.createElement('div')
        this.resultsContainer.className = 'open-effect-results'
        this.resultsContainer.setAttribute('role', 'listbox')

        // Hint bar
        const hint = document.createElement('div')
        hint.className = 'open-effect-hint'
        hint.innerHTML = `
            <span><kbd>↑↓</kbd> Navigate</span>
            <span><kbd>Enter</kbd> Open</span>
            <span><kbd>Esc</kbd> Close</span>
        `

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
            // Show first 20 effects when no query
            this.filteredEffects = this.effects.slice(0, 20)
        } else {
            // Filter and sort by relevance
            this.filteredEffects = this.effects
                .filter(e => 
                    e.name.toLowerCase().includes(q) ||
                    e.namespace.toLowerCase().includes(q) ||
                    e.id.toLowerCase().includes(q)
                )
                .sort((a, b) => {
                    // Exact name match first
                    const aExact = a.name.toLowerCase() === q
                    const bExact = b.name.toLowerCase() === q
                    if (aExact && !bExact) return -1
                    if (bExact && !aExact) return 1
                    
                    // Name starts with query
                    const aStarts = a.name.toLowerCase().startsWith(q)
                    const bStarts = b.name.toLowerCase().startsWith(q)
                    if (aStarts && !bStarts) return -1
                    if (bStarts && !aStarts) return 1
                    
                    // Alphabetical
                    return a.name.localeCompare(b.name)
                })
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
                <div class="open-effect-empty">
                    No effects found
                </div>
            `
            return
        }

        this.resultsContainer.innerHTML = this.filteredEffects.map((effect, i) => `
            <div class="open-effect-item${i === this.selectedIndex ? ' selected' : ''}" 
                 data-index="${i}" 
                 data-id="${effect.id}"
                 role="option"
                 aria-selected="${i === this.selectedIndex}">
                <div class="open-effect-info">
                    <div class="open-effect-name">${this._escapeHtml(effect.name)}</div>
                    <div class="open-effect-namespace">${this._escapeHtml(effect.namespace)}</div>
                </div>
            </div>
        `).join('')

        // Click handlers
        this.resultsContainer.querySelectorAll('.open-effect-item').forEach(item => {
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
        const items = this.resultsContainer.querySelectorAll('.open-effect-item')
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
     * Confirm the current selection
     * @private
     */
    _confirmSelection() {
        const effect = this.filteredEffects[this.selectedIndex]
        if (effect && this.onSelect) {
            this.close()
            this.onSelect(effect.id)
        }
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
