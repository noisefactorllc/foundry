/**
 * File Browser UI Component
 *
 * Displays the workspace files in a tree view and handles file selection.
 *
 * @module ui/file-browser
 */

import { workspaceStore } from '../workspace/index.js'

/**
 * FileBrowser class
 *
 * @example
 * const browser = new FileBrowser(containerEl, {
 *     onSelect: (path) => console.log('Selected:', path)
 * });
 * browser.render();
 */
export class FileBrowser {
    /**
     * Create a new FileBrowser
     * @param {HTMLElement} container - Container element
     * @param {object} [options] - Options
     * @param {function} [options.onSelect] - Called when a file is selected
     */
    constructor(container, options = {}) {
        this.container = container
        this.onSelect = options.onSelect || (() => {})
        this.selectedPath = null

        // Subscribe to workspace changes
        workspaceStore.onChange(() => this.render())
    }

    /**
     * Render the file tree
     */
    render() {
        const files = workspaceStore.listFiles()

        if (files.length === 0) {
            this.container.innerHTML = `
                <div class="empty-state">No effect loaded</div>
            `
            return
        }

        // Build tree structure
        const tree = this._buildTree(files)

        // Render tree
        this.container.innerHTML = ''
        this._renderNode(tree, this.container, 0)
    }

    /**
     * Build a tree structure from flat file paths
     * @private
     */
    _buildTree(files) {
        const root = { name: '', children: {}, files: [] }

        for (const path of files) {
            const parts = path.split('/')
            let current = root

            for (let i = 0; i < parts.length - 1; i++) {
                const dir = parts[i]
                if (!current.children[dir]) {
                    current.children[dir] = { name: dir, children: {}, files: [] }
                }
                current = current.children[dir]
            }

            current.files.push({
                name: parts[parts.length - 1],
                path: path
            })
        }

        return root
    }

    /**
     * Render a tree node
     * @private
     */
    _renderNode(node, container, depth) {
        // Render directories first
        for (const [name, child] of Object.entries(node.children)) {
            const dirEl = document.createElement('div')
            dirEl.className = 'file-item directory'
            dirEl.style.paddingLeft = `${8 + depth * 16}px`
            dirEl.innerHTML = `
                <span class="file-icon icon-material">folder</span>
                <span class="file-name">${name}/</span>
            `
            container.appendChild(dirEl)

            // Render children
            this._renderNode(child, container, depth + 1)
        }

        // Render files
        for (const file of node.files) {
            const fileEl = document.createElement('div')
            fileEl.className = 'file-item'
            if (file.path === this.selectedPath) {
                fileEl.classList.add('active')
            }
            fileEl.style.paddingLeft = `${8 + depth * 16}px`
            fileEl.innerHTML = `
                <span class="file-icon">${this._getFileIcon(file.name)}</span>
                <span class="file-name">${file.name}</span>
            `
            fileEl.addEventListener('click', () => this._selectFile(file.path))
            container.appendChild(fileEl)
        }
    }

    /**
     * Get icon for file type
     * @private
     */
    _getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase()
        switch (ext) {
            case 'js': return '<span class="icon-material">javascript</span>'
            case 'glsl': return '<span class="icon-material">brush</span>'
            case 'wgsl': return '<span class="icon-material">diamond</span>'
            case 'md': return '<span class="icon-material">description</span>'
            case 'json': return '<span class="icon-material">data_object</span>'
            default: return '<span class="icon-material">draft</span>'
        }
    }

    /**
     * Handle file selection
     * @private
     */
    _selectFile(path) {
        this.selectedPath = path
        this.render()
        this.onSelect(path)
    }

    /**
     * Get the currently selected file path
     * @returns {string|null}
     */
    getSelectedPath() {
        return this.selectedPath
    }

    /**
     * Clear selection
     */
    clearSelection() {
        this.selectedPath = null
        this.render()
    }
}
