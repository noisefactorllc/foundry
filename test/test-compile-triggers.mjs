/**
 * Redundant-compile trigger verification (headless).
 *
 * Two UI gestures fired renderer.compile() more than once per user action:
 *  1. Cmd/Ctrl+Enter in the code editor: the editor's keydown handler dispatched
 *     'forcerecompile' (-> recompileFromEditor) but did not stopPropagation, so
 *     the event also bubbled to the document-level keyboard shortcut, which fired
 *     compileAndRun() — TWO compiles for one keypress.
 *  2. Window resize: the resize listener called compileAndRun() on every event
 *     (~60/s while dragging) — a recompile storm, instead of one debounced
 *     recompile after the user stops resizing.
 *
 * This counts renderer.compile() invocations per gesture and asserts exactly one.
 *
 * Requires the dev server running (PORT 3456 by default here).
 * Run: node test/test-compile-triggers.mjs
 */
import { chromium } from 'playwright'

const URL = process.env.TEST_URL || 'http://127.0.0.1:3456'
let failures = 0
const fail = (m) => { console.error(`  FAIL - ${m}`); failures++ }
const ok = (m) => console.log(`  ok - ${m}`)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', () => {})

console.log(`Loading app at ${URL} ...`)
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(4000)
if (!await page.evaluate(() => !!window.effectWorkspace?.renderer)) {
    fail('app did not boot'); await browser.close(); process.exit(1)
}

// Install a counter around renderer.compile (counts invocations, not completions).
await page.evaluate(() => {
    const renderer = window.effectWorkspace.renderer
    window.__compiles = 0
    const orig = renderer.compile.bind(renderer)
    renderer.compile = (...args) => { window.__compiles++; return orig(...args) }
})

// 1) A single Cmd+Enter in the editor compiles exactly once.
console.log('Cmd+Enter compiles once')
const cmdEnter = await page.evaluate(async () => {
    const editor = document.querySelector('#canvas-editor')
    const ta = editor?.querySelector('textarea') || editor?._textarea
    if (!ta) return { noEditor: true }
    if (!ta.value.trim()) return { emptyEditor: true }
    window.__compiles = 0
    ta.focus()
    ta.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', metaKey: true, ctrlKey: true,
        bubbles: true, cancelable: true
    }))
    await new Promise(r => setTimeout(r, 300))
    return { count: window.__compiles }
})
if (cmdEnter.noEditor) fail('could not find code editor textarea')
else if (cmdEnter.emptyEditor) fail('editor was empty — cannot exercise recompile')
else if (cmdEnter.count === 1) ok(`one Cmd+Enter -> 1 compile (got ${cmdEnter.count})`)
else fail(`one Cmd+Enter -> ${cmdEnter.count} compiles (expected 1 — double-dispatch)`)

// 1b) Cmd+Enter while focus is NOT in the editor still compiles (the global
//     shortcut must keep working — the gate only suppresses the editor case).
console.log('Cmd+Enter outside editor still compiles')
const cmdEnterOutside = await page.evaluate(async () => {
    document.activeElement?.blur?.()
    document.body.focus?.()
    window.__compiles = 0
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', metaKey: true, ctrlKey: true,
        bubbles: true, cancelable: true
    }))
    await new Promise(r => setTimeout(r, 300))
    return { count: window.__compiles }
})
if (cmdEnterOutside.count === 1) ok(`Cmd+Enter outside editor -> 1 compile (got ${cmdEnterOutside.count})`)
else fail(`Cmd+Enter outside editor -> ${cmdEnterOutside.count} compiles (expected 1 — global shortcut broken or double)`)

// 2) A burst of resize events collapses to a single debounced recompile.
console.log('Resize storm is debounced')
const resize = await page.evaluate(async () => {
    window.__compiles = 0
    for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('resize'))
    await new Promise(r => setTimeout(r, 500)) // > debounce window, fonts cached
    return { count: window.__compiles }
})
if (resize.count === 1) ok(`5 resize events -> 1 compile (got ${resize.count})`)
else fail(`5 resize events -> ${resize.count} compiles (expected 1 — resize not debounced)`)

await browser.close()
console.log(failures === 0 ? '\nAll compile-trigger checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
