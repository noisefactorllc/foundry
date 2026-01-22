/**
 * Utils Module Index
 *
 * @module utils
 */

export { errorHandler, handleError, ErrorType } from './error-handler.js'
export { 
    storage,
    StorageKey,
    getPreferences,
    setPreference,
    resetPreferences,
    getRecentEffects,
    addRecentEffect,
    saveUIState,
    loadUIState
} from './storage.js'
export {
    FrameRateMonitor,
    debounce,
    throttle,
    requestIdleCallback,
    cancelIdleCallback,
    measure,
    checkWebGPUSupport,
    checkWebGL2Support,
    syntheticDelay,
    waitSyntheticDelay
} from './performance.js'
