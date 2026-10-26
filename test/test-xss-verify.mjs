/**
 * End-to-end XSS hardening verification (headless).
 *
 * Boots the real app in Chromium (validating every module import resolves),
 * then drives the REAL ParamControls render path with malicious effect
 * parameter names/labels and confirms:
 *   - no <img> element is created (payload was escaped, not parsed as HTML)
 *   - the onerror sentinel never fires
 *
 * Requires the dev server running (PORT 3456 by default here).
 * Run: node test/test-xss-verify.mjs
 */
import { chromium } from 'playwright'

const URL = process.env.TEST_URL || 'http://127.0.0.1:3456'
let failures = 0
const fail = (m) => { console.error(`  FAIL - ${m}`); failures++ }
const ok = (m) => console.log(`  ok - ${m}`)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

const consoleErrors = []
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

console.log(`Loading app at ${URL} ...`)
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
// Give app init (manifest load, first compile) time to run.
await page.waitForTimeout(4000)

console.log('App boot')
// The app exposes the renderer once init() succeeds; use it as a readiness signal.
const booted = await page.evaluate(() => !!window.effectWorkspaceRenderer)
if (booted) ok('app initialized (window.effectWorkspaceRenderer present)')
else fail('app did not initialize - module graph may be broken')

// Fatal import/runtime errors during boot would indicate a broken edit.
const fatal = consoleErrors.filter(e =>
    /Failed to (fetch|resolve|load) module|is not defined|Cannot find module|SyntaxError|Unexpected/i.test(e))
if (fatal.length === 0) ok('no fatal module/runtime errors during boot')
else fail(`fatal errors during boot:\n    ${fatal.join('\n    ')}`)

console.log('ParamControls XSS (real render path, real DOM)')
const result = await page.evaluate(async () => {
    window.__xssFired = false
    // Global the payload will try to reach.
    window.__probe = () => { window.__xssFired = true }

    const mod = await import('/js/ui/param-controls.js')
    const ParamControls = mod.ParamControls

    const container = document.createElement('div')
    document.body.appendChild(container)
    const pc = new ParamControls(container, {})

    // (1) malicious LABEL
    pc.setEffect({
        globals: {
            scale: { type: 'float', default: 0.5, min: 0, max: 1, ui: { label: '<img src=x onerror="window.__probe()">' } }
        }
    })
    // (2) malicious NAME (attribute-breakout attempt) + checkbox + color types
    pc.setEffect({
        globals: {
            ['"><img src=y onerror="window.__probe()">']: { type: 'float', default: 0.5, min: 0, max: 1 },
            ['"><img src=z onerror="window.__probe()">_b']: { type: 'bool', default: true },
            ['"><img src=w onerror="window.__probe()">_c']: { type: 'vec3', default: [1, 0, 0] }
        }
    })

    // Allow any (broken) onerror handlers a chance to run.
    await new Promise(r => setTimeout(r, 250))

    return {
        xssFired: window.__xssFired,
        imgCount: container.querySelectorAll('img').length,
        scriptCount: container.querySelectorAll('script').length,
        sliderCount: container.querySelectorAll('input[type="range"]').length
    }
})

if (result.xssFired === false) ok('onerror sentinel never fired')
else fail('XSS sentinel FIRED - injection succeeded')

if (result.imgCount === 0) ok('no injected <img> elements (payload escaped)')
else fail(`${result.imgCount} injected <img> element(s) created`)

if (result.scriptCount === 0) ok('no injected <script> elements')
else fail(`${result.scriptCount} injected <script> element(s) created`)

if (result.sliderCount >= 1) ok('controls still render for benign/escaped params')
else fail('controls did not render (regression)')

console.log('Toast XSS (untrusted message, e.g. shared composition title)')
const toastResult = await page.evaluate(async () => {
    window.__toastXss = false
    window.__toastProbe = () => { window.__toastXss = true }
    const { toast } = await import('/js/ui/toast.js')
    toast.show('Loaded: <img src=x onerror="window.__toastProbe()">', 'info', 0)
    await new Promise(r => setTimeout(r, 250))
    const container = document.querySelector('.toast-container') || document.body
    return { xss: window.__toastXss, imgCount: container.querySelectorAll('.toast img').length }
})
if (toastResult.xss === false && toastResult.imgCount === 0) ok('toast escapes untrusted message')
else fail('toast XSS - injection succeeded')

console.log('ParamControls value-sync with crafted param name (CSS selector safety)')
const syncResult = await page.evaluate(async () => {
    const { ParamControls } = await import('/js/ui/param-controls.js')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const pc = new ParamControls(container, {})
    // A name with chars that would break an unescaped [data-param="..."] selector.
    const weird = 'a"b]c'
    pc.setEffect({ globals: { [weird]: { type: 'float', default: 0.1, min: 0, max: 1 } } })
    let threw = false
    try {
        pc._updateControlValue(weird, 0.7)
    } catch (e) {
        threw = true
    }
    const input = container.querySelector('input[type="range"]')
    return { threw, value: input ? input.value : null }
})
if (!syncResult.threw) ok('value-sync does not throw on crafted param name')
else fail('value-sync threw (querySelector built from unescaped name)')
if (syncResult.value === '0.7') ok('value-sync updated the control for crafted name')
else fail(`value-sync did not update control (value=${syncResult.value})`)

await browser.close()

console.log(failures === 0 ? '\nAll XSS verification checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
