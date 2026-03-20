/**
 * Workspace Files Dialog
 *
 * A search-based dialog for browsing and opening workspace files.
 * Styled identically to the Open Effect dialog.
 *
 * @module ui/workspace-files-dialog
 */

import { workspaceStore } from '../workspace/index.js'

// Inject styles once into document head
const WORKSPACE_FILES_DIALOG_STYLES_ID = 'workspace-files-dialog-styles'
if (!document.getElementById(WORKSPACE_FILES_DIALOG_STYLES_ID)) {
    const styleEl = document.createElement('style')
    styleEl.id = WORKSPACE_FILES_DIALOG_STYLES_ID
    styleEl.textContent = `
        .workspace-files-overlay {
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

        .workspace-files-overlay.visible {
            opacity: 1;
        }

        .workspace-files-dialog {
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

        .workspace-files-overlay.visible .workspace-files-dialog {
            transform: translateY(0) scale(1);
        }

        .workspace-files-search-container {
            padding: 12px;
            border-bottom: 1px solid var(--color-border, #333);
        }

        .workspace-files-search {
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

        .workspace-files-search:focus {
            border-color: var(--color-accent, #00d4ff);
            box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.2);
        }

        .workspace-files-search::placeholder {
            color: var(--color-text-muted, #666);
        }

        .workspace-files-results {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
        }

        .workspace-files-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.1s;
        }

        .workspace-files-item:hover,
        .workspace-files-item.selected {
            background: var(--color-surface-hover, #2a2a3e);
        }

        .workspace-files-item.selected {
            outline: 1px solid var(--color-accent, #00d4ff);
        }

        .workspace-files-icon {
            font-size: 1.25rem;
            color: var(--color-accent, #00d4ff);
            opacity: 0.7;
        }

        .workspace-files-info {
            flex: 1;
            min-width: 0;
        }

        .workspace-files-name {
            font-weight: 500;
            color: var(--color-text, #e0e0e0);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .workspace-files-path {
            font-size: 0.8rem;
            color: var(--color-text-muted, #888);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .workspace-files-empty {
            padding: 24px;
            text-align: center;
            color: var(--color-text-muted, #666);
        }

        .workspace-files-hint {
            padding: 8px 12px;
            border-top: 1px solid var(--color-border, #333);
            font-size: 0.75rem;
            color: var(--color-text-muted, #666);
            display: flex;
            gap: 16px;
        }

        .workspace-files-hint kbd {
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
 * WorkspaceFilesDialog class
 */
export class WorkspaceFilesDialog {
    constructor() {
        this.overlay = null
        this.searchInput = null
        this.resultsContainer = null
        this.isOpen = false
        this.files = []
        this.filteredFiles = []
        this.selectedIndex = 0
        this.onSelect = null
    }

    /**
     * Set the callback for when a file is selected
     * @param {Function} callback
     */
    onFileSelect(callback) {
        this.onSelect = callback
    }

    /**
     * Open the dialog
     */
    open() {
        if (this.isOpen) return

        this._refreshFiles()
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
     * Refresh the file list from workspace
     * @private
     */
    _refreshFiles() {
        const filePaths = workspaceStore.listFiles()
        this.files = filePaths.map(path => {
            const parts = path.split('/')
            const name = parts[parts.length - 1]
            const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
            return { path, name, dir }
        })
    }

    /**
     * Create the dialog DOM
     * @private
     */
    _createDialog() {
        this.overlay = document.createElement('div')
        this.overlay.className = 'workspace-files-overlay'

        const dialog = document.createElement('div')
        dialog.className = 'workspace-files-dialog'
        dialog.setAttribute('role', 'dialog')
        dialog.setAttribute('aria-label', 'Workspace Files')

        // Search container
        const searchContainer = document.createElement('div')
        searchContainer.className = 'workspace-files-search-container'

        this.searchInput = document.createElement('input')
        this.searchInput.type = 'text'
        this.searchInput.className = 'workspace-files-search'
        this.searchInput.name = 'workspace-file-search'
        this.searchInput.placeholder = 'Search workspace files...'
        this.searchInput.setAttribute('autocomplete', 'off')
        this.searchInput.setAttribute('spellcheck', 'false')

        searchContainer.appendChild(this.searchInput)
        dialog.appendChild(searchContainer)

        // Results container
        this.resultsContainer = document.createElement('div')
        this.resultsContainer.className = 'workspace-files-results'
        dialog.appendChild(this.resultsContainer)

        // Hint
        const hint = document.createElement('div')
        hint.className = 'workspace-files-hint'
        hint.innerHTML = `
            <span><kbd>↑↓</kbd> navigate</span>
            <span><kbd>Enter</kbd> open</span>
            <span><kbd>Esc</kbd> close</span>
        `
        dialog.appendChild(hint)

        this.overlay.appendChild(dialog)

        // Event listeners
        this.searchInput.addEventListener('input', (e) => {
            this._updateResults(e.target.value)
        })

        this.searchInput.addEventListener('keydown', (e) => {
            this._handleKeydown(e)
        })

        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.close()
            }
        })
    }

    /**
     * Handle keyboard navigation
     * @private
     */
    _handleKeydown(e) {
        switch (e.key) {
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
            case 'Escape':
                e.preventDefault()
                this.close()
                break
        }
    }

    /**
     * Select next item
     * @private
     */
    _selectNext() {
        if (this.filteredFiles.length === 0) return
        this.selectedIndex = (this.selectedIndex + 1) % this.filteredFiles.length
        this._renderResults()
        this._scrollToSelected()
    }

    /**
     * Select previous item
     * @private
     */
    _selectPrev() {
        if (this.filteredFiles.length === 0) return
        this.selectedIndex = (this.selectedIndex - 1 + this.filteredFiles.length) % this.filteredFiles.length
        this._renderResults()
        this._scrollToSelected()
    }

    /**
     * Scroll to keep selected item visible
     * @private
     */
    _scrollToSelected() {
        const selectedEl = this.resultsContainer.querySelector('.workspace-files-item.selected')
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' })
        }
    }

    /**
     * Confirm the current selection
     * @private
     */
    _confirmSelection() {
        if (this.filteredFiles.length === 0) return
        const file = this.filteredFiles[this.selectedIndex]
        if (file && this.onSelect) {
            this.onSelect(file.path)
        }
        this.close()
    }

    /**
     * Update filtered results based on search query
     * @private
     */
    _updateResults(query) {
        const q = query.toLowerCase().trim()

        if (!q) {
            this.filteredFiles = [...this.files]
        } else {
            this.filteredFiles = this.files.filter(f =>
                f.name.toLowerCase().includes(q) ||
                f.path.toLowerCase().includes(q)
            )
        }

        this.selectedIndex = 0
        this._renderResults()
    }

    /**
     * Render the results list
     * @private
     */
    _renderResults() {
        this.resultsContainer.innerHTML = ''

        if (this.filteredFiles.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'workspace-files-empty'
            empty.textContent = this.files.length === 0
                ? 'No files in workspace'
                : 'No matching files'
            this.resultsContainer.appendChild(empty)
            return
        }

        this.filteredFiles.forEach((file, index) => {
            const item = document.createElement('div')
            item.className = 'workspace-files-item'
            if (index === this.selectedIndex) {
                item.classList.add('selected')
            }

            const icon = document.createElement('span')
            icon.className = 'workspace-files-icon icon-material'
            icon.textContent = this._getFileIcon(file.name)
            item.appendChild(icon)

            const info = document.createElement('div')
            info.className = 'workspace-files-info'

            const name = document.createElement('div')
            name.className = 'workspace-files-name'
            name.textContent = file.name
            info.appendChild(name)

            if (file.dir) {
                const path = document.createElement('div')
                path.className = 'workspace-files-path'
                path.textContent = file.dir
                info.appendChild(path)
            }

            item.appendChild(info)

            item.addEventListener('click', () => {
                this.selectedIndex = index
                this._confirmSelection()
            })

            item.addEventListener('mouseenter', () => {
                // Just update selection state visually without re-rendering
                const prevSelected = this.resultsContainer.querySelector('.workspace-files-item.selected')
                if (prevSelected) {
                    prevSelected.classList.remove('selected')
                }
                item.classList.add('selected')
                this.selectedIndex = index
            })

            this.resultsContainer.appendChild(item)
        })
    }

    /**
     * Get icon for file type
     * @private
     */
    _getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase()
        switch (ext) {
            case 'glsl':
            case 'wgsl':
            case 'vert':
            case 'frag':
                return 'code'
            case 'json':
                return 'data_object'
            case 'txt':
                return 'description'
            case 'md':
                return 'article'
            case 'js':
                return 'javascript'
            default:
                return 'insert_drive_file'
        }
    }
}
