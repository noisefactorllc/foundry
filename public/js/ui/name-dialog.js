/**
 * Name Dialog
 *
 * A custom naming dialog for saving effects, using the HTML Dialog API
 * with styling consistent with existing modals.
 *
 * @module ui/name-dialog
 */

/**
 * NameDialog class
 */
export class NameDialog {
    constructor() {
        this.dialog = null
        this.resolvePromise = null
        this.rejectPromise = null
    }

    /**
     * Show the naming dialog
     * @param {object} options
     * @param {string} [options.title='Save Effect'] - Dialog title
     * @param {string} [options.label='Name'] - Input label
     * @param {string} [options.value=''] - Default input value
     * @param {string} [options.placeholder='Enter name...'] - Input placeholder
     * @param {string} [options.confirmText='Save'] - Confirm button text
     * @param {string} [options.cancelText='Cancel'] - Cancel button text
     * @returns {Promise<string|null>} The entered name, or null if cancelled
     */
    show(options = {}) {
        const {
            title = 'Save Effect',
            label = 'Name',
            value = '',
            placeholder = 'Enter name...',
            confirmText = 'Save',
            cancelText = 'Cancel'
        } = options

        return new Promise((resolve, reject) => {
            this.resolvePromise = resolve
            this.rejectPromise = reject

            this._createDialog({ title, label, value, placeholder, confirmText, cancelText })
            document.body.appendChild(this.dialog)

            // Animate in
            requestAnimationFrame(() => {
                this.dialog.classList.add('modal-visible')
                // Focus and select input
                const input = this.dialog.querySelector('.name-dialog-input')
                if (input) {
                    input.focus()
                    input.select()
                }
            })
        })
    }

    /**
     * Close the dialog
     * @param {string|null} result - The result to return (name or null)
     * @private
     */
    _close(result) {
        if (!this.dialog) return

        this.dialog.classList.remove('modal-visible')
        setTimeout(() => {
            this.dialog.remove()
            this.dialog = null
            if (this.resolvePromise) {
                this.resolvePromise(result)
                this.resolvePromise = null
                this.rejectPromise = null
            }
        }, 200)
    }

    /**
     * Create the dialog element
     * @param {object} options
     * @private
     */
    _createDialog({ title, label, value, placeholder, confirmText, cancelText }) {
        this.dialog = document.createElement('div')
        this.dialog.className = 'modal-overlay'
        this.dialog.setAttribute('role', 'dialog')
        this.dialog.setAttribute('aria-modal', 'true')
        this.dialog.setAttribute('aria-labelledby', 'name-dialog-title')

        this.dialog.innerHTML = `
            <div class="modal-content name-dialog">
                <div class="modal-header">
                    <h2 id="name-dialog-title">${title}</h2>
                    <button class="modal-close" aria-label="Close">
                        <span class="icon-material">close</span>
                    </button>
                </div>
                <div class="name-dialog-body">
                    <label class="name-dialog-label" for="name-dialog-input">${label}</label>
                    <input 
                        type="text" 
                        id="name-dialog-input"
                        class="name-dialog-input" 
                        value="${this._escapeHtml(value)}" 
                        placeholder="${placeholder}"
                        autocomplete="off"
                        spellcheck="false"
                    >
                </div>
                <div class="name-dialog-actions">
                    <button class="action-btn name-dialog-cancel">${cancelText}</button>
                    <button class="action-btn primary name-dialog-confirm">${confirmText}</button>
                </div>
            </div>
        `

        // Event handlers
        const closeBtn = this.dialog.querySelector('.modal-close')
        const cancelBtn = this.dialog.querySelector('.name-dialog-cancel')
        const confirmBtn = this.dialog.querySelector('.name-dialog-confirm')
        const input = this.dialog.querySelector('.name-dialog-input')

        closeBtn.addEventListener('click', () => this._close(null))
        cancelBtn.addEventListener('click', () => this._close(null))
        confirmBtn.addEventListener('click', () => this._handleConfirm(input))

        // Close on backdrop click
        this.dialog.addEventListener('click', (e) => {
            if (e.target === this.dialog) this._close(null)
        })

        // Handle keyboard
        this.dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                this._close(null)
            } else if (e.key === 'Enter') {
                e.preventDefault()
                this._handleConfirm(input)
            }
        })
    }

    /**
     * Handle confirm action
     * @param {HTMLInputElement} input
     * @private
     */
    _handleConfirm(input) {
        const value = input.value.trim()
        if (value) {
            this._close(value)
        } else {
            // Shake the input to indicate error
            input.classList.add('shake')
            input.focus()
            setTimeout(() => input.classList.remove('shake'), 400)
        }
    }

    /**
     * Escape HTML special characters
     * @param {string} str
     * @returns {string}
     * @private
     */
    _escapeHtml(str) {
        const div = document.createElement('div')
        div.textContent = str
        return div.innerHTML
    }
}

/**
 * ConfirmDialog class for yes/no confirmations
 */
export class ConfirmDialog {
    constructor() {
        this.dialog = null
        this.resolvePromise = null
    }

    /**
     * Show a confirmation dialog
     * @param {object} options
     * @param {string} [options.title='Confirm'] - Dialog title
     * @param {string} [options.message='Are you sure?'] - Confirmation message
     * @param {string} [options.icon='warning'] - Material icon name
     * @param {string} [options.confirmText='Delete'] - Confirm button text
     * @param {string} [options.cancelText='Cancel'] - Cancel button text
     * @param {boolean} [options.danger=false] - Whether to style confirm button as danger
     * @returns {Promise<boolean>} True if confirmed, false if cancelled
     */
    show(options = {}) {
        const {
            title = 'Confirm',
            message = 'Are you sure?',
            icon = 'warning',
            confirmText = 'Delete',
            cancelText = 'Cancel',
            danger = true
        } = options

        return new Promise((resolve) => {
            this.resolvePromise = resolve
            this._createDialog({ title, message, icon, confirmText, cancelText, danger })
            document.body.appendChild(this.dialog)

            // Animate in
            requestAnimationFrame(() => {
                this.dialog.classList.add('modal-visible')
                // Focus the cancel button by default (safer)
                const cancelBtn = this.dialog.querySelector('.confirm-dialog-cancel')
                if (cancelBtn) cancelBtn.focus()
            })
        })
    }

    /**
     * Close the dialog
     * @param {boolean} result
     * @private
     */
    _close(result) {
        if (!this.dialog) return

        this.dialog.classList.remove('modal-visible')
        setTimeout(() => {
            this.dialog.remove()
            this.dialog = null
            if (this.resolvePromise) {
                this.resolvePromise(result)
                this.resolvePromise = null
            }
        }, 200)
    }

    /**
     * Create the dialog element
     * @param {object} options
     * @private
     */
    _createDialog({ title, message, icon, confirmText, cancelText, danger }) {
        this.dialog = document.createElement('div')
        this.dialog.className = 'modal-overlay'
        this.dialog.setAttribute('role', 'alertdialog')
        this.dialog.setAttribute('aria-modal', 'true')
        this.dialog.setAttribute('aria-labelledby', 'confirm-dialog-title')
        this.dialog.setAttribute('aria-describedby', 'confirm-dialog-message')

        const dangerClass = danger ? 'danger' : 'primary'

        this.dialog.innerHTML = `
            <div class="modal-content confirm-modal">
                <div class="confirm-modal-content">
                    <div class="confirm-modal-icon">
                        <span class="icon-material">${icon}</span>
                    </div>
                    <h3 class="confirm-modal-title" id="confirm-dialog-title">${title}</h3>
                    <p class="confirm-modal-message" id="confirm-dialog-message">${message}</p>
                    <div class="confirm-modal-actions">
                        <button class="action-btn confirm-dialog-cancel">${cancelText}</button>
                        <button class="action-btn ${dangerClass} confirm-dialog-confirm">${confirmText}</button>
                    </div>
                </div>
            </div>
        `

        // Event handlers
        const cancelBtn = this.dialog.querySelector('.confirm-dialog-cancel')
        const confirmBtn = this.dialog.querySelector('.confirm-dialog-confirm')

        cancelBtn.addEventListener('click', () => this._close(false))
        confirmBtn.addEventListener('click', () => this._close(true))

        // Close on backdrop click
        this.dialog.addEventListener('click', (e) => {
            if (e.target === this.dialog) this._close(false)
        })

        // Handle keyboard
        this.dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                this._close(false)
            } else if (e.key === 'Enter') {
                e.preventDefault()
                this._close(true)
            }
        })
    }
}

// Singleton instances
export const nameDialog = new NameDialog()
export const confirmDialog = new ConfirmDialog()
