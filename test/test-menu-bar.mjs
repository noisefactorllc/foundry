/**
 * Menu bar migration verification (headless).
 *
 * The bespoke #menu implementation was replaced by the shared handfish
 * <menu-bar> component (config assigned in app.js). This drives the REAL app
 * and verifies every baseline menu item, control, and keyboard shortcut is
 * present and fully operational:
 *   - exact menu tree (labels, order, separators, ids) for all 3 menus
 *   - every item's click behavior (dialogs open, toggles flip, export fires)
 *   - the 4 "edit in X" flows end-to-end with the sharing API mocked at the
 *     network boundary and window.open stubbed (no prod side effects)
 *   - center filename label text + gated interactivity
 *   - all 5 right-side buttons incl. undo/redo disabled-state pulls
 *   - global keyboard shortcuts (Space, F1, Cmd+P, Cmd+S, Cmd+Z/Shift+Cmd+Z)
 *   - programmatic getElementById(id).click() delegation contract
 *
 * Requires the dev server running (PORT 3456 by default here).
 * Run: node test/test-menu-bar.mjs   (or TEST_URL=... node test/test-menu-bar.mjs)
 */
import { chromium } from 'playwright'

const URL = process.env.TEST_URL || 'http://127.0.0.1:3456'
let failures = 0
const fail = (m) => { console.error(`  FAIL - ${m}`); failures++ }
const ok = (m) => console.log(`  ok - ${m}`)

const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({ acceptDownloads: true })
const page = await context.newPage()
page.on('pageerror', () => {})

// Stub window.open before any app code runs; record calls for the edit-in flows.
await page.addInitScript(() => {
    window.__openedUrls = []
    window.open = (url) => { window.__openedUrls.push(String(url)); return null }
})
// Mock the sharing API at the network boundary — no prod writes.
await page.route('https://sharing.noisedeck.app/**', route =>
    route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'TESTCODE' })
    }))

console.log(`Loading app at ${URL} ...`)
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(4000)
if (!await page.evaluate(() => !!window.effectWorkspace)) {
    fail('app did not boot')
    await browser.close()
    process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. Structure: exact menu tree
// ---------------------------------------------------------------------------
console.log('Menu tree structure')

const EXPECTED = {
    logoMenu: [
        ['aboutMenuItem', 'about Foundry'],
    ],
    fileMenu: [
        ['newEffectMenuItem', 'new effect...'],
        ['newFileMenuItem', 'new file...'],
        'separator',
        ['workspaceFilesMenuItem', 'workspace files'],
        ['saveEffectMenuItem', 'save effect workspace...'],
        ['deleteEffectMenuItem', 'delete effect workspace...'],
        ['downloadWorkspaceMenuItem', 'export effect to zip'],
        'separator',
        ['importFromLibraryMenuItem', 'import effect from library...'],
        ['importFromZipMenuItem', 'import effect from zip...'],
    ],
    effectMenu: [
        ['showParametersMenuItem', 'show parameters'],
        ['showDslMenuItem', 'show dsl code'],
        'separator',
        ['editInNoisedeckMenuItem', 'edit in Noisedeck...'],
        ['editInNoodlesMenuItem', 'edit in Noodles...'],
        ['editInPolymorphicMenuItem', 'edit in Polymorphic...'],
        ['editInShadeMenuItem', 'edit in Shade...'],
        'separator',
        ['importFromUrlMenuItem', 'import from url...'],
        ['sharePubliclyMenuItem', 'share publicly...'],
    ],
}

const tree = await page.evaluate(() => {
    const bar = document.getElementById('menu')
    const out = {}
    for (const wrapper of bar.querySelectorAll('.hf-menubar-menu')) {
        const panel = wrapper.querySelector('.hf-menubar-panel')
        const rows = [...panel.children].map(el =>
            el.tagName === 'HR' ? 'separator'
                : [el.id, el.querySelector('.hf-menubar-item-label')?.textContent ?? ''])
        out[wrapper.querySelector('.hf-menubar-trigger').id || rows[0]?.[0] || '?'] = rows
    }
    // Key menus by config id order instead: rebuild from the component config.
    const cfg = bar.config
    const byId = {}
    let i = 0
    for (const control of cfg.regions.left) {
        if (control.type !== 'menu') continue
        byId[control.id] = Object.values(out)[i++]
    }
    return byId
})

for (const [menuId, expected] of Object.entries(EXPECTED)) {
    const actual = tree[menuId] || []
    const exp = expected.map(e => Array.isArray(e) ? e.join('|') : e)
    const act = actual.map(e => Array.isArray(e) ? e.join('|') : e)
    if (JSON.stringify(exp) === JSON.stringify(act)) ok(`${menuId}: ${expected.length} rows exact (labels, order, separators, ids)`)
    else fail(`${menuId} mismatch:\n    expected ${JSON.stringify(exp)}\n    actual   ${JSON.stringify(act)}`)
}

// ---------------------------------------------------------------------------
// 2. Open/close/switch behavior smoke
// ---------------------------------------------------------------------------
console.log('Open/close behavior')
const fileTrigger = page.locator('#menu .hf-menubar-trigger', { hasText: 'file' })
const effectTrigger = page.locator('#menu .hf-menubar-trigger', { hasText: 'effect' })
await fileTrigger.click()
if (await page.locator('#newEffectMenuItem').isVisible()) ok('file menu opens on click')
else fail('file menu did not open')
await effectTrigger.click()
if (await page.locator('#showParametersMenuItem').isVisible() && !await page.locator('#newEffectMenuItem').isVisible()) ok('click switches menus')
else fail('menu switch broken')
await page.mouse.click(900, 500)
if (!await page.locator('#showParametersMenuItem').isVisible()) ok('click-away closes')
else fail('click-away broken')

// ---------------------------------------------------------------------------
// 3. Every dialog-opening item: click -> dialog appears -> close
// ---------------------------------------------------------------------------
console.log('Dialog items')

async function itemOpens(itemId, selector, closeVia = 'Escape') {
    await page.evaluate((id) => document.getElementById(id).click(), itemId)
    try {
        await page.waitForSelector(selector, { state: 'visible', timeout: 5000 })
        ok(`${itemId} -> ${selector}`)
    } catch {
        fail(`${itemId}: ${selector} did not appear`)
    }
    if (closeVia === 'Escape') await page.keyboard.press('Escape')
    else await page.click(closeVia)
    await page.waitForTimeout(300)
}

await itemOpens('aboutMenuItem', '.hf-about')
await itemOpens('newEffectMenuItem', '.name-dialog, dialog[open] .name-input, .hf-dialog input')
await itemOpens('newFileMenuItem', '.name-dialog, dialog[open] .name-input, .hf-dialog input')
await itemOpens('workspaceFilesMenuItem', '.workspace-files-dialog, .wf-dialog, dialog[open]')
await itemOpens('saveEffectMenuItem', '.name-dialog, dialog[open] .name-input, .hf-dialog input')
await itemOpens('deleteEffectMenuItem', '.delete-effect-dialog, dialog[open]')
await itemOpens('importFromLibraryMenuItem', '.open-effect-dialog, dialog[open]')
await itemOpens('importFromZipMenuItem', '.import-effect-dialog, dialog[open]')
await itemOpens('importFromUrlMenuItem', '.import-url-input')
await itemOpens('sharePubliclyMenuItem', '.share-modal, dialog[open]')

// export effect to zip -> real download event
{
    const dl = page.waitForEvent('download', { timeout: 10000 }).catch(() => null)
    await page.evaluate(() => document.getElementById('downloadWorkspaceMenuItem').click())
    const download = await dl
    if (download) { ok(`downloadWorkspaceMenuItem -> download event (${download.suggestedFilename()})`); await download.cancel() }
    else fail('downloadWorkspaceMenuItem: no download event')
}

// ---------------------------------------------------------------------------
// 4. Toggle items + center label + right buttons
// ---------------------------------------------------------------------------
console.log('Toggles, label, buttons')

const editorVisible = () => page.evaluate(() => {
    const el = document.getElementById('canvas-editor')
    return !!el && getComputedStyle(el).display !== 'none' && !el.hidden
})
const labelText = () => page.evaluate(() => document.getElementById('menuFilename').textContent)
const dslActive = () => page.evaluate(() => document.getElementById('toggle-dsl-overlay').classList.contains('active'))

if (await editorVisible() && (await labelText()) === 'dsl.txt' && await dslActive()) ok('boot state: editor visible, filename "dsl.txt", dsl button active')
else fail(`boot state wrong: editor=${await editorVisible()} label="${await labelText()}" active=${await dslActive()}`)

await page.evaluate(() => document.getElementById('showDslMenuItem').click())
await page.waitForTimeout(200)
if (!await editorVisible() && (await labelText()) === '' && !await dslActive()) ok('showDslMenuItem toggles editor off; label empties; button deactivates')
else fail('showDslMenuItem toggle-off chain broken')

await page.evaluate(() => document.getElementById('toggle-dsl-overlay').click())
await page.waitForTimeout(200)
if (await editorVisible() && (await labelText()) === 'dsl.txt' && await dslActive()) ok('toggle-dsl-overlay button toggles editor back on (same state chain)')
else fail('toggle-dsl-overlay toggle-on chain broken')

// params overlay toggle
const paramsHidden = () => page.evaluate(() => document.getElementById('params-overlay').hasAttribute('hidden'))
await page.evaluate(() => document.getElementById('showParametersMenuItem').click())
await page.waitForTimeout(150)
if (!await paramsHidden()) ok('showParametersMenuItem opens params overlay')
else fail('params overlay did not open')
await page.evaluate(() => document.getElementById('showParametersMenuItem').click())
await page.waitForTimeout(150)
if (await paramsHidden()) ok('showParametersMenuItem toggles params overlay closed')
else fail('params overlay did not close')

// center label click -> workspace files dialog (gated on editor visible)
await page.evaluate(() => document.getElementById('menuFilename').click())
try {
    await page.waitForSelector('.workspace-files-dialog, .wf-dialog, dialog[open]', { state: 'visible', timeout: 4000 })
    ok('menuFilename click opens workspace files (editor visible)')
} catch { fail('menuFilename click did not open workspace files') }
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// doc toggle button
const docVisible = () => page.evaluate(() => document.getElementById('doc-reader-panel')?.classList.contains('visible') ?? false)
const docActive = () => page.evaluate(() => document.getElementById('doc-toggle-btn').classList.contains('active'))
if (await docVisible() && await docActive()) ok('doc reader open + button active at boot')
else fail('doc reader boot state wrong')
await page.evaluate(() => document.getElementById('doc-toggle-btn').click())
await page.waitForTimeout(150)
if (!await docVisible() && !await docActive()) ok('doc-toggle-btn hides doc reader + deactivates')
else fail('doc-toggle-btn hide broken')
await page.evaluate(() => document.getElementById('doc-toggle-btn').click())
await page.waitForTimeout(150)
if (await docVisible() && await docActive()) ok('doc-toggle-btn shows doc reader + activates')
else fail('doc-toggle-btn show broken')

// play/pause button + tooltip pull
const ppIcon = () => page.evaluate(() => document.getElementById('play-pause-btn').querySelector('.hf-icon').textContent)
const ppTitle = () => page.evaluate(() => document.getElementById('play-pause-btn').getAttribute('data-title'))
// Headless swiftshader can trip the app's performance auto-pause before we
// look, so assert icon/title CONSISTENCY and a clean flip, not a fixed boot
// state. Until the user first toggles, the title is the original static
// "Play/Pause (Space)" regardless of icon.
const PP = { pause: 'Pause', play_arrow: 'Play' }
const ppBefore = await ppIcon()
const titleBefore = await ppTitle()
if (titleBefore === 'Play/Pause (Space)' || PP[ppBefore] === titleBefore) ok(`play-pause boot title ok (${ppBefore}/${titleBefore})`)
else fail(`play-pause state inconsistent: icon=${ppBefore} title=${titleBefore}`)
await page.evaluate(() => document.getElementById('play-pause-btn').click())
await page.waitForTimeout(150)
const ppAfter = await ppIcon()
if (ppAfter !== ppBefore && PP[ppAfter] === (await ppTitle())) ok(`play-pause click flips (${ppBefore} -> ${ppAfter}, title follows)`)
else fail(`play-pause click state broken: ${ppBefore} -> ${ppAfter}/${await ppTitle()}`)

// undo/redo disabled pulls
const undoDisabled = () => page.evaluate(() => document.getElementById('undo-btn').disabled)
const redoDisabled = () => page.evaluate(() => document.getElementById('redo-btn').disabled)
const undoTip = await page.evaluate(() => document.getElementById('undo-btn').getAttribute('data-title'))
const redoTip = await page.evaluate(() => document.getElementById('redo-btn').getAttribute('data-title'))
if (undoTip === 'Undo (Cmd+Z)' && redoTip === 'Redo (Cmd+Shift+Z)') ok('undo/redo shortcut tooltips preserved')
else fail(`undo/redo tooltips: "${undoTip}" / "${redoTip}"`)

// make an edit to arm undo: type into the canvas editor and let hot reload checkpoint
const armed = await page.evaluate(async () => {
    const ed = document.getElementById('canvas-editor')
    if (!ed) return 'no editor'
    ed.value = (ed.value || '') + '\n// menu-bar verification edit'
    ed.dispatchEvent(new CustomEvent('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 2500))   // hot-reload debounce + compile
    return 'done'
})
if (armed !== 'done') fail(`could not arm undo history (${armed})`)
if (!await undoDisabled()) ok('undo-btn enabled after an edit (disabled fn pulls canUndo)')
else fail('undo-btn still disabled after edit')
await page.evaluate(() => document.getElementById('undo-btn').click())
await page.waitForTimeout(1500)
if (!await redoDisabled()) ok('redo-btn enabled after undo (state chain intact)')
else fail('redo-btn still disabled after undo')

// ---------------------------------------------------------------------------
// 5. Edit-in-X flows (network mocked, window.open stubbed)
// ---------------------------------------------------------------------------
console.log('Edit-in-X flows')
for (const [id, host] of [
    ['editInNoisedeckMenuItem', 'noisedeck.app'],
    ['editInNoodlesMenuItem', 'noodles'],
    ['editInPolymorphicMenuItem', 'polymorphic'],
    ['editInShadeMenuItem', 'shade'],
]) {
    await page.evaluate(() => { window.__openedUrls.length = 0 })
    await page.evaluate((itemId) => document.getElementById(itemId).click(), id)
    let opened = ''
    for (let i = 0; i < 40 && !opened; i++) {
        await page.waitForTimeout(500)
        opened = await page.evaluate(() => window.__openedUrls[0] || '')
    }
    if (opened.includes('code=TESTCODE') && opened.toLowerCase().includes(host)) ok(`${id} -> ${opened}`)
    else fail(`${id}: window.open got "${opened}"`)
}

// ---------------------------------------------------------------------------
// 6. Global keyboard shortcuts
// ---------------------------------------------------------------------------
console.log('Keyboard shortcuts')

// Space -> play/pause (was left paused=play_arrow? we clicked once above -> paused; Space resumes)
const beforeSpace = await ppIcon()
await page.keyboard.press(' ')
await page.waitForTimeout(150)
const afterSpace = await ppIcon()
if (beforeSpace !== afterSpace) ok(`Space toggles play/pause (${beforeSpace} -> ${afterSpace})`)
else fail('Space shortcut inert')

// F1 -> help modal
await page.keyboard.press('F1')
try {
    await page.waitForSelector('.help-modal, dialog[open]', { state: 'visible', timeout: 3000 })
    ok('F1 opens help modal')
} catch { fail('F1 help modal did not open') }
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// Cmd+P -> workspace files
await page.keyboard.press('Meta+p')
try {
    await page.waitForSelector('.workspace-files-dialog, .wf-dialog, dialog[open]', { state: 'visible', timeout: 3000 })
    ok('Cmd+P opens workspace files')
} catch { fail('Cmd+P did not open workspace files') }
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// Cmd+S -> auto-saved toast
await page.keyboard.press('Meta+s')
try {
    await page.waitForFunction(() => [...document.querySelectorAll('.toast, .toast-message')].some(t => /auto-saved/i.test(t.textContent)), { timeout: 3000 })
    ok('Cmd+S shows auto-saved toast')
} catch { fail('Cmd+S toast missing') }

// Cmd+Z / Shift+Cmd+Z drive the same undo/redo handlers
const undoStateBefore = await undoDisabled()
await page.keyboard.press('Meta+Shift+z')   // redo (armed above)
await page.waitForTimeout(1500)
await page.keyboard.press('Meta+z')          // undo again
await page.waitForTimeout(1500)
if (!await redoDisabled()) ok('Cmd+Z / Shift+Cmd+Z operate undo/redo history')
else fail(`keyboard undo/redo chain broken (undo-was-disabled=${undoStateBefore})`)

// ---------------------------------------------------------------------------
console.log(failures === 0 ? `\nPASS - all menu bar checks green` : `\n${failures} FAILURES`)
await browser.close()
process.exit(failures === 0 ? 0 : 1)
