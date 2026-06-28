/**
 * Undo/redo verification (headless, real engine).
 *
 * Model (user-chosen): program-level undo of committed states (each successful
 * compile + settled param change is a checkpoint), while native text-undo is
 * preserved inside the code editor (Cmd+Z there must NOT program-undo).
 *
 * Verifies:
 *   - two compiles create undoable history; Undo/Redo buttons step program states
 *   - Cmd+Z while a code editor is focused does NOT program-undo (text-undo kept)
 *   - Cmd+Z when NOT editing performs a program undo
 *
 * Requires the dev server running (PORT 3456 by default here).
 * Run: node test-undo-redo.mjs
 */
import { chromium } from 'playwright'

const URL = process.env.TEST_URL || 'http://127.0.0.1:3456'
let failures = 0
const fail = (m) => { console.error(`  FAIL - ${m}`); failures++ }
const ok = (m) => console.log(`  ok - ${m}`)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', () => {})

console.log(`Loading app at ${URL} ...`)
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(4000)
if (!await page.evaluate(() => !!window.effectWorkspaceRenderer)) { fail('app did not boot'); await browser.close(); process.exit(1) }

const A = 'search synth\n\nsolid()\n  .write(o0)\n\nrender(o0)'
const B = 'search synth\n\nnoise()\n  .write(o0)\n\nrender(o0)'

// Compile a program through the app's real global Cmd+Enter path (so it
// checkpoints). The code editor grabs focus on load and handles Cmd+Enter
// itself; the global shortcut now defers to it when the editor is focused, so
// blur first to drive the global compileAndRun path this helper targets (the
// real path when the user isn't typing in the editor).
async function compile(dsl) {
    await page.evaluate((d) => {
        const ed = document.getElementById('dsl-editor')
        ed.value = d
        document.activeElement?.blur?.()
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
    }, dsl)
    await page.waitForTimeout(1300)
}

const state = () => page.evaluate(() => ({
    canUndo: window.effectWorkspace.workspaceStore.canUndo(),
    canRedo: window.effectWorkspace.workspaceStore.canRedo(),
    dsl: (window.effectWorkspaceRenderer.currentDsl || '')
}))

console.log('Program undo/redo via buttons')
await compile(A)
await compile(B)
let s = await state()
if (s.canUndo) ok('canUndo is true after two compiles')
else fail('canUndo should be true after two distinct compiles')
if (/noise/.test(s.dsl)) ok('current program is B (noise)')
else fail(`expected B (noise) current, got: ${s.dsl.replace(/\n/g, ' ')}`)

await page.click('#undo-btn')
await page.waitForTimeout(1300)
s = await state()
if (/solid/.test(s.dsl) && !/noise/.test(s.dsl)) ok('Undo button restored program A (solid)')
else fail(`undo did not restore A: ${s.dsl.replace(/\n/g, ' ')}`)
if (s.canRedo) ok('canRedo is true after undo')
else fail('canRedo should be true after undo')

await page.click('#redo-btn')
await page.waitForTimeout(1300)
s = await state()
if (/noise/.test(s.dsl)) ok('Redo button restored program B (noise)')
else fail(`redo did not restore B: ${s.dsl.replace(/\n/g, ' ')}`)

console.log('Cmd+Z preserves native text-undo inside the editor')
// Focus the code editor textarea; Cmd+Z there must NOT program-undo.
await page.evaluate(() => {
    const ta = document.querySelector('#canvas-editor textarea')
    ta.focus()
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))
})
await page.waitForTimeout(800)
s = await state()
if (/noise/.test(s.dsl)) ok('Cmd+Z while editing did NOT program-undo (text-undo preserved)')
else fail(`Cmd+Z in editor wrongly program-undid: ${s.dsl.replace(/\n/g, ' ')}`)

console.log('Cmd+Z performs a program undo when not editing')
await page.evaluate(() => {
    const ta = document.querySelector('#canvas-editor textarea')
    if (ta) ta.blur()
    document.body.focus()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))
})
await page.waitForTimeout(1300)
s = await state()
if (/solid/.test(s.dsl) && !/noise/.test(s.dsl)) ok('Cmd+Z (not editing) performed a program undo to A')
else fail(`Cmd+Z (body) did not program-undo to A: ${s.dsl.replace(/\n/g, ' ')}`)

console.log('Editor edits (hot-reload path) create undo checkpoints')
// Current program is A (solid) from the previous undo. Edit via the REAL code
// editor (input → recompileFromEditor, the path compileAndRun does NOT cover).
await page.evaluate((dsl) => {
    const ed = document.getElementById('canvas-editor')
    ed.value = dsl
    ed.dispatchEvent(new Event('input', { bubbles: true }))
}, B)
await page.waitForTimeout(1700) // hot-reload debounce (500) + compile + checkpoint
s = await state()
if (/noise/.test(s.dsl) && s.canUndo) ok('editor edit compiled and created an undo checkpoint')
else fail(`editor edit did not checkpoint (dsl=${s.dsl.replace(/\n/g, ' ')}, canUndo=${s.canUndo})`)

await page.click('#undo-btn')
await page.waitForTimeout(1300)
s = await state()
if (!/noise/.test(s.dsl)) ok('undo reverts the editor edit')
else fail('undo did not revert the editor edit')

console.log('Same-tick undo+redo nets correctly and leaves history intact')
await compile(B) // ensure B is current with A below it
await page.evaluate(() => {
    // Fire undo AND redo in the same synchronous tick. Restores are async and
    // fire-and-forget; the depth-counter guard must keep checkpointing suppressed
    // until BOTH finish so the concurrent restores can't corrupt history. (This
    // exercises the rapid path; the underlying race is timing-dependent.)
    document.body.focus()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true }))
})
await page.waitForTimeout(2500)
s = await state()
if (/noise/.test(s.dsl) && !/solid/.test(s.dsl)) ok('same-tick undo+redo nets to B (no corruption)')
else fail(`same-tick undo+redo corrupted current state: ${s.dsl.replace(/\n/g, ' ')}`)
// The entry below must still be intact: a further undo reaches A.
await page.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))
})
await page.waitForTimeout(1500)
s = await state()
if (/solid/.test(s.dsl)) ok('history below the race is intact (undo reaches A)')
else fail(`history below the race was corrupted: ${s.dsl.replace(/\n/g, ' ')}`)

await browser.close()
console.log(failures === 0 ? '\nAll undo/redo checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
