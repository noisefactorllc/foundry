/**
 * Sharing Loader Module for Effect Workspace
 *
 * Handles loading compositions from sharing.noisedeck.app URLs.
 * Supports loading DSL programs and portable effects.
 *
 * @module sharingLoader
 */

import {
    registerEffect,
    registerOp,
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
        namespace = 'user',
        description = '',
        tags = ['user'],
        globals = {},
        passes = [],
        shaders = {}
    } = effectData

    const effectFunc = func || name

    // Create an effect instance-like object
    const instance = {
        name,
        namespace,
        func: effectFunc,
        description,
        tags,
        globals,
        passes,
        shaders
    }

    // Determine if this is a starter effect (no pipeline inputs)
    const isStarter = checkIsStarter(instance)

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

    // Register the instance - ONLY with namespace-qualified keys to avoid
    // overwriting built-in effects (e.g., classicNoisedeck.pattern)
    registerEffect(fullEffectKey, instance)
    registerEffect(effect.id, instance)

    // Register as DSL operator
    const opSpec = {
        name: effect.func,
        args: buildOpArgs(instance, namespace)
    }
    registerOp(fullEffectKey, opSpec)

    if (isStarter) {
        registerStarterOps([fullEffectKey])
    }

    // Register any choice enums
    const choicesToRegister = buildChoiceEnums(instance, namespace)
    if (Object.keys(choicesToRegister).length > 0) {
        mergeIntoEnums(choicesToRegister)
    }

    console.log(`[sharingLoader] Registered portable effect: ${effectFunc}`)

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
        'inputTex', 'inputTex3d', 'src',
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
 * Build operator args from effect globals
 * @private
 */
function buildOpArgs(instance, namespace) {
    const args = []
    const globals = instance.globals || {}

    for (const [paramName, paramDef] of Object.entries(globals)) {
        const arg = {
            name: paramName,
            type: paramDef.type || 'Number'
        }

        // Handle enum/choice parameters
        if (paramDef.choices) {
            arg.type = 'Enum'
            arg.enum = `${namespace}.${instance.func}.${paramName}`
        } else if (paramDef.enum || paramDef.enumPath) {
            arg.type = 'Enum'
            arg.enum = paramDef.enum || paramDef.enumPath
        }

        // Add default value
        if (paramDef.default !== undefined) {
            arg.default = paramDef.default
        }

        args.push(arg)
    }

    return args
}

/**
 * Build choice enums from effect definition
 * @private
 */
function buildChoiceEnums(instance, namespace) {
    const enums = {}
    const globals = instance.globals || {}

    for (const [paramName, paramDef] of Object.entries(globals)) {
        if (!paramDef.choices) continue

        // Skip if enum already specified
        if (paramDef.enum || paramDef.enumPath) continue

        const enumPath = `${namespace}.${instance.func}.${paramName}`
        
        if (!enums[namespace]) enums[namespace] = {}
        if (!enums[namespace][instance.func]) enums[namespace][instance.func] = {}
        enums[namespace][instance.func][paramName] = {}

        for (const [choiceName, choiceValue] of Object.entries(paramDef.choices)) {
            // Skip documentation entries (end with ":")
            if (choiceName.endsWith(':')) continue
            
            enums[namespace][instance.func][paramName][choiceName] = {
                type: 'Number',
                value: choiceValue
            }
        }
    }

    return enums
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
