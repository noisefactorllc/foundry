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
                        <img class="about-modal-logo" src="/img/logo.png" alt="Effect Workspace logo">
                    </div>
                    <div class="about-modal-details" tabindex="-1">
                        <div class="about-modal-title" id="about-modal-title">Effect Workspace</div>
                        <div class="about-modal-copyright">&copy; 2026 <a href="https://noisefactor.io/" class="about-modal-link" target="_blank" rel="noopener">Noise Factor LLC.</a></div>
                        <div class="about-modal-build">${defaultBuildInfo}</div>
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
