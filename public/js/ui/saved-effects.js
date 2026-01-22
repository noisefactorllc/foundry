/**
 * Saved Effects UI Component
 *
 * Shows a list of saved effects in IndexedDB and allows switching between them.
 *
 * @module ui/saved-effects
 */

import { listWorkspaces, saveWorkspace, loadWorkspace, deleteWorkspace, registerEffectFromWorkspace } from '../workspace/index.js'
import { workspaceStore } from '../workspace/index.js'
import { confirmDialog } from './name-dialog.js'

/**
 * SavedEffects class
 */
export class SavedEffects {
    /**
     * @param {HTMLElement} container - Container element
     * @param {object} options
     * @param {function} options.onLoad - Called when an effect is loaded
     * @param {object} options.renderer - ShadeRenderer instance for effect registration
     */
    constructor(container, options = {}) {
        this.container = container
        this.onLoad = options.onLoad || (() => {})
        this.renderer = options.renderer || null
        this.effects = []
    }

    /**
     * Refresh the list of saved effects
     */
    async refresh() {
        try {
            this.effects = await listWorkspaces()
            // Filter out 'current' and sort by savedAt descending
            this.effects = this.effects
                .filter(e => e.id !== 'current')
                .sort((a, b) => b.savedAt - a.savedAt)
            this.render()
        } catch (err) {
            console.error('[SavedEffects] Failed to list workspaces:', err)
        }
    }

    /**
     * Save the current workspace as a named effect
     * @param {string} [name] - Optional name override
     */
    async save(name) {
        const effectName = name || workspaceStore.name || 'untitled'
        const id = `effect_${effectName}_${Date.now()}`
        
        // Update workspace name
        workspaceStore.name = effectName
        
        await saveWorkspace(workspaceStore, id)
        await this.refresh()
        
        return id
    }

    /**
     * Load a saved effect by ID
     * @param {string} id - Effect ID
     */
    async load(id) {
        await loadWorkspace(workspaceStore, id)
        
        // Re-register the effect with the noisemaker runtime
        // Pass the renderer so the effect is added to its loaded effects cache
        registerEffectFromWorkspace(this.renderer)
        
        this.onLoad(workspaceStore)
    }

    /**
     * Delete a saved effect by ID
     * @param {string} id - Effect ID
     */
    async delete(id) {
        await deleteWorkspace(id)
        await this.refresh()
    }

    /**
     * Render the effects list
     */
    render() {
        if (this.effects.length === 0) {
            this.container.innerHTML = '<div class="empty-state">No saved effects</div>'
            return
        }

        this.container.innerHTML = ''

        for (const effect of this.effects) {
            const item = document.createElement('div')
            item.className = 'saved-effect-item'
            item.dataset.id = effect.id

            const name = document.createElement('span')
            name.className = 'effect-name'
            name.textContent = effect.name || 'Untitled'
            
            const date = document.createElement('span')
            date.className = 'effect-date'
            date.textContent = this._formatDate(effect.savedAt)

            const actions = document.createElement('div')
            actions.className = 'effect-actions'

            const loadBtn = document.createElement('button')
            loadBtn.className = 'action-btn small'
            loadBtn.title = 'Load'
            loadBtn.innerHTML = '<span class="icon-material">folder_open</span>'
            loadBtn.addEventListener('click', (e) => {
                e.stopPropagation()
                this.load(effect.id)
            })

            const deleteBtn = document.createElement('button')
            deleteBtn.className = 'action-btn small danger'
            deleteBtn.title = 'Delete'
            deleteBtn.innerHTML = '<span class="icon-material">delete</span>'
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation()
                e.preventDefault()
                // Show confirm dialog (don't await inline to ensure stopPropagation runs first)
                confirmDialog.show({
                    title: 'Delete Effect',
                    message: `Delete "${effect.name}"? This cannot be undone.`,
                    icon: 'delete',
                    confirmText: 'Delete',
                    cancelText: 'Cancel',
                    danger: true
                }).then((confirmed) => {
                    if (confirmed) {
                        this.delete(effect.id)
                    }
                })
            })

            actions.appendChild(loadBtn)
            actions.appendChild(deleteBtn)

            item.appendChild(name)
            item.appendChild(date)
            item.appendChild(actions)

            // Click on name/date to load (NOT the whole item - avoids event issues with buttons)
            name.style.cursor = 'pointer'
            date.style.cursor = 'pointer'
            name.addEventListener('click', () => this.load(effect.id))
            date.addEventListener('click', () => this.load(effect.id))

            this.container.appendChild(item)
        }
    }

    _formatDate(timestamp) {
        const date = new Date(timestamp)
        const now = new Date()
        const diff = now - date
        
        if (diff < 60000) return 'Just now'
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
        
        return date.toLocaleDateString()
    }
}
