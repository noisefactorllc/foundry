/**
 * About Modal
 *
 * Displays application info, version, and deployment metadata.
 *
 * @module ui/about-modal
 */

/**
 * AboutModal class
 */
export class AboutModal {
    constructor() {
        this.modal = null
        this.isOpen = false
        this.metadata = null
        this.metadataFetched = false
        this.noisemakerVersion = null
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
    async open() {
        if (this.isOpen) return

        this._createModal()
        document.body.appendChild(this.modal)

        // Animate in
        requestAnimationFrame(() => {
            this.modal.classList.add('modal-visible')
        })

        this.isOpen = true

        // Fetch deployment metadata if not already fetched
        if (!this.metadataFetched) {
            await this._fetchDeploymentMetadata()
        } else {
            this._updateBuildInfo()
        }

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
     * Fetch deployment metadata from server
     * @private
     */
    async _fetchDeploymentMetadata() {
        const defaults = { gitHash: 'LOCAL', deployed: 'n/a' }

        try {
            const response = await fetch('./deployment-meta.json', { cache: 'no-store' })
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }
            const data = await response.json()
            const rawHash = typeof data?.git_hash === 'string' ? data.git_hash.trim() : ''
            const rawDate = typeof data?.date === 'number' || typeof data?.date === 'string'
                ? data.date
                : null
            const normalizedHash = rawHash ? rawHash.replace(/\s+/g, '').slice(0, 8) : 'LOCAL'
            const normalizedTimestamp = this._normalizeTimestamp(rawDate)
            const formattedDate = typeof normalizedTimestamp === 'number'
                ? this._formatDate(normalizedTimestamp)
                : 'n/a'

            this.metadata = {
                gitHash: normalizedHash || 'LOCAL',
                deployed: formattedDate
            }
        } catch (error) {
            console.warn('[AboutModal] Failed to fetch deployment metadata:', error)
            this.metadata = defaults
        }

        this.metadataFetched = true
        this._updateBuildInfo()

        // Fetch noisemaker version from vendor bundle
        await this._fetchNoisemakerVersion()
    }

    /**
     * Fetch noisemaker version from vendor bundle header
     * @private
     */
    async _fetchNoisemakerVersion() {
        try {
            const response = await fetch('https://shaders.noisedeck.app/0.8.0/noisemaker-shaders-core.esm.js', { cache: 'no-store' })
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }
            // Read only the first 500 bytes to get the header
            const reader = response.body.getReader()
            const { value } = await reader.read()
            reader.cancel()
            const headerText = new TextDecoder().decode(value).slice(0, 500)
            // Parse Build: line from header comment
            const match = headerText.match(/^\s*\*\s*Build:\s*(\S+)/m)
            if (match) {
                this.noisemakerVersion = match[1]
                this._updateBuildInfo()
            }
        } catch (error) {
            console.warn('[AboutModal] Failed to fetch noisemaker version:', error)
        }
    }

    /**
     * Normalize timestamp value
     * @private
     */
    _normalizeTimestamp(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value
        }
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value.trim())
            if (Number.isFinite(parsed)) {
                return parsed
            }
        }
        return null
    }

    /**
     * Format date from unix timestamp
     * @private
     */
    _formatDate(timestampSeconds) {
        if (!Number.isFinite(timestampSeconds)) return 'n/a'
        const date = new Date(timestampSeconds * 1000)
        if (Number.isNaN(date.getTime())) return 'n/a'

        const pad = (value, length = 2) => String(Math.trunc(value)).padStart(length, '0')
        const year = String(date.getFullYear()).padStart(4, '0')
        const month = pad(date.getMonth() + 1)
        const day = pad(date.getDate())
        const hour = pad(date.getHours())
        const minute = pad(date.getMinutes())

        return `${year}-${month}-${day} ${hour}:${minute}`
    }

    /**
     * Update build info in the modal
     * @private
     */
    _updateBuildInfo() {
        if (!this.modal) return
        const buildInfoEl = this.modal.querySelector('.about-modal-build')
        if (buildInfoEl && this.metadata) {
            buildInfoEl.textContent = `build: ${this.metadata.gitHash} / deployed: ${this.metadata.deployed}`
        }
        const nmVersionEl = this.modal.querySelector('.about-modal-build.noisemaker-version')
        if (nmVersionEl) {
            nmVersionEl.textContent = this.noisemakerVersion
                ? `noisemaker version: ${this.noisemakerVersion}`
                : ''
        }
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
        this.modal.setAttribute('aria-labelledby', 'about-modal-title')

        const defaultBuildInfo = this.metadata
            ? `build: ${this.metadata.gitHash} / deployed: ${this.metadata.deployed}`
            : 'build: local / deployed: n/a'

        this.modal.innerHTML = `
            <div class="modal-content about-modal">
                <div class="about-modal-content">
                    <div class="about-modal-graphic" role="presentation">
                        <svg class="about-modal-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" fill="currentColor"><g transform="translate(0,600) scale(0.1,-0.1)"><path d="M883 4443 l677 -678 672 -2 671 -1 -679 679 -679 679 -670 0 -670 0 678 -677z"/><path d="M2308 4449 c370 -368 681 -673 692 -677 10 -4 315 -6 677 -4 l658 3 -680 674 -680 674 -670 0 -670 0 673 -670z"/><path d="M3753 4440 l682 -680 650 1 c358 0 656 3 663 8 8 5 -208 227 -662 679 l-675 672 -670 0 -669 0 681 -680z"/><path d="M1660 3673 c0 -4 305 -310 678 -680 l677 -672 670 0 670 -1 -681 680 -681 680 -667 0 c-366 0 -666 -3 -666 -7z"/><path d="M3765 3000 l680 -680 670 0 670 0 -680 680 -680 680 -670 0 -670 0 680 -680z"/><path d="M3780 1555 l675 -675 671 0 672 0 -676 675 -677 675 -670 0 -670 0 675 -675z"/></g></svg>
                    </div>
                    <div class="about-modal-details" tabindex="-1">
                        <div class="about-modal-title" id="about-modal-title">Foundry</div>
                        <div class="about-modal-copyright">&copy; 2026 <a href="https://noisefactor.io/" class="about-modal-link" target="_blank" rel="noopener">Noise Factor LLC.</a></div>
                        <div class="about-modal-build">${defaultBuildInfo}</div>
                        <div class="about-modal-build noisemaker-version">${this.noisemakerVersion ? `noisemaker version: ${this.noisemakerVersion}` : ''}</div>
                        <div class="about-modal-ecosystem">Foundry is a free tool by <a href="https://noisefactor.io/" target="_blank" rel="noopener">Noise Factor</a>, powered by the <a href="https://noisemaker.app/" target="_blank" rel="noopener">Noisemaker</a> open source engine. <a href="https://noisedeck.app/" target="_blank" rel="noopener">Noisedeck</a> is our video synth. Free to use, with a $4/mo subscription for pro features.</div>
                    </div>
                </div>
            </div>
        `

        // Close on backdrop click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close()
        })
    }
}

// Singleton instance
export const aboutModal = new AboutModal()
