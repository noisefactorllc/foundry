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

import { Effect, CanvasRenderer, getEffect, registerEffect, unregisterEffect, registerStarterOps, mergeIntoEnums } from '../noisemaker/bundle.js'
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

        const namespace = 'user'
        const opName = `${namespace}.${name}`

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
        const effectDef = new Effect({
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
            // 3D effect properties
            outputTex3d: def.outputTex3d || null,
            outputGeo: def.outputGeo || null,
            uniformLayout: def.uniformLayout,
            uniformLayouts: def.uniformLayouts,
            defaultProgram: def.defaultProgram,
            paramAliases: def.paramAliases
        })

        const pipelineInputs = ['inputTex', 'inputTex3d', 'inputGeo', 'src',
            'o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7']
        const isStarter = def.starter ?? !passes.some(pass =>
            Object.values(pass.inputs || {}).some(input => pipelineInputs.includes(input)))
        effectDef.starter = isStarter
        effectDef.shaders = shaders

        // Canonical registration includes parameter aliases and choice enum names.
        // Keep Foundry's namespace-only registry contract for custom effects.
        const bareEffect = getEffect(name)
        let choices
        try {
            choices = CanvasRenderer.prototype.registerEffectWithRuntime({
                namespace, name, instance: effectDef
            })
        } finally {
            if (bareEffect !== undefined) registerEffect(name, bareEffect)
            else unregisterEffect(name)
        }
        if (isStarter) registerStarterOps([opName])
        if (choices && Object.keys(choices).length) mergeIntoEnums(choices)

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

// The files that make up the workspace's custom effect.
const EFFECT_FILE = /^(definition\.json|help\.md|glsl\/[^/]+\.glsl|wgsl\/[^/]+\.wgsl)$/
// The definition fields a Portable effect carries (see writePortableEffectToWorkspace).
const PORTABLE_FIELDS = ['name', 'func', 'namespace', 'author', 'description', 'tags', 'globals', 'passes', 'textures',
    'outputTex3d', 'outputGeo', 'uniformLayout', 'uniformLayouts', 'defaultProgram', 'paramAliases', 'starter']

/**
 * The workspace's custom effect as a Portable effect: its definition fields,
 * its shaders by program, and its help text. `effect` is null when the
 * workspace has no definition.json, and `error` says why when it is not JSON.
 * @returns {{effect: object|null, error?: string}}
 */
export function readPortableEffectFromWorkspace() {
    const source = workspaceStore.getFile('definition.json')
    if (!source) return { effect: null }
    let definition
    try {
        definition = JSON.parse(source)
    } catch (err) {
        return { effect: null, error: `definition.json is not valid JSON: ${err.message}` }
    }
    const effect = {}
    for (const field of PORTABLE_FIELDS) if (definition[field] !== undefined) effect[field] = definition[field]
    effect.shaders = {}
    for (const [path, content] of workspaceStore.files) {
        const match = /^(glsl|wgsl)\/([^/]+)\.(glsl|wgsl)$/.exec(path)
        if (!match || match[1] !== match[3]) continue
        effect.shaders[match[2]] ||= {}
        effect.shaders[match[2]][match[1]] = content
    }
    const help = workspaceStore.getFile('help.md')
    if (help) effect.help = help
    return { effect }
}

/**
 * Put a Portable effect in the workspace in place of its custom effect, as
 * "import from url" does, keeping files that are not part of the effect, and
 * register it under `user`.
 * @param {object} effect - A Portable effect, with `func` or `name`
 * @param {object} [renderer] - ShadeRenderer to register the effect with
 */
export function replaceWorkspaceEffect(effect, renderer = null) {
    for (const path of [...workspaceStore.files.keys()]) {
        if (EFFECT_FILE.test(path)) workspaceStore.deleteFile(path)
    }
    writePortableEffectToWorkspace({ ...effect, func: effect.func || effect.name, name: effect.name || effect.func })
    workspaceStore.name = effect.name || effect.func
    registerEffectFromWorkspace(renderer)
}

/** Write a Portable effect's definition and sources to the current workspace. */
export function writePortableEffectToWorkspace(effectData) {
    const definition = {
        name: effectData.name,
        func: effectData.func || effectData.name,
        namespace: 'user',
        author: effectData.author || '',
        description: effectData.description || '',
        tags: effectData.tags || [],
        globals: effectData.globals || {},
        passes: effectData.passes || [],
        textures: effectData.textures,
        outputTex3d: effectData.outputTex3d,
        outputGeo: effectData.outputGeo,
        uniformLayout: effectData.uniformLayout,
        uniformLayouts: effectData.uniformLayouts,
        defaultProgram: effectData.defaultProgram,
        paramAliases: effectData.paramAliases,
        starter: effectData.starter
    }
    workspaceStore.setFile('definition.json', JSON.stringify(definition, null, 2))
    for (const [program, shaders] of Object.entries(effectData.shaders || {})) {
        if (shaders.glsl) workspaceStore.setFile(`glsl/${program}.glsl`, shaders.glsl)
        if (shaders.wgsl) workspaceStore.setFile(`wgsl/${program}.wgsl`, shaders.wgsl)
    }
    if (effectData.help) workspaceStore.setFile('help.md', effectData.help)
}
