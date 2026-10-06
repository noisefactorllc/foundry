/**
 * Tests for WorkspaceStore (public/js/workspace/workspace-store.js).
 *
 * WorkspaceStore is the in-memory effect file store with undo/redo history.
 * Its only import (imageRecords.js) has no CDN bundle dependency, so it runs
 * directly in Node.
 *
 * Focus: the data-integrity invariant that loading a different effect
 * (fromObject) must NOT leave the previous effect's history in place — else
 * an undo after load would resurrect the previous effect's files.
 *
 * Run: node test-workspace-store.mjs
 */
import assert from 'node:assert/strict'

let passed = 0
function check(name, fn) {
    try {
        fn()
        passed++
        console.log(`  ok - ${name}`)
    } catch (err) {
        console.error(`  FAIL - ${name}`)
        console.error(`    ${err.message}`)
        process.exitCode = 1
    }
}

const { WorkspaceStore } = await import('./public/js/workspace/workspace-store.js')

// --- File operations (characterization) -------------------------------------
console.log('WorkspaceStore file operations')

check('setFile / getFile / hasFile', () => {
    const s = new WorkspaceStore()
    s.setFile('glsl/main.glsl', 'void main() {}')
    assert.equal(s.getFile('glsl/main.glsl'), 'void main() {}')
    assert.equal(s.hasFile('glsl/main.glsl'), true)
    assert.equal(s.hasFile('missing'), false)
})

check('deleteFile returns whether it existed', () => {
    const s = new WorkspaceStore()
    s.setFile('a', '1')
    assert.equal(s.deleteFile('a'), true)
    assert.equal(s.deleteFile('a'), false)
})

check('listFiles is sorted; toObject round-trips', () => {
    const s = new WorkspaceStore()
    s.setFile('b', '2')
    s.setFile('a', '1')
    assert.deepEqual(s.listFiles(), ['a', 'b'])
    assert.deepEqual(s.toObject(), { a: '1', b: '2' })
})

// --- History (characterization of current store-level behavior) -------------
console.log('WorkspaceStore history (store-level)')

check('checkpoint then undo/redo restores file snapshots', () => {
    const s = new WorkspaceStore()
    s.setFile('a', 'v1')
    s.checkpoint('first')          // index 0
    s.setFile('a', 'v2')
    s.checkpoint('second')         // index 1
    assert.equal(s.canUndo(), true)
    assert.equal(s.undo(), true)   // back to index 0 (a=v1)
    assert.equal(s.getFile('a'), 'v1')
    assert.equal(s.redo(), true)   // forward to index 1 (a=v2)
    assert.equal(s.getFile('a'), 'v2')
})

check('clear() resets files AND history', () => {
    const s = new WorkspaceStore()
    s.setFile('a', '1')
    s.checkpoint('cp')
    s.clear()
    assert.equal(s.files.size, 0)
    assert.equal(s.history.length, 0)
    assert.equal(s.historyIndex, -1)
    assert.equal(s.canUndo(), false)
})

check('maxHistory cap keeps index pointing at the latest entry', () => {
    const s = new WorkspaceStore()
    s.maxHistory = 3
    for (let i = 0; i < 6; i++) {
        s.setFile('a', String(i))
        s.checkpoint('cp' + i)
    }
    assert.equal(s.history.length, 3)
    // Current entry must be the most recent snapshot.
    assert.equal(s.getCurrentEntry().label, 'cp5')
    assert.equal(s.canRedo(), false)
})

// --- fromObject data-integrity invariant (THE fix under test) ---------------
console.log('WorkspaceStore fromObject history reset (data integrity)')

check('fromObject resets history and historyIndex', () => {
    const s = new WorkspaceStore()
    s.fromObject({ 'a.txt': 'A' }, 'EffectA')
    s.checkpoint('edit A')                       // index 0, history has 1 entry
    s.fromObject({ 'b.txt': 'B' }, 'EffectB')    // loading a new effect
    assert.equal(s.history.length, 0, 'history must be cleared when a new effect is loaded')
    assert.equal(s.historyIndex, -1, 'historyIndex must reset when a new effect is loaded')
    assert.equal(s.canUndo(), false, 'must not be able to undo into the previous effect')
})

check('undo after fromObject cannot resurrect the previous effect files', () => {
    const s = new WorkspaceStore()
    s.fromObject({ 'a.txt': 'A' }, 'EffectA')
    // Two checkpoints so historyIndex climbs above 0 (undo()'s <=0 guard would
    // otherwise mask the bug). This is the real cross-effect corruption case.
    s.setFile('a.txt', 'A2')
    s.checkpoint('cp1')                          // index 0
    s.setFile('a.txt', 'A3')
    s.checkpoint('cp2')                          // index 1 (>0)
    s.fromObject({ 'b.txt': 'B' }, 'EffectB')    // load a different effect
    // A consumer calling undo() must not bring EffectA's files back.
    s.undo()
    assert.equal(s.hasFile('a.txt'), false, 'previous effect file must not reappear')
    assert.equal(s.hasFile('b.txt'), true, 'loaded effect file must remain')
    assert.equal(s.name, 'EffectB', 'name reflects the loaded effect')
})

console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures)' : ''}`)
