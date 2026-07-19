/**
 * Effect Controls Panel
 *
 * Web component that renders parameter controls for a single effect, using
 * handfish web components (slider-value, color-picker, vector2d/3d-picker,
 * select-dropdown, toggle-switch) and native inputs for hex color and string
 * parameters.
 *
 * Usage (after handfish is loaded):
 *
 *   const panel = document.createElement('effect-controls')
 *   panel.programState = programState
 *   panel.docCallback = (effectId) => loadDocs(effectId)
 *   panel.show({ effectInfo, effectDef })
 *   container.appendChild(panel)
 *
 *   panel.addEventListener('panelclose', () => { ... })
 *
 * @module ui/effectControls
 */

const STYLES_ID = 'effect-controls-panel-styles'

function injectStyles() {
    if (document.getElementById(STYLES_ID)) return
    const style = document.createElement('style')
    style.id = STYLES_ID
    style.textContent = `
        /* No backdrop-filter on the panel itself: it would create a
           containing block for fixed-positioned descendants, which breaks
           the centering of modal <dialog> children (color-picker, etc.). */
        effect-controls {
            display: flex;
            flex-direction: column;
            width: 100%;
            min-height: 0;
            background: color-mix(in srgb, var(--hf-color-1) 92%, transparent 8%);
            border: 1px solid color-mix(in srgb, var(--hf-accent-3) 15%, transparent 85%);
            border-radius: var(--hf-radius);
            color: var(--hf-color-6);
            font-family: var(--hf-font-family);
            font-size: var(--hf-size-sm, 0.75rem);
            box-sizing: border-box;
            overflow: hidden;
        }

        effect-controls[hidden] {
            display: none;
        }

        effect-controls .ec-titlebar {
            display: flex;
            align-items: center;
            gap: 0.5em;
            padding: 0 0.5em;
            min-height: var(--hf-titlebar-height);
            height: var(--hf-titlebar-height);
            background: color-mix(in srgb, var(--hf-effect-shared-accent, var(--hf-accent-1)) 35%, transparent 65%);
            border-bottom: 1px solid color-mix(in srgb, var(--hf-accent-3) 25%, transparent 75%);
            color: var(--hf-ui-neutral, var(--hf-color-6));
            font-weight: 600;
            font-variation-settings: 'wght' 600;
            text-transform: var(--hf-text-transform);
            letter-spacing: 0.05em;
            flex: 0 0 auto;
        }

        effect-controls .ec-namespace {
            color: color-mix(in srgb, var(--hf-color-5) 80%, transparent 20%);
            font-size: 0.75rem;
            font-weight: 500;
        }

        effect-controls .ec-name {
            font-size: 0.95rem;
            color: var(--hf-color-6);
            margin-right: auto;
        }

        effect-controls .ec-action-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 1.75rem;
            height: 1.75rem;
            background: transparent;
            border: 1px solid transparent;
            border-radius: var(--hf-radius-sm, 0.25rem);
            color: var(--hf-color-5);
            cursor: pointer;
            padding: 0;
            transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
            font-family: 'Material Symbols Outlined';
            font-size: 1.125rem;
            line-height: 1;
        }

        effect-controls .ec-action-btn:hover {
            background: color-mix(in srgb, var(--hf-accent-3) 15%, transparent 85%);
            color: var(--hf-color-7);
        }

        effect-controls .ec-action-btn:disabled {
            opacity: 0.35;
            cursor: not-allowed;
        }

        effect-controls .ec-body {
            padding: 0.625rem 0.75rem 0.75rem;
            overflow-y: auto;
            flex: 1 1 auto;
            min-height: 0;
            scrollbar-width: thin;
            scrollbar-color:
                color-mix(in srgb, var(--hf-accent-3) 30%, transparent 70%) transparent;
        }

        effect-controls .ec-body::-webkit-scrollbar {
            width: 0.5rem;
        }

        effect-controls .ec-body::-webkit-scrollbar-track {
            background: color-mix(in srgb, var(--hf-accent-3) 5%, transparent 95%);
            border-radius: var(--hf-radius-md, 0.375rem);
        }

        effect-controls .ec-body::-webkit-scrollbar-thumb {
            background: color-mix(in srgb, var(--hf-accent-3) 30%, transparent 70%);
            border-radius: var(--hf-radius-md, 0.375rem);
            transition: background 0.15s ease;
        }

        effect-controls .ec-body::-webkit-scrollbar-thumb:hover {
            background: color-mix(in srgb, var(--hf-accent-3) 50%, transparent 50%);
        }

        effect-controls .ec-empty {
            color: color-mix(in srgb, var(--hf-color-5) 60%, transparent 40%);
            font-size: 0.75rem;
            font-style: italic;
            padding: 0.25rem 0;
        }

        effect-controls .ec-category {
            margin-top: 0.5rem;
        }

        effect-controls .ec-category:first-child {
            margin-top: 0;
        }

        effect-controls .ec-category-label {
            font-size: 0.6875rem;
            font-weight: 600;
            font-variation-settings: 'wght' 600;
            color: color-mix(in srgb, var(--hf-color-5) 85%, var(--hf-accent-3) 15%);
            text-transform: var(--hf-text-transform);
            letter-spacing: 0.03em;
            margin: 0 0 0.375rem;
            padding-bottom: 0.25rem;
            border-top: 1px solid color-mix(in srgb, var(--hf-accent-3) 12%, transparent 88%);
            padding-top: 0.5rem;
        }

        effect-controls .ec-category:first-child .ec-category-label {
            border-top: none;
            padding-top: 0;
        }

        /* Outer grid: two control-groups per row (matches noisedeck's #controls). */
        effect-controls .ec-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.5rem 0.75rem;
        }

        /* Each control-group is its own row: label | slider/control | value.
           handfish slider-value uses display:contents, so its slider track and
           value display flow as separate grid items. The third column is
           sized for a numeric value. Non-slider controls span cols 2-3.
           margin-bottom + outer row-gap matches noisedeck's row breathing. */
        effect-controls .ec-control-group {
            display: grid;
            grid-template-columns: 5em 1fr 3em;
            align-items: center;
            gap: 0.5rem;
            min-width: 0;
            margin-bottom: 0.25rem;
        }

        effect-controls .ec-control-group.ec-wide {
            grid-column: 1 / -1;
        }

        /* A control whose ui.enabledBy condition is currently false: shown but
           inert, so it reads as "not applicable now" instead of "broken". */
        effect-controls .ec-control-group.ec-disabled {
            opacity: 0.4;
            pointer-events: none;
        }

        effect-controls .ec-control-label {
            font-size: 0.6875rem;
            font-weight: 600;
            font-variation-settings: 'wght' 600;
            color: color-mix(in srgb, var(--hf-color-6) 85%, var(--hf-accent-3) 15%);
            text-transform: var(--hf-text-transform);
            letter-spacing: 0.03em;
            text-align: right;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* Non-slider controls span the slider + value columns. */
        effect-controls .ec-control-group > select-dropdown,
        effect-controls .ec-control-group > color-picker,
        effect-controls .ec-control-group > toggle-switch,
        effect-controls .ec-control-group > vector2d-picker,
        effect-controls .ec-control-group > vector3d-picker,
        effect-controls .ec-control-group > input,
        effect-controls .ec-control-group > textarea,
        effect-controls .ec-control-group > button {
            grid-column: 2 / 4;
            min-width: 0;
            width: 100%;
        }

        /* slider-value is display:contents — its children flow into the grid
           directly. The slider track lands in col 2, value display in col 3. */
        effect-controls .ec-control-group > slider-value {
            grid-column: 2 / 4;
        }

        effect-controls .ec-control-group slider-value .value-display {
            font-family: var(--hf-font-family-mono, 'Noto Sans Mono', monospace);
            font-size: 0.625rem;
            color: color-mix(in srgb, var(--hf-color-5) 90%, var(--hf-accent-3) 10%);
            text-align: right;
        }

        effect-controls .ec-text-input,
        effect-controls .ec-textarea {
            background: color-mix(in srgb, var(--hf-color-2) 80%, transparent 20%);
            color: var(--hf-color-6);
            border: 1px solid color-mix(in srgb, var(--hf-accent-3) 18%, transparent 82%);
            border-radius: var(--hf-radius-sm, 0.25rem);
            padding: 0.25rem 0.5rem;
            font-family: var(--hf-font-family-mono, 'Noto Sans Mono', 'Noto Sans Mono Block', monospace);
            font-size: 0.75rem;
            outline: none;
            box-sizing: border-box;
        }

        effect-controls .ec-textarea {
            resize: vertical;
            min-height: 2.5rem;
        }

        effect-controls .ec-text-input:focus,
        effect-controls .ec-textarea:focus {
            border-color: var(--hf-focus-ring-color, var(--hf-accent-3));
        }

        effect-controls .ec-hex-color {
            height: var(--hf-control-height, 1.875rem);
            border: 1px solid color-mix(in srgb, var(--hf-accent-3) 18%, transparent 82%);
            border-radius: var(--hf-radius-sm, 0.25rem);
            background: transparent;
            cursor: pointer;
            padding: 0.125rem;
        }
    `
    document.head.appendChild(style)
}

const SURFACE_OPTIONS = ['o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7']
const VOLUME_OPTIONS = ['vol0', 'vol1', 'vol2', 'vol3', 'vol4', 'vol5', 'vol6', 'vol7']
const GEOMETRY_OPTIONS = ['geo0', 'geo1', 'geo2', 'geo3', 'geo4', 'geo5', 'geo6', 'geo7']

function classifyType(spec) {
    if (!spec) return 'unknown'
    if (spec.ui?.control === 'button') return 'button'
    if (spec.ui?.control === 'checkbox' || spec.type === 'boolean') return 'boolean'
    if (spec.ui?.control === 'color' || spec.type === 'vec4') return 'color'
    if (spec.type === 'vec2') return 'vec2'
    if (spec.type === 'vec3') return 'vec3'
    if (spec.choices) return 'choices'
    if (spec.enum && spec.type === 'int') return 'enumInt'
    if (spec.type === 'member') return 'member'
    if (spec.type === 'float' || spec.type === 'int') return 'slider'
    if (spec.type === 'surface') return 'surface'
    if (spec.type === 'volume') return 'volume'
    if (spec.type === 'geometry') return 'geometry'
    if (spec.type === 'string') return 'string'
    if (spec.type === 'enum') return 'enum'
    if (spec.type === 'color') return 'hexColor'
    return 'unknown'
}

function isHidden(spec) {
    if (!spec) return true
    return spec.ui?.control === false || spec.ui?.hidden === true
}

function groupByCategory(globals) {
    const groups = {}
    const order = []
    const DEFAULT = 'general'
    for (const [key, spec] of Object.entries(globals || {})) {
        if (isHidden(spec)) continue
        const cat = spec.ui?.category || DEFAULT
        if (!groups[cat]) {
            groups[cat] = []
            order.push(cat)
        }
        groups[cat].push([key, spec])
    }
    if (order.includes(DEFAULT)) {
        order.splice(order.indexOf(DEFAULT), 1)
        order.unshift(DEFAULT)
    }
    return order.map(cat => [cat, groups[cat]])
}

function isAutomationValue(value) {
    if (!value || typeof value !== 'object') return false
    return !!(value._varRef
        || value.type === 'Oscillator' || value._ast?.type === 'Oscillator'
        || value.type === 'Midi' || value._ast?.type === 'Midi'
        || value.type === 'Audio' || value._ast?.type === 'Audio')
}

function rgbToHex(r, g, b) {
    const to = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')
    return `#${to(r)}${to(g)}${to(b)}`
}

function hexToRgb(hex) {
    const h = hex.startsWith('#') ? hex.slice(1) : hex
    const r = parseInt(h.slice(0, 2), 16) / 255
    const g = parseInt(h.slice(2, 4), 16) / 255
    const b = parseInt(h.slice(4, 6), 16) / 255
    return [r, g, b]
}

// -----------------------------------------------------------------------------
// ui.enabledBy — a control is live only when its condition holds against the
// other params' current values (e.g. halftone `pattern` applies only when
// `mode` is mono). Without this, inapplicable controls look active but the
// shader ignores them, so changing them does nothing. Semantics match
// noisedeck's controlSync.evaluateEnableCondition.
// -----------------------------------------------------------------------------
function conditionValuesEqual(a, b) {
    if (a === b) return true
    if (a === null || a === undefined || b === null || b === undefined) return false
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false
        return a.every((v, i) => Math.abs(v - b[i]) < 0.0001)
    }
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.0001
    return a === b
}

function conditionValueIsTruthy(value) {
    if (value === undefined || value === null) return false
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    if (Array.isArray(value)) return value.some((v, i) => (i === 3 ? false : Math.abs(v - 0.5) > 0.01))
    if (typeof value === 'string') return value.length > 0
    return true
}

function evaluateEnableCondition(condition, params) {
    if (typeof condition === 'string') return conditionValueIsTruthy(params[condition])
    if (typeof condition !== 'object' || condition === null) return true
    if (Array.isArray(condition.or)) return condition.or.some(c => evaluateEnableCondition(c, params))
    if (Array.isArray(condition.and)) return condition.and.every(c => evaluateEnableCondition(c, params))
    if (condition.not !== undefined) return !evaluateEnableCondition(condition.not, params)

    const paramName = condition.param
    if (!paramName) return true
    const value = params[paramName]

    const operators = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn']
    if (!operators.some(op => condition[op] !== undefined)) return conditionValueIsTruthy(value)

    let result = true
    if (condition.eq !== undefined) result = result && conditionValuesEqual(value, condition.eq)
    if (condition.neq !== undefined) result = result && !conditionValuesEqual(value, condition.neq)
    if (condition.gt !== undefined) result = result && (typeof value === 'number' && value > condition.gt)
    if (condition.gte !== undefined) result = result && (typeof value === 'number' && value >= condition.gte)
    if (condition.lt !== undefined) result = result && (typeof value === 'number' && value < condition.lt)
    if (condition.lte !== undefined) result = result && (typeof value === 'number' && value <= condition.lte)
    if (condition.in !== undefined && Array.isArray(condition.in)) result = result && condition.in.some(v => conditionValuesEqual(value, v))
    if (condition.notIn !== undefined && Array.isArray(condition.notIn)) result = result && !condition.notIn.some(v => conditionValuesEqual(value, v))
    return result
}

class EffectControls extends HTMLElement {
    constructor() {
        super()
        this._programState = null
        this._docCallback = null
        this._effectInfo = null
        this._effectDef = null
        this._effectKey = null
        this._enums = null
        this._titleEl = null
        this._infoBtn = null
        this._closeBtn = null
        this._bodyEl = null
        this._controlHandles = new Map()
        this._applyingFromState = false
        this._programStateListener = null
        this._rendered = false
    }

    connectedCallback() {
        if (!this._rendered) {
            injectStyles()
            this._buildShell()
            this._rendered = true
        }
        if (!this._effectInfo) {
            this.setAttribute('hidden', '')
        }
    }

    disconnectedCallback() {
        this._unsubscribeFromState()
    }

    set programState(ps) {
        this._unsubscribeFromState()
        this._programState = ps
        if (ps && typeof ps.on === 'function') {
            this._programStateListener = () => this._syncControlValuesFromState()
            ps.on('change', this._programStateListener)
            ps.on('load', this._programStateListener)
        }
    }

    get programState() { return this._programState }

    set docCallback(fn) { this._docCallback = fn }

    set enums(enums) { this._enums = enums }

    /**
     * Show the panel for a specific effect.
     * @param {object} opts
     * @param {object} opts.effectInfo - From extractEffectsFromDsl(), with stepIndex/name/effectKey/...
     * @param {object} opts.effectDef - The Effect definition (with `globals`)
     */
    show({ effectInfo, effectDef }) {
        if (!this._rendered) {
            injectStyles()
            this._buildShell()
            this._rendered = true
        }
        this._effectInfo = effectInfo
        this._effectDef = effectDef
        this._effectKey = `step_${effectInfo.stepIndex}`
        this._renderTitlebar()
        this._renderBody()
        this.removeAttribute('hidden')
    }

    /**
     * Refresh state when the underlying call site has shifted but the effect is the same.
     */
    updateEffectInfo(effectInfo) {
        if (!this._effectInfo) return
        this._effectInfo = effectInfo
        this._effectKey = `step_${effectInfo.stepIndex}`
        this._syncControlValuesFromState()
    }

    hide() {
        this._effectInfo = null
        this._effectDef = null
        this._effectKey = null
        this._controlHandles.clear()
        this.setAttribute('hidden', '')
    }

    /**
     * Identifier used by external code to know what the panel is currently showing.
     */
    get effectInfo() { return this._effectInfo }

    _unsubscribeFromState() {
        if (this._programState && this._programStateListener && typeof this._programState.off === 'function') {
            this._programState.off('change', this._programStateListener)
            this._programState.off('load', this._programStateListener)
        }
        this._programStateListener = null
    }

    _buildShell() {
        const titleBar = document.createElement('div')
        titleBar.className = 'ec-titlebar'

        const namespaceEl = document.createElement('span')
        namespaceEl.className = 'ec-namespace'
        titleBar.appendChild(namespaceEl)

        const nameEl = document.createElement('span')
        nameEl.className = 'ec-name'
        titleBar.appendChild(nameEl)

        const infoBtn = document.createElement('button')
        infoBtn.className = 'ec-action-btn'
        infoBtn.type = 'button'
        infoBtn.title = 'effect help'
        infoBtn.textContent = 'info'
        infoBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            this._onInfoClick()
        })
        titleBar.appendChild(infoBtn)

        const closeBtn = document.createElement('button')
        closeBtn.className = 'ec-action-btn'
        closeBtn.type = 'button'
        closeBtn.title = 'close'
        closeBtn.textContent = 'close'
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            this.dispatchEvent(new CustomEvent('panelclose', { bubbles: true }))
        })
        titleBar.appendChild(closeBtn)

        const body = document.createElement('div')
        body.className = 'ec-body'

        this.appendChild(titleBar)
        this.appendChild(body)

        this._titleEl = nameEl
        this._namespaceEl = namespaceEl
        this._infoBtn = infoBtn
        this._closeBtn = closeBtn
        this._bodyEl = body
    }

    _renderTitlebar() {
        const info = this._effectInfo
        if (!info) return
        this._titleEl.textContent = info.name
        const ns = info.namespace || (info.fullName?.includes('/') ? info.fullName.split('/')[0] : '')
        this._namespaceEl.textContent = ns ? `${ns}:` : ''
        this._infoBtn.disabled = !this._docCallback
    }

    _renderBody() {
        this._bodyEl.innerHTML = ''
        this._controlHandles.clear()
        const def = this._effectDef
        if (!def || !def.globals || Object.keys(def.globals).length === 0) {
            const empty = document.createElement('div')
            empty.className = 'ec-empty'
            empty.textContent = 'no parameters'
            this._bodyEl.appendChild(empty)
            return
        }

        const grouped = groupByCategory(def.globals)
        if (grouped.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'ec-empty'
            empty.textContent = 'no parameters'
            this._bodyEl.appendChild(empty)
            return
        }

        for (const [category, params] of grouped) {
            const section = document.createElement('section')
            section.className = 'ec-category'

            if (grouped.length > 1 || category !== 'general') {
                const label = document.createElement('div')
                label.className = 'ec-category-label'
                label.textContent = category
                section.appendChild(label)
            }

            const grid = document.createElement('div')
            grid.className = 'ec-grid'
            section.appendChild(grid)

            for (const [paramName, spec] of params) {
                const group = this._buildControlGroup(paramName, spec)
                if (group) grid.appendChild(group)
            }

            this._bodyEl.appendChild(section)
        }

        this._applyEnableStates()
    }

    _buildControlGroup(paramName, spec) {
        const kind = classifyType(spec)
        const group = document.createElement('div')
        group.className = 'ec-control-group'
        group.dataset.paramKey = paramName

        if (kind === 'string' || kind === 'vec2' || kind === 'vec3' || kind === 'color' || kind === 'choices' || kind === 'enum' || kind === 'enumInt' || kind === 'member' || kind === 'surface' || kind === 'volume' || kind === 'geometry') {
            // Most types render reasonably wide; sliders/booleans share a row well.
            // Wide-ify multi-row controls.
            if (kind === 'vec2' || kind === 'vec3' || kind === 'color') {
                group.classList.add('ec-wide')
            }
            if (spec.ui?.multiline) group.classList.add('ec-wide')
        }

        const label = document.createElement('span')
        label.className = 'ec-control-label'
        label.textContent = spec.ui?.label || paramName
        if (spec.ui?.hint) label.title = spec.ui.hint
        group.appendChild(label)

        const value = this._readValue(paramName, spec)
        if (isAutomationValue(value)) {
            const automatic = document.createElement('span')
            automatic.className = 'ec-empty'
            automatic.style.fontSize = '0.75rem'
            automatic.textContent = this._describeAutomation(value)
            group.appendChild(automatic)
            return group
        }

        let handle
        switch (kind) {
            case 'slider': handle = this._buildSlider(paramName, spec, value); break
            case 'boolean': handle = this._buildToggle(paramName, value); break
            case 'color': handle = this._buildColorPicker(paramName, spec, value); break
            case 'hexColor': handle = this._buildHexColor(paramName, value); break
            case 'vec2': handle = this._buildVector2(paramName, spec, value); break
            case 'vec3': handle = this._buildVector3(paramName, spec, value); break
            case 'choices': handle = this._buildChoices(paramName, spec, value); break
            case 'enumInt': handle = this._buildEnumInt(paramName, spec, value); break
            case 'member': handle = this._buildMember(paramName, spec, value); break
            case 'enum': handle = this._buildEnum(paramName, spec, value); break
            case 'surface': handle = this._buildOptionSelect(paramName, SURFACE_OPTIONS, value); break
            case 'volume': handle = this._buildOptionSelect(paramName, VOLUME_OPTIONS, value); break
            case 'geometry': handle = this._buildOptionSelect(paramName, GEOMETRY_OPTIONS, value); break
            case 'string': handle = this._buildString(paramName, spec, value); break
            case 'button': handle = this._buildButton(paramName, spec); break
            default: handle = this._buildUnsupported(spec); break
        }

        if (handle) {
            if (handle.element) group.appendChild(handle.element)
            handle.spec = spec
            handle.group = group
            this._controlHandles.set(paramName, handle)
        }
        return group
    }

    _readValue(paramName, spec) {
        if (this._programState && this._effectKey) {
            const v = this._programState.getValue(this._effectKey, paramName)
            if (v !== undefined) return v
        }
        if (this._effectInfo?.args && paramName in this._effectInfo.args) {
            return this._effectInfo.args[paramName]
        }
        if (spec && 'default' in spec) return spec.default
        return undefined
    }

    _commitValue(paramName, value, spec) {
        if (!this._programState || !this._effectKey) return
        this._applyingFromState = true
        try {
            this._programState.setValue(this._effectKey, paramName, value)
        } finally {
            this._applyingFromState = false
        }
        this.dispatchEvent(new CustomEvent('paramchange', {
            bubbles: true,
            detail: { effectKey: this._effectKey, paramName, value, spec }
        }))
        // This edit may flip another control's enabledBy condition (e.g.
        // changing halftone `mode` enables/disables `pattern`).
        this._applyEnableStates()
    }

    _describeAutomation(value) {
        if (!value || typeof value !== 'object') return 'automated'
        if (value._varRef) return value._varRef
        const t = value.type || value._ast?.type
        if (t === 'Oscillator') return 'osc()'
        if (t === 'Midi') return 'midi()'
        if (t === 'Audio') return 'audio()'
        return 'automated'
    }

    _onInfoClick() {
        if (!this._docCallback || !this._effectInfo) return
        const info = this._effectInfo
        let effectId = null
        const ns = info.namespace
        if (ns && info.name) effectId = `${ns}/${info.name}`
        else if (info.fullName?.includes('/')) effectId = info.fullName
        else if (info.fullName?.includes('.')) effectId = info.fullName.replace('.', '/')
        else effectId = info.name
        this._docCallback(effectId, info)
    }

    _syncControlValuesFromState() {
        if (this._applyingFromState) return
        if (!this._effectKey || !this._programState) return
        if (!this._effectDef?.globals) return
        for (const [paramName, spec] of Object.entries(this._effectDef.globals)) {
            const handle = this._controlHandles.get(paramName)
            if (!handle?.setValue) continue
            const value = this._programState.getValue(this._effectKey, paramName)
            if (value === undefined) continue
            if (isAutomationValue(value)) continue
            handle.setValue(value, spec)
        }
        this._applyEnableStates()
    }

    _currentValues() {
        const values = {}
        const globals = this._effectDef?.globals || {}
        for (const paramName of Object.keys(globals)) {
            values[paramName] = this._readValue(paramName, globals[paramName])
        }
        return values
    }

    _applyEnableStates() {
        if (this._controlHandles.size === 0) return
        const values = this._currentValues()
        for (const [, handle] of this._controlHandles) {
            const cond = handle.spec?.ui?.enabledBy
            const enabled = cond ? evaluateEnableCondition(cond, values) : true
            if (handle.group) handle.group.classList.toggle('ec-disabled', !enabled)
            const el = handle.element
            if (el) {
                if (enabled) el.removeAttribute('disabled')
                else el.setAttribute('disabled', '')
                try { el.disabled = !enabled } catch { /* not settable on this element */ }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Control builders. Each returns a handle: { element, setValue?(value) }.
    // -------------------------------------------------------------------------

    _buildSlider(paramName, spec, value) {
        const isInt = spec.type === 'int'
        const slider = document.createElement('slider-value')
        slider.min = spec.min ?? 0
        slider.max = spec.max ?? 1
        slider.step = spec.step ?? (isInt ? 1 : 0.01)
        slider.type = isInt ? 'int' : 'float'
        slider.value = (typeof value === 'number') ? value : (spec.default ?? slider.min)

        slider.addEventListener('input', () => {
            const numericValue = isInt ? Math.round(slider.value) : Number(slider.value)
            this._commitValue(paramName, numericValue, spec)
        })

        return {
            element: slider,
            setValue: (v) => {
                if (typeof v === 'number') slider.value = v
            }
        }
    }

    _buildToggle(paramName, value) {
        const toggle = document.createElement('toggle-switch')
        if (value) toggle.setAttribute('checked', '')
        toggle.addEventListener('change', () => {
            this._commitValue(paramName, !!toggle.checked)
        })
        return {
            element: toggle,
            setValue: (v) => {
                if (v) toggle.setAttribute('checked', '')
                else toggle.removeAttribute('checked')
            }
        }
    }

    _buildColorPicker(paramName, spec, value) {
        const isVec4 = spec?.type === 'vec4'
        const picker = document.createElement('color-picker')
        picker.value = colorValueToHex(value)

        picker.addEventListener('input', () => {
            const hex = picker.value
            const [r, g, b] = hexToRgb(hex)
            let next
            if (isVec4) {
                const cur = this._readValue(paramName, spec)
                const a = Array.isArray(cur) && cur.length >= 4 && typeof cur[3] === 'number' ? cur[3] : 1
                next = [r, g, b, a]
            } else {
                next = [r, g, b]
            }
            this._commitValue(paramName, next, spec)
        })

        return {
            element: picker,
            setValue: (v) => { picker.value = colorValueToHex(v) }
        }
    }

    _buildHexColor(paramName, value) {
        const input = document.createElement('input')
        input.type = 'color'
        input.className = 'ec-hex-color'
        input.value = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'
        input.addEventListener('input', () => {
            this._commitValue(paramName, input.value)
        })
        return {
            element: input,
            setValue: (v) => {
                if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) input.value = v
            }
        }
    }

    _buildVector2(paramName, spec, value) {
        const picker = document.createElement('vector2d-picker')
        picker.setAttribute('min', spec.min ?? -1)
        picker.setAttribute('max', spec.max ?? 1)
        picker.setAttribute('step', spec.step ?? 0.01)
        if (paramName.toLowerCase().includes('dir') || spec.normalized === true) {
            picker.setAttribute('normalized', '')
        }
        picker.value = vectorTo2D(value)

        picker.addEventListener('input', () => {
            const v = picker.value
            this._commitValue(paramName, [v.x, v.y], spec)
        })

        return {
            element: picker,
            setValue: (v) => { picker.value = vectorTo2D(v) }
        }
    }

    _buildVector3(paramName, spec, value) {
        const picker = document.createElement('vector3d-picker')
        picker.setAttribute('min', spec.min ?? -1)
        picker.setAttribute('max', spec.max ?? 1)
        picker.setAttribute('step', spec.step ?? 0.01)
        if (paramName.toLowerCase().includes('dir') || spec.normalized === true) {
            picker.setAttribute('normalized', '')
        }
        picker.value = vectorTo3D(value)

        picker.addEventListener('input', () => {
            const v = picker.value
            this._commitValue(paramName, [v.x, v.y, v.z], spec)
        })

        return {
            element: picker,
            setValue: (v) => { picker.value = vectorTo3D(v) }
        }
    }

    _buildChoices(paramName, spec, value) {
        const select = document.createElement('select-dropdown')
        const options = []
        for (const [label, val] of Object.entries(spec.choices || {})) {
            if (label.endsWith(':')) continue
            options.push({ value: stringifyChoiceValue(val), text: label })
        }
        select.setOptions(options)
        select.value = stringifyChoiceValue(value)

        select.addEventListener('change', () => {
            const raw = select.value
            const parsed = parseChoiceValue(raw, spec)
            this._commitValue(paramName, parsed, spec)
        })

        return {
            element: select,
            setValue: (v) => { select.value = stringifyChoiceValue(v) }
        }
    }

    _buildEnumInt(paramName, spec, value) {
        const select = document.createElement('select-dropdown')
        const enumPath = spec.enumPath || spec.enum
        const enumObj = lookupEnum(this._enums, enumPath)
        const options = []
        if (enumObj && typeof enumObj === 'object') {
            for (const [key, val] of Object.entries(enumObj)) {
                if (typeof val === 'number') {
                    options.push({ value: String(val), text: key })
                }
            }
        }
        select.setOptions(options)
        select.value = String(value ?? spec.default ?? '')

        select.addEventListener('change', () => {
            const v = parseInt(select.value, 10)
            this._commitValue(paramName, v, spec)
        })

        return {
            element: select,
            setValue: (v) => { select.value = String(v) }
        }
    }

    _buildMember(paramName, spec, value) {
        const select = document.createElement('select-dropdown')
        const enumPath = spec.enumPath || spec.enum
        const enumObj = lookupEnum(this._enums, enumPath)
        const options = []
        if (enumObj && typeof enumObj === 'object') {
            for (const key of Object.keys(enumObj)) {
                options.push({ value: key, text: key })
            }
        }
        select.setOptions(options)
        select.value = memberValueAsString(value)

        select.addEventListener('change', () => {
            const v = select.value
            this._commitValue(paramName, { type: 'Member', path: enumPath ? [enumPath, v] : [v] }, spec)
        })

        return {
            element: select,
            setValue: (v) => { select.value = memberValueAsString(v) }
        }
    }

    _buildEnum(paramName, spec, value) {
        const select = document.createElement('select-dropdown')
        const opts = Array.isArray(spec.options) ? spec.options : []
        select.setOptions(opts.map(o => ({ value: String(o), text: String(o) })))
        select.value = String(value ?? spec.default ?? '')
        select.addEventListener('change', () => {
            this._commitValue(paramName, select.value, spec)
        })
        return {
            element: select,
            setValue: (v) => { select.value = String(v) }
        }
    }

    _buildOptionSelect(paramName, options, value) {
        const select = document.createElement('select-dropdown')
        select.setOptions(options.map(o => ({ value: o, text: o })))
        select.value = typeof value === 'string' ? value : (options[0] || '')
        select.addEventListener('change', () => {
            this._commitValue(paramName, select.value)
        })
        return {
            element: select,
            setValue: (v) => { if (typeof v === 'string') select.value = v }
        }
    }

    _buildString(paramName, spec, value) {
        const multiline = spec.ui?.multiline === true
        const el = multiline ? document.createElement('textarea') : document.createElement('input')
        if (!multiline) el.type = 'text'
        el.className = multiline ? 'ec-textarea' : 'ec-text-input'
        el.value = typeof value === 'string' ? value : (spec.default ?? '')
        el.addEventListener('input', () => {
            this._commitValue(paramName, el.value, spec)
        })
        return {
            element: el,
            setValue: (v) => { if (typeof v === 'string') el.value = v }
        }
    }

    _buildButton(paramName, spec) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'ec-action-btn'
        btn.style.width = 'auto'
        btn.style.height = '1.875rem'
        btn.style.padding = '0 0.625rem'
        btn.style.fontFamily = 'inherit'
        btn.style.fontSize = '0.75rem'
        btn.textContent = spec.ui?.buttonLabel || paramName
        btn.addEventListener('click', () => {
            this._commitValue(paramName, true, spec)
        })
        return { element: btn }
    }

    _buildUnsupported(spec) {
        const note = document.createElement('span')
        note.className = 'ec-empty'
        note.textContent = `(${spec?.type || 'unknown'} not yet supported)`
        return { element: note }
    }
}

function colorValueToHex(value) {
    if (typeof value === 'string' && /^#[0-9a-f]{6,8}$/i.test(value)) return value.slice(0, 7)
    if (Array.isArray(value)) {
        const [r = 0, g = 0, b = 0] = value
        if (typeof r === 'number') return rgbToHex(r, g, b)
    }
    return '#000000'
}

function vectorTo2D(value) {
    if (Array.isArray(value)) return { x: Number(value[0] ?? 0), y: Number(value[1] ?? 0) }
    if (value && typeof value === 'object') return { x: Number(value.x ?? 0), y: Number(value.y ?? 0) }
    return { x: 0, y: 0 }
}

function vectorTo3D(value) {
    if (Array.isArray(value)) return { x: Number(value[0] ?? 0), y: Number(value[1] ?? 0), z: Number(value[2] ?? 0) }
    if (value && typeof value === 'object') return { x: Number(value.x ?? 0), y: Number(value.y ?? 0), z: Number(value.z ?? 0) }
    return { x: 0, y: 0, z: 0 }
}

function stringifyChoiceValue(v) {
    if (v === undefined || v === null) return ''
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
    return JSON.stringify(v)
}

function parseChoiceValue(raw, spec) {
    if (typeof raw !== 'string') return raw
    if (raw === 'true') return true
    if (raw === 'false') return false
    const asNum = Number(raw)
    if (!Number.isNaN(asNum) && raw.trim() !== '') return asNum
    try {
        return JSON.parse(raw)
    } catch {
        return raw
    }
}

function memberValueAsString(value) {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object' && Array.isArray(value.path)) {
        return value.path[value.path.length - 1] ?? ''
    }
    return ''
}

function lookupEnum(enums, path) {
    if (!enums || !path) return null
    const parts = String(path).split('.')
    let cur = enums
    for (const p of parts) {
        if (cur && typeof cur === 'object' && p in cur) cur = cur[p]
        else return null
    }
    return cur
}

if (!customElements.get('effect-controls')) {
    customElements.define('effect-controls', EffectControls)
}

export { EffectControls }
