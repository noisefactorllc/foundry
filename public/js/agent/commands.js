/**
 * FoundryAgent command handlers. Each handler receives (args, ctx) and
 * returns { result, warnings?, image? }; the dispatcher builds the envelope.
 * ctx is built in js/app.js (see bootstrapAgent there).
 *
 * Handlers reuse the paths the editor uses: a program runs through the same
 * compile as Cmd+Enter, and undo, saved effects and imports behave for an
 * agent as they do for a person. Foundry suggests Noisemaker's conventions
 * and does not enforce them: a program or shader that breaks one still runs.
 *
 * @module agent/commands
 */

import { commandError } from './dispatcher.js'
import { buildSnapshot } from './snapshot.js'
import { compile as compileDsl, extractEffectNamesFromDsl, getEffect } from '../noisemaker/bundle.js'
import { readPortableEffectFromWorkspace, registerEffectFromWorkspace, replaceWorkspaceEffect } from '../workspace/index.js'
import { loadFromCode } from '../sharingLoader.js'
import { extractShortCode } from '../ui/import-from-url-dialog.js'

const EDITABLE = /\.(glsl|wgsl|json|js|md|txt)$/i
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

export async function getState(_args, ctx) {
    return { result: buildSnapshot(ctx) }
}

/**
 * The program and the custom effect as this command may see them. Through the
 * online session that is what the session holds (the `main` and `effect`
 * documents), never text that this tab keeps out of it; in the page it is the
 * editor and the workspace.
 */
export function visibleWork(ctx) {
    if (ctx.remote) {
        const dsl = ctx.sessionText('main') ?? ''
        const text = ctx.sessionText('effect')
        let effect = null
        if (text) {
            try { effect = JSON.parse(text) } catch { /* the session holds no readable effect */ }
        }
        return { dsl, effect }
    }
    const { effect, error } = readPortableEffectFromWorkspace()
    return { dsl: ctx.getDsl(), effect, warning: error ? { code: 'EFFECT_DEFINITION_INVALID', message: error } : null }
}

// A Portable effect's files, as the workspace keeps them.
function effectFiles(effect) {
    if (!effect) return new Map()
    const { shaders = {}, help, ...definition } = effect
    const files = new Map([['definition.json', JSON.stringify({ ...definition, namespace: 'user' }, null, 2)]])
    for (const [program, set] of Object.entries(shaders)) {
        if (typeof set?.glsl === 'string') files.set(`glsl/${program}.glsl`, set.glsl)
        if (typeof set?.wgsl === 'string') files.set(`wgsl/${program}.wgsl`, set.wgsl)
    }
    if (help) files.set('help.md', help)
    return files
}

export async function getProgram(_args, ctx) {
    const { dsl, effect, warning } = visibleWork(ctx)
    return {
        result: { dsl, running: ctx.renderer.currentDsl === dsl.trim(), effect },
        warnings: warning ? [warning] : [],
    }
}

async function loadProgramEffects(dsl, { renderer }) {
    const manifest = renderer.manifest || {}
    let found = []
    try {
        found = extractEffectNamesFromDsl(dsl, manifest) || []
    } catch {
        // A program that does not parse loads nothing; diagnosis reports it.
    }
    const ids = [...new Set(found.map(entry => entry.effectId))]
        .filter(id => manifest[id] && !renderer.loadedEffects.has(id))
    try {
        for (const id of ids) await renderer.loadEffect(id)
    } catch (err) {
        throw commandError('EFFECT_LOAD_FAILED', `Could not load effects: ${err?.message || err}`, { effectIds: ids })
    }
}

// The engine's media() has no `url` argument: the app reads `url` (an
// `image:<sha256>` id or a link) itself and binds the image as a texture. The
// renderer leaves it out before it compiles, so diagnosis leaves it out the
// same way. One level of nested parentheses inside a link is allowed. The
// argument becomes spaces, so every line and column in a diagnostic still
// points at the program's text.
const MEDIA_CALL = /\bmedia\s*\(((?:[^()]|\([^()]*\))*)\)/gi
const URL_ARG = /\burl\s*:\s*(?:"[^"]*"|'[^']*')/i
const blank = text => text.replace(/[^\n]/g, ' ')

function withoutMediaUrls(dsl) {
    return dsl.replace(MEDIA_CALL, (call, args) => {
        const found = URL_ARG.exec(args)
        if (!found) return call
        let start = found.index
        let end = start + found[0].length
        const after = /^\s*,/.exec(args.slice(end))
        if (after) end += after[0].length
        else {
            const before = /,\s*$/.exec(args.slice(0, start))
            if (before) start = before.index
        }
        const open = call.indexOf('(') + 1
        return call.slice(0, open) + args.slice(0, start) + blank(args.slice(start, end)) + args.slice(end) + ')'
    })
}

function diagnose(dsl) {
    try {
        const compiled = compileDsl(withoutMediaUrls(dsl))
        return (compiled?.diagnostics || []).map(d => ({
            code: d.code,
            severity: d.severity,
            message: d.message,
            ...(d.location ? { location: d.location } : {}),
        }))
    } catch (err) {
        // The parser throws on syntax errors: "Expected ... at line N col M".
        const at = /line (\d+) col (\d+)/.exec(err?.message || '')
        return [{
            code: 'SYNTAX',
            severity: 'error',
            message: err?.message || String(err),
            ...(at ? { location: { line: Number(at[1]), column: Number(at[2]) } } : {}),
        }]
    }
}

const isError = d => d.severity === 'error'

// A Portable effect needs a DSL name and at least one shader program.
function checkEffect(effect) {
    const func = effect.func || effect.name
    if (typeof func !== 'string' || !IDENTIFIER.test(func)) {
        throw commandError('INVALID_EFFECT', 'effect.func (or effect.name) must be a DSL identifier, such as myEffect.', { field: 'effect.func' })
    }
    const shaders = effect.shaders
    const programs = shaders && typeof shaders === 'object' && !Array.isArray(shaders) ? Object.entries(shaders) : []
    if (!programs.length || programs.some(([program, set]) => !IDENTIFIER.test(program) || !set || typeof set !== 'object' ||
        !['glsl', 'wgsl'].some(lang => typeof set[lang] === 'string' && set[lang].trim()))) {
        throw commandError('INVALID_EFFECT', 'effect.shaders maps each program name to { glsl, wgsl } source text; at least one is required.', { field: 'effect.shaders' })
    }
    for (const field of ['globals', 'textures', 'uniformLayouts']) {
        const value = effect[field]
        if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) {
            throw commandError('INVALID_EFFECT', `effect.${field} must be an object.`, { field: `effect.${field}` })
        }
    }
    if (effect.passes !== undefined && !Array.isArray(effect.passes)) {
        throw commandError('INVALID_EFFECT', 'effect.passes must be an array.', { field: 'effect.passes' })
    }
}

// Copy of the workspace's files and name, to put back when a program is refused.
function snapshotWorkspace(workspaceStore) {
    return { files: new Map(workspaceStore.files), name: workspaceStore.name }
}

function restoreWorkspace(workspaceStore, snapshot, renderer) {
    for (const path of [...workspaceStore.files.keys()]) {
        if (!snapshot.files.has(path)) workspaceStore.deleteFile(path)
    }
    for (const [path, content] of snapshot.files) {
        if (workspaceStore.getFile(path) !== content) workspaceStore.setFile(path, content)
    }
    workspaceStore.name = snapshot.name
    registerEffectFromWorkspace(renderer)
}

async function checkProgram(dsl, effect, ctx) {
    if (effect) checkEffect(effect)
    const snapshot = effect ? snapshotWorkspace(ctx.workspaceStore) : null
    if (effect) replaceWorkspaceEffect(effect, ctx.renderer)
    try {
        await loadProgramEffects(dsl, ctx)
        return { diagnostics: diagnose(dsl), snapshot }
    } catch (err) {
        if (snapshot) restoreWorkspace(ctx.workspaceStore, snapshot, ctx.renderer)
        throw err
    }
}

export async function validateProgram({ dsl, effect }, ctx) {
    const { diagnostics, snapshot } = await checkProgram(dsl, effect, ctx)
    // Validation changes nothing: the effect it registered gives way to the workspace's own.
    if (snapshot) restoreWorkspace(ctx.workspaceStore, snapshot, ctx.renderer)
    return { result: { valid: !diagnostics.some(isError), diagnostics } }
}

/**
 * Run `dsl` (and, with `effect`, that custom effect) in place of the current
 * program, through the same compile as Cmd+Enter, or change nothing.
 */
async function applyProgram(dsl, effect, ctx) {
    const previousDsl = ctx.getDsl()
    const { diagnostics, snapshot } = await checkProgram(dsl, effect, ctx)
    if (diagnostics.some(isError)) {
        if (snapshot) restoreWorkspace(ctx.workspaceStore, snapshot, ctx.renderer)
        throw commandError('INVALID_PROGRAM', 'The program does not compile. Nothing changed.', { diagnostics })
    }
    const images = await ctx.resolveImages(dsl)
    ctx.setDsl(dsl)
    const outcome = await ctx.compile({ remote: ctx.remote })
    if (!outcome?.success) {
        if (snapshot) restoreWorkspace(ctx.workspaceStore, snapshot, ctx.renderer)
        ctx.setDsl(previousDsl)
        if (previousDsl.trim()) await ctx.compile({ remote: ctx.remote })
        ctx.refreshWorkspace()
        throw commandError('COMPILE_FAILED', `The renderer rejected the program. Nothing changed. ${outcome?.error || ''}`.trim(), {})
    }
    if (effect) ctx.workspaceStore.checkpoint('Agent program', { dsl })
    ctx.refreshWorkspace()
    const warnings = images.missing.map(id => ({ code: 'IMAGE_MISSING', message: `The program names image:${id}, which this tab does not have.`, id }))
    return { diagnostics, warnings }
}

export async function setProgram({ dsl, effect }, ctx) {
    const { diagnostics, warnings } = await applyProgram(dsl, effect, ctx)
    return { result: { applied: true, diagnostics }, warnings }
}

export async function undo(_args, ctx) {
    return { result: { applied: await ctx.undo({ remote: ctx.remote }) } }
}

export async function redo(_args, ctx) {
    return { result: { applied: await ctx.redo({ remote: ctx.remote }) } }
}

// Workspace files: the custom effect's definition, shaders and help, and any
// other file the person made with "new file...".
// Through the session they are the files of the session's program and custom
// effect; the workspace's other files and its images stay in the tab.
function visibleFiles(ctx) {
    if (!ctx.remote) return new Map([...ctx.workspaceStore.files, ['dsl.txt', ctx.getDsl()]])
    const { dsl, effect } = visibleWork(ctx)
    return new Map([...effectFiles(effect), ['dsl.txt', dsl]])
}

export async function listFiles(_args, ctx) {
    const files = [...visibleFiles(ctx).entries()]
        .map(([path, content]) => ({ path, chars: content.length }))
        .sort((a, b) => a.path.localeCompare(b.path))
    const images = ctx.remote ? [] : ctx.workspaceStore.images.map(image => ({ id: image.id, mimeType: image.mimeType || image.blob?.type || '' }))
    return { result: { name: ctx.workspaceStore.name || '', files, images } }
}

export async function readFile({ path }, ctx) {
    const files = visibleFiles(ctx)
    if (!files.has(path)) {
        throw commandError('NOT_FOUND_FILE', `The workspace has no file ${path}.`, { path, files: [...files.keys()] })
    }
    return { result: { path, content: files.get(path) } }
}

/**
 * Write a workspace file as the code editor does: the custom effect is
 * registered again and the program compiles. A file that does not compile
 * stays written, as in the editor, and the result reports the error.
 */
export async function writeFile({ path, content }, ctx) {
    if (path === 'dsl.txt') {
        throw commandError('INVALID_ARGS_RANGE', 'dsl.txt is the program: run it with setProgram.', { field: 'path' })
    }
    if (!EDITABLE.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '..')) {
        throw commandError('INVALID_ARGS_RANGE', 'path must be a relative .glsl, .wgsl, .json, .js, .md or .txt file path.', { field: 'path' })
    }
    const created = !ctx.workspaceStore.hasFile(path)
    ctx.workspaceStore.setFile(path, content)
    registerEffectFromWorkspace(ctx.renderer)
    const outcome = ctx.getDsl().trim() ? await ctx.compile({ remote: ctx.remote }) : { success: true }
    if (outcome?.success && path === 'definition.json') ctx.workspaceStore.checkpoint('Edit', { dsl: ctx.getDsl() })
    ctx.refreshWorkspace()
    return {
        result: {
            path,
            chars: content.length,
            created,
            compiled: outcome?.success ? { success: true } : { success: false, error: outcome?.error || 'The program did not compile.' },
        },
    }
}

export async function newEffect({ name }, ctx) {
    if (!IDENTIFIER.test(name)) {
        throw commandError('INVALID_ARGS_RANGE', 'name must be a DSL identifier, such as myEffect.', { field: 'name' })
    }
    // file > new effect...: synth/solid as the starting point, under `user`.
    if (!await ctx.loadEffect('synth/solid', name)) {
        throw commandError('EFFECT_LOAD_FAILED', 'Could not start a new effect from synth/solid.', { effectId: 'synth/solid' })
    }
    const outcome = await ctx.compile()
    return { result: { name, files: [...ctx.workspaceStore.files.keys()].sort(), dsl: ctx.getDsl(), compiled: Boolean(outcome?.success) } }
}

export async function loadEffect({ effectId, name }, ctx) {
    if (!ctx.renderer.manifest?.[effectId]) {
        throw commandError('NOT_FOUND_EFFECT', `Unknown effect: ${effectId}`, { effectId })
    }
    if (name !== undefined && !IDENTIFIER.test(name)) {
        throw commandError('INVALID_ARGS_RANGE', 'name must be a DSL identifier, such as myEffect.', { field: 'name' })
    }
    // file > import effect from library...
    if (!await ctx.loadEffect(effectId, name)) {
        throw commandError('EFFECT_LOAD_FAILED', `Could not load ${effectId} into the workspace.`, { effectId })
    }
    return {
        result: {
            loaded: true,
            effectId,
            name: ctx.workspaceStore.name,
            files: [...ctx.workspaceStore.files.keys()].sort(),
            dsl: ctx.getDsl(),
            running: ctx.renderer.currentDsl === ctx.getDsl().trim(),
        },
    }
}

// Saved effects: the person's effect workspaces in IndexedDB, as the saved
// effects panel and file > save effect workspace... read and write them.
export async function listSavedEffects(_args, { savedEffects }) {
    await savedEffects.refresh()
    return { result: { total: savedEffects.effects.length, effects: savedEffects.effects.map(({ id, name, savedAt }) => ({ id, name: name || '', savedAt })) } }
}

async function findSaved(id, savedEffects) {
    await savedEffects.refresh()
    const entry = savedEffects.effects.find(effect => effect.id === id)
    if (!entry) throw commandError('NOT_FOUND_EFFECT', `No saved effect has the id ${id}.`, { id })
    return entry
}

export async function loadSavedEffect({ id }, ctx) {
    const entry = await findSaved(id, ctx.savedEffects)
    await ctx.savedEffects.load(entry.id)
    const outcome = await ctx.compile()
    return { result: { loaded: true, id: entry.id, name: entry.name || '', dsl: ctx.getDsl(), compiled: Boolean(outcome?.success) } }
}

export async function saveEffect({ name }, { savedEffects, refreshEffectDialog }) {
    const id = await savedEffects.save(name.trim())
    await refreshEffectDialog()
    return { result: { saved: true, id, name: name.trim() } }
}

export async function deleteSavedEffect({ id }, { savedEffects, refreshEffectDialog }) {
    const entry = await findSaved(id, savedEffects)
    await savedEffects.delete(entry.id)
    await refreshEffectDialog()
    return { result: { deleted: true, id: entry.id, name: entry.name || '' } }
}

function userEffectEntry(ctx) {
    const { effect } = visibleWork(ctx)
    if (!effect) return null
    const func = effect.func || effect.name
    return { effectId: `user/${func}`, namespace: 'user', name: func, description: effect.description || '', tags: effect.tags || [] }
}

export async function searchEffects({ query = '', namespace, limit = 50 }, ctx) {
    const { renderer } = ctx
    const q = query.toLowerCase()
    const user = userEffectEntry(ctx)
    const matches = [
        ...(user ? [user] : []),
        ...Object.entries(renderer.manifest || {}).map(([effectId, entry]) => {
            const [ns, name] = effectId.split('/')
            return { effectId, namespace: ns, name, description: entry.description || '', tags: entry.tags || [] }
        }),
    ].filter(e => (!namespace || e.namespace === namespace)
        && (!q || `${e.effectId} ${e.description} ${e.tags.join(' ')}`.toLowerCase().includes(q)))
    return { result: { total: matches.length, effects: matches.slice(0, limit) } }
}

function enumChoices(spec, enums) {
    if (spec.choices) return { choices: spec.choices }
    const path = spec.enum || spec.enumPath
        || (spec.type === 'member' && typeof spec.default === 'string'
            ? spec.default.split('.').slice(0, -1).join('.') : '')
    if (!path) return {}
    const node = path.split('.').reduce((value, key) => value?.[key], enums)
    if (!node || typeof node !== 'object') return {}
    return { enum: path, choices: Object.fromEntries(Object.entries(node).map(([key, value]) =>
        [key, spec.type === 'member' ? `${path}.${key}` : value?.value ?? value])) }
}

export async function getEffectDefinition({ effectId }, ctx) {
    const { renderer } = ctx
    const [namespace, name] = effectId.split('/')
    let def
    if (namespace === 'user') {
        const { effect } = visibleWork(ctx)
        if (effect && (effect.func || effect.name) === name) def = effect
    } else {
        if (!renderer.manifest?.[effectId]) throw commandError('NOT_FOUND_EFFECT', `Unknown effect: ${effectId}`, { effectId })
        try {
            def = (await renderer.loadEffect(effectId))?.instance
        } catch (err) {
            throw commandError('EFFECT_LOAD_FAILED', `Could not load ${effectId}: ${err?.message || err}`, { effectId })
        }
        def ||= getEffect(`${namespace}.${name}`) || getEffect(effectId)
    }
    if (!def) throw commandError('NOT_FOUND_EFFECT', `Unknown effect: ${effectId}`, { effectId })
    const params = Object.entries(def.globals || {})
        .filter(([, spec]) => spec && !spec.internal && !spec.ui?.hidden)
        .map(([param, spec]) => ({
            name: param,
            type: spec.type,
            default: spec.default ?? null,
            ...(spec.min !== undefined ? { min: spec.min } : {}),
            ...(spec.max !== undefined ? { max: spec.max } : {}),
            ...enumChoices(spec, renderer.enums),
            ...(spec.uniform ? { uniform: spec.uniform } : {}),
            ...(spec.ui?.label ? { label: spec.ui.label } : {}),
        }))
    return {
        result: {
            effectId,
            func: def.func || name,
            namespace,
            description: def.description || renderer.manifest?.[effectId]?.description || '',
            params,
        },
    }
}

export async function play(_args, ctx) {
    if (ctx.isPaused()) ctx.togglePlayPause()
    return { result: { playing: !ctx.isPaused() } }
}

export async function pause(_args, ctx) {
    if (!ctx.isPaused()) ctx.togglePlayPause()
    return { result: { playing: !ctx.isPaused() } }
}

export async function setBackend({ backend }, ctx) {
    if (backend === 'webgpu' && !navigator.gpu) {
        throw commandError('BACKEND_UNAVAILABLE', 'This browser has no WebGPU. Foundry stays on WebGL2.', { backend })
    }
    await ctx.switchBackend(backend)
    if (ctx.renderer.backend !== backend) {
        throw commandError('BACKEND_UNAVAILABLE', `Foundry could not switch to ${backend}.`, { backend, current: ctx.renderer.backend })
    }
    return { result: { backend: ctx.renderer.backend } }
}

// The next animation frame, after the render loop has drawn into it.
const nextFrame = () => new Promise(done => requestAnimationFrame(() => setTimeout(done, 0)))

export async function getThumbnail({ maxDimension = 256, format = 'jpg' }, ctx) {
    // The canvas as the person sees it. Nothing is rendered for the image, so
    // stateful effects do not advance: a running loop has drawn the latest
    // frame, and a paused canvas keeps its last one (WebGL2 preserves it).
    if (!ctx.isPaused()) await nextFrame()
    const live = ctx.renderer.canvas
    const scale = Math.min(1, maxDimension / Math.max(live.width, live.height, 1))
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(live.width * scale))
    out.height = Math.max(1, Math.round(live.height * scale))
    out.getContext('2d').drawImage(live, 0, 0, out.width, out.height)
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg'
    const image = await new Promise((resolve, reject) => {
        out.toBlob(blob => blob ? resolve(blob) : reject(new Error('The canvas could not be encoded')), mimeType, 0.85)
    })
    return { result: { mimeType, width: out.width, height: out.height }, image }
}

// file > export effect to zip: a browser download of the workspace.
export async function exportZip(_args, ctx) {
    await ctx.exportZip()
    return { result: { started: true, name: ctx.workspaceStore.name || 'effect-workspace' } }
}

function compositionCode(link) {
    try {
        const code = new URL(link).searchParams.get('code')
        if (code) return code
    } catch { /* a bare code or a sharing link */ }
    return extractShortCode(link)
}

// effect > import from url...: a sharing composition, with its custom effect and images.
export async function importComposition({ link }, ctx) {
    const code = compositionCode(link)
    if (!code) {
        throw commandError('IMPORT_FAILED', 'That is not a sharing link or code. A link looks like https://sharing.noisedeck.app/s/CODE.', { link })
    }
    let composition
    try {
        composition = await loadFromCode(code)
    } catch (err) {
        throw commandError('IMPORT_FAILED', `Could not load the composition: ${err?.message || err}`, { code })
    }
    const compiled = await ctx.importComposition(composition)
    return {
        result: {
            title: composition.title || '',
            effects: (composition.rawEffects || []).map(effect => effect.func || effect.name),
            images: (composition.images || []).length,
            dsl: ctx.getDsl(),
            compiled: Boolean(compiled?.success),
        },
    }
}
