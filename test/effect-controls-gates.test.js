/**
 * Tests for ui.enabledBy gates in the effect controls panel.
 *
 * A condition on a parameter that an oscillator, MIDI, audio or a variable
 * drives has no single value to test, so the gate stays open while the
 * source moves the parameter.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.HTMLElement ??= class {}
globalThis.customElements ??= { get: () => undefined, define: () => {} }
const { evaluateEnableCondition } = await import('../public/js/ui/effect-controls.js')

const lfo = { type: 'Oscillator', min: 1, max: 5 }
const knob = { type: 'Midi', channel: 1 }
const beat = { _ast: { type: 'Audio' } }
const bound = { _varRef: 'osc1', value: 0 }

test('literal values open and close a comparison gate', () => {
    const focal = { and: ['viewMode', { param: 'aperture', gt: 0 }] }
    assert.equal(evaluateEnableCondition(focal, { viewMode: 2, aperture: 1.5 }), true)
    assert.equal(evaluateEnableCondition(focal, { viewMode: 2, aperture: 0 }), false)
    assert.equal(evaluateEnableCondition(focal, { viewMode: 0, aperture: 1.5 }), false)
})

test('an automated driver keeps a gate open', () => {
    const focal = { and: ['viewMode', { param: 'aperture', gt: 0 }] }
    for (const aperture of [lfo, knob, beat, bound]) {
        assert.equal(evaluateEnableCondition(focal, { viewMode: 2, aperture }), true)
    }
    assert.equal(evaluateEnableCondition({ not: { param: 'a', eq: 1 } }, { a: lfo }), true)
    assert.equal(evaluateEnableCondition({ or: [{ param: 'a', eq: 1 }, { param: 'b', gt: 2 }] }, { a: 0, b: lfo }), true)
    assert.equal(evaluateEnableCondition('flag', { flag: bound }), true)
})

test('an automated driver does not open a gate another condition closes', () => {
    const refract = { and: [{ param: 'refractAAmt', gt: 0 }, { param: 'blendMode', neq: 100 }] }
    assert.equal(evaluateEnableCondition(refract, { refractAAmt: lfo, blendMode: 100 }), false)
    assert.equal(evaluateEnableCondition(refract, { refractAAmt: lfo, blendMode: 10 }), true)
    assert.equal(evaluateEnableCondition({ and: ['viewMode', { param: 'aperture', gt: 0 }] }, { viewMode: 0, aperture: lfo }), false)
})
