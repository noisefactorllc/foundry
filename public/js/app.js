/**
 * Effect Workspace
 * Main application entry point
 * 
 * A pure effects editor with hot reload - no AI components
 */

import { ShadeRenderer } from './noisemaker/index.js'
import { workspaceStore, saveWorkspace, loadWorkspace, registerEffectFromWorkspace } from './workspace/index.js'
import { FileBrowser, ParamControls, SavedEffects, keyboard, toast, helpModal, aboutModal, nameDialog, CodeEditor, deleteEffectDialog, initDocReader, toggleDocReader, showDocReader, hideDocReader, showPlaceholderContent } from './ui/index.js'
import { OpenEffectDialog } from './ui/open-effect-dialog.js'
import { WorkspaceFilesDialog } from './ui/workspace-files-dialog.js'
import { shareModal } from './ui/share-modal.js'
import { 
    errorHandler, 
    handleError,
    ErrorType,
    getPreferences, 
    setPreference,
    saveUIState,
    loadUIState,
    addRecentEffect
} from './utils/index.js'

// =========================================================================
// Default DSL Program (Splash Screen)
// =========================================================================

function getDefaultDsl() {
    return `
search synth, filter, classicNoisedeck, render, points, mixer

solid(
  r: 0,
  g: 0,
  b: 0
)
  .text(
    text: "EffectWorkspace",
    font: "Nunito",
    size: 0.14,
    color: #c3c3c3
  )
  .pointsEmit(attrition: 2.63)
  .physical(
    gravity: 0,
    energy: 0.98,
    drag: 0.125
  )
  .pointsRender(density: 100, inputIntensity: 20)
  .chromaticAberration(aberrationAmt: 12)
  .lens(displacement: -0.1)
  .write(o0)

pattern(
  patternType: grid,
  scale: 62.57,
  lineWidth: 10,
  animation: panUp,
  color1: #222222
)
  .blendMode(tex: read(o0), mixAmt: -4.56)
  .vignette(brightness: 0.12)
  .write(o1)

render(o1)
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
    const menuFilenameEl = document.getElementById('menuFilename')
    if (menuFilenameEl) {
        menuFilenameEl.textContent = canvasEditorCurrentFile || 'dsl.txt'
    }
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
const playPauseBtn = document.getElementById('play-pause-btn')
const durationInput = document.getElementById('duration-input')
const fpsCounter = document.getElementById('fps-counter')
const paramsContainer = document.getElementById('params-overlay-content')
const fileTreeContainer = document.getElementById('file-tree')
const savedEffectsContainer = document.getElementById('saved-overlay-content')

// Canvas overlay elements
const toggleSavedOverlay = document.getElementById('toggle-saved-overlay')
const toggleDslOverlay = document.getElementById('toggle-dsl-overlay')
const paramsOverlay = document.getElementById('params-overlay')
const savedOverlay = document.getElementById('saved-overlay')
const canvasEditor = document.getElementById('canvas-editor')
// canvasEditor is now a <code-editor> web component with .value property
const compilerErrorEl = document.getElementById('compiler-error')
const saveEffectOverlayBtn = document.getElementById('save-effect-overlay-btn')
const agentStatus = document.getElementById('agent-status')
const menuFilename = document.getElementById('menuFilename')

// =========================================================================
// State
// =========================================================================

let isPaused = false
let pausedTime = 0
let currentEffect = null
let performancePauseGraceEnd = 0
let activeBottomLeftOverlay = null
let canvasEditorVisible = true // Visible by default in Effect Workspace
let canvasEditorCurrentFile = 'dsl.txt'

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
    }
})

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
            playPauseBtn.textContent = 'play_arrow'
            playPauseBtn.title = 'Play'
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
// Effect Loading
// =========================================================================

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
            name: instance.name,
            func: instance.func,
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
            outputGeo: instance.outputGeo || null
        }
        workspaceStore.setFile('definition.json', JSON.stringify(definitionMeta, null, 2))

        if (instance.shaders) {
            for (const [prog, shaderSet] of Object.entries(instance.shaders)) {
                if (shaderSet.glsl) {
                    workspaceStore.setFile(`glsl/${prog}.glsl`, shaderSet.glsl)
                }
                if (shaderSet.wgsl) {
                    workspaceStore.setFile(`wgsl/${prog}.wgsl`, shaderSet.wgsl)
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
            // Add 'user' to the search directive while preserving original namespaces
            const searchMatch = dsl.match(/^search\s+(.+)$/m)
            if (searchMatch) {
                const namespaces = searchMatch[1].split(',').map(s => s.trim())
                if (!namespaces.includes('user')) {
                    // Add 'user' to the beginning of the search directive
                    const newSearch = `search user, ${namespaces.join(', ')}`
                    dsl = dsl.replace(/^search\s+.+$/m, newSearch)
                }
            }
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

        await compileAndRun()

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
    toggleDslOverlay?.classList.toggle('active', canvasEditorVisible)
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
    
    const escaped = displayError.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    compilerErrorEl.innerHTML = `<span>${escaped}</span>`
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
    
    try {
        const dsl = currentFile === 'dsl.txt' 
            ? content 
            : (dslEditor?.value || workspaceStore.getFile('dsl.txt') || '')
        
        if (!dsl.trim()) {
            return { success: true }
        }
        
        const result = await renderer.compile(dsl, { workspaceStore })
        
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
        updateMenuFilename()
        canvasEditor.value = dslEditor?.value || ''
        canvasEditor.focus()
    }
    
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
    
    // Listen for forcerecompile event from CodeEditor (Ctrl/Cmd+Enter)
    canvasEditor.addEventListener('forcerecompile', async () => {
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
        canvasEditor.value = dsl
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

// Toggle button handlers
toggleSavedOverlay?.addEventListener('click', () => showBottomLeftOverlay('saved'))
toggleDslOverlay?.addEventListener('click', toggleCanvasEditor)

// Doc reader toggle
const docToggleBtn = document.getElementById('doc-toggle-btn')
const docReaderClose = document.querySelector('.doc-reader-close')

docToggleBtn?.addEventListener('click', () => {
    const isVisible = toggleDocReader()
    docToggleBtn.classList.toggle('active', isVisible)
    canvasEditor?.classList.toggle('doc-open', isVisible)
})

docReaderClose?.addEventListener('click', () => {
    hideDocReader()
    docToggleBtn?.classList.remove('active')
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
        docToggleBtn?.classList.add('active')
        canvasEditor?.classList.add('doc-open')
        
        updateLoadingStatus('Initializing renderer')
        
        await renderer.init()
        
        paramControls.setProgramState(renderer.programState, 'step_0')
        
        console.log('Effect Workspace initialized')
        console.log(`Loaded ${renderer.getEffectIds().length} effects from manifest`)
        
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
                await compileAndRun()
                renderer.start()
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
        
        await compileAndRun()
        renderer.start()

        window.addEventListener('resize', async () => {
            const { width, height } = resizeCanvas()
            renderer.resize(width, height)
            await compileAndRun()
        })

        workspaceStore.onChange(async () => {
            await saveWorkspace(workspaceStore)
        })

        let saveTimeout = null
        dslEditor?.addEventListener('input', () => {
            clearTimeout(saveTimeout)
            saveTimeout = setTimeout(() => {
                saveUIState({ dsl: dslEditor.value })
            }, 1000)
            if (canvasEditorVisible && canvasEditor && canvasEditorCurrentFile === 'dsl.txt') {
                canvasEditor.value = dslEditor.value
            }
        })

        registerKeyboardShortcuts()
        setupAboutModal()
        setupMenuBar()
        
        if (savedEffects) {
            await savedEffects.refresh()
        }

        // Populate dialog with library + user effects
        await refreshEffectDialog()

        updateMenuFilename()
        hideLoadingScreen()
        
        setTimeout(() => {
            toast.success('Effect Workspace ready')
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
            action: compileAndRun
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
            description: 'Undo',
            action: handleUndo
        },
        {
            key: 'e',
            meta: true,
            description: 'Export ZIP',
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

function setupMenuBar() {
    const menu = document.getElementById('menu')
    if (!menu) return

    // Dropdown menu toggle
    const menus = menu.querySelectorAll('.menu')
    menus.forEach(menuEl => {
        const title = menuEl.querySelector('.menu-title')
        const items = menuEl.querySelector('.menu-items')

        if (title && items) {
            title.addEventListener('click', (e) => {
                e.stopPropagation()
                // Close other menus
                menu.querySelectorAll('.menu-items').forEach(el => {
                    if (el !== items) el.classList.add('hide')
                })
                items.classList.toggle('hide')
            })
        }
    })

    // Close menus when clicking outside
    document.addEventListener('click', () => {
        menu.querySelectorAll('.menu-items').forEach(el => {
            el.classList.add('hide')
        })
    })

    // About menu item
    const aboutMenuItem = document.getElementById('aboutMenuItem')
    if (aboutMenuItem) {
        aboutMenuItem.addEventListener('click', () => {
            aboutModal.open()
            menu.querySelectorAll('.menu-items').forEach(el => el.classList.add('hide'))
        })
    }

    // Import from library menu item
    const importFromLibraryMenuItem = document.getElementById('importFromLibraryMenuItem')
    if (importFromLibraryMenuItem) {
        importFromLibraryMenuItem.addEventListener('click', () => {
            openEffectDialog.open()
            menu.querySelectorAll('.menu-items').forEach(el => el.classList.add('hide'))
        })
    }

    // Workspace files menu item
    const workspaceFilesMenuItem = document.getElementById('workspaceFilesMenuItem')
    if (workspaceFilesMenuItem) {
        workspaceFilesMenuItem.addEventListener('click', () => {
            workspaceFilesDialog.open()
            menu.querySelectorAll('.menu-items').forEach(el => el.classList.add('hide'))
        })
    }

    // Save effect workspace menu item
    const saveEffectMenuItem = document.getElementById('saveEffectMenuItem')
    if (saveEffectMenuItem) {
        saveEffectMenuItem.addEventListener('click', async () => {
            menu.querySelectorAll('.menu-items').forEach(el => el.classList.add('hide'))
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
        })
    }

    // Delete effect workspace menu item
    const deleteEffectMenuItem = document.getElementById('deleteEffectMenuItem')
    if (deleteEffectMenuItem) {
        deleteEffectMenuItem.addEventListener('click', () => {
            menu.querySelectorAll('.menu-items').forEach(el => el.classList.add('hide'))
            deleteEffectDialog.onEffectDelete(async () => {
                await refreshEffectDialog()
                toast.success('Effect deleted')
            })
            deleteEffectDialog.open()
        })
    }

    // Download workspace files menu item
    const downloadWorkspaceMenuItem = document.getElementById('downloadWorkspaceMenuItem')
    if (downloadWorkspaceMenuItem) {
        downloadWorkspaceMenuItem.addEventListener('click', () => {
            handleExport()
            menu.querySelectorAll('.menu-items').forEach(el => el.classList.add('hide'))
        })
    }

    // Show parameters menu item
    const showParametersMenuItem = document.getElementById('showParametersMenuItem')
    if (showParametersMenuItem) {
        showParametersMenuItem.addEventListener('click', () => {
            showBottomLeftOverlay('params')
            menu.querySelectorAll('.menu-items').forEach(el => el.classList.add('hide'))
        })
    }

    // Edit in Noisedeck menu item
    const editInNoisedeckMenuItem = document.getElementById('editInNoisedeckMenuItem')
    if (editInNoisedeckMenuItem) {
        editInNoisedeckMenuItem.addEventListener('click', () => {
            handleEditInNoisedeck()
            menu.querySelectorAll('.menu-items').forEach(el => el.classList.add('hide'))
        })
    }

    // Share publicly menu item
    const sharePubliclyMenuItem = document.getElementById('sharePubliclyMenuItem')
    if (sharePubliclyMenuItem) {
        sharePubliclyMenuItem.addEventListener('click', () => {
            const dsl = canvasEditor?.value || dslEditor.value || ''
            shareModal.open({
                dsl,
                canvas,
                renderer
            })
            menu.querySelectorAll('.menu-items').forEach(el => el.classList.add('hide'))
        })
    }
}

// =========================================================================
// Compilation
// =========================================================================

async function compileAndRun() {
    const dsl = dslEditor.value.trim()
    if (!dsl) {
        showCompileStatus('No DSL program to compile', 'error')
        return
    }

    showCompileStatus('Compiling shader...', '')
    setAgentStatus('Compiling...')
    
    const result = await renderer.compile(dsl, { workspaceStore })

    if (result.success) {
        showCompileStatus('Shader compiled', 'success')
        setOriginalDsl(dsl)
        setAgentStatus('Ready')
    } else {
        showCompileStatus(`${result.error}`, 'error')
        setAgentStatus('Error')
    }
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
    if (isPaused) {
        performancePauseGraceEnd = Date.now() + 5000
        renderer.start()
        playPauseBtn.textContent = 'pause'
        playPauseBtn.title = 'Pause'
    } else {
        renderer.stop()
        playPauseBtn.textContent = 'play_arrow'
        playPauseBtn.title = 'Play'
    }
    isPaused = !isPaused
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
// Undo/Export
// =========================================================================

function handleUndo() {
    if (workspaceStore.canUndo()) {
        workspaceStore.undo()
        toast.success('Undid change')
    } else {
        toast.info('Nothing to undo')
    }
}

async function handleExport() {
    try {
        // Load JSZip dynamically if needed
        if (!window.JSZip) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script')
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
                script.onload = resolve
                script.onerror = () => reject(new Error('Failed to load JSZip'))
                document.head.appendChild(script)
            })
        }
        
        const files = workspaceStore.toObject()
        const dsl = dslEditor.value
        
        const zip = new window.JSZip()
        
        // Add DSL
        zip.file('dsl.txt', dsl)
        
        // Add all workspace files
        for (const [path, content] of Object.entries(files)) {
            zip.file(path, content)
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

// Edit in Noisedeck
const SHARE_API_URL = 'https://sharing.noisedeck.app/api/embed/shorten'
const NOISEDECK_URL = 'https://preview.noisedeck.app'

/**
 * Share the effect and open Noisedeck in a new window
 */
async function handleEditInNoisedeck() {
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
            console.warn('[Noisedeck] Failed to get DSL from programState:', err)
        }
    }
    
    toast.info('Opening in Noisedeck...')
    
    try {
        // Capture screenshot
        let screenshot = null
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
            screenshot = tempCanvas.toDataURL('image/jpeg', 0.85)
        } catch (err) {
            console.warn('[Noisedeck] Screenshot capture failed:', err)
        }
        
        // Create effect ZIP if we have workspace files
        let effectZip = null
        const files = workspaceStore.toObject()
        const defJson = files['definition.json']
        const glslFiles = Object.keys(files).filter(p => p.startsWith('glsl/') && p.endsWith('.glsl'))
        
        if (defJson && glslFiles.length > 0) {
            try {
                // Load JSZip if needed
                if (!window.JSZip) {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script')
                        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
                        script.onload = resolve
                        script.onerror = () => reject(new Error('Failed to load JSZip'))
                        document.head.appendChild(script)
                    })
                }
                
                const zip = new window.JSZip()
                zip.file('definition.json', defJson)
                for (const path of glslFiles) {
                    zip.file(path, files[path])
                }
                const zipBlob = await zip.generateAsync({ type: 'blob' })
                const reader = new FileReader()
                effectZip = await new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result.split(',')[1])
                    reader.onerror = reject
                    reader.readAsDataURL(zipBlob)
                })
            } catch (err) {
                console.warn('[Noisedeck] Effect ZIP creation failed:', err)
            }
        }
        
        // Build payload
        const payload = {
            dsl,
            title: workspaceStore.name || 'Effect Workspace',
            description: 'Created with Effect Workspace',
            ttlMinutes: 60
        }
        if (screenshot) payload.screenshot = screenshot
        if (effectZip) payload.effects = [effectZip]
        
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
        console.log('[Noisedeck] Share result:', result)
        
        // Open Noisedeck with the short code
        const noisedeckUrl = `${NOISEDECK_URL}/?code=${result.code}`
        window.open(noisedeckUrl, '_blank')
        
        toast.success('Opened in Noisedeck')
    } catch (error) {
        console.error('[Noisedeck] Error:', error)
        toast.error(`Failed to open in Noisedeck: ${error.message}`)
    }
}

// =========================================================================
// Event Listeners
// =========================================================================

playPauseBtn.addEventListener('click', togglePlayPause)
durationInput?.addEventListener('change', updateDuration)

// =========================================================================
// Start
// =========================================================================

init().then(() => {
    // Focus editor after load
    if (canvasEditor) {
        canvasEditor.focus()
    }
})

// Expose for debugging
window.effectWorkspace = {
    renderer,
    workspaceStore,
    loadEffect: loadEffectToWorkspace,
    searchEffects: (query) => renderer.searchEffects(query),
    getEffectIds: () => renderer.getEffectIds()
}
