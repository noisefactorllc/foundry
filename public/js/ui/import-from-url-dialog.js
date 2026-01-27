/**
 * Import from URL Dialog
 *
 * Dialog for importing compositions from sharing.noisedeck.app URLs.
 *
 * @module ui/import-from-url-dialog
 */

import { loadFromCode } from '../sharingLoader.js'

// Inject styles once
const STYLES_ID = 'import-from-url-dialog-styles'
if (!document.getElementById(STYLES_ID)) {
    const styleEl = document.createElement('style')
    styleEl.id = STYLES_ID
    styleEl.textContent = `
        .import-url-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
            display: flex;
            align-items: flex-start;
            justify-content: center;
            padding-top: 15vh;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.15s ease;
        }
        
        .import-url-overlay.visible {
            opacity: 1;
        }
        
        .import-url-dialog {
            background: rgba(15, 17, 20, 0.98);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            width: 450px;
            max-width: 90vw;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            overflow: hidden;
        }
        
        .import-url-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.75rem 1rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            background: linear-gradient(180deg, rgba(102, 126, 234, 0.15) 0%, rgba(102, 126, 234, 0.05) 100%);
        }
        
        .import-url-title {
            font-size: 0.875rem;
            font-weight: 600;
            color: #d9deeb;
            text-transform: lowercase;
            letter-spacing: 0.05em;
        }
        
        .import-url-close {
            background: transparent;
            border: none;
            color: #888;
            cursor: pointer;
            font-size: 1rem;
            padding: 0.25em 0.5em;
            line-height: 1;
            opacity: 0.7;
            transition: opacity 0.15s ease;
        }
        
        .import-url-close:hover {
            opacity: 1;
            color: #fff;
        }
        
        .import-url-content {
            padding: 1rem;
        }
        
        .import-url-description {
            font-size: 0.75rem;
            color: #888;
            margin-bottom: 1rem;
            line-height: 1.5;
        }
        
        .import-url-input-group {
            margin-bottom: 1rem;
        }
        
        .import-url-label {
            display: block;
            font-size: 0.75rem;
            color: #aaa;
            margin-bottom: 0.5rem;
            text-transform: lowercase;
        }
        
        .import-url-input {
            width: 100%;
            padding: 0.625rem 0.75rem;
            font-size: 0.8125rem;
            font-family: 'JetBrains Mono', 'SF Mono', Monaco, Consolas, monospace;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 4px;
            color: #fff;
            outline: none;
            transition: border-color 0.15s ease;
            box-sizing: border-box;
        }
        
        .import-url-input:focus {
            border-color: rgba(165, 184, 255, 0.5);
        }
        
        .import-url-input::placeholder {
            color: #555;
        }
        
        .import-url-info {
            font-size: 0.75rem;
            color: #aaa;
            padding: 0.75rem;
            background: rgba(165, 184, 255, 0.1);
            border-radius: 4px;
            margin-bottom: 1rem;
            display: none;
        }
        
        .import-url-info.visible {
            display: block;
        }
        
        .import-url-error {
            font-size: 0.75rem;
            color: #ff6b6b;
            padding: 0.75rem;
            background: rgba(255, 107, 107, 0.1);
            border-radius: 4px;
            margin-bottom: 1rem;
            display: none;
        }
        
        .import-url-error.visible {
            display: block;
        }
        
        .import-url-actions {
            display: flex;
            gap: 0.5rem;
            justify-content: flex-end;
        }
        
        .import-url-btn {
            padding: 0.5rem 1rem;
            font-size: 0.8125rem;
            font-weight: 500;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        
        .import-url-btn-primary {
            background: rgba(165, 184, 255, 0.2);
            color: #a5b8ff;
        }
        
        .import-url-btn-primary:hover:not(:disabled) {
            background: rgba(165, 184, 255, 0.3);
        }
        
        .import-url-btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .import-url-btn-secondary {
            background: transparent;
            color: #888;
        }
        
        .import-url-btn-secondary:hover {
            color: #fff;
        }
    `
    document.head.appendChild(styleEl)
}

/**
 * Extract the short code from a sharing URL
 * @param {string} url - The sharing URL
 * @returns {string|null} The short code or null if invalid
 */
function extractShortCode(url) {
    if (!url) return null
    
    // Direct code (just alphanumeric)
    if (/^[a-zA-Z0-9_-]{4,10}$/.test(url.trim())) {
        return url.trim()
    }
    
    try {
        const parsed = new URL(url)
        if (!parsed.hostname.includes('sharing.noisedeck.app')) {
            return null
        }
        const match = parsed.pathname.match(/^\/s\/([a-zA-Z0-9_-]+)$/)
        return match ? match[1] : null
    } catch {
        return null
    }
}

/**
 * Import from URL Dialog Class
 */
export class ImportFromUrlDialog {
    constructor() {
        this._overlay = null
        this._input = null
        this._info = null
        this._error = null
        this._loadBtn = null
        this._onLoad = null
    }

    /**
     * Open the dialog
     * @param {object} options
     * @param {function} options.onLoad - Callback with { dsl, title, effects, rawEffects }
     */
    open(options = {}) {
        this._onLoad = options.onLoad || null
        
        if (this._overlay) {
            this._overlay.remove()
        }
        
        this._overlay = document.createElement('div')
        this._overlay.className = 'import-url-overlay'
        this._overlay.innerHTML = `
            <div class="import-url-dialog">
                <div class="import-url-header">
                    <span class="import-url-title">import from url</span>
                    <button class="import-url-close" aria-label="Close">×</button>
                </div>
                <div class="import-url-content">
                    <p class="import-url-description">
                        Load a composition from a sharing.noisedeck.app URL.
                        You can paste the full URL or just the short code.
                    </p>
                    <div class="import-url-input-group">
                        <label class="import-url-label">sharing url or code</label>
                        <input type="text" class="import-url-input" placeholder="https://sharing.noisedeck.app/s/..." autocomplete="off">
                    </div>
                    <div class="import-url-info"></div>
                    <div class="import-url-error"></div>
                    <div class="import-url-actions">
                        <button class="import-url-btn import-url-btn-secondary">cancel</button>
                        <button class="import-url-btn import-url-btn-primary" disabled>load</button>
                    </div>
                </div>
            </div>
        `
        
        document.body.appendChild(this._overlay)
        
        this._input = this._overlay.querySelector('.import-url-input')
        this._info = this._overlay.querySelector('.import-url-info')
        this._error = this._overlay.querySelector('.import-url-error')
        this._loadBtn = this._overlay.querySelector('.import-url-btn-primary')
        const cancelBtn = this._overlay.querySelector('.import-url-btn-secondary')
        const closeBtn = this._overlay.querySelector('.import-url-close')
        
        // Event handlers
        this._input.addEventListener('input', () => this._validateInput())
        this._loadBtn.addEventListener('click', () => this._handleLoad())
        cancelBtn.addEventListener('click', () => this.close())
        closeBtn.addEventListener('click', () => this.close())
        
        // Close on overlay click
        this._overlay.addEventListener('click', (e) => {
            if (e.target === this._overlay) this.close()
        })
        
        // Close on escape
        this._escHandler = (e) => {
            if (e.key === 'Escape') this.close()
        }
        document.addEventListener('keydown', this._escHandler)
        
        // Animate in
        requestAnimationFrame(() => {
            this._overlay.classList.add('visible')
            this._input.focus()
        })
    }

    /**
     * Validate input and enable/disable load button
     */
    _validateInput() {
        const value = this._input.value.trim()
        this._error.classList.remove('visible')
        this._info.classList.remove('visible')
        
        if (!value) {
            this._loadBtn.disabled = true
            return
        }
        
        const code = extractShortCode(value)
        if (code) {
            this._loadBtn.disabled = false
        } else {
            this._loadBtn.disabled = true
            this._error.textContent = 'Invalid URL. Expected format: https://sharing.noisedeck.app/s/CODE'
            this._error.classList.add('visible')
        }
    }

    /**
     * Handle load button click
     */
    async _handleLoad() {
        const value = this._input.value.trim()
        const code = extractShortCode(value)
        
        if (!code) return
        
        this._loadBtn.disabled = true
        this._loadBtn.textContent = 'loading...'
        this._error.classList.remove('visible')
        
        try {
            const result = await loadFromCode(code)
            
            // Show info
            let info = `<b>${result.title || 'Untitled'}</b>`
            if (result.effects.length > 0) {
                info += `<br>${result.effects.length} custom effect${result.effects.length > 1 ? 's' : ''} loaded`
            }
            this._info.innerHTML = info
            this._info.classList.add('visible')
            
            // Call callback
            if (this._onLoad) {
                this._onLoad(result)
            }
            
            // Close dialog after short delay
            setTimeout(() => this.close(), 500)
            
        } catch (err) {
            console.error('Failed to load from URL:', err)
            this._error.textContent = err.message || 'Failed to load composition'
            this._error.classList.add('visible')
            this._loadBtn.disabled = false
            this._loadBtn.textContent = 'load'
        }
    }

    /**
     * Close the dialog
     */
    close() {
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler)
            this._escHandler = null
        }
        
        if (this._overlay) {
            this._overlay.classList.remove('visible')
            setTimeout(() => {
                this._overlay.remove()
                this._overlay = null
            }, 150)
        }
    }
}

// Singleton instance
export const importFromUrlDialog = new ImportFromUrlDialog()
