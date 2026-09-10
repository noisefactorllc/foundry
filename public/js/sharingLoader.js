/**
 * Sharing Loader Module for Effect Workspace
 *
 * Handles loading compositions from sharing.noisedeck.app URLs.
 * Supports loading DSL programs and portable effects.
 *
 * @module sharingLoader
 */

import {
    Effect,
    CanvasRenderer,
    getEffect, registerEffect, unregisterEffect,
    registerStarterOps,
    mergeIntoEnums
} from './noisemaker/bundle.js'

const SHARING_API_BASE = 'https://sharing.noisedeck.app'

/**
 * Fetch composition data from the sharing API
 * @param {string} code - The short code
 * @returns {Promise<object>} Composition data including dsl, effects, title, etc.
 */
export async function fetchComposition(code) {
    const response = await fetch(`${SHARING_API_BASE}/api/composition/${code}`)

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Composition not found or expired')
        }
        throw new Error(`Failed to fetch composition: ${response.status}`)
    }

    return response.json()
}

/**
 * Register a portable effect from the sharing API response format
 * Effects come pre-parsed with shaders embedded.
 * @param {object} effectData - Effect data from the API
 * @returns {object} Registered effect info
 */
export function registerPortableEffect(effectData) {
    const {
        name,
        func,
        description = '',
        tags = ['user'],
        globals = {},
        passes = [],
        shaders = {}
    } = effectData

    const namespace = 'user'
    const effectFunc = func || name

    // Construct a real Effect instance so lifecycle hooks (asyncInit, onInit,
    // onUpdate, onDestroy) inherit from Effect.prototype. Plain objects fail
    // the pipeline's `effectDef.asyncInit === Effect.prototype.asyncInit` guard
    // and crash compilation with `t.asyncInit is not a function`.
    const instance = new Effect({
        name,
        namespace,
        func: effectFunc,
        description,
        tags,
        globals,
        passes,
        textures: effectData.textures,
        outputTex3d: effectData.outputTex3d,
        outputGeo: effectData.outputGeo,
        uniformLayout: effectData.uniformLayout,
        uniformLayouts: effectData.uniformLayouts,
        defaultProgram: effectData.defaultProgram,
        paramAliases: effectData.paramAliases,
    })
    instance.shaders = shaders

    // Determine if this is a starter effect (no pipeline inputs)
    const isStarter = effectData.starter ?? checkIsStarter(instance)
    instance.starter = isStarter

    // Build effect wrapper
    const effect = {
        id: `${namespace}/${effectFunc}`,
        namespace,
        name: effectFunc,
        func: effectFunc,
        instance,
        globals,
        passes,
        shaders,
        isUserEffect: true,
        isPortable: true
    }

    // Build the full effect key (namespace.func)
    const fullEffectKey = `${namespace}.${effect.func}`

    // Canonical registration includes parameter aliases and choice enum names.
    // Keep Foundry's namespace-only registry contract for custom effects.
    const bareEffect = getEffect(effectFunc)
    let choicesToRegister
    try {
        choicesToRegister = CanvasRenderer.prototype.registerEffectWithRuntime(effect)
    } finally {
        if (bareEffect !== undefined) registerEffect(effectFunc, bareEffect)
        else unregisterEffect(effectFunc)
    }

    if (isStarter) {
        registerStarterOps([fullEffectKey])
    }

    // Register any choice enums
    if (choicesToRegister && Object.keys(choicesToRegister).length > 0) {
        mergeIntoEnums(choicesToRegister)
    }


    return effect
}

/**
 * Check if an effect is a starter (doesn't need pipeline input)
 * @private
 */
function checkIsStarter(instance) {
    const passes = instance.passes || []
    if (passes.length === 0) return true

    const pipelineInputs = [
        'inputTex', 'inputTex3d', 'inputGeo', 'src',
        'o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'
    ]

    for (const pass of passes) {
        if (!pass.inputs) continue
        const inputs = Object.values(pass.inputs)
        if (inputs.some(val => pipelineInputs.includes(val))) {
            return false
        }
    }

    return true
}

/**
 * Load a composition from a short code
 * Fetches the composition and registers any portable effects
 * @param {string} code - The short code
 * @returns {Promise<{dsl: string, title: string, effects: object[], rawEffects: object[]}>} Loaded composition
 */
export async function loadFromCode(code) {
    const composition = await fetchComposition(code)

    // Register any portable effects
    const registeredEffects = []
    if (composition.effects && Array.isArray(composition.effects)) {
        for (const effectData of composition.effects) {
            try {
                const registered = registerPortableEffect(effectData)
                registeredEffects.push(registered)
            } catch (err) {
                console.error(`Failed to register effect ${effectData.name}:`, err)
            }
        }
    }

    return {
        dsl: composition.dsl,
        title: composition.title || '',
        description: composition.description || '',
        effects: registeredEffects,
        rawEffects: composition.effects || [],  // Include raw effect data for workspace population
        code: composition.code
    }
}

/**
 * Check if there's a code parameter in the URL
 * @returns {string|null} The short code or null
 */
export function getCodeFromUrl() {
    const urlParams = new URLSearchParams(window.location.search)
    return urlParams.get('code')
}
