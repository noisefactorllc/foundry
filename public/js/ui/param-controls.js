/**
 * Parameter Controls UI Component
 *
 * Generates UI controls for effect parameters (globals).
 *
 * @module ui/param-controls
 */

/**
 * ParamControls class
 *
 * @example
 * const controls = new ParamControls(containerEl, {
 *     onChange: (name, value) => renderer.setUniform(name, value)
 * });
 * controls.setEffect(effectInstance);
 */
export class ParamControls {
    /**
     * Create a new ParamControls
     * @param {HTMLElement} container - Container element
     * @param {object} [options] - Options
     * @param {function} [options.onChange] - Called when a parameter changes
     * @param {function} [options.onRender] - Called when controls are re-rendered
     */
    constructor(container, options = {}) {
        this.container = container
        this.onChange = options.onChange || (() => {})
        this.onRender = options.onRender || (() => {})
        this.effect = null
        this.values = {}
        
        // ProgramState integration (Phase 3 migration)
        this.programState = null
        this.stepKey = null
        this._stateChangeHandler = null
        this._stateLoadHandler = null
    }

    /**
     * Set the ProgramState reference
     * @param {object} programState - ProgramState instance
     * @param {string} [stepKey='step_0'] - Which step these controls are for
     */
    setProgramState(programState, stepKey = 'step_0') {
        // Remove previous listeners if any
        if (this.programState) {
            if (this._stateChangeHandler) {
                this.programState.off('change', this._stateChangeHandler)
            }
            if (this._stateLoadHandler) {
                this.programState.off('load', this._stateLoadHandler)
            }
        }
        
        this.programState = programState
        this.stepKey = stepKey
        
        // Guard: programState might not be available yet
        if (!programState) {
            console.warn('[ParamControls] setProgramState called with undefined programState')
            return
        }
        
        // Subscribe to individual value changes (from slider movements)
        this._stateChangeHandler = ({ stepKey: changedKey, paramName, value }) => {
            if (changedKey === this.stepKey) {
                this._updateControlValue(paramName, value)
            }
        }
        this.programState.on('change', this._stateChangeHandler)
        
        // Subscribe to DSL load/recompile (updates all controls from new DSL values)
        this._stateLoadHandler = () => {
            this._syncAllControlsFromState()
        }
        this.programState.on('load', this._stateLoadHandler)
    }

    /**
     * Sync all controls to current ProgramState values
     * Called when DSL is compiled/recompiled
     * FORCES update on EVERY change - no conditional logic
     * @private
     */
    _syncAllControlsFromState() {
        if (!this.programState || !this.stepKey) return
        
        // Get the effect definition from ProgramState (THE ONE SOURCE OF TRUTH)
        const effectDef = this.programState.getEffectDef(this.stepKey)
        
        // Get values from ProgramState (THE ONE SOURCE OF TRUTH)
        const stepValues = this.programState.getStepValues(this.stepKey) || {}
        
        const newGlobals = effectDef?.globals || {}
        
        // ALWAYS update effect and re-render controls when DSL changes
        // No conditional logic - FORCE the update every time
        if (effectDef) {
            this.effect = effectDef
            this.values = {}
            
            // Initialize values from ProgramState, falling back to defaults
            for (const [name, spec] of Object.entries(newGlobals)) {
                if (stepValues[name] !== undefined) {
                    this.values[name] = stepValues[name]
                } else if (spec.default !== undefined) {
                    this.values[name] = spec.default
                } else {
                    this.values[name] = this._getDefaultForType(spec.type)
                }
            }
            
            this.render()
        } else {
            // No effect def but still update any existing controls with stepValues
            for (const [name, value] of Object.entries(stepValues)) {
                if (!name.startsWith('_')) {
                    this.values[name] = value
                    this._updateControlValue(name, value)
                }
            }
            // Still notify that an update happened (for overlay sync)
            this.onRender()
        }
    }

    /**
     * Update a control's displayed value (internal, called on ProgramState change)
     * @param {string} name - Parameter name
     * @param {any} value - New value
     * @private
     */
    _updateControlValue(name, value) {
        const input = this.container.querySelector(`[data-param="${name}"]`)
        if (input) {
            if (input.type === 'checkbox') {
                input.checked = value
            } else if (input.type === 'color') {
                const type = this.effect?.globals?.[name]?.type || 'vec4'
                input.value = type === 'vec3' || type === 'vec4' ? this._vec4ToHex(value) : value
            } else {
                input.value = value
            }
            const valueDisplay = input.parentElement?.querySelector('.param-value')
            if (valueDisplay) {
                valueDisplay.textContent = this._formatValue(value)
            }
        }
    }

    /**
     * Set the effect to generate controls for
     * @param {object} effect - Effect instance with globals
     */
    setEffect(effect) {
        this.effect = effect
        this.values = {}

        // Initialize values - prefer ProgramState as THE source of truth
        if (effect && effect.globals) {
            // Get values from ProgramState if available (THE ONE SOURCE OF TRUTH)
            const stateValues = (this.programState && this.stepKey) 
                ? this.programState.getStepValues(this.stepKey) 
                : {}
            
            for (const [name, spec] of Object.entries(effect.globals)) {
                // Use ProgramState value if exists, otherwise fall back to defaults
                if (stateValues[name] !== undefined) {
                    this.values[name] = stateValues[name]
                } else if (spec.default !== undefined) {
                    this.values[name] = spec.default
                } else {
                    // Provide type-appropriate defaults
                    this.values[name] = this._getDefaultForType(spec.type)
                }
            }
        }

        this.render()
    }

    /**
     * Get a sensible default value for a given type
     * @param {string} type - The uniform type
     * @returns {any} Default value appropriate for the type
     * @private
     */
    _getDefaultForType(type) {
        switch (type) {
            case 'vec2':
                return [0, 0]
            case 'vec3':
                return [1, 1, 1]
            case 'vec4':
                return [1, 1, 1, 1]
            case 'bool':
                return false
            case 'int':
                return 0
            case 'float':
            default:
                return 0
        }
    }

    /**
     * Get current parameter values
     * Now delegates to ProgramState when available
     * @returns {Object<string, any>}
     */
    getValues() {
        if (this.programState && this.stepKey) {
            return this.programState.getStepValues(this.stepKey)
        }
        return { ...this.values }  // Fallback for backward compat
    }

    /**
     * Set a parameter value
     * Now delegates to ProgramState when available
     * @param {string} name - Parameter name
     * @param {any} value - New value
     */
    setValue(name, value) {
        // Always keep local values in sync (for rendering)
        this.values[name] = value
        
        if (this.programState && this.stepKey) {
            // Use ProgramState as THE source of truth
            this.programState.setValue(this.stepKey, name, value)
            // Call onChange for direct uniform updates
            this.onChange(name, value)
        } else {
            // Fallback when ProgramState not available
            this.onChange(name, value)
            // Update UI if needed
            this._updateControlValue(name, value)
        }
    }

    /**
     * Render the controls
     */
    render() {
        if (!this.effect || !this.effect.globals) {
            this.container.innerHTML = `
                <div class="empty-state">Load an effect to see parameters</div>
            `
            this.onRender()
            return
        }

        const globals = this.effect.globals
        const entries = Object.entries(globals)

        if (entries.length === 0) {
            this.container.innerHTML = `
                <div class="empty-state">
                    <p>No custom parameters</p>
                    <p class="hint">Standard uniforms available: time, resolution, aspect</p>
                </div>
            `
            this.onRender()
            return
        }

        // Group by category if available
        const groups = this._groupByCategory(entries)

        this.container.innerHTML = ''

        for (const [category, params] of Object.entries(groups)) {
            if (category !== 'default') {
                const header = document.createElement('div')
                header.className = 'param-category'
                header.textContent = category
                this.container.appendChild(header)
            }

            for (const [name, spec] of params) {
                const control = this._createControl(name, spec)
                this.container.appendChild(control)
            }
        }
        
        // Notify listener that controls were rendered
        this.onRender()
    }

    /**
     * Group parameters by category
     * @private
     */
    _groupByCategory(entries) {
        const groups = { default: [] }

        for (const [name, spec] of entries) {
            const category = spec.ui?.category || 'default'
            if (!groups[category]) {
                groups[category] = []
            }
            groups[category].push([name, spec])
        }

        return groups
    }

    /**
     * Create a control element for a parameter
     * @private
     */
    _createControl(name, spec) {
        const div = document.createElement('div')
        div.className = 'param-control'

        const label = spec.ui?.label || name
        const type = spec.type || 'float'
        const control = spec.ui?.control
        const value = this.values[name]

        // Check for color control first (ui.control takes precedence)
        if (control === 'color' || type === 'vec4' || type === 'vec3') {
            div.innerHTML = this._createColorPicker(name, label, value)
        } else if (type === 'bool') {
            div.innerHTML = this._createCheckbox(name, label, value)
        } else if (type === 'float' || type === 'int') {
            div.innerHTML = this._createSlider(name, label, spec, value)
        } else {
            div.innerHTML = this._createSlider(name, label, spec, value)
        }

        // Add event listeners
        const input = div.querySelector('input')
        if (input) {
            input.addEventListener('input', (e) => {
                let newValue

                if (e.target.type === 'checkbox') {
                    newValue = e.target.checked
                } else if (e.target.type === 'color') {
                    // Convert hex color to vec3 or vec4 for shader uniforms
                    newValue = this._hexToVec(e.target.value, type)
                } else {
                    newValue = parseFloat(e.target.value)
                    if (type === 'int') {
                        newValue = Math.round(newValue)
                    }
                }

                // Use setValue to delegate to ProgramState when available
                this.setValue(name, newValue)

                // Update value display (setValue may not update display for non-ProgramState path)
                const valueDisplay = div.querySelector('.param-value')
                if (valueDisplay) {
                    valueDisplay.textContent = this._formatValue(newValue)
                }
            })
        }

        return div
    }

    /**
     * Create slider HTML
     * @private
     */
    _createSlider(name, label, spec, value) {
        const min = spec.min !== undefined ? spec.min : 0
        const max = spec.max !== undefined ? spec.max : 1
        const step = spec.type === 'int' ? 1 : (max - min) / 100

        return `
            <div class="param-label">
                <span>${label}</span>
                <span class="param-value">${this._formatValue(value)}</span>
            </div>
            <input type="range" class="param-slider" data-param="${name}"
                   min="${min}" max="${max}" step="${step}" value="${value}">
        `
    }

    /**
     * Create checkbox HTML
     * @private
     */
    _createCheckbox(name, label, value) {
        return `
            <label class="param-checkbox">
                <input type="checkbox" data-param="${name}" ${value ? 'checked' : ''}>
                <span>${label}</span>
            </label>
        `
    }

    /**
     * Create color picker HTML
     * @private
     */
    _createColorPicker(name, label, value) {
        // Convert vec4 to hex color
        const hex = this._vec4ToHex(value)

        return `
            <div class="param-label">
                <span>${label}</span>
            </div>
            <input type="color" class="param-color" data-param="${name}" value="${hex}">
        `
    }

    /**
     * Format a value for display
     * @private
     */
    _formatValue(value) {
        if (typeof value === 'boolean') {
            return value ? 'on' : 'off'
        }
        if (typeof value === 'number') {
            return value.toFixed(2)
        }
        if (Array.isArray(value) && value.length >= 3) {
            // Vec4 color - show as hex
            return this._vec4ToHex(value)
        }
        return String(value)
    }

    /**
     * Convert vec4 to hex color
     * @private
     */
    _vec4ToHex(vec) {
        if (!Array.isArray(vec) || vec.length < 3) {
            return '#ffffff'
        }
        const r = Math.round(vec[0] * 255).toString(16).padStart(2, '0')
        const g = Math.round(vec[1] * 255).toString(16).padStart(2, '0')
        const b = Math.round(vec[2] * 255).toString(16).padStart(2, '0')
        return `#${r}${g}${b}`
    }

    /**
     * Convert hex color to vec4
     * @private
     */
    _hexToVec4(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255
        const g = parseInt(hex.slice(3, 5), 16) / 255
        const b = parseInt(hex.slice(5, 7), 16) / 255
        return [r, g, b, 1.0]
    }

    /**
     * Convert hex color to vec3 or vec4 based on type
     * @private
     */
    _hexToVec(hex, type) {
        const r = parseInt(hex.slice(1, 3), 16) / 255
        const g = parseInt(hex.slice(3, 5), 16) / 255
        const b = parseInt(hex.slice(5, 7), 16) / 255
        return type === 'vec3' ? [r, g, b] : [r, g, b, 1.0]
    }
}
