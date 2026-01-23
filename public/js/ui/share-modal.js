/**
 * Share Modal
 *
 * Shares the current effect to sharing.noisedeck.app via the Portable Effects API.
 *
 * @module ui/share-modal
 */

import { toast } from './toast.js'
import { workspaceStore } from '../workspace/index.js'

const SHARE_API_URL = 'https://sharing.noisedeck.app/api/embed/shorten'

/**
 * ShareModal class
 */
export class ShareModal {
    constructor() {
        this.modal = null
        this.isOpen = false
        this.isSharing = false
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
     * @param {Object} options
     * @param {string} options.dsl - DSL program
     * @param {HTMLCanvasElement} options.canvas - Canvas for screenshot
     * @param {Object} options.renderer - ShadeRenderer instance for programState
     */
    async open(options = {}) {
        if (this.isOpen) return

        this.options = options
        // Capture screenshot before creating modal
        this.screenshot = this._captureScreenshot()
        this._createModal()
        document.body.appendChild(this.modal)

        // Set preview image
        const previewImg = this.modal.querySelector('#share-preview-img')
        if (previewImg && this.screenshot) {
            previewImg.src = this.screenshot
        }

        // Animate in
        requestAnimationFrame(() => {
            this.modal.classList.add('modal-visible')
        })

        this.isOpen = true

        // Close on escape
        this._escHandler = (e) => {
            if (e.key === 'Escape' && !this.isSharing) this.close()
        }
        document.addEventListener('keydown', this._escHandler)

        // Focus title input
        const titleInput = this.modal.querySelector('#share-title')
        if (titleInput) {
            titleInput.focus()
            titleInput.select()
        }
    }

    /**
     * Close the modal
     */
    close() {
        if (!this.isOpen || this.isSharing) return

        this.modal.classList.remove('modal-visible')
        setTimeout(() => {
            this.modal.remove()
            this.modal = null
        }, 200)

        this.isOpen = false
        document.removeEventListener('keydown', this._escHandler)
    }

    /**
     * Create a base64-encoded ZIP of the effect
     * @private
     * @returns {Promise<string|null>} Base64-encoded ZIP or null if no files
     */
    async _createEffectZip() {
        const files = workspaceStore.toObject()
        
        // Check if we have the minimum required files
        const defJson = files['definition.json']
        const glslFiles = Object.keys(files).filter(p => p.startsWith('glsl/') && p.endsWith('.glsl'))
        
        if (!defJson || glslFiles.length === 0) {
            console.log('[ShareModal] No complete effect to package')
            return null
        }

        try {
            // Dynamically load JSZip from CDN
            if (!window.JSZip) {
                await this._loadJSZip()
            }

            const zip = new window.JSZip()
            
            // Add definition.json
            zip.file('definition.json', defJson)
            
            // Add GLSL files
            for (const path of glslFiles) {
                zip.file(path, files[path])
            }

            // Generate base64-encoded ZIP
            const zipBlob = await zip.generateAsync({ type: 'blob' })
            const base64 = await this._blobToBase64(zipBlob)
            
            return base64
        } catch (error) {
            console.error('[ShareModal] Failed to create ZIP:', error)
            return null
        }
    }

    /**
     * Load JSZip library from CDN
     * @private
     */
    async _loadJSZip() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script')
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
            script.onload = resolve
            script.onerror = () => reject(new Error('Failed to load JSZip'))
            document.head.appendChild(script)
        })
    }

    /**
     * Convert Blob to base64 string
     * @private
     */
    async _blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
                // Remove data URL prefix to get just the base64
                const dataUrl = reader.result
                const base64 = dataUrl.split(',')[1]
                resolve(base64)
            }
            reader.onerror = reject
            reader.readAsDataURL(blob)
        })
    }

    /**
     * Capture screenshot from canvas
     * @private
     * @returns {string|null} Data URL or null if no canvas
     */
    _captureScreenshot() {
        const canvas = this.options?.canvas
        if (!canvas) return null

        try {
            // Create a 1200x630 canvas for og:image dimensions
            const targetWidth = 1200
            const targetHeight = 630
            
            const tempCanvas = document.createElement('canvas')
            tempCanvas.width = targetWidth
            tempCanvas.height = targetHeight
            const ctx = tempCanvas.getContext('2d')
            
            // Calculate scaling to cover the target area
            const sourceAspect = canvas.width / canvas.height
            const targetAspect = targetWidth / targetHeight
            
            let sx, sy, sw, sh
            if (sourceAspect > targetAspect) {
                // Source is wider - crop horizontally
                sh = canvas.height
                sw = canvas.height * targetAspect
                sx = (canvas.width - sw) / 2
                sy = 0
            } else {
                // Source is taller - crop vertically
                sw = canvas.width
                sh = canvas.width / targetAspect
                sx = 0
                sy = (canvas.height - sh) / 2
            }
            
            ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight)
            
            return tempCanvas.toDataURL('image/jpeg', 0.85)
        } catch (error) {
            console.error('[ShareModal] Screenshot capture failed:', error)
            return null
        }
    }

    /**
     * Handle the share action
     * @private
     */
    async _handleShare() {
        if (this.isSharing) return

        const titleInput = this.modal.querySelector('#share-title')
        const descInput = this.modal.querySelector('#share-description')
        const shareBtn = this.modal.querySelector('#share-submit-btn')

        const title = titleInput?.value.trim() || ''
        const description = descInput?.value.trim() || ''
        
        // Get DSL with current parameter values
        let dsl = this.options?.dsl || ''
        const renderer = this.options?.renderer
        
        // Try to get DSL with current param values from ShadeRenderer's programState
        if (renderer?.programState?.toDsl) {
            try {
                const dslWithParams = renderer.programState.toDsl()
                if (dslWithParams && dslWithParams.trim()) {
                    dsl = dslWithParams
                    console.log('[ShareModal] Using DSL with current params from programState')
                }
            } catch (err) {
                console.warn('[ShareModal] Failed to get DSL from programState:', err)
            }
        }

        if (!dsl) {
            toast.error('No DSL program to share')
            return
        }

        this.isSharing = true
        shareBtn.disabled = true
        shareBtn.innerHTML = '<span class="loading-spinner"></span> Sharing...'

        try {
            // Prepare the request
            const screenshot = this.screenshot
            const effectZip = await this._createEffectZip()
            
            const payload = {
                dsl,
                title: title || workspaceStore.name || 'Foundry',
                description: description || 'Created with Foundry'
            }

            if (screenshot) {
                payload.screenshot = screenshot
            }

            if (effectZip) {
                payload.effects = [effectZip]
            }

            console.log('[ShareModal] Sharing:', { 
                title: payload.title, 
                dslLength: dsl.length,
                hasScreenshot: !!screenshot,
                hasEffects: !!effectZip
            })

            const response = await fetch(SHARE_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                const errorMsg = errorData.details || errorData.error || `HTTP ${response.status}`
                throw new Error(errorMsg)
            }

            const result = await response.json()
            console.log('[ShareModal] Share result:', result)

            // Show the result
            this._showResult(result)
            toast.success('Effect shared successfully!')

        } catch (error) {
            console.error('[ShareModal] Share failed:', error)
            toast.error(`Share failed: ${error.message}`)
            shareBtn.disabled = false
            shareBtn.innerHTML = '<span class="icon-material">share</span> Share'
        } finally {
            this.isSharing = false
        }
    }

    /**
     * Show the share result
     * @private
     */
    _showResult(result) {
        const formSection = this.modal.querySelector('.share-form')
        const resultSection = this.modal.querySelector('.share-result')

        if (formSection) formSection.style.display = 'none'
        if (resultSection) {
            resultSection.style.display = 'block'
            
            const urlInput = resultSection.querySelector('#share-url')
            if (urlInput) {
                urlInput.value = result.shortUrl
            }

            const expiresEl = resultSection.querySelector('.share-expires')
            if (expiresEl && result.expiresAt) {
                const expiresDate = new Date(result.expiresAt)
                expiresEl.textContent = `Expires: ${expiresDate.toLocaleDateString()}`
            }

            // Update effect count if effects were uploaded
            const effectsEl = resultSection.querySelector('.share-effects-count')
            if (effectsEl) {
                const count = result.effectCount || (result.effects?.length ?? 0)
                if (count > 0) {
                    effectsEl.textContent = `${count} portable effect${count > 1 ? 's' : ''} included`
                    effectsEl.style.display = 'block'
                }
            }
        }
    }

    /**
     * Copy the share URL to clipboard
     * @private
     */
    async _copyUrl() {
        const urlInput = this.modal.querySelector('#share-url')
        if (!urlInput) return

        try {
            await navigator.clipboard.writeText(urlInput.value)
            toast.success('URL copied to clipboard')
        } catch {
            // Fallback
            urlInput.select()
            document.execCommand('copy')
            toast.success('URL copied to clipboard')
        }
    }

    /**
     * Create the modal element
     * @private
     */
    _createModal() {
        const effectName = workspaceStore.name || 'Foundry'

        this.modal = document.createElement('div')
        this.modal.className = 'modal-overlay'
        this.modal.setAttribute('role', 'dialog')
        this.modal.setAttribute('aria-modal', 'true')
        this.modal.setAttribute('aria-labelledby', 'share-modal-title')

        this.modal.innerHTML = `
            <div class="modal-content share-modal">
                <div class="modal-header">
                    <h2 id="share-modal-title">Share Effect</h2>
                    <button class="modal-close" aria-label="Close">
                        <span class="icon-material">close</span>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="share-preview">
                        <img id="share-preview-img" alt="Effect preview">
                    </div>
                    <div class="share-form">
                        <div class="share-field">
                            <label for="share-title">Title</label>
                            <input type="text" id="share-title" value="${this._escapeHtml(effectName)}" placeholder="Effect name" maxlength="100">
                        </div>
                        <div class="share-field">
                            <label for="share-description">Description <span class="optional">(optional)</span></label>
                            <textarea id="share-description" rows="2" placeholder="Describe your effect..." maxlength="500"></textarea>
                        </div>
                        <div class="share-info">
                            <span class="icon-material">info</span>
                            <span>Your effect will be shared to sharing.noisedeck.app and accessible for 90 days.</span>
                        </div>
                        <div class="share-actions">
                            <button id="share-submit-btn" class="action-btn primary">
                                <span class="icon-material">share</span>
                                Share
                            </button>
                        </div>
                    </div>
                    <div class="share-result" style="display: none;">
                        <div class="share-success">
                            <span class="icon-material success-icon">check_circle</span>
                            <span>Effect shared!</span>
                        </div>
                        <div class="share-url-field">
                            <input type="text" id="share-url" readonly>
                            <button id="share-copy-btn" class="action-btn small" title="Copy URL">
                                <span class="icon-material">content_copy</span>
                            </button>
                        </div>
                        <div class="share-effects-count" style="display: none;"></div>
                        <div class="share-expires"></div>
                        <div class="share-actions">
                            <button id="share-done-btn" class="action-btn">Done</button>
                        </div>
                    </div>
                </div>
            </div>
        `

        // Event handlers
        this.modal.querySelector('.modal-close').addEventListener('click', () => this.close())
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal && !this.isSharing) this.close()
        })

        const shareBtn = this.modal.querySelector('#share-submit-btn')
        shareBtn.addEventListener('click', () => this._handleShare())

        const copyBtn = this.modal.querySelector('#share-copy-btn')
        copyBtn.addEventListener('click', () => this._copyUrl())

        const doneBtn = this.modal.querySelector('#share-done-btn')
        doneBtn.addEventListener('click', () => this.close())

        // Enter key to submit
        const titleInput = this.modal.querySelector('#share-title')
        titleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                this._handleShare()
            }
        })
    }

    /**
     * Escape HTML entities
     * @private
     */
    _escapeHtml(str) {
        const div = document.createElement('div')
        div.textContent = str
        return div.innerHTML
    }
}

// Singleton instance
export const shareModal = new ShareModal()
