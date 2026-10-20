/**
 * State snapshot attached to every FoundryAgent envelope. It stays small:
 * the program text comes from getProgram, and file text from readFile.
 *
 * @module agent/snapshot
 */

/** Snapshot schema version. Bump for renamed or removed fields. */
export const SCHEMA_VERSION = '1.0'

function effectName(workspaceStore) {
    const source = workspaceStore.getFile('definition.json')
    if (!source) return null
    try {
        const definition = JSON.parse(source)
        return definition.func || definition.name || null
    } catch {
        return null
    }
}

export function buildSnapshot({ renderer, workspaceStore, getDsl, isPaused, getPausedTime, lastCompile }) {
    const dsl = getDsl() || ''
    const canvas = renderer.canvas
    const compile = lastCompile()
    return {
        schemaVersion: SCHEMA_VERSION,
        program: {
            chars: dsl.length,
            running: Boolean(renderer.currentDsl) && renderer.currentDsl === dsl.trim(),
        },
        workspace: {
            name: workspaceStore.name || '',
            files: workspaceStore.files.size,
            effect: effectName(workspaceStore),
            images: workspaceStore.images.length,
        },
        compile: compile ? { ok: Boolean(compile.success), ...(compile.success ? {} : { error: String(compile.error || '').slice(0, 500) }) } : null,
        canvas: { width: canvas?.width ?? 0, height: canvas?.height ?? 0 },
        playback: { playing: !isPaused(), loopDuration: renderer.loopDuration ?? null, time: isPaused() ? getPausedTime?.() ?? null : null },
        backend: renderer.backend,
        history: { canUndo: workspaceStore.canUndo(), canRedo: workspaceStore.canRedo() },
    }
}
