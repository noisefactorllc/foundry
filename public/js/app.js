/**
 * Effect Workspace
 * Main application entry point
 * 
 * A pure effects editor with hot reload - no AI components
 */

import { ShadeRenderer } from './noisemaker/index.js'
import { preloadFontsForDsl } from './fontLoader.js'
import { workspaceStore, saveWorkspace, loadWorkspace, registerEffectFromWorkspace, writePortableEffectToWorkspace, readPortableEffectFromWorkspace, replaceWorkspaceEffect } from './workspace/index.js'
import { imageFilePath } from './imageRecords.js'
import { FileBrowser, ParamControls, SavedEffects, keyboard, toast, helpModal, aboutModal, nameDialog, CodeEditor, deleteEffectDialog, initDocReader, toggleDocReader, showDocReader, hideDocReader, isDocReaderVisible, showPlaceholderContent, importFromUrlDialog } from './ui/index.js'
import { FOUNDRY_VERSION } from './ui/about-modal.js'
import { OpenEffectDialog } from './ui/open-effect-dialog.js'
import { ImportEffectDialog } from './ui/import-effect-dialog.js'
import { WorkspaceFilesDialog } from './ui/workspace-files-dialog.js'
import { shareModal } from './ui/share-modal.js'
import { loadFromCode, getCodeFromUrl, attachShareFiles } from './sharingLoader.js'
import { bootstrapAgent, markAgentReady, createSeanceAgentRelay } from './agent/index.js'
import { createOnlineCollaboration } from './onlineCollaboration.js'
// A namespace import: an older handfish without the connect-agent dialog
// still loads the app, and the "connect agent..." item stays hidden.
import * as handfish from 'handfish'
import {
    errorHandler,
    handleError,
    ErrorType,
    getPreferences,
    setPreference,
    saveUIState,
    loadUIState,
    addRecentEffect,
    escapeHtml,
    debounce
} from './utils/index.js'

// =========================================================================
// Default DSL Program (Splash Screen)
// =========================================================================

function getDefaultDsl() {
    return `
search synth, filter

solid()
  .text(text: "Welcome to Foundry!", size: 0.05, font: 'Victor Mono')
  .write(o0)

render(o0)
`
}

// =========================================================================
// Loading Screen
// =========================================================================

const loadingScreen = document.getElementById('loading-screen')
const appContainer = document.getElementById('app')

function updateLoadingStatus(status) {
    const statusSpan = loadingScreen?.querySelector('.loading-status span')
    if (statusSpan) {
        statusSpan.textContent = status
    }
}

function updateMenuFilename() {
    // The menu bar's center label pulls filename + visibility from state.
    refreshMenuBar()
}

function hideLoadingScreen() {
    if (!loadingScreen) return
    
    loadingScreen.classList.add('fade-out')
    appContainer.classList.add('loaded')
    
    setTimeout(() => {
        loadingScreen.classList.add('hidden')
    }, 400)
}

// =========================================================================
// DOM Elements
// =========================================================================

const canvas = document.getElementById('canvas')
const dslEditor = document.getElementById('dsl-editor')
const compileStatus = document.getElementById('compile-status')
const durationInput = document.getElementById('duration-input')
const fpsCounter = document.getElementById('fps-counter')
const paramsContainer = document.getElementById('params-overlay-content')
const fileTreeContainer = document.getElementById('file-tree')
const savedEffectsContainer = document.getElementById('saved-overlay-content')

// Canvas overlay elements
const toggleSavedOverlay = document.getElementById('toggle-saved-overlay')
const paramsOverlay = document.getElementById('params-overlay')
const savedOverlay = document.getElementById('saved-overlay')
const canvasEditor = document.getElementById('canvas-editor')
// canvasEditor is now a <code-editor> web component with .value property
const compilerErrorEl = document.getElementById('compiler-error')
const saveEffectOverlayBtn = document.getElementById('save-effect-overlay-btn')
const agentStatus = document.getElementById('agent-status')

// =========================================================================
// State
// =========================================================================

let isPaused = false
let playPauseTouched = false   // original title reads "Play/Pause (Space)" until first toggled
let pausedTime = 0
let currentEffect = null
let performancePauseGraceEnd = 0
let activeBottomLeftOverlay = null
let canvasEditorVisible = true // Visible by default in Effect Workspace
let canvasEditorCurrentFile = 'dsl.txt'
// Set true for one tick when the editor handles Cmd+Enter itself (it dispatches
// 'forcerecompile'), so the global Cmd+Enter shortcut can skip its own compile
// and avoid a double. See the forcerecompile listener and the keyboard shortcut.
let editorHandledForceRecompile = false

// Editor hot reload state
let hotReloadTimeout = null
let originalDsl = ''

// =========================================================================
// UI Components
// =========================================================================

const fileBrowser = new FileBrowser(fileTreeContainer, {
    onSelect: (path) => {
        const content = workspaceStore.getFile(path)
        if (content) {
            console.log('Selected:', path)
        }
    }
})

const paramControls = new ParamControls(paramsContainer, {
    onChange: (name, value) => {
        renderer.setUniform(name, value)
        if (isPaused) {
            renderer.render(pausedTime)
        }
        updateDslEditorFromState()
        debouncedParamCheckpoint()
    }
})

// Compile-time `define` params are baked into the shader source, so a uniform
// write does nothing — the picture only changes on a recompile. ProgramState
// emits `recompileNeeded` for any define-param mutation (already gated on a
// real value change and coalesced across a batch), so we drive the recompile
// off that rather than re-deriving it per widget.
let defineRecompileTimer = null
let defineRecompileInFlight = false
function scheduleDefineRecompile() {
    if (defineRecompileTimer) clearTimeout(defineRecompileTimer)
    defineRecompileTimer = setTimeout(async () => {
        defineRecompileTimer = null
        // Don't overlap compiles; if a request lands mid-compile, re-defer it.
        if (defineRecompileInFlight) { scheduleDefineRecompile(); return }
        defineRecompileInFlight = true
        try {
            const result = await compileAndRun()
            // Multi-pass library effects have incomplete workspace shaders; if
            // the workspace recompile fails, fall back to the pristine library
            // effect so define-param changes still take effect.
            if (result && !result.success) await compileAndRun({})
        } finally {
            defineRecompileInFlight = false
        }
    }, 120)
}

/**
 * Update the DSL editor to show the current DSL with parameter values
 */
function updateDslEditorFromState() {
    if (renderer?.programState?.toDsl) {
        try {
            const dslWithParams = renderer.programState.toDsl()
            if (dslWithParams && dslWithParams.trim()) {
                dslEditor.value = dslWithParams
                if (canvasEditor && canvasEditorCurrentFile === 'dsl.txt') {
                    canvasEditor.value = dslWithParams
                }
            }
        } catch (err) {
            console.warn('[App] Failed to update DSL editor from state:', err)
        }
    }
}

// Saved effects list
let savedEffects = null
if (savedEffectsContainer) {
    savedEffects = new SavedEffects(savedEffectsContainer, {
        onLoad: async (store) => {
            showBottomLeftOverlay(null)
            
            console.log('[SavedEffects] Loading effect:', store.name)
            
            const defJson = store.getFile('definition.json')
            let effectName = store.name
            let namespace = 'synth'
            let globals = {}
            
            if (defJson) {
                try {
                    const def = JSON.parse(defJson)
                    effectName = def.func || def.name || store.name
                    namespace = def.namespace || 'synth'
                    globals = def.globals || {}
                } catch (e) {
                    console.error('[SavedEffects] Failed to parse definition.json:', e.message)
                }
            }
            
            let dsl = store.getFile('dsl.txt')
            if (!dsl && effectName) {
                dsl = `search ${namespace}\n${effectName}().write(o0)\nrender(o0)`
            }
            
            if (dsl) {
                dslEditor.value = dsl
                if (canvasEditor) {
                    // Open definition.json when loading an effect
                    const defContent = store.getFile('definition.json')
                    if (defContent) {
                        canvasEditor.value = defContent
                        canvasEditorCurrentFile = 'definition.json'
                    } else {
                        canvasEditor.value = dsl
                        canvasEditorCurrentFile = 'dsl.txt'
                    }
                    updateMenuFilename()
                }
                await compileAndRun()
            }
            
            fileBrowser.render()
            paramControls.setEffect({ globals })
            
            toast.success(`Loaded: ${store.name}`)
        }
    })
}

// =========================================================================
// Canvas Resize
// =========================================================================

function resizeCanvas() {
    const baseDpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth || 1024
    const height = canvas.clientHeight || 1024
    
    const renderedWidth = width * baseDpr
    const renderedHeight = height * baseDpr
    const isHighRes = renderedWidth > 1920 || renderedHeight > 1080
    const dpr = isHighRes ? baseDpr * 0.5 : baseDpr
    
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    
    return { width: canvas.width, height: canvas.height }
}

// =========================================================================
// Renderer Setup
// =========================================================================

const renderer = new ShadeRenderer(canvas, {
    width: canvas.width || 1024,
    height: canvas.height || 1024,
    preferWebGPU: false,
    targetFPS: 60,
    loopDuration: durationInput ? parseInt(durationInput.value) || 10 : 10,
    onFPS: (fps) => {
        if (fpsCounter) {
            fpsCounter.textContent = `${fps} fps`
        }
        
        const now = Date.now()
        if (fps < 20 && !isPaused && now > performancePauseGraceEnd) {
            renderer.stop()
            isPaused = true
            pausedTime = 0
            refreshMenuBar()
            toast.warning('Performance pause - shader too expensive')
        }
    },
    onError: (err) => {
        showCompileStatus(`Error: ${err.message}`, 'error')
    }
})

// Expose renderer for debugging
window.effectWorkspaceRenderer = renderer

// Set renderer on SavedEffects
if (savedEffects) {
    savedEffects.renderer = renderer
}

// =========================================================================
// Effect Library (Open Dialog)
// =========================================================================

let allEffects = []
const openEffectDialog = new OpenEffectDialog()

// Set up the callback for when an effect is selected
openEffectDialog.onEffectSelect(async (effectId) => {
    // Check if this is a user-saved effect
    if (effectId.startsWith('user/')) {
        const savedId = effectId.substring(5) // Remove 'user/' prefix
        if (savedEffects) {
            await savedEffects.load(savedId)
            // After loading, compile the effect
            await compileAndRun()
        }
    } else {
        loadEffectToWorkspace(effectId)
    }
})

// =========================================================================
// Workspace Files Dialog
// =========================================================================

const workspaceFilesDialog = new WorkspaceFilesDialog()

// Set up the callback for when a file is selected
workspaceFilesDialog.onFileSelect((filePath) => {
    if (!canvasEditorVisible) {
        toggleCanvasEditor()
    }
    switchEditorFile(filePath)
})

/**
 * Refresh the effect dialog with library effects + user saved effects
 */
async function refreshEffectDialog() {
    // Start with library effects
    const libraryEffects = renderer.getEffectIds().map(id => {
        const [namespace, name] = id.split('/')
        return { id, namespace, name }
    })
    
    // Add user saved effects
    let userEffects = []
    if (savedEffects) {
        await savedEffects.refresh()
        userEffects = savedEffects.effects.map(e => ({
            id: `user/${e.id}`,
            namespace: 'user',
            name: e.name || e.id
        }))
    }
    
    // Combine: user effects first, then library
    allEffects = [...userEffects, ...libraryEffects]
    openEffectDialog.setEffects(allEffects)
}

// =========================================================================
// Import from ZIP Dialog
// =========================================================================

const importEffectDialog = new ImportEffectDialog()

// Set up the callback for when an effect is imported from ZIP
importEffectDialog.onEffectImport(async ({ name, files, images = [] }) => {
    // Clear workspace
    workspaceStore.files.clear()
    workspaceStore.name = name

    // Load files into workspace, converting definition.js to definition.json if needed
    for (const [path, content] of Object.entries(files)) {
        if (path === 'definition.js') {
            // Convert JS definition to JSON format
            const jsonDef = convertDefinitionJsToJson(content, name)
            workspaceStore.files.set('definition.json', jsonDef)
        } else if (path === 'definition.json') {
            workspaceStore.files.set(path, content)
        } else {
            workspaceStore.files.set(path, content)
        }
    }
    // The ZIP's images, as Blob records
    workspaceStore.images = images

    // Get DSL from definition's defaultProgram, or generate one
    let dsl = workspaceStore.getFile('dsl.txt') || workspaceStore.getFile('effect.dsl')
    const defContent = workspaceStore.files.get('definition.json')
    if (defContent) {
        try {
            const def = JSON.parse(defContent)
            dsl ||= def.defaultProgram
        } catch (e) { /* ignore parse errors */ }
    }
    if (!dsl) {
        dsl = `search user\n\n${name}().write(o0)`
    }
    workspaceStore.files.set('dsl.txt', dsl)

    // Register the effect (pass DSL so it can detect starter usage)
    await registerEffectFromWorkspace(null, dsl)

    if (dslEditor) {
        dslEditor.value = dsl
    }

    // Save to current workspace slot and compile
    await saveWorkspace(workspaceStore)
    await compileAndRun()

    // Update file browser and effect dialog
    fileBrowser?.render()
    await refreshEffectDialog()

    toast.success(`Imported: ${name}`)
})

/**
 * Convert a definition.js class file to definition.json format
 * @param {string} jsContent - The JS class content
 * @param {string} fallbackName - Fallback effect name
 * @returns {string} JSON definition
 */
function convertDefinitionJsToJson(jsContent, fallbackName) {
    const def = {
        name: fallbackName,
        namespace: 'user',
        func: fallbackName,
        description: '',
        tags: ['user'],
        globals: {},
        passes: []
    }

    // Extract name
    const nameMatch = jsContent.match(/name\s*[=:]\s*['"]([^'"]+)['"]/)
    if (nameMatch) def.name = nameMatch[1]

    // Extract func
    const funcMatch = jsContent.match(/func\s*[=:]\s*['"]([^'"]+)['"]/)
    if (funcMatch) def.func = funcMatch[1]
    else def.func = def.name

    // Extract namespace
    const nsMatch = jsContent.match(/namespace\s*[=:]\s*['"]([^'"]+)['"]/)
    if (nsMatch) def.namespace = nsMatch[1]

    // Extract description
    const descMatch = jsContent.match(/description\s*[=:]\s*['"]([^'"]+)['"]/)
    if (descMatch) def.description = descMatch[1]

    // Extract globals - look for globals = { ... } or globals: { ... }
    const globalsMatch = jsContent.match(/globals\s*[=:]\s*(\{[\s\S]*?\})\s*[;,]?\s*(?=\n\s*(?:passes|constructor|\})|$)/)
    if (globalsMatch) {
        try {
            // Try to parse the globals object
            def.globals = eval('(' + globalsMatch[1] + ')')
        } catch (e) {
            console.warn('[Import] Could not parse globals:', e)
        }
    }

    // Extract passes
    const passesMatch = jsContent.match(/passes\s*[=:]\s*(\[[\s\S]*?\])\s*[;,]?\s*(?=\n\s*(?:globals|constructor|\})|$)/)
    if (passesMatch) {
        try {
            def.passes = eval('(' + passesMatch[1] + ')')
        } catch (e) {
            console.warn('[Import] Could not parse passes:', e)
        }
    }

    // Extract tags
    const tagsMatch = jsContent.match(/tags\s*[=:]\s*(\[[^\]]*\])/)
    if (tagsMatch) {
        try {
            def.tags = eval('(' + tagsMatch[1] + ')')
        } catch (e) {
            console.warn('[Import] Could not parse tags:', e)
        }
    }

    return JSON.stringify(def, null, 2)
}

// =========================================================================
// Effect Loading
// =========================================================================

/** Rename exact DSL call identifiers while preserving comments and string values. */
function renameEffectCalls(source, originalName, newName) {
    // Keep strings and comments whole so apparent calls inside them stay literal.
    const tokens = Array.from(source.matchAll(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_]\w*|[^\s]/g))
        .filter(token => !token[0].startsWith('//') && !token[0].startsWith('/*'))
    let renamed = source
    for (let i = tokens.length - 2; i >= 0; i--) {
        if (tokens[i][0] === originalName && tokens[i + 1][0] === '(') {
            const start = tokens[i].index
            renamed = renamed.slice(0, start) + newName + renamed.slice(start + originalName.length)
        }
    }
    return renamed
}

/** Resolve imported effects from the workspace before their library originals. */
function useWorkspaceNamespace(source) {
    return source.replace(/^search[ \t]+([^\r\n]+)/m, (_, search) => {
        const namespaces = search.split(',').map(namespace => namespace.trim())
            .filter(namespace => namespace !== 'user')
        return `search ${['user', ...namespaces].join(', ')}`
    })
}

async function loadEffectToWorkspace(effectId, newName) {
    try {
        const effect = await renderer.loadEffect(effectId)
        if (!effect || !effect.instance) {
            throw new Error(`Effect ${effectId} not found`)
        }

        const instance = effect.instance
        const name = newName || effect.name || effectId.split('/')[1]

        workspaceStore.clear()
        workspaceStore.name = name
        updateMenuFilename()

        // Get manifest info for starter/hasTex - check instance first, then manifest
        const manifestEntry = renderer.getEffectManifest(effectId) || {}
        
        // Determine starter/hasTex: instance takes priority over manifest
        const isStarter = instance.starter !== undefined 
            ? instance.starter === true 
            : manifestEntry.starter === true
        const hasTex = instance.hasTex !== undefined 
            ? instance.hasTex === true 
            : manifestEntry.hasTex === true

        const definitionMeta = {
            name: name,  // Use the provided/derived name
            func: name,  // Use the provided/derived name as func
            namespace: 'user',  // Use 'user' namespace for imported effects
            originalNamespace: effect.namespace,  // Keep original for reference
            description: instance.description || '',
            tags: instance.tags || [],
            globals: instance.globals || {},
            passes: instance.passes || [],  // Preserve pass structure
            textures: instance.textures || {},  // Preserve texture specs
            starter: isStarter,
            hasTex: hasTex,
            // 3D effect properties
            outputTex3d: instance.outputTex3d || null,
            outputGeo: instance.outputGeo || null,
            uniformLayout: instance.uniformLayout,
            uniformLayouts: instance.uniformLayouts,
            defaultProgram: instance.defaultProgram,
            paramAliases: instance.paramAliases
        }

        // For simple single-pass effects, rename the program to match the new effect name
        // Build a mapping from old program names to new ones
        const originalFunc = instance.func || instance.name
        const programRenameMap = {}
        
        // If passes reference the original func name, map it to the new name
        if (definitionMeta.passes && definitionMeta.passes.length > 0) {
            definitionMeta.passes = definitionMeta.passes.map(pass => {
                const newPass = { ...pass }
                // If pass program matches original func, rename to new name
                if (pass.program === originalFunc) {
                    programRenameMap[originalFunc] = name
                    newPass.program = name
                }
                return newPass
            })
        }

        // Keep per-program buffer layouts aligned with renamed shader files.
        if (definitionMeta.uniformLayouts) {
            definitionMeta.uniformLayouts = Object.fromEntries(
                Object.entries(definitionMeta.uniformLayouts).map(([program, layout]) =>
                    [programRenameMap[program] || program, layout]))
        }
        if (definitionMeta.defaultProgram && originalFunc && name !== originalFunc) {
            definitionMeta.defaultProgram = renameEffectCalls(definitionMeta.defaultProgram, originalFunc, name)
        }
        if (definitionMeta.defaultProgram) {
            definitionMeta.defaultProgram = useWorkspaceNamespace(definitionMeta.defaultProgram)
        }

        workspaceStore.setFile('definition.json', JSON.stringify(definitionMeta, null, 2))

        if (instance.shaders) {
            for (const [prog, shaderSet] of Object.entries(instance.shaders)) {
                // Use renamed program name if applicable
                const newProg = programRenameMap[prog] || prog
                if (shaderSet.glsl) {
                    workspaceStore.setFile(`glsl/${newProg}.glsl`, shaderSet.glsl)
                }
                if (shaderSet.wgsl) {
                    workspaceStore.setFile(`wgsl/${newProg}.wgsl`, shaderSet.wgsl)
                }
            }
        }

        if (instance.help) {
            workspaceStore.setFile('help.md', instance.help)
        }

        workspaceStore.checkpoint('Loaded effect: ' + effectId)
        addRecentEffect(effectId, name)

        // Register the effect under 'user' namespace so DSL can find it
        registerEffectFromWorkspace(renderer)

        currentEffect = instance
        paramControls.setEffect(instance)
        fileBrowser.render()

        let dsl = renderer.buildDslSource(effect)
        if (dsl) {
            // Replace original effect func name with the new name
            if (newName && originalFunc && newName !== originalFunc) {
                dsl = renameEffectCalls(dsl, originalFunc, newName)
            }
            dsl = useWorkspaceNamespace(dsl)
            // Save DSL to workspace
            workspaceStore.setFile('dsl.txt', dsl)
            dslEditor.value = dsl
            if (canvasEditor) {
                // Open definition.json when importing an effect
                const defContent = workspaceStore.getFile('definition.json')
                if (defContent) {
                    canvasEditor.value = defContent
                    canvasEditorCurrentFile = 'definition.json'
                } else {
                    canvasEditor.value = dsl
                    canvasEditorCurrentFile = 'dsl.txt'
                }
                updateMenuFilename()
            }
        }

        let compileResult = await compileAndRun()

        // Filters/mixers/render stages need an input, but buildDslSource emits
        // some of them first in the chain (e.g. `refract().write(o0)`) — illegal,
        // so the effect never loads and its controls never appear. On a failed
        // load, try wrapping the effect over a visible source. This only ever
        // fires when the initial load already failed, so effects that load are
        // untouched.
        if (compileResult && !compileResult.success) {
            const originalDsl = dslEditor.value
            const func = instance.func || name
            const ns = effect.namespace || 'filter'
            const surfaces = Object.entries(instance.globals || {})
                .filter(([, spec]) => spec && spec.type === 'surface')
                .map(([key]) => key)
            const candidates = [
                // single-input filters / feedback effects
                `search ${ns}, synth\n\nnoise()\n  .${func}()\n  .write(o0)\n\nrender(o0)`,
                // mixers that read named input surfaces (rTex/gTex/source/...)
                surfaces.length
                    ? `search ${ns}, synth\n\nnoise().write(o0)\n${func}(${surfaces.map(s => `${s}: o0`).join(', ')}).write(o1)\n\nrender(o1)`
                    : null,
                // points-render stages need a points emitter upstream
                `search ${ns}, points, synth\n\nnoise().pointsEmit().${func}().write(o0)\n\nrender(o0)`,
                // 3D render/filter stages need a 3D field source upstream
                `search ${ns}, synth3d, synth\n\nnoise3d().${func}().write(o0)\n\nrender(o0)`,
            ].filter(Boolean)
            for (const candidate of candidates) {
                dslEditor.value = candidate
                compileResult = await compileAndRun()
                if (compileResult && compileResult.success) break
                // Multi-pass effects (feedback, billboard render, ...) whose
                // workspace shaders are incomplete still compile against the
                // pristine library effect — retry the same DSL without the
                // workspace override.
                compileResult = await compileAndRun({})
                if (compileResult && compileResult.success) break
            }
            // No wrapper compiled: don't leave the editor showing an unrelated
            // fallback DSL — restore the effect's own source.
            if (compileResult && !compileResult.success) {
                dslEditor.value = originalDsl
            }
        }

        toast.success(`Loaded ${effectId}`)
        return true
    } catch (err) {
        handleError(err, ErrorType.UNKNOWN)
        toast.error(`Failed to load effect: ${err.message}`)
        return false
    }
}

// =========================================================================
// Canvas Overlay Management
// =========================================================================

function updateOverlayToggleStates() {
    toggleSavedOverlay?.classList.toggle('active', activeBottomLeftOverlay === 'saved')
    // The DSL toggle lives in the menu bar; it pulls canvasEditorVisible.
    refreshMenuBar()
}

function showBottomLeftOverlay(which) {
    paramsOverlay?.setAttribute('hidden', '')
    savedOverlay?.setAttribute('hidden', '')
    
    if (which === activeBottomLeftOverlay || which === null) {
        activeBottomLeftOverlay = null
    } else {
        activeBottomLeftOverlay = which
        if (which === 'params') {
            paramsOverlay?.removeAttribute('hidden')
        } else if (which === 'saved') {
            savedOverlay?.removeAttribute('hidden')
            savedEffects?.refresh()
        }
    }
    
    updateOverlayToggleStates()
}

// =========================================================================
// Canvas Code Editor (Hot Reload)
// =========================================================================

function showCompilerError(errorText) {
    if (!compilerErrorEl) return
    
    let displayError = errorText
    const glslMatch = errorText.match(/ERROR:\s*\d+:\d+:\s*(.+?)(?:\n|$)/i)
    if (glslMatch) {
        displayError = glslMatch[1].trim()
    } else {
        const firstLine = errorText.split('\n')[0]
        if (firstLine.length > 200) {
            displayError = firstLine.substring(0, 200) + '...'
        } else {
            displayError = firstLine
        }
    }
    
    compilerErrorEl.innerHTML = `<span>${escapeHtml(displayError)}</span>`
    compilerErrorEl.title = errorText
    compilerErrorEl.classList.add('visible')
}

function hideCompilerError() {
    if (!compilerErrorEl) return
    compilerErrorEl.classList.remove('visible')
}

// Note: syncEditorDisplay and syncEditorScroll are now handled internally by the CodeEditor component

function isEditableFile(filePath) {
    const editableExtensions = ['glsl', 'wgsl', 'json', 'js', 'md', 'txt']
    const ext = filePath.split('.').pop().toLowerCase()
    return editableExtensions.includes(ext)
}

function switchEditorFile(filePath) {
    if (!canvasEditor) return
    
    saveCurrentEditorContent()
    canvasEditorCurrentFile = filePath
    updateMenuFilename()
    saveUIState({ lastOpenedFile: filePath })
    
    if (filePath === 'dsl.txt') {
        canvasEditor.value = dslEditor?.value || ''
        // Switch to WebGL2 when editing DSL
        autoSwitchBackend('webgl2')
    } else {
        const content = workspaceStore.getFile(filePath)
        canvasEditor.value = content || ''
        // Auto-switch backend based on file extension
        const ext = filePath.split('.').pop().toLowerCase()
        if (ext === 'wgsl') {
            autoSwitchBackend('webgpu')
        } else if (ext === 'glsl') {
            autoSwitchBackend('webgl2')
        }
    }
    
    canvasEditor.focus()
}

function saveCurrentEditorContent() {
    if (!canvasEditor) return
    
    const content = canvasEditor.value
    
    // Always save to workspace store
    if (canvasEditorCurrentFile === 'dsl.txt') {
        if (dslEditor) {
            dslEditor.value = content
        }
        workspaceStore.setFile('dsl.txt', content)
    } else {
        workspaceStore.setFile(canvasEditorCurrentFile, content)
    }
}

async function recompileFromEditor() {
    if (!renderer || !canvasEditor) return { success: false, error: 'Not initialized' }
    
    const currentFile = canvasEditorCurrentFile
    const content = canvasEditor.value
    
    // Always save the file to workspace store
    if (currentFile === 'dsl.txt') {
        if (dslEditor) {
            dslEditor.value = content
        }
        workspaceStore.setFile('dsl.txt', content)
    } else {
        workspaceStore.setFile(currentFile, content)
    }
    
    if (!content.trim()) {
        return { success: false, error: 'Empty file' }
    }

    // Re-register the effect if definition.json or shaders changed
    if (currentFile !== 'dsl.txt') {
        registerEffectFromWorkspace(renderer)
    }

    try {
        const dsl = currentFile === 'dsl.txt'
            ? content
            : (dslEditor?.value || workspaceStore.getFile('dsl.txt') || '')
        
        if (!dsl.trim()) {
            return { success: true }
        }

        await preloadFontsForDsl(dsl)
        const result = await renderer.compile(dsl, { workspaceStore })
        lastCompileResult = result
        
        if (currentFile === 'definition.json' && result.success) {
            try {
                const def = JSON.parse(content)
                if (def.globals) {
                    paramControls.setEffect({ globals: def.globals })
                }
            } catch (e) {
                return { success: false, error: `Invalid JSON: ${e.message}` }
            }
        }

        // Editing in the code editor compiles through here (not compileAndRun),
        // so record the undo checkpoint here too. Deduped, so a Cmd+Enter that
        // also triggers compileAndRun won't create a second entry.
        if (result.success) {
            maybeCheckpoint('Edit')
        }
        onlineCollaboration.publish({ uploadImages: sessionOrigin === 0 })

        return result
    } catch (err) {
        console.error('Recompile error:', err)
        return { success: false, error: err.message || String(err) }
    }
}

function toggleCanvasEditor() {
    if (!canvasEditor) return
    const isHidden = canvasEditor.style.display === 'none'
    
    if (!isHidden && canvasEditorCurrentFile !== 'dsl.txt') {
        switchEditorFile('dsl.txt')
        return
    }
    
    canvasEditor.style.display = isHidden ? '' : 'none'
    canvasEditorVisible = isHidden
    
    if (!isHidden) {
        hideCompilerError()
    }
    
    if (isHidden && canvasEditor) {
        canvasEditorCurrentFile = 'dsl.txt'
        canvasEditor.value = dslEditor?.value || ''
        canvasEditor.focus()
    }
    
    // Update menu filename (shows/hides based on editor visibility)
    updateMenuFilename()
    updateOverlayToggleStates()
}

function openCanvasEditorWithFile(filePath) {
    if (!canvasEditor) return
    
    if (canvasEditor.style.display === 'none') {
        canvasEditor.style.display = ''
        canvasEditorVisible = true
        updateOverlayToggleStates()
    }
    
    switchEditorFile(filePath)
}

function setupCanvasEditorHotReload() {
    if (!canvasEditor) return
    
    // Hot reload: recompile 500ms after user stops typing
    // The CodeEditor component handles scroll sync internally
    canvasEditor.addEventListener('input', () => {
        if (hotReloadTimeout) {
            clearTimeout(hotReloadTimeout)
        }
        
        hotReloadTimeout = setTimeout(async () => {
            hotReloadTimeout = null
            setAgentStatus('Compiling...')
            const result = await recompileFromEditor()
            if (!result.success) {
                console.warn('Hot reload compile failed:', result.error)
                showCompilerError(result.error)
                setAgentStatus('Error')
            } else {
                hideCompilerError()
                setAgentStatus('Ready')
            }
        }, 500)
    })
    
    // Listen for forcerecompile event from the CodeEditor (Ctrl/Cmd+Enter).
    // The editor is provided by an external bundle (handfish; the local
    // public/js/ui/code-editor.js is a guarded-out fallback), so this event is
    // our only hook into its Cmd+Enter. Flag it synchronously here so the global
    // Cmd+Enter shortcut (which fires later in the same keydown bubble) skips its
    // duplicate compile. If this event ever stops firing, the flag stays false
    // and the global shortcut falls through to compile — fail-safe, never a
    // silent no-op. Reset on the next microtask (after this keydown dispatch).
    canvasEditor.addEventListener('forcerecompile', async () => {
        editorHandledForceRecompile = true
        queueMicrotask(() => { editorHandledForceRecompile = false })
        if (hotReloadTimeout) {
            clearTimeout(hotReloadTimeout)
            hotReloadTimeout = null
        }
        setAgentStatus('Compiling...')
        const result = await recompileFromEditor()
        if (!result.success) {
            console.warn('Manual compile failed:', result.error)
            showCompilerError(result.error)
            setAgentStatus('Error')
        } else {
            hideCompilerError()
            setAgentStatus('Ready')
        }
    })
}

function initCanvasEditorControls() {
    if (compilerErrorEl) {
        compilerErrorEl.addEventListener('click', async () => {
            const errorText = compilerErrorEl.textContent
            try {
                await navigator.clipboard.writeText(errorText)
                console.log('Error copied to clipboard')
            } catch (err) {
                console.error('Failed to copy error:', err)
            }
        })
    }
    
    setupCanvasEditorHotReload()
}

function setOriginalDsl(dsl) {
    originalDsl = dsl
    if (canvasEditor && canvasEditorCurrentFile === 'dsl.txt') {
        canvasEditor.value = dslEditor.value
    }
}

function setAgentStatus(status) {
    if (!agentStatus) return
    const statusText = agentStatus.querySelector('.status-text')
    if (statusText) {
        statusText.textContent = status
    }
}

// Overlay close button handlers
document.querySelectorAll('.canvas-overlay .overlay-close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const overlay = btn.closest('.canvas-overlay')
        if (overlay?.id === 'canvas-editor') {
            toggleCanvasEditor()
        } else {
            showBottomLeftOverlay(null)
        }
    })
})

// The params overlay has no overlay-header; <effect-controls> closes itself.
paramsOverlay?.addEventListener('panelclose', () => showBottomLeftOverlay(null))

// Toggle button handlers
toggleSavedOverlay?.addEventListener('click', () => showBottomLeftOverlay('saved'))
// Doc reader close button (the open/toggle control lives in the menu bar)
const docReaderClose = document.querySelector('.doc-reader-close')

docReaderClose?.addEventListener('click', () => {
    hideDocReader()
    refreshMenuBar()
    canvasEditor?.classList.remove('doc-open')
})

// Save effect button in overlay
saveEffectOverlayBtn?.addEventListener('click', async () => {
    const name = await nameDialog.show({
        title: 'Save Effect',
        label: 'Effect Name',
        value: workspaceStore.name || '',
        placeholder: 'Enter effect name...',
        confirmText: 'Save'
    })
    if (name) {
        await savedEffects?.save(name)
        await refreshEffectDialog() // Update dialog with new saved effect
        toast.success(`Saved: ${name}`)
    }
})

// =========================================================================
// Initialization
// =========================================================================

async function init() {
    try {
        updateLoadingStatus('Loading fonts')
        
        if (document.fonts && document.fonts.ready) {
            await document.fonts.ready
            try {
                await document.fonts.load('500 48px Nunito')
            } catch (e) {
                console.warn('[Fonts] Could not preload Nunito:', e)
            }
        }
        
        updateLoadingStatus('Loading preferences')
        
        const prefs = getPreferences()
        if (prefs.duration && durationInput) {
            durationInput.value = prefs.duration
        }
        
        initCanvasEditorControls()
        
        // Initialize doc reader - show by default
        initDocReader()
        showPlaceholderContent()
        showDocReader()
        refreshMenuBar()
        canvasEditor?.classList.add('doc-open')
        
        updateLoadingStatus('Initializing renderer')
        
        await renderer.init()
        
        paramControls.setProgramState(renderer.programState, () => renderer.enums)
        // Recompile when a compile-time `define` param changes (engine signals this).
        renderer.programState?.on?.('recompileNeeded', scheduleDefineRecompile)
        
        
        // Populate effect list for dialog (will be updated with user effects later)
        allEffects = renderer.getEffectIds().map(id => {
            const [namespace, name] = id.split('/')
            return { id, namespace, name }
        })
        // Don't set effects yet - wait until we have user effects too

        updateLoadingStatus('Restoring workspace')
        
        const restored = await loadWorkspace(workspaceStore)
        if (restored) {
            console.log('Restored workspace from IndexedDB')
            registerEffectFromWorkspace(renderer)
            fileBrowser.render()
            updateMenuFilename()
            
            let dsl = workspaceStore.getFile('dsl.txt')
            
            if (!dsl) {
                // No dsl.txt - generate from definition.json
                const defJson = workspaceStore.getFile('definition.json')
                if (defJson) {
                    try {
                        const def = JSON.parse(defJson)
                        const effectName = def.func || def.name
                        const namespace = def.namespace || 'synth'
                        if (effectName) {
                            // Build effect object from workspace definition
                            const effect = {
                                namespace: namespace,
                                name: effectName,
                                instance: def
                            }
                            dsl = renderer.buildDslSource(effect)
                        }
                    } catch (e) {
                        console.error('[App] Failed to parse definition.json:', e)
                    }
                }
                
                // If still no DSL, use default
                if (!dsl) {
                    dsl = getDefaultDsl()
                }
                workspaceStore.setFile('dsl.txt', dsl)
            }
            
            if (dsl) {
                dslEditor.value = dsl
                if (canvasEditor) {
                    canvasEditor.value = dsl
                    canvasEditorCurrentFile = 'dsl.txt'
                    updateMenuFilename()
                }
                // Compilation is deferred to the single compileAndRun() at the
                // end of init(); compiling here too double-compiled the same
                // program on every restored startup.
            }
            
            const defJson = workspaceStore.getFile('definition.json')
            if (defJson) {
                try {
                    const def = JSON.parse(defJson)
                    if (def.globals) {
                        paramControls.setEffect({ globals: def.globals })
                    }
                } catch (e) {
                    console.error('[App] Failed to parse definition.json:', e.message)
                }
            }
        }

        // Check for shared composition code in URL
        const shareCode = getCodeFromUrl()
        if (shareCode) {
            updateLoadingStatus('Loading shared composition')
            try {
                const composition = await loadFromCode(shareCode)
                renderer.images = composition.images || []
                console.log('[Workspace] Loaded shared composition:', composition.title || shareCode)
                
                // Populate workspace with effect files from rawEffects
                if (composition.rawEffects && composition.rawEffects.length > 0) {
                    const effectData = composition.rawEffects[0]
                    console.log('[Workspace] Populating workspace from shared effect:', effectData.name)
                    
                    // Clear existing workspace
                    workspaceStore.clear()
                    workspaceStore.name = effectData.name || 'Shared Effect'
                    
                    writePortableEffectToWorkspace(effectData)

                    // Update file browser UI
                    fileBrowser.render()
                    
                    console.log('[Workspace] Workspace populated with files:', 
                        Array.from(workspaceStore.files.keys()))
                }
                
                // Set DSL from composition
                const dsl = composition.dsl || getDefaultDsl()
                dslEditor.value = dsl
                if (canvasEditor) {
                    canvasEditor.value = dsl
                    canvasEditorCurrentFile = 'dsl.txt'
                }
                workspaceStore.setFile('dsl.txt', dsl)
                workspaceStore.images = renderer.images
                workspaceStore.checkpoint('Loaded from share')
                
                // Clear the URL parameter to prevent reload loop
                const url = new URL(window.location.href)
                url.searchParams.delete('code')
                window.history.replaceState({}, '', url.toString())
                
                // Compilation is deferred to the single compileAndRun() at the
                // end of init() (avoids double-compiling on shared-link load).

                // Show notification
                setTimeout(() => {
                    toast.info(`Loaded: ${composition.title || 'Shared effect'}`)
                }, 600)
            } catch (err) {
                console.error('[Workspace] Failed to load shared composition:', err)
                toast.error(`Failed to load shared effect: ${err.message}`)
            }
        }

        const uiState = loadUIState()
        if (uiState.dsl && !restored) {
            dslEditor.value = uiState.dsl
        }
        
        if (!dslEditor.value || !dslEditor.value.trim()) {
            dslEditor.value = getDefaultDsl()
        }
        
        // Sync to canvas editor
        if (canvasEditor) {
            // Restore last opened file
            const lastFile = uiState.lastOpenedFile || 'dsl.txt'
            const lastFileContent = lastFile === 'dsl.txt' ? dslEditor.value : workspaceStore.getFile(lastFile)
            if (lastFileContent) {
                canvasEditor.value = lastFileContent
                canvasEditorCurrentFile = lastFile
            } else {
                canvasEditor.value = dslEditor.value
                canvasEditorCurrentFile = 'dsl.txt'
            }
            updateMenuFilename()
        }

        updateLoadingStatus('Compiling shaders')

        // Size the canvas to its container BEFORE the first compile so we render
        // at the correct resolution from the start, not just after the first
        // window resize. Mirrors the resize handler below.
        const startupSize = resizeCanvas()
        renderer.resize(startupSize.width, startupSize.height)

        await compileAndRun()
        renderer.start()

        // Resize the canvas live on every event (cheap), but debounce the
        // expensive recompile so dragging a window edge doesn't trigger a
        // recompile storm (~60/s) of overlapping compileAndRun() calls.
        const debouncedResizeCompile = debounce(() => {
            compileAndRun().catch(() => { /* surfaced via compile status */ })
        }, 150)
        window.addEventListener('resize', () => {
            const { width, height } = resizeCanvas()
            renderer.resize(width, height)
            debouncedResizeCompile()
        })

        // Apply undo/redo restores to the editor + renderer, and keep the
        // undo/redo button states in sync with the history.
        workspaceStore.onChange((detail) => {
            if (detail.type === 'restore') {
                lastRestore = applyRestoredState(detail)
            }
            updateUndoRedoButtons()
        })

        // Autosave is debounced so a burst of changes (undo checkpoints, slider
        // drags, rapid edits) collapses to a single IndexedDB write. An
        // `unsavedChanges` flag avoids redundant writes (a flush after the
        // debounce already saved, or a tab-switch with nothing to save).
        let unsavedChanges = false
        let saveInFlight = false
        let saveFailing = false      // a save failed and none has succeeded since
        let retriedAfterFailure = false
        const saveWorkspaceNow = () => {
            // Never overlap saves. Two in flight can settle out of order, and a
            // stale rejection would re-flag work that the later write persisted.
            if (!unsavedChanges || saveInFlight) return
            unsavedChanges = false
            saveInFlight = true
            saveWorkspace(workspaceStore)
                .then(() => {
                    saveFailing = false
                    retriedAfterFailure = false
                })
                .catch(err => {
                    // Leave the change pending: clearing the flag up front and
                    // then failing drops the edit permanently.
                    unsavedChanges = true
                    if (!saveFailing) {
                        // Once per failure streak — not once per tab switch,
                        // which is every switch when storage is unavailable.
                        saveFailing = true
                        handleError(err, ErrorType.STORAGE)
                    }
                })
                .finally(() => {
                    saveInFlight = false
                    if (!unsavedChanges) return
                    if (!saveFailing) {
                        debouncedSave()          // changes made during the write
                    } else if (!retriedAfterFailure) {
                        // One automatic retry. Bounded, so a permanently
                        // unavailable IndexedDB can't spin on the timer.
                        retriedAfterFailure = true
                        debouncedSave()
                    }
                })
        }
        const debouncedSave = debounce(saveWorkspaceNow, 400)
        workspaceStore.onChange(() => {
            unsavedChanges = true
            debouncedSave()
        })

        // The DSL editor persists to localStorage on its own, slower timer.
        // Track it as pending so the flush below covers it too — otherwise
        // closing the tab mid-edit loses the last thing typed, while the
        // workspace beside it is saved.
        //
        // Pending is a flag, not a snapshot: dslEditor.value is also assigned
        // programmatically (undo, opening an effect) without an input event, so
        // a value captured at keystroke time would go stale and overwrite the
        // newer content. Read the editor at save time.
        let uiStateDirty = false
        let uiStateTimeout = null
        const saveUIStateNow = () => {
            if (!uiStateDirty || !dslEditor) return
            clearTimeout(uiStateTimeout)
            uiStateTimeout = null
            uiStateDirty = false
            // saveUIState reports a refused write (quota, storage off) by
            // returning false rather than throwing. Keep it pending so the next
            // flush retries, instead of dropping the edit the way the workspace
            // path used to.
            if (saveUIState({ dsl: dslEditor.value }) === false) {
                uiStateDirty = true
            }
        }

        // Durability: flush every pending save immediately when the tab is
        // hidden or unloaded, since the timers may not fire if the page is
        // frozen. Failures are surfaced, not swallowed — a silently dropped
        // final write is exactly how work goes missing.
        const flushSave = () => {
            try {
                saveUIStateNow()
            } finally {
                // The workspace flush must run even if the editor-state write
                // throws; it holds the larger body of work.
                saveWorkspaceNow()
            }
        }
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushSave()
        })
        window.addEventListener('pagehide', flushSave)

        dslEditor?.addEventListener('input', () => {
            uiStateDirty = true
            clearTimeout(uiStateTimeout)
            uiStateTimeout = setTimeout(saveUIStateNow, 1000)
            if (canvasEditorVisible && canvasEditor && canvasEditorCurrentFile === 'dsl.txt') {
                canvasEditor.value = dslEditor.value
            }
        })

        registerKeyboardShortcuts()
        setupAboutModal()
        refreshMenuBar()

        if (savedEffects) {
            await savedEffects.refresh()
        }

        // Populate dialog with library + user effects
        await refreshEffectDialog()

        updateMenuFilename()
        hideLoadingScreen()
        
        setTimeout(() => {
            toast.success('Foundry ready')
        }, 500)
    } catch (err) {
        handleError(err, ErrorType.UNKNOWN)
        showCompileStatus(`Initialization failed: ${err.message}`, 'error')
        hideLoadingScreen()
    }
}

// =========================================================================
// Keyboard Shortcuts
// =========================================================================

function registerKeyboardShortcuts() {
    keyboard.registerAll([
        {
            key: 'o',
            meta: true,
            description: 'Open effect',
            action: () => openEffectDialog.open()
        },
        {
            key: 'Enter',
            meta: true,
            description: 'Compile and run DSL',
            action: () => {
                // If the editor already handled this Cmd+Enter (it dispatched
                // 'forcerecompile' -> recompileFromEditor earlier in this same
                // keydown), skip so one keypress doesn't fire two compiles.
                // Otherwise compile here — so the primary "run" gesture always
                // works even if the editor isn't focused or doesn't self-handle.
                if (editorHandledForceRecompile) return
                compileAndRun().catch(() => { /* surfaced via compile status */ })
            }
        },
        {
            key: 's',
            meta: true,
            description: 'Save (auto-saved)',
            action: () => toast.info('Workspace is auto-saved')
        },
        {
            key: 'z',
            meta: true,
            skipInInput: true,
            description: 'Undo',
            action: handleUndo
        },
        {
            key: 'z',
            meta: true,
            shift: true,
            skipInInput: true,
            description: 'Redo',
            action: handleRedo
        },
        {
            key: 'e',
            meta: true,
            description: 'Export effect to ZIP',
            action: handleExport
        },
        {
            key: 'F1',
            description: 'Show help',
            action: () => helpModal.toggle()
        },
        {
            key: ' ',
            meta: false,
            shift: false,
            description: 'Play/Pause',
            action: togglePlayPause
        },
        {
            key: 'Escape',
            description: 'Blur current input / close overlays',
            action: () => {
                showBottomLeftOverlay(null)
                document.activeElement?.blur()
            }
        },
        {
            key: 'p',
            meta: true,
            description: 'Open workspace files',
            action: () => workspaceFilesDialog.open()
        }
    ])
}

function setupAboutModal() {
    const appTitle = document.getElementById('app-title')
    if (appTitle) {
        appTitle.addEventListener('click', () => aboutModal.open())
        appTitle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                aboutModal.open()
            }
        })
    }
}

// =========================================================================
// Menu Bar
// =========================================================================

const menuBarEl = document.getElementById('menu')

function refreshMenuBar() {
    menuBarEl?.refresh?.()
    // Native browser tooltips, exactly as the original buttons had: mirror the
    // component's data-title onto title (Foundry loads no tooltip layer).
    if (menuBarEl) {
        for (const el of menuBarEl.querySelectorAll('[data-title]')) {
            if (el.title !== el.dataset.title) el.title = el.dataset.title
        }
    }
}

// Whether "connect agent..." can help in the current session; set once online
// collaboration exists (see the Online Session section below).
let canConnectAgent = () => true
// Whether this tab is in a session, so "go online..." offers going offline.
let isOnline = () => false

// Config for the shared handfish <menu-bar>. Handlers are the same closures
// the old per-id listeners ran; dynamic fields are pulled on menu open,
// after every activation, and on refreshMenuBar().
if (menuBarEl) {
    menuBarEl.config = {
        ariaLabel: 'Foundry menu',
        regions: {
            left: [
                {
                    type: 'menu',
                    id: 'logoMenu',
                    trigger: {
                        html: '<svg id="logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" fill="currentColor"><g transform="translate(0,600) scale(0.1,-0.1)"><path d="M883 4443 l677 -678 672 -2 671 -1 -679 679 -679 679 -670 0 -670 0 678 -677z"/><path d="M2308 4449 c370 -368 681 -673 692 -677 10 -4 315 -6 677 -4 l658 3 -680 674 -680 674 -670 0 -670 0 673 -670z"/><path d="M3753 4440 l682 -680 650 1 c358 0 656 3 663 8 8 5 -208 227 -662 679 l-675 672 -670 0 -669 0 681 -680z"/><path d="M1660 3673 c0 -4 305 -310 678 -680 l677 -672 670 0 670 -1 -681 680 -681 680 -667 0 c-366 0 -666 -3 -666 -7z"/><path d="M3765 3000 l680 -680 670 0 670 0 -680 680 -680 680 -670 0 -670 0 680 -680z"/><path d="M3780 1555 l675 -675 671 0 672 0 -676 675 -677 675 -670 0 -670 0 675 -675z"/></g></svg>',
                        ariaLabel: 'Foundry menu',
                    },
                    items: [
                        { id: 'aboutMenuItem', label: 'about Foundry', onSelect: () => aboutModal.open() },
                    ],
                },
                {
                    type: 'menu',
                    id: 'fileMenu',
                    trigger: { label: 'file' },
                    items: [
                        {
                            id: 'newEffectMenuItem',
                            label: 'new effect...',
                            onSelect: async () => {
                                const name = await nameDialog.show({
                                    title: 'New Effect',
                                    label: 'Effect Name',
                                    value: '',
                                    placeholder: 'Enter effect name...',
                                    confirmText: 'Create'
                                })
                                if (name) {
                                    // Import synth.solid as the starting point under user namespace
                                    await loadEffectToWorkspace('synth/solid', name)
                                    await compileAndRun()
                                    toast.success(`Created: ${name}`)
                                }
                            },
                        },
                        {
                            id: 'newFileMenuItem',
                            label: 'new file...',
                            onSelect: async () => {
                                const filename = await nameDialog.show({
                                    title: 'New File',
                                    label: 'Filename',
                                    value: '',
                                    placeholder: 'e.g., glsl/helper.glsl',
                                    confirmText: 'Create'
                                })
                                if (filename) {
                                    // Create the file with empty content
                                    workspaceStore.setFile(filename, '')
                                    fileBrowser.render()
                                    // Open the new file in editor
                                    if (!canvasEditorVisible) {
                                        toggleCanvasEditor()
                                    }
                                    switchEditorFile(filename)
                                    toast.success(`Created: ${filename}`)
                                }
                            },
                        },
                        { type: 'separator' },
                        { id: 'workspaceFilesMenuItem', label: 'workspace files', onSelect: () => workspaceFilesDialog.open() },
                        {
                            id: 'saveEffectMenuItem',
                            label: 'save effect workspace...',
                            onSelect: async () => {
                                const name = await nameDialog.show({
                                    title: 'Save Effect',
                                    label: 'Effect Name',
                                    value: workspaceStore.name || '',
                                    placeholder: 'Enter effect name...',
                                    confirmText: 'Save'
                                })
                                if (name) {
                                    await savedEffects?.save(name)
                                    await refreshEffectDialog()
                                    toast.success(`Saved: ${name}`)
                                }
                            },
                        },
                        {
                            id: 'deleteEffectMenuItem',
                            label: 'delete effect workspace...',
                            onSelect: () => {
                                deleteEffectDialog.onEffectDelete(async () => {
                                    await refreshEffectDialog()
                                    toast.success('Effect deleted')
                                })
                                deleteEffectDialog.open()
                            },
                        },
                        { id: 'downloadWorkspaceMenuItem', label: 'export effect to zip', onSelect: () => handleExport() },
                        { type: 'separator' },
                        { id: 'importFromLibraryMenuItem', label: 'import effect from library...', onSelect: () => openEffectDialog.open() },
                        { id: 'importFromZipMenuItem', label: 'import effect from zip...', onSelect: () => importEffectDialog.open() },
                    ],
                },
                {
                    type: 'menu',
                    id: 'effectMenu',
                    trigger: { label: 'effect' },
                    items: [
                        { id: 'showParametersMenuItem', label: 'show parameters', onSelect: () => showBottomLeftOverlay('params') },
                        { id: 'showDslMenuItem', label: 'show dsl code', onSelect: () => toggleCanvasEditor() },
                        { type: 'separator' },
                        { id: 'editInNoisedeckMenuItem', label: 'edit in Noisedeck...', onSelect: () => shareAndOpen(SHARE_TARGETS.noisedeck) },
                        { id: 'editInNoodlesMenuItem', label: 'edit in Noodles...', onSelect: () => shareAndOpen(SHARE_TARGETS.noodles) },
                        { id: 'editInPolymorphicMenuItem', label: 'edit in Polymorphic...', onSelect: () => shareAndOpen(SHARE_TARGETS.polymorphic) },
                        { id: 'editInShadeMenuItem', label: 'edit in Shade...', onSelect: () => shareAndOpen(SHARE_TARGETS.shade) },
                        { type: 'separator' },
                        {
                            id: 'importFromUrlMenuItem',
                            label: 'import from url...',
                            onSelect: () => {
                                importFromUrlDialog.open({
                                    onLoad: (composition) => handleLoadFromUrl(composition).catch(err => handleError(err, ErrorType.UNKNOWN))
                                })
                            },
                        },
                        {
                            id: 'sharePubliclyMenuItem',
                            label: 'share publicly...',
                            onSelect: () => {
                                const dsl = canvasEditor?.value || dslEditor.value || ''
                                shareModal.open({
                                    dsl,
                                    canvas,
                                    renderer
                                })
                            },
                        },
                        // Online, it offers the way back: it opens the session, where Go Offline is.
                        { id: 'goOnlineMenuItem', label: () => isOnline() ? 'go offline...' : 'go online...', onSelect: () => seanceDialog?.show?.() },
                        { id: 'connectAgentMenuItem', label: 'connect agent...', hidden: () => !customElements.get('agent-connect-dialog') || !canConnectAgent(), onSelect: () => onlineCollaboration.showAgentDialog() },
                    ],
                },
            ],
            center: [
                {
                    type: 'label',
                    id: 'menuFilename',
                    text: () => canvasEditorVisible ? (canvasEditorCurrentFile || 'dsl.txt') : '',
                    interactive: () => canvasEditorVisible,
                    onSelect: () => workspaceFilesDialog.open(),
                },
            ],
            right: [
                { type: 'button', id: 'undo-btn', icon: 'undo', tooltip: 'Undo (Cmd+Z)', ariaLabel: 'Undo', disabled: () => !workspaceStore.canUndo(), onSelect: () => handleUndo() },
                { type: 'button', id: 'redo-btn', icon: 'redo', tooltip: 'Redo (Cmd+Shift+Z)', ariaLabel: 'Redo', disabled: () => !workspaceStore.canRedo(), onSelect: () => handleRedo() },
                {
                    type: 'button',
                    id: 'doc-toggle-btn',
                    icon: 'info',
                    tooltip: 'Documentation',
                    ariaLabel: 'Toggle documentation',
                    active: () => isDocReaderVisible(),
                    onSelect: () => {
                        const isVisible = toggleDocReader()
                        canvasEditor?.classList.toggle('doc-open', isVisible)
                    },
                },
                { type: 'button', id: 'toggle-dsl-overlay', icon: 'code', tooltip: 'Show DSL', ariaLabel: 'Toggle DSL code', active: () => canvasEditorVisible, onSelect: () => toggleCanvasEditor() },
                { type: 'button', id: 'play-pause-btn', icon: () => isPaused ? 'play_arrow' : 'pause', tooltip: () => playPauseTouched ? (isPaused ? 'Play' : 'Pause') : 'Play/Pause (Space)', ariaLabel: 'Play/Pause', onSelect: () => togglePlayPause() },
            ],
        },
    }
}

// =========================================================================
// Compilation
// =========================================================================

async function compileAndRun(compileOpts) {
    const dsl = dslEditor.value.trim()
    if (!dsl) {
        showCompileStatus('No DSL program to compile', 'error')
        return { success: false, error: 'No DSL program to compile' }
    }

    showCompileStatus('Compiling shader...', '')
    setAgentStatus('Compiling...')

    await preloadFontsForDsl(dsl)
    // Callers may pass {} to compile the pristine library effect instead of the
    // workspace copy — used as a load fallback for multi-pass effects whose
    // workspace shaders are incomplete.
    const result = await renderer.compile(dsl, compileOpts || { workspaceStore })
    lastCompileResult = result

    if (result.success) {
        showCompileStatus('Shader compiled', 'success')
        setOriginalDsl(dsl)
        setAgentStatus('Ready')
        // Record an undo checkpoint for the committed program (deduped + guarded
        // against firing during an undo/redo restore).
        maybeCheckpoint('Compile')
    } else {
        showCompileStatus(`${result.error}`, 'error')
        setAgentStatus('Error')
    }
    onlineCollaboration.publish({ uploadImages: sessionOrigin === 0 })
    return result
}

function showCompileStatus(message, type) {
    compileStatus.textContent = message
    compileStatus.className = 'compile-status'
    if (type) {
        compileStatus.classList.add(type)
    }
}

// =========================================================================
// Playback Controls
// =========================================================================

function togglePlayPause() {
    playPauseTouched = true
    if (isPaused) {
        performancePauseGraceEnd = Date.now() + 5000
        renderer.start()
    } else {
        renderer.stop()
    }
    isPaused = !isPaused
    refreshMenuBar()
}

function updateDuration() {
    const duration = durationInput ? parseInt(durationInput.value) || 10 : 10
    renderer.setLoopDuration(duration)
    setPreference('duration', duration)
}

// =========================================================================
// Backend Switching
// =========================================================================

async function autoSwitchBackend(backend) {
    const currentBackend = renderer.backend
    if (currentBackend === backend) {
        return
    }
    
    // Check WebGPU availability before switching
    if (backend === 'webgpu' && !navigator.gpu) {
        console.warn('[Backend] WebGPU not available, staying on WebGL2')
        return
    }
    
    try {
        await renderer.switchBackend(backend, { workspaceStore })
        
        if (!renderer.isRunning) {
            renderer.start()
        }
        
        window.dispatchEvent(new CustomEvent('backend-changed', { detail: { backend } }))
    } catch (err) {
        console.error(`[Backend] Failed to switch to ${backend}:`, err.message)
    }
}

// =========================================================================
// Undo / Redo
// =========================================================================

// Depth counter: > 0 while ANY undo/redo restore is in flight, so the recompile
// each one triggers doesn't record a brand-new checkpoint (which would corrupt
// the history). A counter (not a boolean) is required because restores are async
// and fire-and-forget — two in the same tick (e.g. undo+redo) must both keep the
// guard raised until the LAST one finishes.
let restoringHistory = 0
// The undo/redo restore in flight, so an agent's undo can wait for it.
let lastRestore = Promise.resolve()

/** Current effective program (params baked in via toDsl), falling back to the editor. */
function currentProgramDsl() {
    try {
        const live = renderer.programState?.toDsl?.()
        if (live && live.trim()) return live
    } catch (_) { /* toDsl unavailable */ }
    return dslEditor.value || ''
}

/**
 * Record an undo checkpoint of the current program, unless we're mid-restore or
 * the program is unchanged. If the current entry was created without a DSL (e.g.
 * a load checkpoint made before the first compile), fill it in rather than
 * pushing a duplicate.
 */
function maybeCheckpoint(label) {
    if (restoringHistory > 0) return
    const dsl = currentProgramDsl()
    if (!dsl.trim()) return
    const current = workspaceStore.getCurrentEntry()
    if (current && current.dsl === dsl) return
    if (current && !current.dsl) {
        current.dsl = dsl
    } else {
        workspaceStore.checkpoint(label, { dsl })
    }
    updateUndoRedoButtons()
}

const debouncedParamCheckpoint = debounce(() => maybeCheckpoint('Adjust parameters'), 600)

/** Apply a history entry restored by undo/redo to the editor + renderer. */
async function applyRestoredState(detail) {
    restoringHistory++
    try {
        const dsl = (detail && detail.dsl && detail.dsl.trim())
            ? detail.dsl
            : (workspaceStore.getFile('dsl.txt') || '')
        if (dsl) {
            dslEditor.value = dsl
            workspaceStore.setFile('dsl.txt', dsl)
            if (canvasEditor && canvasEditorCurrentFile === 'dsl.txt') {
                canvasEditor.value = dsl
            }
            await compileAndRun()
        }
        fileBrowser.render()
    } catch (err) {
        console.error('[App] Failed to apply restored state:', err)
    } finally {
        restoringHistory--
        updateUndoRedoButtons()
    }
}

function updateUndoRedoButtons() {
    // The menu bar's undo/redo buttons pull workspaceStore.canUndo()/canRedo().
    refreshMenuBar()
}

function handleUndo() {
    if (workspaceStore.canUndo()) {
        workspaceStore.undo() // dispatches 'restore' → applyRestoredState
        toast.success('Undid change')
    } else {
        toast.info('Nothing to undo')
    }
}

function handleRedo() {
    if (workspaceStore.canRedo()) {
        workspaceStore.redo() // dispatches 'restore' → applyRestoredState
        toast.success('Redid change')
    } else {
        toast.info('Nothing to redo')
    }
}

async function handleExport() {
    try {
        // Load JSZip dynamically if needed
        await loadJSZip()
        
        const files = workspaceStore.toObject()
        const dsl = dslEditor.value

        const zip = new window.JSZip()

        // dsl.txt is never copied into the ZIP below, so effect.dsl is the only
        // place the program travels in. Gating it on images meant a DSL-only
        // workspace (edited straight in the editor, no imported definition or
        // images) exported an archive with no program in it at all.
        if (dsl.trim()) zip.file('effect.dsl', dsl)

        // Add all workspace files, injecting defaultProgram into definition.json
        for (const [path, content] of Object.entries(files)) {
            if (path === 'dsl.txt') continue
            if (path === 'definition.json' && dsl) {
                try {
                    const def = JSON.parse(content)
                    def.defaultProgram = dsl
                    zip.file(path, JSON.stringify(def, null, 2))
                    continue
                } catch (e) { /* fall through to add as-is */ }
            }
            zip.file(path, content)
        }
        // Each image goes in as a binary file, images/<id>.<ext>.
        for (const image of workspaceStore.images) {
            if (image.blob instanceof Blob) zip.file(imageFilePath(image), image.blob)
        }
        
        const blob = await zip.generateAsync({ type: 'blob' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${workspaceStore.name || 'effect-workspace'}.zip`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        
        toast.success('Exported workspace')
    } catch (error) {
        toast.error(`Export failed: ${error.message}`)
    }
}

// Edit in other apps
const SHARE_API_URL = 'https://sharing.noisedeck.app/api/embed/shorten'

/** The editor apps a composition can be opened in, one entry per "edit in ..." menu item. */
const SHARE_TARGETS = {
    noisedeck: { label: 'Noisedeck', url: 'https://noisedeck.app', defaultTitle: 'Foundry' },
    noodles: { label: 'Noodles', url: 'https://noodles.noisedeck.app', defaultTitle: 'Foundry' },
    polymorphic: { label: 'Polymorphic', url: 'https://polymorphic.noisedeck.app', defaultTitle: 'Foundry Effect' },
    shade: { label: 'Shade', url: 'https://shade.noisedeck.app', defaultTitle: 'Foundry' },
}

/**
 * Load JSZip from its CDN if the page hasn't already.
 * @returns {Promise<void>}
 */
async function loadJSZip() {
    if (window.JSZip) return
    await new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
        script.onload = resolve
        script.onerror = () => reject(new Error('Failed to load JSZip'))
        document.head.appendChild(script)
    })
}

/**
 * Capture the canvas as a 1200x630 share screenshot, center-cropped to the
 * target aspect.
 * @returns {HTMLCanvasElement|null} The screenshot canvas, or null on failure
 */
function captureShareScreenshot() {
    try {
        const targetWidth = 1200
        const targetHeight = 630
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = targetWidth
        tempCanvas.height = targetHeight
        const ctx = tempCanvas.getContext('2d')
        const sourceAspect = canvas.width / canvas.height
        const targetAspect = targetWidth / targetHeight
        let sx, sy, sw, sh
        if (sourceAspect > targetAspect) {
            sh = canvas.height
            sw = canvas.height * targetAspect
            sx = (canvas.width - sw) / 2
            sy = 0
        } else {
            sw = canvas.width
            sh = canvas.width / targetAspect
            sx = 0
            sy = (canvas.height - sh) / 2
        }
        ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight)
        return tempCanvas
    } catch (err) {
        console.warn('[Share] Screenshot capture failed:', err)
        return null
    }
}

/**
 * Bundle the workspace's definition.json, shaders and help.md as the base64
 * effect ZIP the sharing service accepts, or null when there is nothing to
 * bundle (no definition or shaders) or bundling fails.
 * @param {string} label - Target label for console messages
 * @returns {Promise<string|null>} Base64 ZIP payload
 */
async function buildShareEffectZip(label) {
    const files = workspaceStore.toObject()
    const defJson = files['definition.json']
    const glslFiles = Object.keys(files).filter(p => p.startsWith('glsl/') && p.endsWith('.glsl'))
    const wgslFiles = Object.keys(files).filter(p => p.startsWith('wgsl/') && p.endsWith('.wgsl'))

    if (!defJson || (glslFiles.length === 0 && wgslFiles.length === 0)) {
        return null
    }

    try {
        await loadJSZip()

        const zip = new window.JSZip()
        zip.file('definition.json', defJson)

        // Add all GLSL shaders
        for (const path of glslFiles) {
            zip.file(path, files[path])
        }

        // Add all WGSL shaders
        for (const path of wgslFiles) {
            zip.file(path, files[path])
        }

        // Add help.md if present
        if (files['help.md']) {
            zip.file('help.md', files['help.md'])
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' })
        const reader = new FileReader()
        const effectZip = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result.split(',')[1])
            reader.onerror = reject
            reader.readAsDataURL(zipBlob)
        })

        console.log(`[${label}] Created effect ZIP with files:`,
            ['definition.json', ...glslFiles, ...wgslFiles, files['help.md'] ? 'help.md' : null].filter(Boolean))
        return effectZip
    } catch (err) {
        console.warn(`[${label}] Effect ZIP creation failed:`, err)
        return null
    }
}

/**
 * Share the current effect to the sharing service and open one of the editor
 * apps with the short code. The single implementation behind every
 * "edit in ..." menu item; per-app behavior comes from SHARE_TARGETS.
 * @param {{label: string, url: string, defaultTitle: string}} target - Share target
 */
async function shareAndOpen({ label, url, defaultTitle }) {
    // Get DSL with current parameter values
    let dsl = dslEditor.value
    if (!dsl) {
        toast.warning('Nothing to edit. Create an effect first!')
        return
    }

    // Try to get DSL with current param values from programState
    if (renderer?.programState?.toDsl) {
        try {
            const dslWithParams = renderer.programState.toDsl()
            if (dslWithParams && dslWithParams.trim()) {
                dsl = dslWithParams
            }
        } catch (err) {
            console.warn(`[${label}] Failed to get DSL from programState:`, err)
        }
    }

    toast.info(`Opening in ${label}...`)

    try {
        // Capture screenshot
        const screenshot = captureShareScreenshot()

        // Create effect ZIP if we have workspace files
        const effectZip = await buildShareEffectZip(label)

        // Build payload
        const payload = {
            dsl,
            title: workspaceStore.name || defaultTitle,
            description: 'Created with Foundry',
            ttlMinutes: 60
        }
        if (effectZip) payload.effects = [effectZip]

        // Images and the screenshot go to the sharing service as files.
        await attachShareFiles(payload, { images: renderer.images || [], screenshot })

        // Upload to sharing service
        const response = await fetch(SHARE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.details || errorData.error || `HTTP ${response.status}`)
        }

        const result = await response.json()
        console.log(`[${label}] Share result:`, result)

        // Open the app with the short code
        window.open(`${url}/?code=${result.code}`, '_blank')

        toast.success(`Opened in ${label}`)
    } catch (error) {
        console.error(`[${label}] Error:`, error)
        toast.error(`Failed to open in ${label}: ${error.message}`)
    }
}

// =========================================================================
// Import from URL
// =========================================================================

/**
 * Handle loading a composition from a sharing URL
 * @param {object} composition - The loaded composition data
 */
async function handleLoadFromUrl(composition) {
    if (!composition) return
    renderer.images = composition.images || []
    
    console.log('[Foundry] Loaded composition from URL:', composition.title || 'Untitled')
    
    // Set DSL from composition
    if (composition.dsl) {
        dslEditor.value = composition.dsl
        if (canvasEditor) {
            canvasEditor.value = composition.dsl
        }
    }
    
    // Populate workspace with effect files from rawEffects
    if (composition.rawEffects && composition.rawEffects.length > 0) {
        const effectData = composition.rawEffects[0]
        console.log('[Foundry] Populating workspace from imported effect:', effectData.name)
        
        // Clear existing workspace
        workspaceStore.clear()
        workspaceStore.name = effectData.name || 'Imported Effect'
        
        writePortableEffectToWorkspace(effectData)

        // Update file browser UI
        if (fileBrowser) {
            fileBrowser.render()
        }
        
        console.log('[Foundry] Workspace populated with files:', 
            Array.from(workspaceStore.files.keys()))
    }
    
    if (composition.dsl) workspaceStore.setFile('dsl.txt', composition.dsl)
    workspaceStore.images = renderer.images
    workspaceStore.checkpoint('Imported from URL')

    // Rebuild pipeline with new DSL. Await the recompile and surface its result
    // (same pattern as the code-editor compile paths) — otherwise a composition
    // whose DSL fails to compile would still report a false "Loaded" success
    // while the canvas silently broke.
    if (composition.dsl) {
        setAgentStatus('Compiling...')
        const result = await recompileFromEditor()
        if (!result.success) {
            console.warn('Import compile failed:', result.error)
            showCompilerError(result.error)
            setAgentStatus('Error')
            toast.error(`Imported "${composition.title || 'composition'}" but it failed to compile`)
            return result
        }
        hideCompilerError()
        setAgentStatus('Ready')
    }

    toast.success(`Loaded: ${composition.title || 'Imported composition'}`)
    return { success: true }
}

// =========================================================================
// Event Listeners
// =========================================================================

// play/pause, undo, and redo are menu-bar controls wired via its config
durationInput?.addEventListener('change', updateDuration)

// =========================================================================
// Online Session and Agent API
// =========================================================================

// The result of the latest compile, for the agent's state snapshot.
let lastCompileResult = null
// Above zero while a change that came from the online session compiles: the
// session then gets the program but none of the person's own images.
let sessionOrigin = 0

/** Run `action` as a change that came from the online session. */
async function fromSession(action) {
    sessionOrigin++
    try {
        return await action()
    } finally {
        sessionOrigin--
    }
}

const seanceDialog = document.getElementById('seanceDialog')

/** Put program text in the editors and the workspace without compiling it. */
function setProgramText(dsl) {
    dslEditor.value = dsl
    if (canvasEditor && canvasEditorCurrentFile === 'dsl.txt') {
        canvasEditor.value = dsl
    }
    if (workspaceStore.getFile('dsl.txt') !== dsl) workspaceStore.setFile('dsl.txt', dsl)
}

/** The image records the program can name: the renderer's and the workspace's. */
function heldImages() {
    return [...new Map([...renderer.images, ...workspaceStore.images].map(image => [image.id, image])).values()]
}

/** Keep image records that arrived from the session beside the program's own. */
function addImages(records) {
    renderer.images = [...renderer.images, ...records]
    workspaceStore.images = [...workspaceStore.images, ...records]
}

/** Show the workspace as it now is: its files, its parameters and its name. */
function refreshWorkspaceView() {
    fileBrowser.render()
    const defJson = workspaceStore.getFile('definition.json')
    if (defJson) {
        try {
            paramControls.setEffect({ globals: JSON.parse(defJson).globals || {} })
        } catch (e) { /* the editor reports an invalid definition */ }
    }
    if (canvasEditor && canvasEditorCurrentFile !== 'dsl.txt') {
        const content = workspaceStore.getFile(canvasEditorCurrentFile)
        if (content !== undefined) canvasEditor.value = content
    }
    updateMenuFilename()
}

/** The workspace's custom effect as Portable effect JSON, or '' when it has none. */
function workspaceEffectText() {
    const { effect } = readPortableEffectFromWorkspace()
    return effect ? JSON.stringify(effect) : ''
}

/** Put a custom effect that arrived from the session in the workspace. */
function setWorkspaceEffectText(text) {
    if (text === workspaceEffectText()) return
    let effect
    try {
        effect = JSON.parse(text)
    } catch (err) {
        console.warn('[Seance] the session holds a custom effect that is not JSON', err)
        return
    }
    replaceWorkspaceEffect(effect, renderer)
    refreshWorkspaceView()
}

const onlineCollaboration = createOnlineCollaboration({
    dialog: seanceDialog,
    agentDialog: document.getElementById('agentConnectDialog'),
    agentPrompt: sessionUrl => handfish.agentConnectPrompt?.({
        app: 'Foundry',
        contractUrl: 'https://foundry.noisedeck.app/llms-full.txt',
        sessionUrl,
    }) || '',
    notify: (message, type = 'info') => toast.show(message, type),
    getDsl: () => dslEditor.value,
    setDsl: setProgramText,
    getEffectText: workspaceEffectText,
    setEffectText: setWorkspaceEffectText,
    compile: ({ remote } = {}) => remote ? fromSession(compileAndRun) : compileAndRun(),
    heldImages,
    addImages,
    createAgentRelay: ({ uploadImage, onAgent }) => createSeanceAgentRelay({ appVersion: FOUNDRY_VERSION, uploadImage, onAgent }),
})
canConnectAgent = () => onlineCollaboration.canConnectAgent()
isOnline = () => ['online', 'readonly'].includes(onlineCollaboration.getStatus())

// Undo and redo restore through the workspace's 'restore' event; wait for it.
async function restoreHistory(step) {
    if (!(step === 'undo' ? workspaceStore.canUndo() : workspaceStore.canRedo())) return false
    workspaceStore[step]()
    await lastRestore
    return true
}

bootstrapAgent({
    renderer,
    workspaceStore,
    savedEffects,
    getDsl: () => dslEditor.value,
    setDsl: setProgramText,
    compile: ({ remote } = {}) => remote ? fromSession(compileAndRun) : compileAndRun(),
    lastCompile: () => lastCompileResult,
    sessionText: docId => onlineCollaboration.sessionText(docId),
    refreshWorkspace: refreshWorkspaceView,
    resolveImages: dsl => onlineCollaboration.resolveImages(dsl),
    isPaused: () => isPaused,
    togglePlayPause,
    hasUnpublishedEditorDraft: () => Boolean(canvasEditor && canvasEditor.value !== (
        canvasEditorCurrentFile === 'dsl.txt' ? dslEditor.value : workspaceStore.getFile(canvasEditorCurrentFile) ?? ''
    )),
    getPausedTime: () => renderer.normalizedTime,
    renderAt: async time => {
        if (!isPaused) togglePlayPause()
        pausedTime = time
        await renderer.renderAt(time)
    },
    setLoopDuration: seconds => {
        renderer.setLoopDuration(seconds)
        if (durationInput) durationInput.value = seconds
    },
    switchBackend: async (backend, { dsl } = {}) => {
        if (renderer.backend === backend) return { success: true }
        const frameTime = renderer.normalizedTime ?? pausedTime
        const result = await renderer.switchBackend(backend, { workspaceStore, ...(dsl !== undefined ? { dsl } : {}) })
        if (isPaused) {
            renderer.stop()
            if (result.success) {
                pausedTime = frameTime
                await renderer.renderAt(pausedTime)
            }
        } else if (!renderer.isRunning) renderer.start()
        window.dispatchEvent(new CustomEvent('backend-changed', { detail: { backend: renderer.backend } }))
        return result
    },
    // Not through a session: it replaces the person's whole workspace.
    loadEffect: (effectId, name) => loadEffectToWorkspace(effectId, name),
    refreshEffectDialog,
    exportZip: () => handleExport(),
    importComposition: composition => handleLoadFromUrl(composition),
    undo: ({ remote } = {}) => remote ? fromSession(() => restoreHistory('undo')) : restoreHistory('undo'),
    redo: ({ remote } = {}) => remote ? fromSession(() => restoreHistory('redo')) : restoreHistory('redo'),
})

// =========================================================================
// Start
// =========================================================================

init().then(async () => {
    // Focus editor after load
    if (canvasEditor) {
        canvasEditor.focus()
    }
    markAgentReady()
    await onlineCollaboration.joinFromUrlIfPresent()
})

// Expose for debugging
window.effectWorkspace = {
    renderer,
    workspaceStore,
    loadEffect: loadEffectToWorkspace,
    searchEffects: (query) => renderer.searchEffects(query),
    getEffectIds: () => renderer.getEffectIds()
}
