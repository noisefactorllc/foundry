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
    // ?images=files lists the composition's images as { id, url } files.
    const response = await fetch(`${SHARING_API_BASE}/api/composition/${code}?images=files`)

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Composition not found or expired')
        }
        throw new Error(`Failed to fetch composition: ${response.status}`)
    }

    const composition = await response.json()
    composition.images = await loadSharedImageFiles(composition.images)
    return composition
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
        images: composition.images || [],
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

/**
 * Shared compositions list their images as { id, url } files. Load each file
 * into the { id, dataUrl, ... } images the renderer binds, checked against its
 * id. A file that cannot be loaded is left out and logged.
 */
export async function loadSharedImageFiles(images = []) {
    if (!images.some(image => image?.url && image.dataUrl === undefined)) return images
    const { prepareImage } = await import('https://sharing.noisedeck.app/js/portableImages.js?v=images-20260929')
    const loaded = await Promise.all(images.map(async image => {
        if (!image?.url || image.dataUrl !== undefined) return image
        try {
            const response = await fetch(image.url)
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const prepared = await prepareImage(await response.blob())
            if (prepared.id !== image.id) throw new Error('the image bytes do not match their id')
            return prepared
        } catch (error) {
            console.warn(`Shared image ${image.id} was not loaded:`, error)
            return null
        }
    }))
    return loaded.filter(Boolean)
}

/**
 * Upload an image file to the sharing service.
 * @param {Blob} blob - The image file (PNG, JPEG, GIF or WebP)
 * @returns {Promise<string>} The id to name it by, as `image:<id>`
 */
export async function uploadImage(blob) {
    const response = await fetch(`${SHARING_API_BASE}/api/images`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type },
        body: blob
    })
    if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || `Image upload failed: ${response.status}`)
    }
    return (await response.json()).id
}

/**
 * Capture and upload the share screenshot as a JPEG file. The screenshot is
 * best-effort: if it cannot be captured or uploaded, the share goes without it.
 * @param {HTMLCanvasElement|null} canvas - The 1200x630 screenshot canvas
 * @returns {Promise<string|undefined>} The uploaded screenshot's id
 */
export async function uploadScreenshot(canvas) {
    if (!canvas) return undefined
    try {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
        return blob ? await uploadImage(blob) : undefined
    } catch (error) {
        console.warn('Share screenshot was not uploaded:', error)
        return undefined
    }
}

/**
 * Send a share payload's images and screenshot to the sharing service as
 * files. Each image the program uses is uploaded with POST /api/images and
 * named in `payload.dsl` by the id the service returns; the screenshot is
 * uploaded as a JPEG and `payload.screenshot` is set to its id. No image is
 * sent as base64.
 * @param {object} payload - The share request body; `dsl` and `screenshot` are set
 * @param {object} options
 * @param {Array<{id: string, dataUrl: string}>} [options.images] - The renderer's images
 * @param {HTMLCanvasElement|null} [options.screenshot] - The screenshot canvas
 * @returns {Promise<object>} The payload
 */
export async function attachShareFiles(payload, { images = [], screenshot = null } = {}) {
    if (/\burl\b/.test(payload.dsl)) {
        const tools = await import('https://sharing.noisedeck.app/js/portableImages.js?v=images-20260929')
        const prepared = await tools.prepareImagesForShare(payload.dsl, images)
        const ids = new Map()
        for (const image of prepared.images) ids.set(image.id, await uploadImage(tools.imageToBlob(image)))
        payload.dsl = [...ids].every(([from, to]) => from === to)
            ? prepared.dsl
            : tools.replaceMediaUrls(prepared.dsl, url => url?.startsWith('image:') && ids.has(url.slice(6)) ? `image:${ids.get(url.slice(6))}` : url)
    }
    const screenshotId = await uploadScreenshot(screenshot)
    if (screenshotId) payload.screenshot = screenshotId
    return payload
}
