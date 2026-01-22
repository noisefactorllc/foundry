/**
 * Error Handler - Global error handling and recovery
 *
 * Provides centralized error handling for the Shade application,
 * including global error catching, recovery strategies, and user feedback.
 *
 * @module utils/error-handler
 */

import { toast } from '../ui/index.js'

/**
 * Error types for categorization
 */
export const ErrorType = {
    SHADER: 'shader',
    NETWORK: 'network',
    STORAGE: 'storage',
    API: 'api',
    RENDER: 'render',
    UNKNOWN: 'unknown'
}

/**
 * ErrorHandler class
 */
class ErrorHandler {
    constructor() {
        /** @type {Array<{type: string, message: string, timestamp: number, stack?: string}>} */
        this.errorLog = []
        
        /** @type {number} */
        this.maxLogSize = 100
        
        /** @type {boolean} */
        this.isRecovering = false
        
        this._setupGlobalHandlers()
    }

    /**
     * Setup global error handlers
     * @private
     */
    _setupGlobalHandlers() {
        // Catch unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            this.handle(event.reason, ErrorType.UNKNOWN, false)
            event.preventDefault()
        })

        // Catch uncaught errors
        window.addEventListener('error', (event) => {
            this.handle(event.error || event.message, ErrorType.UNKNOWN, false)
            event.preventDefault()
        })

        // WebGL context lost
        document.addEventListener('webglcontextlost', (event) => {
            event.preventDefault()
            this.handleContextLost('WebGL')
        })

        // WebGPU device lost handling would be in the renderer
    }

    /**
     * Handle an error
     * @param {Error|string} error - The error
     * @param {string} [type=ErrorType.UNKNOWN] - Error type
     * @param {boolean} [showToast=true] - Whether to show toast
     * @returns {void}
     */
    handle(error, type = ErrorType.UNKNOWN, showToast = true) {
        const message = error instanceof Error ? error.message : String(error)
        const stack = error instanceof Error ? error.stack : undefined

        // Log the error
        this._logError(type, message, stack)

        // Show user feedback
        if (showToast) {
            this._showErrorToast(type, message)
        }

        // Console for debugging
        console.error(`[Shade Error - ${type}]`, error)

        // Attempt recovery for certain error types
        this._attemptRecovery(type)
    }

    /**
     * Handle shader compilation error
     * @param {string} shaderType - 'glsl' or 'wgsl'
     * @param {string} errorMessage - Compiler error
     * @param {string} [source] - Source code
     */
    handleShaderError(shaderType, errorMessage, source) {
        this._logError(ErrorType.SHADER, errorMessage, source)
        
        // Parse line number from error if possible
        const lineMatch = errorMessage.match(/(?:line|Line|ERROR:)\s*(\d+)/i)
        const line = lineMatch ? parseInt(lineMatch[1]) : null

        toast.error(`Shader error${line ? ` at line ${line}` : ''}: ${errorMessage.slice(0, 100)}`, 8000)
    }

    /**
     * Handle network/API errors
     * @param {string} endpoint - API endpoint
     * @param {Error|Response} error - The error
     */
    handleNetworkError(endpoint, error) {
        let message = 'Network error'

        if (error instanceof Response) {
            message = `API error (${error.status}): ${error.statusText}`
        } else if (error instanceof Error) {
            if (error.name === 'AbortError') {
                message = 'Request was cancelled'
            } else if (error.message.includes('fetch')) {
                message = 'Unable to connect to server'
            } else {
                message = error.message
            }
        }

        this.handle(new Error(message), ErrorType.NETWORK)
    }

    /**
     * Handle storage errors
     * @param {string} operation - 'save' or 'load'
     * @param {Error} error - The error
     */
    handleStorageError(operation, error) {
        let message = `Storage ${operation} failed`

        if (error.name === 'QuotaExceededError') {
            message = 'Storage quota exceeded. Please clear some space.'
        } else if (error.name === 'NotFoundError') {
            message = 'No saved data found'
        }

        this.handle(new Error(message), ErrorType.STORAGE)
    }

    /**
     * Handle GPU context loss
     * @param {string} backend - 'WebGL' or 'WebGPU'
     */
    handleContextLost(backend) {
        toast.warning(`${backend} context lost. Attempting recovery...`, 5000)
        
        this._logError(ErrorType.RENDER, `${backend} context lost`)

        // Context recovery is handled by the renderer
        // This just provides user feedback
        setTimeout(() => {
            if (!this.isRecovering) {
                toast.info('If rendering is broken, try refreshing the page.')
            }
        }, 5000)
    }

    /**
     * Log error to internal log
     * @private
     */
    _logError(type, message, stack) {
        this.errorLog.push({
            type,
            message,
            stack,
            timestamp: Date.now()
        })

        // Trim log if too large
        if (this.errorLog.length > this.maxLogSize) {
            this.errorLog.shift()
        }
    }

    /**
     * Show appropriate toast for error type
     * @private
     */
    _showErrorToast(type, message) {
        // Truncate long messages
        const displayMessage = message.length > 150 
            ? message.slice(0, 147) + '...' 
            : message

        switch (type) {
            case ErrorType.SHADER:
                toast.error(`Shader error: ${displayMessage}`, 6000)
                break
            case ErrorType.NETWORK:
                toast.error(`Connection error: ${displayMessage}`, 5000)
                break
            case ErrorType.API:
                toast.error(`API error: ${displayMessage}`, 5000)
                break
            case ErrorType.STORAGE:
                toast.warning(`Storage error: ${displayMessage}`, 4000)
                break
            case ErrorType.RENDER:
                toast.error(`Render error: ${displayMessage}`, 5000)
                break
            default:
                toast.error(displayMessage, 4000)
        }
    }

    /**
     * Attempt automatic recovery for certain error types
     * @private
     */
    _attemptRecovery(type) {
        if (this.isRecovering) return

        // No automatic recovery needed for most types
        // This is a placeholder for future recovery strategies
    }

    /**
     * Get recent errors
     * @param {number} [count=10] - Number of errors to return
     * @returns {Array}
     */
    getRecentErrors(count = 10) {
        return this.errorLog.slice(-count)
    }

    /**
     * Clear error log
     */
    clearLog() {
        this.errorLog = []
    }

    /**
     * Export error log for debugging
     * @returns {string}
     */
    exportLog() {
        return JSON.stringify(this.errorLog, null, 2)
    }
}

// Singleton instance
export const errorHandler = new ErrorHandler()

// Convenience exports
export function handleError(error, type, showToast) {
    errorHandler.handle(error, type, showToast)
}
