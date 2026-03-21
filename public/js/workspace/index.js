/**
 * Workspace module - exports for workspace management
 *
 * @module workspace
 */

export { WorkspaceStore, workspaceStore } from './workspace-store.js'
export {
    saveWorkspace,
    loadWorkspace,
    deleteWorkspace,
    listWorkspaces,
    isIndexedDBAvailable
} from './workspace-db.js'

import { registerEffect, registerOp, registerStarterOps } from '../noisemaker/bundle.js'
import { workspaceStore } from './workspace-store.js'

/**
 * Re-register an effect from the current workspace with the noisemaker runtime.
 * Call this after loading a workspace that contains a custom effect.
 * @param {object} [renderer] - Optional ShadeRenderer instance to register with
 * @param {string} [dslOverride] - Optional DSL to use for starter detection (if not provided, reads from workspace)
 * @returns {boolean} Whether registration was successful
 */
export function registerEffectFromWorkspace(renderer = null, dslOverride = null) {
    const defJson = workspaceStore.getFile('definition.json')
    if (!defJson) {
        return false
    }

    try {
        const def = JSON.parse(defJson)
        const name = def.func || def.name
        if (!name) {
            console.warn('[Workspace] No effect name in definition')
            return false
        }
        
        
        const globals = def.globals || {}

        // Migrate old workspaces: ensure 'user' namespace is in search directive
        const originalNamespace = def.originalNamespace || def.namespace
        if (originalNamespace && originalNamespace !== 'user') {
            let dsl = workspaceStore.getFile('dsl.txt')
            if (dsl) {
                // Check if 'user' is already in the search directive
                const searchMatch = dsl.match(/^search\s+(.+)$/m)
                if (searchMatch) {
                    const namespaces = searchMatch[1].split(',').map(s => s.trim())
                    if (!namespaces.includes('user')) {
                        // Add 'user' to the beginning of the search directive
                        const newSearch = `search user, ${namespaces.join(', ')}`
                        dsl = dsl.replace(/^search\s+.+$/m, newSearch)
                        workspaceStore.setFile('dsl.txt', dsl)
                    }
                }
            }
            // Also update definition.json namespace
            if (def.namespace !== 'user') {
                def.namespace = 'user'
                workspaceStore.setFile('definition.json', JSON.stringify(def, null, 2))
            }
        }

        // Find all shader files keyed by their program names
        const shaders = {}
        for (const [path, content] of workspaceStore.files) {
            if (path.startsWith('glsl/') && path.endsWith('.glsl')) {
                const progName = path.slice(5, -5) // Remove 'glsl/' and '.glsl'
                if (!shaders[progName]) shaders[progName] = {}
                shaders[progName].glsl = content
            } else if (path.startsWith('wgsl/') && path.endsWith('.wgsl')) {
                const progName = path.slice(5, -5) // Remove 'wgsl/' and '.wgsl'
                if (!shaders[progName]) shaders[progName] = {}
                shaders[progName].wgsl = content
            }
        }

        if (Object.keys(shaders).length === 0) {
            console.warn('[Workspace] No shaders found')
            return false
        }

        // Build args array from globals in noisemaker's expected format
        const args = Object.entries(globals).map(([uname, udef]) => ({
            name: uname,
            type: udef.type === 'vec4' ? 'color' : (udef.type || 'float'),
            default: udef.default ?? 0,
            min: udef.min,
            max: udef.max,
            uniform: udef.uniform || uname
        }))

        // Use 'user' namespace for workspace effects
        const namespace = 'user'

        // Register as an op in the user namespace
        const opName = `${namespace}.${name}`
        const opSpec = {
            name: name,
            args: args
        }
        
        // Register the op
        registerOp(opName, opSpec)
        
        // Detect if effect is used as a starter in DSL
        // An effect is a starter if it appears at the beginning of a chain (not chained from something else)
        let isStarter = def.starter === true
        
        // Check DSL to see if effect is actually used as a starter
        const dsl = dslOverride || workspaceStore.getFile('dsl.txt')
        if (dsl && !isStarter) {
            // Look for the effect name at the start of a line (not chained with .)
            // Pattern: effectname() at start of line, possibly with namespace prefix
            const effectPattern = new RegExp(`^\\s*(${name}|${namespace}\\.${name}|${namespace}/${name})\\s*\\(`, 'm')
            if (effectPattern.test(dsl)) {
                isStarter = true
            }
        }
        
        if (isStarter) {
            registerStarterOps([opName])
        }

        // Determine passes - use stored passes from definition if available,
        // otherwise create correct pass structure based on effect type
        let passes
        if (def.passes && Array.isArray(def.passes) && def.passes.length > 0) {
            // Use the stored passes structure
            passes = def.passes
        } else {
            // Create correct pass structure based on starter flag
            const firstProgram = Object.keys(shaders)[0]
            const isStarter = def.starter === true
            
            if (isStarter) {
                // Starter effect: no input, just output
                passes = [
                    {
                        name: 'render',
                        program: firstProgram,
                        inputs: {},
                        outputs: { color: 'outputTex' }
                    }
                ]
            } else {
                // Filter effect: takes input, produces output
                passes = [
                    {
                        name: 'render',
                        program: firstProgram,
                        inputs: { inputTex: 'inputTex' },
                        outputs: { color: 'outputTex' }
                    }
                ]
            }
        }

        // Create effect definition using 'user' namespace
        const effectDef = {
            name: name,
            namespace: namespace,
            func: name,
            starter: def.starter === true,  // Preserve starter flag
            description: def.description || `Custom effect: ${name}`,
            tags: def.tags || ['custom'],
            globals,
            passes,
            shaders,
            textures: def.textures || {},
            asyncInit: async () => {},
            // 3D effect properties
            outputTex3d: def.outputTex3d || null,
            outputGeo: def.outputGeo || null
        }

        // Register the effect with the global registry under namespace-qualified keys only
        // Do NOT register by just function name to avoid overwriting built-in effects
        registerEffect(opName, effectDef)
        registerEffect(`${namespace}/${name}`, effectDef)

        // Also register with the renderer's loaded effects cache if provided
        // This is critical for compile() to find the effect without trying to load from bundles
        if (renderer && renderer.registerCustomEffect) {
            renderer.registerCustomEffect(`${namespace}/${name}`, effectDef)
        }

        return true
    } catch (err) {
        console.error('[Workspace] Failed to re-register effect:', err)
        console.error('[Workspace] definition.json content:', defJson)
        return false
    }
}
