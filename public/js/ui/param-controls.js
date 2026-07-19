/**
 * Param Controls
 *
 * Drives the <effect-controls> panel for the effect currently being edited.
 *
 * The panel is the same component Polymorphic uses, so the layout, widget set,
 * and DSL round-trip all match it. This module only answers "which effect is
 * being edited, and where does it sit in the compiled chain?", and keeps the
 * call surface app.js and the chat ToolExecutor depend on.
 *
 * @module ui/param-controls
 */

import './effect-controls.js'

export class ParamControls {
    /**
     * @param {HTMLElement} container - Mount point (the params overlay body)
     * @param {object} [options]
     * @param {(name: string, value: any) => void} [options.onChange] - Fired per committed edit
     */
    constructor(container, options = {}) {
        this.container = container
        this.onChange = options.onChange || (() => {})

        /** The effect being edited — an effect instance, or {globals} from definition.json. */
        this.effect = null
        this.programState = null

        this._shownSignature = null
        this._stateListener = null
        // Provides the engine's enum table (channel/color/etc). member and
        // enum-int dropdowns build their options from it; without it those
        // dropdowns render empty and can't be changed.
        this._enumsProvider = null

        this._empty = document.createElement('div')
        this._empty.className = 'empty-state'
        this._empty.textContent = 'Load an effect to see parameters'

        this._panel = document.createElement('effect-controls')
        this._panel.addEventListener('paramchange', (e) => {
            this.onChange(e.detail.paramName, e.detail.value)
        })

        this.container.innerHTML = ''
        this.container.appendChild(this._empty)
        this.container.appendChild(this._panel)
    }

    /** The step the panel is bound to, or null when nothing is shown. */
    get stepKey() {
        const info = this._panel.effectInfo
        return info ? `step_${info.stepIndex}` : null
    }

    /**
     * @param {object} programState - The engine's ProgramState for the live program
     */
    setProgramState(programState, enumsProvider) {
        if (this.programState?.off && this._stateListener) {
            this.programState.off('load', this._stateListener)
            this.programState.off('structurechange', this._stateListener)
        }
        this.programState = programState
        this._panel.programState = programState
        if (enumsProvider) this._enumsProvider = enumsProvider
        if (programState?.on) {
            this._stateListener = () => this._sync()
            programState.on('load', this._stateListener)
            programState.on('structurechange', this._stateListener)
        }
        this._sync()
    }

    /**
     * @param {object|null} effect - The effect being edited, or null to clear
     */
    setEffect(effect) {
        this.effect = effect
        this._sync()
    }

    /** @returns {object} Current values for the edited effect's step */
    getValues() {
        const stepKey = this.stepKey
        if (this.programState && stepKey) return this.programState.getStepValues(stepKey)
        return {}
    }

    /**
     * @param {string} name - Parameter name
     * @param {any} value - New value
     */
    setValue(name, value) {
        const stepKey = this.stepKey
        if (!this.programState || !stepKey) return
        this.programState.setValue(stepKey, name, value)
        this.onChange(name, value)
    }

    _sync() {
        const info = this._resolveEffectInfo()
        const def = this._resolveEffectDef(info)

        if (!info || !def?.globals) {
            this._shownSignature = null
            this._panel.hide()
            this._empty.hidden = false
            return
        }

        const signature = `${info.stepIndex}:${info.fullName}:${Object.keys(def.globals).join(',')}`
        if (signature === this._shownSignature) {
            // Same effect, same params: the call site may have shifted, but a
            // rebuild here would drop focus and interrupt an in-flight drag.
            this._panel.updateEffectInfo(info)
            return
        }

        this._shownSignature = signature
        this._empty.hidden = true
        if (this._enumsProvider) this._panel.enums = this._enumsProvider() || {}
        this._panel.show({ effectInfo: info, effectDef: def })
    }

    /**
     * Locate the edited effect in the compiled chain by name.
     *
     * Authoring DSL is usually `effect().write(o0)`, where the edited effect is
     * also step 0 — but any chain with a starter in front of it (the default
     * program included) would otherwise surface the starter's params instead.
     */
    _resolveEffectInfo() {
        const structure = this.programState?.getStructure?.() || []
        if (structure.length === 0) return null

        const name = this._editedEffectName()
        if (name) {
            // Show the edited effect specifically. If it isn't in the compiled
            // chain, don't fall back to an unrelated step — that would surface
            // (and edit) the wrong effect. Signal "nothing to show" instead.
            return structure.find(e => e.name === name || e.fullName === name) || null
        }
        // No specific effect being edited: show the program's first step.
        return structure[0]
    }

    _resolveEffectDef(info) {
        if (!info) return null
        // While authoring, definition.json runs ahead of the compiled program:
        // a param added there should show up before the next successful compile.
        const name = this._editedEffectName()
        if (this.effect?.globals && (!name || info.name === name || info.fullName === name)) {
            return this.effect
        }
        return this.programState?.getEffectDef?.(`step_${info.stepIndex}`) || null
    }

    _editedEffectName() {
        return this.effect?.func || this.effect?.name || null
    }
}
