/**
 * Share Modal
 *
 * Shares the current effect to sharing.noisedeck.app via the Portable Effects API.
 *
 * @module ui/share-modal
 */

import { toast } from './toast.js'
import { workspaceStore } from '../workspace/index.js'
import { escapeHtml } from '../utils/html.js'
import { attachShareFiles } from '../sharingLoader.js'

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
            try {
                previewImg.src = this.screenshot.toDataURL('image/jpeg', 0.85)
            } catch (error) {
                console.error('[ShareModal] Screenshot preview failed:', error)
            }
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
     * @returns {HTMLCanvasElement|null} The 1200x630 screenshot canvas, or null if no canvas
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
            
            return tempCanvas
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

            if (effectZip) {
                payload.effects = [effectZip]
            }

            console.log('[ShareModal] Sharing:', { 
                title: payload.title, 
                dslLength: dsl.length,
                hasScreenshot: !!screenshot,
                hasEffects: !!effectZip
            })

            // Images and the screenshot go to the sharing service as files.
            await attachShareFiles(payload, { images: renderer?.images || [], screenshot })

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
                        <button id="share-blaster-btn" class="blaster-publish-btn" type="button">
                            publish on <svg version="1.0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 95" preserveAspectRatio="xMidYMid meet"><g transform="translate(0,95) scale(0.1,-0.1)" fill="currentColor" stroke="none"><path d="M310 490 l0 -200 55 0 55 0 0 115 0 115 30 0 c27 0 30 -3 30 -30 0 -25 4 -30 25 -30 20 0 25 -5 25 -25 0 -21 5 -25 30 -25 l30 0 0 -60 0 -61 58 3 57 3 3 198 2 197 -60 0 -60 0 0 -85 c0 -84 0 -85 -25 -85 -21 0 -25 5 -25 30 0 27 -3 30 -30 30 -25 0 -30 4 -30 24 0 19 -6 25 -27 28 -22 2 -29 9 -31 31 -3 26 -6 27 -58 27 l-54 0 0 -200z"/><path d="M1320 660 l0 -30 60 0 60 0 0 30 0 30 -60 0 -60 0 0 -30z"/><path d="M2422 493 l3 -198 168 -3 167 -2 0 30 c0 27 3 30 30 30 l31 0 -3 58 c-3 54 -4 57 -30 60 -22 3 -28 9 -28 28 0 20 5 24 30 24 30 0 30 1 30 55 0 54 0 55 -30 55 -27 0 -30 3 -30 30 l0 30 -170 0 -170 0 2 -197z m278 82 l0 -55 -80 0 -80 0 0 55 0 55 80 0 80 0 0 -55z m0 -170 l0 -55 -80 0 -80 0 0 55 0 55 80 0 80 0 0 -55z"/><path d="M2902 493 l3 -198 165 0 165 0 3 27 3 27 -113 3 -113 3 -3 168 -2 167 -55 0 -55 0 2 -197z"/><path d="M3380 660 c0 -27 -3 -30 -30 -30 -25 0 -30 -4 -30 -25 0 -20 -5 -25 -25 -25 l-25 0 0 -145 0 -145 55 0 55 0 0 60 0 60 85 0 85 0 0 -60 0 -60 55 0 55 0 0 145 0 145 -25 0 c-20 0 -25 5 -25 25 0 21 -5 25 -30 25 -27 0 -30 3 -30 30 l0 30 -85 0 -85 0 0 -30z m110 -55 c0 -21 5 -25 30 -25 30 0 30 -1 30 -55 l0 -55 -85 0 -85 0 0 55 c0 54 0 55 30 55 25 0 30 4 30 25 0 20 5 25 25 25 20 0 25 -5 25 -25z"/><path d="M3748 663 c-2 -22 -9 -29 -30 -31 -27 -3 -28 -6 -28 -58 0 -53 0 -54 30 -54 27 0 30 -3 30 -30 l0 -30 110 0 110 0 0 -55 0 -56 -82 3 c-82 3 -83 3 -86 31 -3 26 -6 27 -58 27 -53 0 -54 0 -54 -30 0 -27 3 -30 30 -30 27 0 30 -3 30 -30 l0 -31 138 3 137 3 3 27 c3 21 9 27 30 30 25 3 27 7 28 48 1 59 -4 70 -32 70 -19 0 -24 5 -24 25 l0 25 -115 0 -115 0 0 55 0 55 85 0 c84 0 85 0 85 -25 0 -25 2 -26 58 -23 50 3 57 6 60 26 3 19 -1 22 -27 22 -28 0 -31 3 -31 30 l0 30 -139 0 -140 0 -3 -27z"/><path d="M4170 660 c0 -30 1 -30 55 -30 l55 0 2 -167 3 -168 55 0 55 0 3 168 2 167 55 0 c54 0 55 0 55 30 l0 30 -170 0 -170 0 0 -30z"/><path d="M4532 493 l3 -198 198 -3 197 -2 0 30 0 30 -140 0 -140 0 0 55 0 55 110 0 110 0 0 30 0 30 -110 0 -110 0 0 55 0 55 140 0 140 0 0 30 0 30 -200 0 -200 0 2 -197z"/><path d="M4960 490 l0 -200 55 0 55 0 0 61 c0 60 0 60 28 57 21 -2 28 -9 30 -30 3 -22 9 -28 27 -28 18 0 24 -6 27 -27 3 -28 4 -28 86 -31 l82 -3 0 31 c0 25 -4 30 -25 30 -21 0 -25 5 -25 30 0 27 -3 30 -30 30 -25 0 -30 4 -30 25 0 24 3 25 55 25 l55 0 0 85 c0 84 0 85 -25 85 -21 0 -25 5 -25 30 l0 30 -170 0 -170 0 0 -200z m280 85 c0 -54 0 -55 -30 -55 -25 0 -30 -4 -30 -25 0 -24 -3 -25 -55 -25 l-55 0 0 80 0 80 85 0 85 0 0 -55z"/><path d="M5490 550 l0 -140 60 0 60 0 0 55 c0 52 1 55 25 55 25 0 25 1 25 85 l0 85 -85 0 -85 0 0 -140z"/><path d="M790 550 c0 -27 -3 -30 -30 -30 l-30 0 0 -85 0 -85 30 0 c27 0 30 -3 30 -30 l0 -30 140 0 140 0 0 30 c0 27 3 30 30 30 l30 0 0 85 0 85 -30 0 c-27 0 -30 3 -30 30 l0 30 -140 0 -140 0 0 -30z m220 -115 l0 -85 -80 0 -80 0 0 85 0 85 80 0 80 0 0 -85z"/><path d="M1270 550 c0 -25 4 -30 25 -30 25 0 25 -1 25 -85 l0 -85 -55 0 c-54 0 -55 0 -55 -30 l0 -30 170 0 170 0 0 30 c0 30 -1 30 -55 30 l-55 0 0 115 0 115 -85 0 -85 0 0 -30z"/><path d="M1630 550 c0 -25 -4 -30 -25 -30 -21 0 -25 -5 -25 -30 0 -25 4 -30 25 -30 20 0 25 -5 25 -25 l0 -25 115 0 115 0 0 -30 0 -30 -140 0 -140 0 0 -30 0 -30 168 2 167 3 3 28 c3 21 9 27 28 27 20 0 24 5 24 30 0 25 -4 30 -24 30 -19 0 -25 6 -28 28 l-3 27 -112 3 c-113 3 -113 3 -113 27 l0 25 115 0 115 0 0 30 0 30 -145 0 -145 0 0 -30z"/><path d="M2059 573 c-1 -5 -2 -17 -3 -28 -1 -14 -9 -21 -28 -23 l-28 -3 0 -84 0 -84 28 -3 c21 -2 27 -8 27 -28 l0 -25 143 -3 142 -3 0 30 0 30 -112 3 -113 3 0 25 0 25 143 3 142 3 0 54 c0 54 0 55 -30 55 -27 0 -30 3 -30 30 l0 30 -140 0 c-77 0 -140 -3 -141 -7z m221 -78 c0 -25 -1 -25 -85 -25 -84 0 -85 0 -85 25 0 25 1 25 85 25 84 0 85 0 85 -25z"/><path d="M5492 323 c3 -27 5 -28 58 -28 53 0 55 1 58 28 3 27 3 27 -58 27 -61 0 -61 0 -58 -27z"/></g></svg>
                        </button>
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

        const blasterBtn = this.modal.querySelector('#share-blaster-btn')
        blasterBtn.addEventListener('click', () => this._publishToBlaster())

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
        return escapeHtml(str)
    }

    /**
     * Publish to NoiseBLASTER!
     * @private
     */
    _publishToBlaster() {
        const urlInput = this.modal.querySelector('#share-url')
        if (!urlInput || !urlInput.value) return

        // Extract code from URL (e.g., https://sharing.noisedeck.app/s/ABC123)
        const match = urlInput.value.match(/\/s\/([a-zA-Z0-9_-]+)$/)
        if (!match) {
            console.error('Could not extract share code from URL:', urlInput.value)
            return
        }

        const code = match[1]
        const intakeUrl = `https://blaster.noisedeck.app/intake?code=${encodeURIComponent(code)}&app=foundry`
        window.open(intakeUrl, '_blank')
    }
}

// Singleton instance
export const shareModal = new ShareModal()
