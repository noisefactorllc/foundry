/**
 * HADES
 * Main application entry point
 * 
 * A pure effects editor with hot reload - no AI components
 */

import { ShadeRenderer } from './noisemaker/index.js'
import { workspaceStore, saveWorkspace, loadWorkspace, registerEffectFromWorkspace } from './workspace/index.js'
import { FileBrowser, ParamControls, SavedEffects, keyboard, toast, helpModal, aboutModal, nameDialog, CodeEditor } from './ui/index.js'
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
    text: "H A D E S",
    font: "Audiowide",
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
const exportBtn = document.getElementById('export-btn')
const noisedeckBtn = document.getElementById('noisedeck-btn')
const backendWebgl2Btn = document.getElementById('backend-webgl2')
const backendWebgpuBtn = document.getElementById('backend-webgpu')
const paramsContainer = document.getElementById('params-overlay-content')
const fileTreeContainer = document.getElementById('file-tree')
const savedEffectsContainer = document.getElementById('saved-overlay-content')

// Canvas overlay elements
const toggleParamsOverlay = document.getElementById('toggle-params-overlay')
const toggleSavedOverlay = document.getElementById('toggle-saved-overlay')
const toggleWorkspaceOverlay = document.getElementById('toggle-workspace-overlay')
const toggleDslOverlay = document.getElementById('toggle-dsl-overlay')
const paramsOverlay = document.getElementById('params-overlay')
const savedOverlay = document.getElementById('saved-overlay')
const workspaceOverlay = document.getElementById('workspace-overlay')
const canvasEditor = document.getElementById('canvas-editor')
const workspaceOverlayContent = document.getElementById('workspace-overlay-content')
// canvasEditor is now a <code-editor> web component with .value property
const compilerErrorEl = document.getElementById('compiler-error')
const saveEffectOverlayBtn = document.getElementById('save-effect-overlay-btn')
const agentStatus = document.getElementById('agent-status')

// Effect search
const effectSearch = document.getElementById('effect-search')
const effectList = document.getElementById('effect-list')

// =========================================================================
// State
// =========================================================================

let isPaused = false
let pausedTime = 0
let currentEffect = null
let performancePauseGraceEnd = 0
let activeBottomLeftOverlay = null
let canvasEditorVisible = true // Visible by default in HADES
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
                    canvasEditor.value = dsl
                    canvasEditorCurrentFile = 'dsl.txt'
                }
                await compileAndRun()
            }
            
            fileBrowser.render()
            updateBackendSwitchVisibility()
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
    loopDuration: parseInt(durationInput.value) || 10,
    onFPS: (fps) => {
        fpsCounter.textContent = `${fps} fps`
        
        const now = Date.now()
        if (fps < 20 && !isPaused && now > performancePauseGraceEnd) {
            renderer.stop()
            isPaused = true
            pausedTime = 0
            playPauseBtn.querySelector('.icon').textContent = 'play_arrow'
            playPauseBtn.title = 'Play'
            toast.warning('Performance pause - shader too expensive')
        }
    },
    onError: (err) => {
        showCompileStatus(`Error: ${err.message}`, 'error')
    }
})

// Expose renderer for debugging
window.hadesRenderer = renderer

// Set renderer on SavedEffects
if (savedEffects) {
    savedEffects.renderer = renderer
}

// =========================================================================
// Effect Library
// =========================================================================

let allEffects = []

function renderEffectList(filter = '') {
    if (!effectList) return
    
    const filtered = filter 
        ? allEffects.filter(e => 
            e.name.toLowerCase().includes(filter.toLowerCase()) ||
            e.namespace.toLowerCase().includes(filter.toLowerCase())
          )
        : allEffects.slice(0, 50) // Show first 50 by default
    
    if (filtered.length === 0) {
        effectList.innerHTML = '<div class="empty-state">No effects found</div>'
        return
    }
    
    effectList.innerHTML = filtered.map(effect => `
        <div class="effect-item" data-id="${effect.id}">
            <span class="effect-name">${effect.name}</span>
            <span class="effect-namespace">${effect.namespace}</span>
        </div>
    `).join('')
    
    // Add click handlers
    effectList.querySelectorAll('.effect-item').forEach(item => {
        item.addEventListener('click', () => {
            loadEffectToWorkspace(item.dataset.id)
        })
    })
}

// Search handler
effectSearch?.addEventListener('input', (e) => {
    renderEffectList(e.target.value)
})

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

        const definitionMeta = {
            name: instance.name,
            func: instance.func,
            namespace: effect.namespace,
            description: instance.description || '',
            tags: instance.tags || [],
            globals: instance.globals || {}
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

        currentEffect = instance
        paramControls.setEffect(instance)
        fileBrowser.render()

        const dsl = renderer.buildDslSource(effect)
        if (dsl) {
            dslEditor.value = dsl
            if (canvasEditor) {
                canvasEditor.value = dsl
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
    toggleParamsOverlay?.classList.toggle('active', activeBottomLeftOverlay === 'params')
    toggleSavedOverlay?.classList.toggle('active', activeBottomLeftOverlay === 'saved')
    toggleWorkspaceOverlay?.classList.toggle('active', activeBottomLeftOverlay === 'workspace')
    toggleDslOverlay?.classList.toggle('active', canvasEditorVisible)
}

function showBottomLeftOverlay(which) {
    paramsOverlay?.setAttribute('hidden', '')
    savedOverlay?.setAttribute('hidden', '')
    workspaceOverlay?.setAttribute('hidden', '')
    
    if (which === activeBottomLeftOverlay || which === null) {
        activeBottomLeftOverlay = null
    } else {
        activeBottomLeftOverlay = which
        if (which === 'params') {
            paramsOverlay?.removeAttribute('hidden')
        } else if (which === 'saved') {
            savedOverlay?.removeAttribute('hidden')
            savedEffects?.refresh()
        } else if (which === 'workspace') {
            workspaceOverlay?.removeAttribute('hidden')
            updateWorkspaceOverlayContent()
        }
    }
    
    updateOverlayToggleStates()
}

function updateWorkspaceOverlayContent() {
    if (!workspaceOverlayContent) return
    
    const files = workspaceStore.listFiles()
    
    if (files.length === 0) {
        workspaceOverlayContent.innerHTML = '<div class="empty-state">No effect loaded</div>'
        return
    }
    
    let html = ''
    for (const filePath of files) {
        const fileName = filePath.split('/').pop()
        const ext = fileName.split('.').pop().toLowerCase()
        
        let icon = 'draft'
        switch (ext) {
            case 'js': icon = 'javascript'; break
            case 'json': icon = 'data_object'; break
            case 'glsl': icon = 'brush'; break
            case 'wgsl': icon = 'diamond'; break
            case 'md': icon = 'description'; break
        }
        
        html += `
            <div class="file-item" data-path="${filePath}">
                <span class="file-icon icon-material">${icon}</span>
                <span class="file-name">${filePath}</span>
            </div>
        `
    }
    
    workspaceOverlayContent.innerHTML = html
    
    workspaceOverlayContent.querySelectorAll('.file-item').forEach(item => {
        const path = item.dataset.path
        if (isEditableFile(path)) {
            item.addEventListener('click', () => {
                openCanvasEditorWithFile(path)
                showBottomLeftOverlay(null)
            })
        }
    })
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
    
    if (filePath === 'dsl.txt') {
        canvasEditor.value = dslEditor?.value || ''
    } else {
        const content = workspaceStore.getFile(filePath)
        canvasEditor.value = content || ''
    }
    
    canvasEditor.focus()
}

function saveCurrentEditorContent() {
    if (!canvasEditor) return
    
    const content = canvasEditor.value
    
    if (canvasEditorCurrentFile === 'dsl.txt') {
        if (dslEditor) {
            dslEditor.value = content
        }
    } else {
        workspaceStore.setFile(canvasEditorCurrentFile, content)
    }
}

async function recompileFromEditor() {
    if (!renderer || !canvasEditor) return { success: false, error: 'Not initialized' }
    
    const currentFile = canvasEditorCurrentFile
    const content = canvasEditor.value
    
    if (currentFile === 'dsl.txt') {
        if (dslEditor) {
            dslEditor.value = content
        }
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
toggleParamsOverlay?.addEventListener('click', () => showBottomLeftOverlay('params'))
toggleSavedOverlay?.addEventListener('click', () => showBottomLeftOverlay('saved'))
toggleWorkspaceOverlay?.addEventListener('click', () => showBottomLeftOverlay('workspace'))
toggleDslOverlay?.addEventListener('click', toggleCanvasEditor)

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
                await document.fonts.load('400 48px Audiowide')
            } catch (e) {
                console.warn('[Fonts] Could not preload Audiowide:', e)
            }
        }
        
        updateLoadingStatus('Loading preferences')
        
        const prefs = getPreferences()
        if (prefs.duration) {
            durationInput.value = prefs.duration
        }
        
        initCanvasEditorControls()
        
        updateLoadingStatus('Initializing renderer')
        
        await renderer.init()
        
        paramControls.setProgramState(renderer.programState, 'step_0')
        
        console.log('HADES initialized')
        console.log(`Loaded ${renderer.getEffectIds().length} effects from manifest`)
        
        // Populate effect list
        allEffects = renderer.getEffectIds().map(id => {
            const [namespace, name] = id.split('/')
            return { id, namespace, name }
        })
        renderEffectList()

        updateLoadingStatus('Restoring workspace')
        
        const restored = await loadWorkspace(workspaceStore)
        if (restored) {
            console.log('Restored workspace from IndexedDB')
            registerEffectFromWorkspace(renderer)
            fileBrowser.render()
            updateBackendSwitchVisibility()
            
            let dsl = workspaceStore.getFile('dsl.txt')
            
            if (!dsl) {
                const defJson = workspaceStore.getFile('definition.json')
                if (defJson) {
                    try {
                        const def = JSON.parse(defJson)
                        const effectName = def.func || def.name
                        const namespace = def.namespace || 'synth'
                        if (effectName) {
                            dsl = `search ${namespace}\n${effectName}().write(o0)\nrender(o0)`
                            workspaceStore.setFile('dsl.txt', dsl)
                        }
                    } catch (e) {
                        console.error('[App] Failed to parse definition.json:', e)
                    }
                }
            }
            
            if (dsl) {
                dslEditor.value = dsl
                if (canvasEditor) {
                    canvasEditor.value = dsl
                    canvasEditorCurrentFile = 'dsl.txt'
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
            canvasEditor.value = dslEditor.value
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
            updateBackendSwitchVisibility()
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
        
        if (savedEffects) {
            await savedEffects.refresh()
        }

        hideLoadingScreen()
        
        setTimeout(() => {
            toast.success('HADES ready')
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
        playPauseBtn.querySelector('.icon').textContent = 'pause'
        playPauseBtn.title = 'Pause'
    } else {
        renderer.stop()
        playPauseBtn.querySelector('.icon').textContent = 'play_arrow'
        playPauseBtn.title = 'Play'
    }
    isPaused = !isPaused
}

function updateDuration() {
    const duration = parseInt(durationInput.value) || 10
    renderer.setLoopDuration(duration)
    setPreference('duration', duration)
}

// =========================================================================
// Backend Switching
// =========================================================================

function updateBackendButtonUI(backend) {
    if (backendWebgl2Btn && backendWebgpuBtn) {
        const isWebGPU = backend === 'webgpu'
        backendWebgl2Btn.classList.toggle('active', !isWebGPU)
        backendWebgl2Btn.setAttribute('aria-pressed', !isWebGPU)
        backendWebgpuBtn.classList.toggle('active', isWebGPU)
        backendWebgpuBtn.setAttribute('aria-pressed', isWebGPU)
    }
}

async function checkWebGPUAvailability() {
    if (backendWebgpuBtn) {
        const isAvailable = navigator.gpu !== undefined
        if (!isAvailable) {
            backendWebgpuBtn.classList.add('webgpu-unavailable')
            backendWebgpuBtn.disabled = true
            backendWebgpuBtn.title = 'WebGPU not available in this browser'
        }
    }
}

function updateBackendSwitchVisibility() {
    const backendSwitch = document.getElementById('backend-switch')
    if (!backendSwitch) return
    
    const files = workspaceStore.listFiles()
    const hasWgslFiles = files.some(f => f.endsWith('.wgsl'))
    
    if (hasWgslFiles) {
        backendSwitch.classList.remove('hidden')
    } else {
        backendSwitch.classList.add('hidden')
    }
}

async function switchBackend(backend) {
    const currentBackend = renderer.backend
    if (currentBackend === backend) {
        return
    }
    
    showCompileStatus(`Switching to ${backend}...`, '')
    try {
        await renderer.switchBackend(backend, { workspaceStore })
        setPreference('backend', backend)
        updateBackendButtonUI(backend)
        showCompileStatus(`Switched to ${backend}`, 'success')
        
        if (!renderer.isRunning) {
            renderer.start()
        }
        
        window.dispatchEvent(new CustomEvent('backend-changed', { detail: { backend } }))
    } catch (err) {
        showCompileStatus(`Failed to switch: ${err.message}`, 'error')
        updateBackendButtonUI(currentBackend)
        await compileAndRun()
        renderer.start()
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
        a.download = `${workspaceStore.name || 'hades-effect'}.zip`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        
        toast.success('Exported workspace')
    } catch (error) {
        toast.error(`Export failed: ${error.message}`)
    }
}

// Open in Noisedeck
const SHARE_API_URL = 'https://sharing.noisedeck.app/share'
const NOISEDECK_URL = 'https://noisedeck.app'

async function handleEditInNoisedeck() {
    const dsl = dslEditor.value
    if (!dsl) {
        toast.warning('No DSL to export')
        return
    }
    
    try {
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
        
        const payload = {
            dsl,
            title: workspaceStore.name || 'HADES Effect',
            description: 'Created with HADES',
            ttlMinutes: 60
        }
        if (screenshot) payload.screenshot = screenshot
        
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
durationInput.addEventListener('change', updateDuration)
exportBtn.addEventListener('click', handleExport)
noisedeckBtn?.addEventListener('click', handleEditInNoisedeck)

backendWebgl2Btn?.addEventListener('click', () => switchBackend('webgl2'))
backendWebgpuBtn?.addEventListener('click', () => switchBackend('webgpu'))

checkWebGPUAvailability()
updateBackendSwitchVisibility()
updateBackendButtonUI(renderer.backend)

window.addEventListener('backend-changed', (e) => {
    updateBackendButtonUI(e.detail.backend)
})

window.addEventListener('wgsl-files-added', () => {
    updateBackendSwitchVisibility()
})

workspaceStore.addEventListener('change', () => {
    updateWorkspaceOverlayContent()
})

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
window.hades = {
    renderer,
    workspaceStore,
    loadEffect: loadEffectToWorkspace,
    searchEffects: (query) => renderer.searchEffects(query),
    getEffectIds: () => renderer.getEffectIds()
}
