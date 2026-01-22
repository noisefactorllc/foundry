/**
 * Help Modal
 *
 * Displays keyboard shortcuts and help information.
 *
 * @module ui/help-modal
 */

import { keyboard } from './keyboard.js'

/**
 * HelpModal class
 */
export class HelpModal {
    constructor() {
        this.modal = null
        this.isOpen = false
    }

    /**
     * Toggle the modal
     */
    toggle() {
        if (this.isOpen) {
            this.close()
        } else {
            this.open()
        }
    }

    /**
     * Open the modal
     */
    open() {
        if (this.isOpen) return

        this._createModal()
        document.body.appendChild(this.modal)

        // Animate in
        requestAnimationFrame(() => {
            this.modal.classList.add('modal-visible')
        })

        this.isOpen = true

        // Close on escape
        this._escHandler = (e) => {
            if (e.key === 'Escape') this.close()
        }
        document.addEventListener('keydown', this._escHandler)
    }

    /**
     * Close the modal
     */
    close() {
        if (!this.isOpen) return

        this.modal.classList.remove('modal-visible')
        setTimeout(() => {
            this.modal.remove()
            this.modal = null
        }, 200)

        this.isOpen = false
        document.removeEventListener('keydown', this._escHandler)
    }

    /**
     * Create the modal element
     * @private
     */
    _createModal() {
        this.modal = document.createElement('div')
        this.modal.className = 'modal-overlay'
        this.modal.setAttribute('role', 'dialog')
        this.modal.setAttribute('aria-modal', 'true')
        this.modal.setAttribute('aria-labelledby', 'help-modal-title')

        const shortcuts = keyboard.getShortcutList()

        this.modal.innerHTML = `
            <div class="modal-content help-modal">
                <div class="modal-header">
                    <h2 id="help-modal-title">Keyboard Shortcuts</h2>
                    <button class="modal-close" aria-label="Close">&times;</button>
                </div>
                <div class="modal-body">
                    <table class="shortcuts-table">
                        <tbody>
                            ${shortcuts.map(s => `
                                <tr>
                                    <td class="shortcut-keys"><kbd>${s.keys}</kbd></td>
                                    <td class="shortcut-desc">${s.description}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    
                    <h3>Workflow</h3>
                    <ul class="help-tips">
                        <li>Load effects from the library</li>
                        <li>Tune parameters in real-time with instant visual feedback</li>
                        <li>Save your presets for later use</li>
                    </ul>
                </div>
            </div>
        `

        // Close on backdrop click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close()
        })

        // Close button
        this.modal.querySelector('.modal-close').addEventListener('click', () => {
            this.close()
        })
    }
}

// Singleton instance
export const helpModal = new HelpModal()
