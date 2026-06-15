/**
 * Tests for HTML escaping of untrusted content rendered into innerHTML.
 *
 * Covers:
 *  - the shared escapeHtml() utility (public/js/utils/html.js)
 *  - ParamControls control builders, which interpolate effect-provided
 *    parameter names/labels (untrusted: from imported ZIPs / shared
 *    compositions) into innerHTML.
 *
 * Run: node test-escape-html.mjs
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

// --- escapeHtml utility -----------------------------------------------------
const { escapeHtml } = await import('./public/js/utils/html.js')

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

// --- ParamControls builders -------------------------------------------------
const { ParamControls } = await import('./public/js/ui/param-controls.js')

console.log('ParamControls control builders')

// A container stub is enough; the builders under test return HTML strings and
// only use pure helpers (_formatValue, _vec4ToHex).
const pc = new ParamControls({}, {})

const XSS = '"><img src=x onerror=alert(1)>'

check('_createSlider escapes malicious name and label', () => {
    const html = pc._createSlider(XSS, XSS, { min: 0, max: 1, type: 'float' }, 0.5)
    assert.ok(!html.includes('<img'), 'no raw <img element may appear')
    assert.ok(html.includes('&lt;img'), 'payload must be HTML-escaped, not dropped')
})

check('_createCheckbox escapes malicious name and label', () => {
    const html = pc._createCheckbox(XSS, XSS, false)
    assert.ok(!html.includes('<img'), 'no raw <img element may appear')
    assert.ok(html.includes('&lt;img'), 'payload must be HTML-escaped, not dropped')
})

check('_createColorPicker escapes malicious name and label', () => {
    const html = pc._createColorPicker(XSS, XSS, [1, 1, 1])
    assert.ok(!html.includes('<img'), 'no raw <img element may appear')
    assert.ok(html.includes('&lt;img'), 'payload must be HTML-escaped, not dropped')
})

check('_createSlider preserves benign output structure', () => {
    const html = pc._createSlider('scale', 'Scale', { min: 0, max: 10, type: 'float' }, 2)
    assert.ok(html.includes('data-param="scale"'), 'data-param attribute present')
    assert.ok(html.includes('type="range"'), 'range input present')
    assert.ok(html.includes('>Scale<'), 'label text present')
})

console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures)' : ''}`)
