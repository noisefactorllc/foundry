/**
 * Performance Utilities
 *
 * Performance monitoring and optimization helpers.
 *
 * @module utils/performance
 */

/**
 * Frame Rate Monitor
 * Monitors rendering performance and detects drops
 */
export class FrameRateMonitor {
    constructor(options = {}) {
        /** @type {number} */
        this.targetFPS = options.targetFPS || 60
        
        /** @type {number} */
        this.warningThreshold = options.warningThreshold || 0.7 // 70% of target
        
        /** @type {number[]} */
        this.samples = []
        
        /** @type {number} */
        this.maxSamples = options.maxSamples || 60
        
        /** @type {function|null} */
        this.onDrop = options.onDrop || null
        
        /** @type {boolean} */
        this.warned = false
    }

    /**
     * Record a frame time
     * @param {number} fps - Current FPS
     */
    sample(fps) {
        this.samples.push(fps)
        
        if (this.samples.length > this.maxSamples) {
            this.samples.shift()
        }
        
        // Check for sustained drops
        if (this.samples.length >= 10) {
            const avg = this.getAverageFPS()
            const threshold = this.targetFPS * this.warningThreshold
            
            if (avg < threshold && !this.warned) {
                this.warned = true
                this.onDrop?.(avg, this.targetFPS)
            } else if (avg >= threshold) {
                this.warned = false
            }
        }
    }

    /**
     * Get average FPS over sample window
     * @returns {number}
     */
    getAverageFPS() {
        if (this.samples.length === 0) return 0
        return this.samples.reduce((a, b) => a + b, 0) / this.samples.length
    }

    /**
     * Get minimum FPS in sample window
     * @returns {number}
     */
    getMinFPS() {
        if (this.samples.length === 0) return 0
        return Math.min(...this.samples)
    }

    /**
     * Get frame time jitter (variance)
     * @returns {number}
     */
    getJitter() {
        if (this.samples.length < 2) return 0
        const avg = this.getAverageFPS()
        const variance = this.samples.reduce((sum, fps) => sum + Math.pow(fps - avg, 2), 0) / this.samples.length
        return Math.sqrt(variance)
    }

    /**
     * Reset samples
     */
    reset() {
        this.samples = []
        this.warned = false
    }
}

/**
 * Debounce a function
 * @param {function} fn - Function to debounce
 * @param {number} delay - Delay in ms
 * @returns {function}
 */
export function debounce(fn, delay) {
    let timeoutId = null
    return function (...args) {
        clearTimeout(timeoutId)
        timeoutId = setTimeout(() => fn.apply(this, args), delay)
    }
}

/**
 * Throttle a function
 * @param {function} fn - Function to throttle
 * @param {number} limit - Minimum time between calls in ms
 * @returns {function}
 */
export function throttle(fn, limit) {
    let lastCall = 0
    return function (...args) {
        const now = Date.now()
        if (now - lastCall >= limit) {
            lastCall = now
            return fn.apply(this, args)
        }
    }
}

/**
 * Request idle callback with fallback
 * @param {function} callback - Callback to run when idle
 * @param {object} [options] - Options
 * @returns {number} Handle for cancellation
 */
export function requestIdleCallback(callback, options = {}) {
    if ('requestIdleCallback' in window) {
        return window.requestIdleCallback(callback, options)
    }
    // Fallback for Safari
    return setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1)
}

/**
 * Cancel idle callback
 * @param {number} handle - Handle from requestIdleCallback
 */
export function cancelIdleCallback(handle) {
    if ('cancelIdleCallback' in window) {
        window.cancelIdleCallback(handle)
    } else {
        clearTimeout(handle)
    }
}

/**
 * Measure execution time
 * @param {string} label - Performance label
 * @param {function} fn - Function to measure
 * @returns {*} Return value of fn
 */
export async function measure(label, fn) {
    const start = performance.now()
    const result = await fn()
    const duration = performance.now() - start
    console.debug(`[Perf] ${label}: ${duration.toFixed(2)}ms`)
    return result
}

/**
 * Check WebGPU availability and capabilities
 * @returns {Promise<{available: boolean, limits?: object}>}
 */
export async function checkWebGPUSupport() {
    if (!navigator.gpu) {
        return { available: false }
    }

    try {
        const adapter = await navigator.gpu.requestAdapter()
        if (!adapter) {
            return { available: false }
        }

        const limits = adapter.limits
        return {
            available: true,
            limits: {
                maxTextureDimension2D: limits.maxTextureDimension2D,
                maxBindGroups: limits.maxBindGroups,
                maxComputeWorkgroupSizeX: limits.maxComputeWorkgroupSizeX
            }
        }
    } catch {
        return { available: false }
    }
}

/**
 * Check WebGL2 availability and capabilities
 * @returns {{available: boolean, renderer?: string, vendor?: string}}
 */
export function checkWebGL2Support() {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')

    if (!gl) {
        return { available: false }
    }

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
    const result = {
        available: true,
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'Unknown',
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'Unknown'
    }

    // Clean up
    const loseContext = gl.getExtension('WEBGL_lose_context')
    if (loseContext) loseContext.loseContext()

    return result
}

/**
 * Synthetic delay for UI pacing
 * Returns a random duration between 5-10 seconds
 * @returns {number} Delay in milliseconds
 */
export function syntheticDelay() {
    return 5000 + Math.random() * 5000
}

/**
 * Wait for a synthetic delay
 * @returns {Promise<void>}
 */
export function waitSyntheticDelay() {
    return new Promise(resolve => setTimeout(resolve, syntheticDelay()))
}
