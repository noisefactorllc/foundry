/**
 * Tests for the build-time input validation in scripts/fetch-noisemaker.cjs.
 *
 * The fetch script reads a pin file (version + baseUrl) and a remote manifest
 * (effect ids), then uses those values to build BOTH download URLs and local
 * file paths. Without validation, a hostile pin file or manifest could cause
 * path traversal (write outside the vendor dir) or SSRF (fetch internal hosts).
 *
 * Run: node test/test-fetch-noisemaker.mjs
 */
import assert from 'node:assert/strict'

const mod = await import('../scripts/fetch-noisemaker.cjs')
const { validateVersion, validateBaseUrl, validateEffectId } = mod.default || mod

let passed = 0
function check(name, fn) {
    try { fn(); passed++; console.log(`  ok - ${name}`) }
    catch (e) { console.error(`  FAIL - ${name}\n    ${e.message}`); process.exitCode = 1 }
}
const rejects = (fn) => assert.throws(fn)
const accepts = (fn) => assert.doesNotThrow(fn)

console.log('validateVersion')
check('accepts the real pinned version "1"', () => accepts(() => validateVersion('1')))
check('accepts a semver-ish version', () => accepts(() => validateVersion('1.0.60')))
check('rejects path traversal', () => rejects(() => validateVersion('../etc')))
check('rejects ".."', () => rejects(() => validateVersion('..')))
check('rejects slashes', () => rejects(() => validateVersion('a/b')))
check('rejects empty / non-string', () => { rejects(() => validateVersion('')); rejects(() => validateVersion(null)) })

console.log('validateBaseUrl')
check('accepts the real baseUrl', () => accepts(() => validateBaseUrl('https://shaders.noisedeck.app')))
check('rejects non-TLS http', () => rejects(() => validateBaseUrl('http://shaders.noisedeck.app')))
check('rejects localhost (SSRF)', () => rejects(() => validateBaseUrl('https://localhost')))
check('rejects loopback/link-local IP (SSRF)', () => {
    rejects(() => validateBaseUrl('https://127.0.0.1'))
    rejects(() => validateBaseUrl('https://169.254.169.254'))
})
check('rejects embedded credentials', () => rejects(() => validateBaseUrl('https://user:pass@evil.example')))
check('rejects garbage', () => rejects(() => validateBaseUrl('not a url')))

console.log('validateEffectId')
check('accepts namespace/name', () => accepts(() => validateEffectId('synth/noise')))
check('accepts a simple name', () => accepts(() => validateEffectId('noise')))
check('rejects path traversal', () => rejects(() => validateEffectId('../../etc/passwd')))
check('rejects a dotdot segment', () => rejects(() => validateEffectId('a/../b')))
check('rejects leading slash (absolute)', () => rejects(() => validateEffectId('/abs')))
check('rejects backslash', () => rejects(() => validateEffectId('a\\b')))

console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures)' : ''}`)
