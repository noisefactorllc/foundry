/**
 * Tests for safe rendering of untrusted parameter names and labels.
 *
 * Covers:
 *  - the shared escapeHtml() utility (public/js/utils/html.js)
 *  - EffectControls DOM builders with effect-provided parameter names and
 *    labels (untrusted: from imported ZIPs / shared compositions).
 *
 * Requires Playwright Chromium (node node_modules/playwright/cli.js install chromium).
 * Run: node test/test-escape-html.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

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

// --- escapeHtml utility -----------------------------------------------------
const { escapeHtml } = await import('../public/js/utils/html.js')

console.log('escapeHtml()')

check('escapes angle brackets (script tags)', () => {
    assert.equal(
        escapeHtml('<script>alert(1)</script>'),
        '&lt;script&gt;alert(1)&lt;/script&gt;'
    )
})

check('escapes ampersand first (no double-encoding)', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b')
    assert.equal(escapeHtml('<'), '&lt;')
    // & must be escaped before < so "&lt;" in input stays literal
    assert.equal(escapeHtml('&lt;'), '&amp;lt;')
})

check('escapes double quotes (safe inside double-quoted attributes)', () => {
    assert.equal(escapeHtml('he said "hi"'), 'he said &quot;hi&quot;')
})

check('escapes single quotes', () => {
    assert.equal(escapeHtml("it's"), 'it&#39;s')
})

check('returns empty string for null / undefined', () => {
    assert.equal(escapeHtml(null), '')
    assert.equal(escapeHtml(undefined), '')
})

check('coerces non-string values to string', () => {
    assert.equal(escapeHtml(42), '42')
    assert.equal(escapeHtml(0), '0')
    assert.equal(escapeHtml(false), 'false')
})

check('leaves benign text unchanged', () => {
    assert.equal(escapeHtml('scale'), 'scale')
    assert.equal(escapeHtml('Plasma Wave'), 'Plasma Wave')
})

// --- EffectControls builders in a real DOM ----------------------------------
const browser = await chromium.launch({ headless: true })
try {
    const page = await browser.newPage()
    await page.addScriptTag({
        type: 'module',
        content: readFileSync(new URL('../public/js/ui/effect-controls.js', import.meta.url), 'utf8'),
    })
    const XSS = '\"><img src=x onerror=alert(1)>'
    console.log('EffectControls DOM builders')
    for (const [name, spec, tag] of [
        ['slider', { type: 'float', min: 0, max: 1, default: 0.5 }, 'SLIDER-VALUE'],
        ['checkbox', { type: 'boolean', default: false }, 'TOGGLE-SWITCH'],
        ['color picker', { type: 'vec3', default: [1, 1, 1], ui: { control: 'color' } }, 'COLOR-PICKER'],
    ]) {
        const result = await page.evaluate(({ payload, spec }) => {
            const panel = document.createElement('effect-controls')
            const group = panel._buildControlGroup(payload, {
                ...spec, ui: { ...spec.ui, label: payload },
            })
            return {
                html: group.outerHTML,
                images: group.querySelectorAll('img').length,
                label: group.querySelector('.ec-control-label').textContent,
                parameter: group.dataset.paramKey,
                control: group.lastElementChild.tagName,
            }
        }, { payload: XSS, spec })
        check(`${name} preserves malicious names and labels as text`, () => {
            assert.equal(result.images, 0)
            assert.ok(!result.html.includes('<img'), 'no raw img element may appear')
            assert.ok(result.html.includes('&lt;img'), 'payload must be escaped, not dropped')
            assert.equal(result.label, XSS)
            assert.equal(result.parameter, XSS)
            assert.equal(result.control, tag)
        })
    }
    const benign = await page.evaluate(() => {
        const panel = document.createElement('effect-controls')
        const group = panel._buildControlGroup('scale', {
            type: 'float', min: 0, max: 10, default: 2, ui: { label: 'Scale' },
        })
        const slider = group.querySelector('slider-value')
        return { parameter: group.dataset.paramKey, label: group.querySelector('.ec-control-label').textContent,
            min: slider.min, max: slider.max, value: slider.value }
    })
    check('slider preserves benign labels and values', () => {
        assert.deepEqual(benign, { parameter: 'scale', label: 'Scale', min: 0, max: 10, value: 2 })
    })
} finally {
    await browser.close()
}

console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures)' : ''}`)
