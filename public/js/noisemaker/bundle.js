/**
 * ESM bundle loader for Noisemaker Shaders Core
 *
 * Dynamically imports from the appropriate ESM bundle:
 * - Non-minified for local development (localhost, 127.0.0.1, file://)
 * - Minified for production
 *
 * This allows easier debugging of upstream issues in development
 * while keeping production bundles small.
 * 
 * @version 2.1.0 - Enhanced op registration debugging
 */

// VERSION MARKER - helps identify if updated code is running
const BUNDLE_VERSION = '2.1.0'

const SHADER_CDN = 'https://shaders.noisedeck.app/1'

// Detect if we're in local development
const isLocalDev = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
)

// Choose bundle based on environment
const bundlePath = isLocalDev
    ? `${SHADER_CDN}/noisemaker-shaders-core.esm.js`
    : `${SHADER_CDN}/noisemaker-shaders-core.esm.min.js`

// Dynamic import and re-export
const bundle = await import(bundlePath)

// Re-export everything we need
export const CanvasRenderer = bundle.CanvasRenderer
export const ProgramState = bundle.ProgramState
export const registerEffect = bundle.registerEffect
export const getEffect = bundle.getEffect
export const getAllEffects = bundle.getAllEffects
export const registerOp = bundle.registerOp
export const registerStarterOps = bundle.registerStarterOps
export const mergeIntoEnums = bundle.mergeIntoEnums
export const stdEnums = bundle.stdEnums
export const compile = bundle.compile
export const validate = bundle.validate
export const lex = bundle.lex
export const parse = bundle.parse
export const unparse = bundle.unparse
export const extractEffectNamesFromDsl = bundle.extractEffectNamesFromDsl
export const extractEffectsFromDsl = bundle.extractEffectsFromDsl
export const cloneParamValue = bundle.cloneParamValue
export const isStarterEffect = bundle.isStarterEffect
export const hasTexSurfaceParam = bundle.hasTexSurfaceParam
export const is3dGenerator = bundle.is3dGenerator
export const is3dProcessor = bundle.is3dProcessor
export const isValidIdentifier = bundle.isValidIdentifier
export const sanitizeEnumName = bundle.sanitizeEnumName
export const groupGlobalsByCategory = bundle.groupGlobalsByCategory

// Debug: expose bundle for verification
export const _bundle = bundle

/**
 * Test if an op is registered in the DSL ops registry.
 * Uses compile() to validate - if compile succeeds, the op is registered.
 * @param {string} namespace - Namespace (e.g., 'user')
 * @param {string} name - Effect name
 * @returns {{registered: boolean, error?: string}}
 */
export function testOpRegistration(namespace, name) {
    // Include render(o0) to ensure full DSL validity
    const testDsl = `search ${namespace}\n${name}().write(o0)\nrender(o0)`
    try {
        const result = compile(testDsl)
        // Check for diagnostic errors
        if (result.diagnostics && result.diagnostics.length > 0) {
            const errors = result.diagnostics.filter(d => d.severity === 'error')
            if (errors.length > 0) {
                return {
                    registered: false,
                    error: errors.map(e => e.message).join(', ')
                }
            }
        }
        return { registered: true }
    } catch (e) {
        return {
            registered: false,
            error: e.message || String(e)
        }
    }
}

/**
 * Debug helper - directly register an op and verify it's in the registry.
 * This bypasses any potential import/module issues.
 * @param {string} opName - Full op name (e.g., 'user.myEffect')
 * @param {object} opSpec - Op specification
 * @returns {{success: boolean, registered: boolean}}
 */
export function debugRegisterOp(opName, opSpec) {
    console.log('[bundle.debugRegisterOp] Registering:', opName)
    console.log('[bundle.debugRegisterOp] Spec:', JSON.stringify(opSpec, null, 2))
    
    // Call registerOp
    registerOp(opName, opSpec)
    
    // Immediately test if it worked via compilation
    const parts = opName.split('.')
    const namespace = parts[0]
    const name = parts[1]
    // Include render(o0) to avoid missing render errors
    const testDsl = `search ${namespace}\n${name}().write(o0)\nrender(o0)`
    
    try {
        const result = compile(testDsl)
        const hasErrors = result.diagnostics?.some(d => d.severity === 'error')
        console.log('[bundle.debugRegisterOp] Test compile result:', hasErrors ? 'FAILED' : 'SUCCESS')
        if (hasErrors) {
            console.log('[bundle.debugRegisterOp] Errors:', result.diagnostics.filter(d => d.severity === 'error'))
        }
        return { success: true, registered: !hasErrors }
    } catch (e) {
        console.log('[bundle.debugRegisterOp] Test compile threw:', e.message)
        return { success: true, registered: false, error: e.message }
    }
}

/**
 * List all registered ops in a namespace (for debugging)
 * @param {string} namespace - Namespace to search (e.g., 'user')
 * @returns {string[]} List of op names in that namespace
 */
export function listOpsInNamespace(namespace) {
    // Get all effects and filter by namespace
    const allEffects = getAllEffects()
    const userOps = []
    for (const effectId of Object.keys(allEffects)) {
        if (effectId.startsWith(`${namespace}/`) || effectId.startsWith(`${namespace}.`)) {
            userOps.push(effectId)
        }
    }
    return userOps
}
