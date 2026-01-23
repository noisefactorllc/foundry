/**
 * Import Effect from ZIP Dialog
 *
 * Dialog for importing custom shader effects from ZIP files.
 * Mirrors the UX of open-effect-dialog.js but for file upload.
 *
 * @module ui/import-effect-dialog
 */

// Inject styles once
const STYLES_ID = 'import-effect-dialog-styles'
if (!document.getElementById(STYLES_ID)) {
    const styleEl = document.createElement('style')
    styleEl.id = STYLES_ID
    styleEl.textContent = `
        .import-effect-overlay {
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
        
        .import-effect-overlay.visible {
            opacity: 1;
        }
        
        .import-effect-dialog {
            background: rgba(15, 17, 20, 0.98);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            width: 400px;
            max-width: 90vw;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            overflow: hidden;
        }
        
        .import-effect-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.75rem 1rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            background: linear-gradient(180deg, rgba(102, 126, 234, 0.15) 0%, rgba(102, 126, 234, 0.05) 100%);
        }
        
        .import-effect-title {
            font-size: 0.875rem;
            font-weight: 600;
            color: #d9deeb;
            text-transform: lowercase;
            letter-spacing: 0.05em;
        }
        
        .import-effect-close {
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
        
        .import-effect-close:hover {
            opacity: 1;
            color: #fff;
        }
        
        .import-effect-content {
            padding: 1rem;
        }
        
        .import-effect-description {
            font-size: 0.75rem;
            color: #888;
            margin-bottom: 1rem;
            line-height: 1.5;
        }
        
        .import-effect-dropzone {
            border: 2px dashed rgba(165, 184, 255, 0.3);
            border-radius: 6px;
            padding: 2rem 1rem;
            text-align: center;
            cursor: pointer;
            transition: all 0.15s ease;
            background: rgba(0, 0, 0, 0.2);
        }
        
        .import-effect-dropzone:hover,
        .import-effect-dropzone.dragover {
            border-color: rgba(165, 184, 255, 0.6);
            background: rgba(165, 184, 255, 0.05);
        }
        
        .import-effect-dropzone-icon {
            font-size: 2rem;
            color: #667eea;
            margin-bottom: 0.5rem;
        }
        
        .import-effect-dropzone-text {
            font-size: 0.75rem;
            color: #888;
        }
        
        .import-effect-dropzone-text strong {
            color: #667eea;
        }
        
        .import-effect-file-input {
            display: none;
        }
        
        .import-effect-info {
            margin-top: 1rem;
            padding: 0.75rem;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 6px;
            display: none;
        }
        
        .import-effect-info.visible {
            display: block;
        }
        
        .import-effect-info-name {
            font-size: 0.875rem;
            font-weight: 600;
            color: #d9deeb;
            margin-bottom: 0.25rem;
        }
        
        .import-effect-info-details {
            font-size: 0.6875rem;
            color: #888;
        }
        
        .import-effect-error {
            margin-top: 1rem;
            padding: 0.75rem;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 6px;
            font-size: 0.75rem;
            color: #f87171;
            display: none;
        }
        
        .import-effect-error.visible {
            display: block;
        }
        
        .import-effect-actions {
            margin-top: 1rem;
            display: flex;
            gap: 0.5rem;
        }
        
        .import-effect-btn {
            flex: 1;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        
        .import-effect-btn-primary {
            background: rgba(165, 184, 255, 0.3);
            border: 1px solid rgba(165, 184, 255, 0.5);
            color: #d9deeb;
        }
        
        .import-effect-btn-primary:hover:not(:disabled) {
            background: rgba(165, 184, 255, 0.5);
            border-color: #a5b8ff;
        }
        
        .import-effect-btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .import-effect-btn-secondary {
            background: transparent;
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: #888;
        }
        
        .import-effect-btn-secondary:hover {
            border-color: rgba(255, 255, 255, 0.3);
            color: #d9deeb;
        }
    `
    document.head.appendChild(styleEl)
}

/**
 * ImportEffectDialog class
 */
export class ImportEffectDialog {
    constructor() {
        this.overlay = null
        this.isOpen = false
        this.onImport = null
        this.pendingZip = null
    }

    /**
     * Set the callback for when an effect is imported
     * @param {Function} callback - Called with { name, files } object
     */
    onEffectImport(callback) {
        this.onImport = callback
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
        })

        this.isOpen = true
        this.pendingZip = null
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
        }, 150)

        this.isOpen = false
        this.pendingZip = null
    }

    /**
     * Create the dialog DOM
     * @private
     */
    _createDialog() {
        this.overlay = document.createElement('div')
        this.overlay.className = 'import-effect-overlay'

        const dialog = document.createElement('div')
        dialog.className = 'import-effect-dialog'
        dialog.setAttribute('role', 'dialog')
        dialog.setAttribute('aria-label', 'Import Effect from ZIP')

        // Header
        const header = document.createElement('div')
        header.className = 'import-effect-header'
        
        const title = document.createElement('div')
        title.className = 'import-effect-title'
        title.textContent = 'import effect from zip'
        
        const closeBtn = document.createElement('button')
        closeBtn.className = 'import-effect-close'
        closeBtn.innerHTML = '✕'
        closeBtn.addEventListener('click', () => this.close())
        
        header.appendChild(title)
        header.appendChild(closeBtn)

        // Content
        const content = document.createElement('div')
        content.className = 'import-effect-content'

        // Description
        const description = document.createElement('div')
        description.className = 'import-effect-description'
        description.textContent = 'Upload a ZIP file containing your custom shader effect. The ZIP should include definition.json and shader files in glsl/ and/or wgsl/ directories.'
        
        // Dropzone
        const dropzone = document.createElement('div')
        dropzone.className = 'import-effect-dropzone'
        
        const dropzoneIcon = document.createElement('div')
        dropzoneIcon.className = 'import-effect-dropzone-icon icon-material'
        dropzoneIcon.textContent = 'upload_file'
        
        const dropzoneText = document.createElement('div')
        dropzoneText.className = 'import-effect-dropzone-text'
        dropzoneText.innerHTML = '<strong>Click to browse</strong> or drag and drop'
        
        const fileInput = document.createElement('input')
        fileInput.type = 'file'
        fileInput.accept = '.zip'
        fileInput.className = 'import-effect-file-input'
        
        dropzone.appendChild(dropzoneIcon)
        dropzone.appendChild(dropzoneText)
        dropzone.appendChild(fileInput)
        
        // Info section
        const info = document.createElement('div')
        info.className = 'import-effect-info'
        
        const infoName = document.createElement('div')
        infoName.className = 'import-effect-info-name'
        
        const infoDetails = document.createElement('div')
        infoDetails.className = 'import-effect-info-details'
        
        info.appendChild(infoName)
        info.appendChild(infoDetails)
        
        // Error section
        const error = document.createElement('div')
        error.className = 'import-effect-error'
        
        // Actions
        const actions = document.createElement('div')
        actions.className = 'import-effect-actions'
        
        const cancelBtn = document.createElement('button')
        cancelBtn.className = 'import-effect-btn import-effect-btn-secondary'
        cancelBtn.textContent = 'Cancel'
        cancelBtn.addEventListener('click', () => this.close())
        
        const importBtn = document.createElement('button')
        importBtn.className = 'import-effect-btn import-effect-btn-primary'
        importBtn.textContent = 'Import'
        importBtn.disabled = true
        
        actions.appendChild(cancelBtn)
        actions.appendChild(importBtn)
        
        content.appendChild(description)
        content.appendChild(dropzone)
        content.appendChild(info)
        content.appendChild(error)
        content.appendChild(actions)
        
        dialog.appendChild(header)
        dialog.appendChild(content)
        this.overlay.appendChild(dialog)

        // Store references
        this._fileInput = fileInput
        this._dropzone = dropzone
        this._info = info
        this._infoName = infoName
        this._infoDetails = infoDetails
        this._error = error
        this._importBtn = importBtn

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

        // Close on Escape
        const escHandler = (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close()
                document.removeEventListener('keydown', escHandler)
            }
        }
        document.addEventListener('keydown', escHandler)

        // Dropzone click
        this._dropzone.addEventListener('click', () => {
            this._fileInput.click()
        })

        // Drag and drop
        this._dropzone.addEventListener('dragover', (e) => {
            e.preventDefault()
            this._dropzone.classList.add('dragover')
        })

        this._dropzone.addEventListener('dragleave', () => {
            this._dropzone.classList.remove('dragover')
        })

        this._dropzone.addEventListener('drop', (e) => {
            e.preventDefault()
            this._dropzone.classList.remove('dragover')
            const file = e.dataTransfer.files[0]
            if (file && file.name.endsWith('.zip')) {
                this._processFile(file)
            } else {
                this._showError('Please drop a ZIP file')
            }
        })

        // File input change
        this._fileInput.addEventListener('change', (e) => {
            const file = e.target.files?.[0]
            if (file) {
                this._processFile(file)
            }
        })

        // Import button
        this._importBtn.addEventListener('click', () => {
            if (this.pendingZip && this.onImport) {
                this._importBtn.disabled = true
                this._importBtn.textContent = 'Importing...'
                
                // Call the import callback
                Promise.resolve(this.onImport(this.pendingZip))
                    .then(() => {
                        this.close()
                    })
                    .catch((err) => {
                        this._showError(err.message || 'Failed to import effect')
                        this._importBtn.disabled = false
                        this._importBtn.textContent = 'Import'
                    })
            }
        })
    }

    /**
     * Process an uploaded ZIP file
     * @private
     * @param {File} file
     */
    async _processFile(file) {
        // Hide previous errors
        this._error.classList.remove('visible')
        this._info.classList.remove('visible')
        this._importBtn.disabled = true
        this.pendingZip = null

        try {
            // Load JSZip if needed
            if (typeof JSZip === 'undefined') {
                await this._loadJSZip()
            }

            // eslint-disable-next-line no-undef
            const zip = await JSZip.loadAsync(file)
            const files = {}

            // Find definition.json or definition.js
            let definitionPath = null
            let basePath = ''

            for (const path of Object.keys(zip.files)) {
                if (path.endsWith('definition.json') && !zip.files[path].dir) {
                    definitionPath = path
                    basePath = path.replace(/definition\.json$/, '')
                    break
                }
                if (path.endsWith('definition.js') && !zip.files[path].dir) {
                    definitionPath = path
                    basePath = path.replace(/definition\.js$/, '')
                    break
                }
            }

            if (!definitionPath) {
                throw new Error('ZIP must contain a definition.json or definition.js file')
            }

            // Extract all relevant files
            let hasGlsl = false
            let hasWgsl = false

            for (const [path, zipFile] of Object.entries(zip.files)) {
                if (zipFile.dir) continue
                if (basePath && !path.startsWith(basePath)) continue

                const relativePath = basePath ? path.slice(basePath.length) : path

                // Include definition, shader files, and dsl.txt
                if (relativePath === 'definition.json' ||
                    relativePath === 'definition.js' ||
                    relativePath === 'dsl.txt' ||
                    relativePath.startsWith('glsl/') ||
                    relativePath.startsWith('wgsl/')) {
                    
                    files[relativePath] = await zipFile.async('text')

                    if (relativePath.startsWith('glsl/') && relativePath.endsWith('.glsl')) {
                        hasGlsl = true
                    }
                    if (relativePath.startsWith('wgsl/') && relativePath.endsWith('.wgsl')) {
                        hasWgsl = true
                    }
                }
            }

            if (!hasGlsl && !hasWgsl) {
                throw new Error('ZIP must contain at least one shader in glsl/ or wgsl/ directory')
            }

            // Extract effect name
            let name = 'unnamed'
            const defContent = files['definition.json'] || files['definition.js']
            if (defContent) {
                try {
                    if (files['definition.json']) {
                        const def = JSON.parse(defContent)
                        name = def.name || def.func || 'unnamed'
                    } else {
                        // Extract from JS
                        const nameMatch = defContent.match(/name\s*[=:]\s*['"]([^'"]+)['"]/i)
                        if (nameMatch) name = nameMatch[1]
                    }
                } catch {
                    // Use default name
                }
            }

            // Count files
            const fileCount = Object.keys(files).length
            const glslCount = Object.keys(files).filter(f => f.endsWith('.glsl')).length
            const wgslCount = Object.keys(files).filter(f => f.endsWith('.wgsl')).length

            // Show info
            this._infoName.textContent = name
            let details = `${fileCount} files`
            if (glslCount > 0) details += ` • ${glslCount} GLSL`
            if (wgslCount > 0) details += ` • ${wgslCount} WGSL`
            this._infoDetails.textContent = details
            this._info.classList.add('visible')

            // Store for import
            this.pendingZip = { name, files }
            this._importBtn.disabled = false

        } catch (err) {
            console.error('Failed to process ZIP:', err)
            this._showError(err.message || 'Failed to process ZIP file')
        }
    }

    /**
     * Show an error message
     * @private
     * @param {string} message
     */
    _showError(message) {
        this._error.textContent = message
        this._error.classList.add('visible')
        this._info.classList.remove('visible')
        this._importBtn.disabled = true
        this.pendingZip = null
    }

    /**
     * Load JSZip library
     * @private
     */
    async _loadJSZip() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script')
            script.src = '/js/lib/jszip.min.js'
            script.onload = resolve
            script.onerror = () => reject(new Error('Failed to load JSZip library'))
            document.head.appendChild(script)
        })
    }
}
