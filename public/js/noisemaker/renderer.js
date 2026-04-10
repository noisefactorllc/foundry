/**
 * Shade Renderer - Wrapper around Noisemaker CanvasRenderer
 *
 * Provides a simplified interface for Shade's shader editing workflow.
 * This is a thin wrapper that adapts the Noisemaker rendering pipeline
 * for Shade's specific needs.
 *
 * @module noisemaker/renderer
 */

import { CanvasRenderer, ProgramState, extractEffectNamesFromDsl, extractEffectsFromDsl, getEffect, getAllEffects } from './bundle.js'

/**
 * ShadeRenderer - Main rendering class for Shade
 *
 * Wraps the Noisemaker CanvasRenderer and provides methods for:
 * - Loading and compiling DSL programs
 * - Managing the render loop
 * - Switching between WebGL2 and WebGPU backends
 *
 * @class
 * @example
 * const renderer = new ShadeRenderer(canvas, {
 *     width: 1024,
 *     height: 1024
 * });
 * await renderer.init();
 * await renderer.compile('noise().write(o0)');
 * renderer.start();
 */
export class ShadeRenderer {
    /**
     * Create a new ShadeRenderer
     * @param {HTMLCanvasElement} canvas - Target canvas element
     * @param {object} [options={}] - Configuration options
     * @param {number} [options.width=1024] - Render width
     * @param {number} [options.height=1024] - Render height
     * @param {boolean} [options.preferWebGPU=false] - Use WebGPU backend
     * @param {number} [options.targetFPS=60] - Target frames per second
     * @param {number} [options.loopDuration=10] - Animation loop duration in seconds
     * @param {function} [options.onFPS] - Callback when FPS updates
     * @param {function} [options.onError] - Callback on render error
     */
    constructor(canvas, options = {}) {
        this._originalCanvas = canvas // Keep reference for init, but use getter for current canvas
        this.width = options.width || canvas?.width || 1024
        this.height = options.height || canvas?.height || 1024
        this.preferWebGPU = options.preferWebGPU || false
        this.targetFPS = options.targetFPS || 60
        this.loopDuration = options.loopDuration || 10

        // Create internal CanvasRenderer
        // CRITICAL: Pass canvasContainer for resetCanvas() to work during backend switch
        this._renderer = new CanvasRenderer({
            canvas: canvas,
            canvasContainer: canvas?.parentElement || null,
            width: this.width,
            height: this.height,
            basePath: 'https://shaders.noisedeck.app/0',
            preferWebGPU: this.preferWebGPU,
            useBundles: true,
            bundlePath: 'https://shaders.noisedeck.app/0/effects',
            onFPS: options.onFPS,
            onError: options.onError
        })

        // State
        this._initialized = false
        this._currentDsl = '' // The ONE canonical DSL source
        this._lastGoodDsl = '' // Last successfully compiled DSL (for recovery)
        this._hasCorruptedState = false // Flag to force fresh pipeline on next compile
        this._textCanvases = new Map() // Track text canvases for text effects
        this._uniformValues = {} // Track uniform values for DSL generation
        
        // Create ProgramState - renderer is set in init() after CanvasRenderer is ready
        this._programState = new ProgramState()
    }

    // =========================================================================
    // Public Getters
    // =========================================================================

    /** @returns {HTMLCanvasElement} Current canvas element (may change after backend switch) */
    get canvas() {
        // Delegate to internal renderer's canvas getter - canvas can change after resetCanvas()
        return this._renderer.canvas || this._originalCanvas
    }

    /** @returns {ProgramState} Program state manager */
    get programState() {
        return this._programState
    }

    /** @returns {string} Current backend ('webgl2' or 'webgpu') */
    get backend() {
        return this._renderer.backend === 'wgsl' ? 'webgpu' : 'webgl2'
    }

    /** @returns {boolean} Whether the render loop is running */
    get isRunning() {
        return this._renderer.isRunning
    }

    /** @returns {number} Current measured FPS */
    get currentFPS() {
        return this._renderer.currentFPS
    }

    /** @returns {string} Current DSL source - THE ONE SOURCE OF TRUTH */
    get currentDsl() {
        return this._currentDsl
    }

    /** @returns {string} Last successfully compiled DSL (for recovery after errors) */
    get lastGoodDsl() {
        return this._lastGoodDsl
    }

    /** @returns {boolean} Whether the pipeline state is corrupted from a failed compile */
    get hasCorruptedState() {
        return this._hasCorruptedState
    }

    /** @returns {object} Effect manifest */
    get manifest() {
        return this._renderer.manifest
    }

    /** @returns {Map} Loaded effects cache */
    get loadedEffects() {
        return this._renderer.loadedEffects
    }

    /** @returns {object} Enum definitions (for ProgramState) */
    get enums() {
        return this._renderer.enums
    }

    /** @returns {object} Rendering pipeline (for ProgramState) */
    get pipeline() {
        return this._renderer.pipeline
    }

    /**
     * Convert parameter value for uniform (for ProgramState)
     * @param {*} value - Parameter value
     * @param {object} spec - Parameter specification
     * @returns {*} Converted value
     */
    convertParameterForUniform(value, spec) {
        if (this._renderer.convertParameterForUniform) {
            return this._renderer.convertParameterForUniform(value, spec)
        }
        return value
    }

    /**
     * Handle zoom changes (for ProgramState)
     * @param {string} stepKey - Step key
     * @param {number} zoom - Zoom value
     */
    handleZoomChange(stepKey, zoom) {
        if (this._renderer.handleZoomChange) {
            this._renderer.handleZoomChange(stepKey, zoom)
        }
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /**
     * Initialize the renderer (load manifest)
     * Must be called before compile()
     * @returns {Promise<void>}
     */
    async init() {
        if (this._initialized) return

        await this._renderer.loadManifest()
        this._renderer.setLoopDuration(this.loopDuration)
        
        // Connect ProgramState to this ShadeRenderer so it can access currentDsl, enums, pipeline
        // ProgramState.toDsl() needs renderer.currentDsl to generate updated DSL
        this._programState.setRenderer(this)
        
        this._initialized = true
    }

    /**
     * Start the render loop
     */
    start() {
        this._renderer.start()
    }

    /**
     * Stop the render loop
     */
    stop() {
        this._renderer.stop()
    }

    /**
     * Resize the renderer
     * @param {number} width - New width
     * @param {number} height - New height
     */
    resize(width, height) {
        this.width = width
        this.height = height
        if (this._renderer.resize) {
            this._renderer.resize(width, height)
        }
    }

    /**
     * Render a single frame at a specific time
     * @param {number} normalizedTime - Time value 0-1
     */
    render(normalizedTime) {
        this._renderer.render(normalizedTime)
    }

    // =========================================================================
    // Compilation
    // =========================================================================

    /**
     * Compile a DSL program
     * @param {string} dsl - DSL source code
     * @param {object} [options={}] - Compilation options
     * @param {object} [options.workspaceStore] - Workspace store with shader files
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async compile(dsl, options = {}) {
        if (!this._initialized) {
            await this.init()
        }

        // Clear tracked uniform values when compiling new DSL
        this._uniformValues = {}

        // If previous compile failed and corrupted state, force pipeline reset
        if (this._hasCorruptedState) {
            console.log('[ShadeRenderer] compile: Previous compile failed, forcing pipeline reset')
            try {
                // Dispose the corrupted pipeline to force fresh creation
                await this._renderer.dispose({ loseContext: false, resetCanvas: false })
            } catch (disposeErr) {
                console.warn('[ShadeRenderer] compile: Failed to dispose corrupted pipeline:', disposeErr)
            }
            this._hasCorruptedState = false
        }

        try {
            // Build augmented manifest that includes registered user effects
            const baseManifest = this._renderer.manifest || {}
            const registeredEffects = getAllEffects()
            const augmentedManifest = { ...baseManifest }
            
            // Add registered effects to manifest for extractEffectNamesFromDsl
            for (const [key, effectDef] of registeredEffects) {
                // Support both "namespace/name" and "namespace.name" formats
                const slashKey = key.includes('.') ? key.replace('.', '/') : key
                if (!augmentedManifest[slashKey]) {
                    augmentedManifest[slashKey] = {
                        starter: effectDef.starter !== false, // default to starter
                        hasTex: effectDef.hasTex === true
                    }
                }
            }
            
            // Extract effect names and load them if needed
            const effectData = extractEffectNamesFromDsl(dsl, augmentedManifest)
            const effectIds = effectData.map(e => e.effectId)
            
            // Filter out registered effects - they don't need to be loaded from bundles
            const effectIdsToLoad = effectIds.filter(id => {
                const dotKey = id.replace('/', '.')
                return !registeredEffects.has(id) && !registeredEffects.has(dotKey)
            })
            
            if (effectIdsToLoad.length > 0) {
                await this._renderer.loadEffects(effectIdsToLoad)
            }

            // Build shader overrides from workspace if provided
            const shaderOverrides = this._buildShaderOverrides(dsl, options.workspaceStore)

            // Compile the DSL with shader overrides
            await this._renderer.compile(dsl, { shaderOverrides })

            // Normalize color uniforms: DSL defaults may be hex strings
            // which the WebGL uniform setter can't parse as vec3
            this._normalizeColorUniforms()

            // SUCCESS: Update state
            this._currentDsl = dsl
            this._lastGoodDsl = dsl // Track last known good DSL
            this._hasCorruptedState = false

            // Sync our ProgramState from the compiled DSL
            // This parses the DSL and initializes step states
            this._programState.fromDsl(dsl)

            // Initialize text textures for any text effects in the pipeline
            await this._initializeTextEffects(dsl, effectData)

            return { success: true }
        } catch (err) {
            console.error('Compilation error:', err)
            if (err.diagnostics) {
                console.error('Compilation diagnostics:', JSON.stringify(err.diagnostics, null, 2))
            }
            
            // CRITICAL: Mark state as corrupted so next compile forces fresh pipeline
            this._hasCorruptedState = true
            console.log('[ShadeRenderer] compile: Marked state as corrupted for recovery')
            
            // Aggressively extract error message
            let errorMessage = 'Unknown compilation error'
            let diagnostics = null
            let errorCode = null
            
            if (typeof err === 'string') {
                errorMessage = err
            } else if (err instanceof Error) {
                errorMessage = err.message || err.toString()
            } else if (err && typeof err === 'object') {
                // Capture error code if present (e.g., ERR_SHADER_COMPILE)
                if (err.code) {
                    errorCode = err.code
                }
                
                // Check for diagnostics array (semantic/validation errors)
                if (err.diagnostics && Array.isArray(err.diagnostics)) {
                    diagnostics = err.diagnostics
                    const errorDiags = err.diagnostics.filter(d => d.severity === 'error')
                    if (errorDiags.length > 0) {
                        errorMessage = errorDiags.map(d => d.message).join('; ')
                    }
                } else {
                    // Build informative message from Noisemaker error structure
                    // Structure: { code: "ERR_SHADER_COMPILE", detail: string|null, source: string }
                    if (errorCode) {
                        const parts = [errorCode]
                        if (err.detail) {
                            parts.push(err.detail)
                        }
                        if (err.source && !err.detail) {
                            // Include first line of source for context if no detail
                            const firstLine = err.source.split('\n').slice(0, 3).join(' ').substring(0, 100)
                            parts.push(`source: ${firstLine}...`)
                        }
                        errorMessage = parts.join(': ')
                    } else {
                        // Try various properties that might contain the message
                        errorMessage = err.message || err.error || err.reason || err.description || 
                                       (err.errors && Array.isArray(err.errors) ? err.errors.join(', ') : null) ||
                                       JSON.stringify(err, null, 2)
                    }
                }
            }
            // Final fallback - if still looks like [object Object], use JSON
            if (errorMessage === '[object Object]' || !errorMessage) {
                try {
                    errorMessage = JSON.stringify(err, null, 2)
                } catch (e) {
                    errorMessage = 'Compilation failed (error could not be serialized)'
                }
            }
            return { success: false, error: errorMessage, code: errorCode, diagnostics }
        }
    }

    /**
     * Initialize text textures for text effects in the pipeline
     * @param {string} dsl - DSL source code
     * @param {Array} effectData - Extracted effect data
     * @private
     */
    async _initializeTextEffects(dsl, effectData) {
        // Clear old text canvases
        this._textCanvases.clear()

        // Extract effects with their step indices from DSL
        const effects = extractEffectsFromDsl(dsl)
        
        // Find text effects (filter/text or text in any namespace)
        for (const effect of effects) {
            if (effect.name === 'text' || effect.effectKey === 'text') {
                // Use effect.temp which is the step.temp used for texture binding
                const stepIndex = effect.temp !== undefined ? effect.temp : effect.stepIndex
                const args = effect.args || {}
                
                
                // Get parameters from the effect args
                const params = {
                    text: args.text || 'Hello World',
                    font: args.font || 'Nunito',
                    size: args.size ?? 0.1,
                    posX: args.posX ?? 0.5,
                    posY: args.posY ?? 0.5,
                    rotation: args.rotation ?? 0,
                    color: args.color || '#ffffff',
                    bgColor: args.bgColor || '#000000',
                    bgOpacity: args.bgOpacity ?? 0,
                    justify: args.justify || 'center'
                }
                
                
                // Create canvas for this text effect
                const canvas = document.createElement('canvas')
                canvas.width = this.width
                canvas.height = this.height
                
                const textureId = `textTex_step_${stepIndex}`
                this._textCanvases.set(stepIndex, { canvas, textureId, params })
                
                
                // Render text to canvas
                this._renderTextToCanvas(stepIndex)
            }
        }
    }

    /**
     * Parse text effect parameters from DSL argument string
     * @param {string} argsStr - Arguments string from DSL
     * @returns {object} Parsed parameters
     * @private
     */
    _parseTextParams(argsStr) {
        const params = {
            text: 'Hello World',
            font: 'Nunito',
            size: 0.1,
            posX: 0.5,
            posY: 0.5,
            rotation: 0,
            color: '#ffffff',
            bgColor: '#000000',
            bgOpacity: 0,
            justify: 'center'
        }
        
        // Parse key: value pairs
        const regex = /(\w+)\s*:\s*(?:"([^"]*)"|'([^']*)'|([^,\)]+))/g
        let m
        while ((m = regex.exec(argsStr)) !== null) {
            const key = m[1]
            const value = m[2] || m[3] || m[4]?.trim()
            if (value !== undefined) {
                if (key === 'text' || key === 'font' || key === 'justify') {
                    params[key] = value
                } else if (key === 'color' || key === 'bgColor') {
                    params[key] = value
                } else if (key === 'size' || key === 'posX' || key === 'posY' || key === 'rotation' || key === 'bgOpacity') {
                    params[key] = parseFloat(value)
                }
            }
        }
        
        return params
    }

    /**
     * Build shader overrides from workspace store
     * This allows workspace shaders to override library shaders for loaded effects.
     * 
     * @param {string} dsl - DSL source code
     * @param {object} [workspaceStore] - Workspace store with shader files
     * @returns {object} Shader overrides keyed by step.temp index
     * @private
     */
    _buildShaderOverrides(dsl, workspaceStore) {
        const overrides = {}
        
        if (!workspaceStore) {
            return overrides
        }

        // Get definition.json to find the effect being edited
        const defJson = workspaceStore.getFile('definition.json')
        if (!defJson) {
            return overrides
        }

        let definition
        try {
            definition = JSON.parse(defJson)
        } catch (e) {
            console.error('[ShadeRenderer] Failed to parse definition.json:', e.message)
            console.error('[ShadeRenderer] definition.json content:', defJson)
            return overrides
        }

        const effectFunc = definition.func || definition.name
        const effectNs = definition.namespace
        
        if (!effectFunc) {
            return overrides
        }

        // Gather all shader files from workspace based on current backend
        const workspaceShaders = {}
        const useWgsl = this._renderer.backend === 'wgsl'
        
        for (const [path, content] of workspaceStore.files) {
            if (!content) continue
            
            if (useWgsl && path.startsWith('wgsl/') && path.endsWith('.wgsl')) {
                const progName = path.slice(5, -5) // Remove 'wgsl/' and '.wgsl'
                if (!workspaceShaders[progName]) workspaceShaders[progName] = {}
                workspaceShaders[progName].wgsl = content
            } else if (!useWgsl && path.startsWith('glsl/') && path.endsWith('.glsl')) {
                const progName = path.slice(5, -5) // Remove 'glsl/' and '.glsl'
                if (!workspaceShaders[progName]) workspaceShaders[progName] = {}
                workspaceShaders[progName].glsl = content
            }
        }

        if (Object.keys(workspaceShaders).length === 0) {
            return overrides
        }

        // Extract effects from DSL to find the step indices
        const effects = extractEffectsFromDsl(dsl)
        
        // Find all steps that use our effect
        for (const effect of effects) {
            // Match by effect name (could be full name or short name)
            const shortName = effect.name
            const fullName = effect.fullName || effect.effectKey
            
            const matches = shortName === effectFunc || 
                fullName === effectFunc ||
                fullName === `synth.${effectFunc}` ||
                (effectNs && fullName === `${effectNs}.${effectFunc}`)
            
            
            if (matches) {
                // Apply workspace shaders for this step
                const stepIndex = effect.temp
                overrides[stepIndex] = workspaceShaders
            }
        }
        

        return overrides
    }

    /**
     * Convert hex color to RGB array
     * @param {string} hex - Hex color string
     * @returns {number[]} RGB values 0-1
     * @private
     */
    _hexToRgb(hex) {
        if (Array.isArray(hex)) return hex.slice(0, 3)
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
        return result
            ? [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255, parseInt(result[3], 16) / 255]
            : [1, 1, 1]
    }

    /**
     * Normalize color uniforms after compilation.
     * The DSL parser stores color defaults as hex strings (e.g. "#000000"),
     * but the WebGL uniform setter expects arrays. Convert in-place.
     * @private
     */
    _normalizeColorUniforms() {
        const passes = this._renderer.pipeline?.graph?.passes
        if (!passes) return

        for (const pass of passes) {
            if (!pass.uniforms) continue
            for (const [name, value] of Object.entries(pass.uniforms)) {
                if (typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value)) {
                    pass.uniforms[name] = this._hexToRgb(value)
                }
            }
        }
    }

    /**
     * Render text to canvas and upload as texture
     * @param {number} stepIndex - Step index
     * @private
     */
    _renderTextToCanvas(stepIndex) {
        const textState = this._textCanvases.get(stepIndex)
        if (!textState || !this._renderer._pipeline) return
        
        const { canvas, textureId, params } = textState
        const ctx = canvas.getContext('2d')
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        
        // Draw background if needed
        if (params.bgOpacity > 0) {
            const bgRgb = this._hexToRgb(params.bgColor)
            ctx.fillStyle = `rgba(${Math.round(bgRgb[0] * 255)}, ${Math.round(bgRgb[1] * 255)}, ${Math.round(bgRgb[2] * 255)}, ${params.bgOpacity})`
            ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
        
        // Set up text rendering
        const text = String(params.text || '')
        const lines = text.split('\n')
        const fontSize = Math.round(params.size * canvas.height)
        const lineHeight = fontSize * 1.2
        const textRgb = this._hexToRgb(params.color)
        const rotation = (params.rotation || 0) * Math.PI / 180
        
        const fontFamily = /^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i.test(params.font)
            ? params.font
            : `"${params.font}"`
        ctx.font = `${fontSize}px ${fontFamily}`
        ctx.textAlign = params.justify || 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = `rgba(${Math.round(textRgb[0] * 255)}, ${Math.round(textRgb[1] * 255)}, ${Math.round(textRgb[2] * 255)}, 1)`
        
        const x = params.posX * canvas.width
        const y = params.posY * canvas.height
        
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(rotation)
        
        const totalHeight = (lines.length - 1) * lineHeight
        const startY = -totalHeight / 2
        
        for (let i = 0; i < lines.length; i++) {
            const lineY = startY + i * lineHeight
            ctx.fillText(lines[i], 0, lineY)
        }
        
        ctx.restore()
        
        // Upload canvas as texture
        this._renderer.updateTextureFromSource(textureId, canvas, { flipY: true })
    }

    // =========================================================================
    // Backend Switching
    // =========================================================================

    /**
     * Switch rendering backend
     * @param {'webgl2' | 'webgpu'} backend - Target backend
     * @param {object} [options] - Options
     * @param {object} [options.workspaceStore] - Workspace store for shader overrides
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async switchBackend(backend, options = {}) {
        const wantWebGPU = backend === 'webgpu'
        const wasRunning = this._renderer.isRunning
        
        // Stop render loop during switch
        if (wasRunning) {
            this._renderer.stop()
        }
        
        this.preferWebGPU = wantWebGPU
        
        try {
            await this._renderer.switchBackend(wantWebGPU ? 'wgsl' : 'glsl')
        } catch (err) {
            console.error('[ShadeRenderer] switchBackend failed:', err)
            return { 
                success: false, 
                error: `Failed to switch to ${backend}: ${err.message || err}` 
            }
        }

        // Recompile THE ONE canonical DSL with new backend
        if (this._currentDsl) {
            const result = await this.compile(this._currentDsl, options)
            if (!result.success) {
                return { 
                    success: false, 
                    error: `Backend switch succeeded but recompile failed: ${result.error}` 
                }
            }
        }
        
        // Restart if was running
        if (wasRunning) {
            this._renderer.start()
        }
        
        return { success: true }
    }

    // =========================================================================
    // Configuration
    // =========================================================================

    /**
     * Set target FPS
     * @param {number} fps - Target frames per second
     */
    setTargetFPS(fps) {
        this.targetFPS = fps
        // Note: Noisemaker's CanvasRenderer doesn't support setTargetFPS
    }

    /**
     * Set loop duration
     * @param {number} duration - Duration in seconds
     */
    setLoopDuration(duration) {
        this.loopDuration = duration
        this._renderer.setLoopDuration(duration)
    }

    /**
     * Set a uniform value
     * @param {string} name - Uniform name
     * @param {*} value - Uniform value
     */
    setUniform(name, value) {
        this._renderer.setUniform(name, value)
        
        // Track the uniform value for DSL generation
        if (!this._uniformValues) {
            this._uniformValues = {}
        }
        this._uniformValues[name] = value
        
        // Note: ProgramState.setValue() is called by ParamControls before onChange fires
        // So we don't need to duplicate it here. If called directly (not via ParamControls),
        // the caller should update ProgramState separately.
    }
    
    /**
     * Get all current uniform values that have been set
     * @returns {Object} Map of uniform names to values
     */
    getUniformValues() {
        return this._uniformValues || {}
    }

    // =========================================================================
    // Effect Library
    // =========================================================================

    /**
     * Get all effect IDs from the manifest
     * @returns {string[]} Array of effect IDs (namespace/name)
     */
    getEffectIds() {
        return Object.keys(this._renderer.manifest || {})
    }

    /**
     * Get the manifest entry for an effect
     * @param {string} effectId - Effect ID (namespace/name)
     * @returns {object|null} Manifest entry or null
     */
    getEffectManifest(effectId) {
        return this._renderer.manifest[effectId] || null
    }

    /**
     * Load an effect and return its instance
     * @param {string} effectId - Effect ID (namespace/name)
     * @returns {Promise<object>} Loaded effect with instance
     */
    async loadEffect(effectId) {
        await this._renderer.loadEffects([effectId])
        return this._renderer.loadedEffects.get(effectId)
    }

    /**
     * Get effects for a specific namespace
     * @param {string} namespace - Effect namespace
     * @returns {string[]} Array of effect names
     */
    getEffectsForNamespace(namespace) {
        return this._renderer.getEffectsFromManifest(namespace)
    }

    /**
     * Get effect description
     * @param {string} effectId - Effect ID (namespace/name)
     * @returns {string|null} Description or null
     */
    getEffectDescription(effectId) {
        return this._renderer.getEffectDescription(effectId)
    }

    /**
     * Register a custom effect with the renderer's loaded effects cache.
     * This ensures the effect is available for DSL compilation without
     * trying to load it from bundles.
     *
     * @param {string} effectId - Effect ID (namespace/name format)
     * @param {object} effectDef - Effect definition with name, namespace, globals, passes, shaders
     */
    registerCustomEffect(effectId, effectDef) {
        // Build the effect object structure expected by the renderer
        const effect = {
            namespace: effectDef.namespace || 'synth',
            name: effectDef.name || effectId.split('/')[1],
            instance: effectDef
        }

        // Add to the internal loaded effects cache
        this._renderer._loadedEffects.set(effectId, effect)

        // Also register with variant IDs
        const name = effectDef.name || effectDef.func
        const namespace = effectDef.namespace || 'synth'
        if (name) {
            this._renderer._loadedEffects.set(`${namespace}/${name}`, effect)
            this._renderer._loadedEffects.set(`${namespace}.${name}`, effect)
        }

    }

    /**
     * Search effects by query
     * @param {string} query - Search query
     * @returns {Array<{id: string, description: string, score: number}>}
     */
    searchEffects(query) {
        const results = []
        const queryLower = query.toLowerCase()
        const queryTerms = queryLower.split(/\s+/)

        for (const [id, entry] of Object.entries(this._renderer.manifest)) {
            const description = entry.description || ''
            const searchText = `${id} ${description}`.toLowerCase()

            // Simple scoring based on term matches
            let score = 0
            for (const term of queryTerms) {
                if (searchText.includes(term)) {
                    score += term.length
                    // Bonus for exact matches in ID
                    if (id.toLowerCase().includes(term)) {
                        score += 5
                    }
                }
            }

            if (score > 0) {
                results.push({
                    id,
                    description,
                    starter: entry.starter || false,
                    score
                })
            }
        }

        // Sort by score descending
        results.sort((a, b) => b.score - a.score)
        return results
    }

    /**
     * Build DSL source from an effect and its namespace
     * Delegates to the internal renderer's buildDslSource which has the proper logic
     * for all effect types, search directives, starter/hasTex handling, etc.
     * @param {object} effect - Effect object with namespace and instance
     * @returns {string} Generated DSL program
     */
    buildDslSource(effect) {
        // Use the internal renderer's buildDslSource
        if (this._renderer.buildDslSource) {
            return this._renderer.buildDslSource(effect)
        }
        
        // Fallback if internal buildDslSource not available
        if (!effect || !effect.instance) {
            return ''
        }

        const namespace = effect.namespace
        const funcName = effect.instance.func || effect.name
        const effectId = `${namespace}/${effect.name}`
        
        // Get manifest info for this effect, or use values from instance (for workspace effects)
        const manifestEntry = this._renderer.manifest?.[effectId] || {}
        const isStarter = effect.instance.starter !== undefined 
            ? effect.instance.starter === true 
            : manifestEntry.starter === true
        const hasTex = effect.instance.hasTex !== undefined 
            ? effect.instance.hasTex === true 
            : manifestEntry.hasTex === true

        // Points namespace: needs pointsEmit/pointsRender wrapper
        if (namespace === 'points') {
            return `search points, synth, render

noise()
  .pointsEmit()
  .${funcName}()
  .pointsRender()
  .write(o0)

render(o0)`
        }
        
        // 3D synth namespace
        if (namespace === 'synth3d') {
            return `search synth3d, render

${funcName}()
  .render3d()
  .write(o0)

render(o0)`
        }

        // Determine search directive based on namespace
        let searchNs = namespace
        if (namespace === 'classicNoisemaker') {
            searchNs = 'classicNoisemaker, synth'
        } else if (namespace === 'classicNoisedeck') {
            searchNs = 'classicNoisedeck, synth'
        } else if (namespace === 'render') {
            searchNs = 'synth, filter, render'
        } else if (namespace === 'filter' || namespace === 'mixer') {
            searchNs = `${namespace}, synth`
        }

        // Generate DSL based on starter/hasTex from manifest
        if (isStarter) {
            if (hasTex) {
                // Starter with tex: generate source, then apply effect with tex
                return `search ${searchNs}

noise()
  .write(o0)

${funcName}(tex: read(o0))
  .write(o1)

render(o1)`
            } else {
                // Pure starter: just run the effect
                return `search ${searchNs}

${funcName}()
  .write(o0)

render(o0)`
            }
        } else {
            if (hasTex) {
                // Non-starter with tex: needs two inputs
                return `search ${searchNs}

noise()
  .write(o0)

noise(seed: 2)
  .${funcName}(tex: read(o0))
  .write(o1)

render(o1)`
            } else {
                // Non-starter without tex: chain after noise
                return `search ${searchNs}

noise()
  .${funcName}()
  .write(o0)

render(o0)`
            }
        }
    }
}