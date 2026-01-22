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
 * @returns {boolean} Whether registration was successful
 */
export function registerEffectFromWorkspace(renderer = null) {
    const defJson = workspaceStore.getFile('definition.json')
    if (!defJson) {
        console.log('[Workspace] No definition.json found, skipping registration')
        return false
    }

    try {
        console.log('[Workspace] Parsing definition.json (%d chars):', defJson.length)
        const def = JSON.parse(defJson)
        const name = def.func || def.name
        if (!name) {
            console.warn('[Workspace] No effect name in definition')
            return false
        }
        
        console.log('[Workspace] Registering effect:', name)
        
        const globals = def.globals || {}

        // Migrate old workspaces: update dsl.txt to use 'user' namespace
        const originalNamespace = def.originalNamespace || def.namespace
        if (originalNamespace && originalNamespace !== 'user') {
            let dsl = workspaceStore.getFile('dsl.txt')
            if (dsl && dsl.includes(`search ${originalNamespace}`)) {
                dsl = dsl.replace(
                    new RegExp(`(search\\s+)${originalNamespace}(\\s*,|\\s*\\n)`, 'g'),
                    `$1user$2`
                )
                workspaceStore.setFile('dsl.txt', dsl)
                console.log('[Workspace] Migrated dsl.txt to use user namespace')
            }
            // Also update definition.json namespace
            if (def.namespace !== 'user') {
                def.namespace = 'user'
                workspaceStore.setFile('definition.json', JSON.stringify(def, null, 2))
                console.log('[Workspace] Migrated definition.json to use user namespace')
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
        console.log('[Workspace] Registering op:', opName, 'with args:', args.map(a => a.name))
        registerOp(opName, opSpec)
        
        // Only register as starter if it IS a starter effect
        const isStarter = def.starter === true
        if (isStarter) {
            registerStarterOps([opName])
        }
        console.log('[Workspace] Op registration complete, starter:', isStarter)

        // Determine passes - use stored passes from definition if available,
        // otherwise create correct pass structure based on effect type
        let passes
        if (def.passes && Array.isArray(def.passes) && def.passes.length > 0) {
            // Use the stored passes structure
            passes = def.passes
            console.log('[Workspace] Using stored passes:', passes.map(p => p.program).join(', '))
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
                        outputs: { fragColor: 'outputTex' }
                    }
                ]
            } else {
                // Filter effect: takes input, produces output
                passes = [
                    {
                        name: 'render',
                        program: firstProgram,
                        inputs: { inputTex: 'source' },
                        outputs: { fragColor: 'outputTex' }
                    }
                ]
            }
            console.log('[Workspace] Created', isStarter ? 'starter' : 'filter', 'pass for program:', firstProgram)
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
            uniformLayout: def.uniformLayout,
            uniformLayouts: def.uniformLayouts
        }

        // Register the effect with the global registry under multiple keys
        registerEffect(opName, effectDef)
        registerEffect(`${namespace}/${name}`, effectDef)
        // Also register with just the function name for lookups without namespace
        registerEffect(name, effectDef)

        // Also register with the renderer's loaded effects cache if provided
        // This is critical for compile() to find the effect without trying to load from bundles
        if (renderer && renderer.registerCustomEffect) {
            renderer.registerCustomEffect(`${namespace}/${name}`, effectDef)
        }

        console.log(`[Workspace] Re-registered effect: ${namespace}/${name}`)
        return true
    } catch (err) {
        console.error('[Workspace] Failed to re-register effect:', err)
        console.error('[Workspace] definition.json content:', defJson)
        return false
    }
}
