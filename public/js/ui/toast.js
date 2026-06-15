/**
 * Toast Notifications
 *
 * Non-blocking notifications for errors, success, and info messages.
 *
 * @module ui/toast
 */

import { escapeHtml } from '../utils/html.js'

/**
 * Toast class
 */
export class Toast {
    constructor() {
        this.container = null
        this._ensureContainer()
    }

    /**
     * Show a toast notification
     * @param {string} message - Message to display
     * @param {'info'|'success'|'error'|'warning'} [type='info'] - Toast type
     * @param {number} [duration=3000] - Auto-dismiss duration in ms (0 for persistent)
     */
    show(message, type = 'info', duration = 3000) {
        this._ensureContainer()

        const toast = document.createElement('div')
        toast.className = `toast toast-${type}`
        
        const icon = this._getIcon(type)
        // message may contain untrusted text (e.g. a shared composition title
        // or an error string), so escape it before inserting as HTML.
        toast.innerHTML = `
            <span class="toast-icon">${icon}</span>
            <span class="toast-message">${escapeHtml(message)}</span>
            <button class="toast-close" aria-label="Dismiss"><span class="icon-material">close</span></button>
        `

        // Close button
        toast.querySelector('.toast-close').addEventListener('click', () => {
            this._dismiss(toast)
        })

        this.container.appendChild(toast)

        // Animate in
        requestAnimationFrame(() => {
            toast.classList.add('toast-visible')
        })

        // Auto-dismiss
        if (duration > 0) {
            setTimeout(() => this._dismiss(toast), duration)
        }

        return toast
    }

    /**
     * Show info toast
     */
    info(message, duration) {
        return this.show(message, 'info', duration)
    }

    /**
     * Show success toast
     */
    success(message, duration) {
        return this.show(message, 'success', duration)
    }

    /**
     * Show error toast
     */
    error(message, duration = 5000) {
        return this.show(message, 'error', duration)
    }

    /**
     * Show warning toast
     */
    warning(message, duration = 4000) {
        return this.show(message, 'warning', duration)
    }

    /**
     * Dismiss a toast
     * @private
     */
    _dismiss(toast) {
        toast.classList.remove('toast-visible')
        toast.classList.add('toast-hiding')
        setTimeout(() => toast.remove(), 300)
    }

    /**
     * Get icon for toast type
     * @private
     */
    _getIcon(type) {
        switch (type) {
            case 'success': return '<span class="icon-material">check_circle</span>'
            case 'error': return '<span class="icon-material">error</span>'
            case 'warning': return '<span class="icon-material">warning</span>'
            default: return '<span class="icon-material">info</span>'
        }
    }

    /**
     * Ensure container exists
     * @private
     */
    _ensureContainer() {
        if (!this.container || !document.body.contains(this.container)) {
            this.container = document.createElement('div')
            this.container.id = 'toast-container'
            this.container.setAttribute('role', 'alert')
            this.container.setAttribute('aria-live', 'polite')
            document.body.appendChild(this.container)
        }
    }
}

// Singleton instance
export const toast = new Toast()
