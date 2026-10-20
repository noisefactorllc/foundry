import test from 'node:test'
import assert from 'node:assert/strict'
import { SCHEMAS, validate } from '../public/js/agent/schemas.js'
import { REMOTE, catalog, imageResult } from '../public/js/agent/transports.js'
import { renderLlmsFull } from '../scripts/build-llms-full.mjs'
import { readFile } from 'node:fs/promises'

test('renderAt accepts only finite normalized time', () => {
    assert.ok(SCHEMAS.renderAt)
    for (const time of [0, 0.25, 1]) assert.equal(validate({ time }, SCHEMAS.renderAt).ok, true)
    for (const time of [-0.01, 1.01, NaN, Infinity, -Infinity, '0.5']) assert.equal(validate({ time }, SCHEMAS.renderAt).ok, false)
    assert.equal(validate({}, SCHEMAS.renderAt).ok, false)
})
test('setLoopDuration accepts finite positive seconds, including fractions', () => {
    assert.ok(SCHEMAS.setLoopDuration)
    for (const seconds of [0.1, 2.5, 10]) assert.equal(validate({ seconds }, SCHEMAS.setLoopDuration).ok, true)
    for (const seconds of [0, -1, NaN, Infinity, '10']) assert.equal(validate({ seconds }, SCHEMAS.setLoopDuration).ok, false)
    assert.match(validate({ seconds: 0 }, SCHEMAS.setLoopDuration).message, /greater than 0/)
})
test('shader inputs name exactly one source or path and writes are explicit', () => {
    for (const command of ['checkShader', 'bundleShader']) {
        const schema = SCHEMAS[command]
        assert.ok(schema)
        assert.equal(validate({ source: '', language: 'glsl' }, schema).ok, true)
        assert.equal(validate({ path: 'wgsl/fx.wgsl' }, schema).ok, true)
        assert.equal(validate({}, schema).ok, false)
        assert.equal(validate({ source: 'x', path: 'glsl/fx.glsl' }, schema).ok, false)
        assert.equal(validate({ path: 'x', force: true }, schema).ok, false)
    }
    assert.equal(SCHEMAS.bundleShader.properties.write.default, false)
})
test('the session catalog includes playback, backend and shader commands', () => {
    for (const name of ['renderAt', 'setLoopDuration', 'setBackend', 'checkShader', 'bundleShader']) assert.equal(REMOTE.has(name), true, name)
    const commands = Object.fromEntries(catalog().map(entry => [entry.name, entry]))
    assert.equal(commands.checkShader.readOnly, true)
    assert.equal(commands.bundleShader.readOnly, false)
})
test('the approved craft/video guide and generated command reference are current', async () => {
    const guide = await readFile(new URL('../public/llms.txt', import.meta.url), 'utf8')
    assert.match(guide, /## Shader craft/)
    assert.ok(guide.includes('https://noisemaker.app/llms-full.txt#portable-effect-authoring'))
    assert.match(guide, /## Recreate a reference video/)
    const full = await readFile(new URL('../public/llms-full.txt', import.meta.url), 'utf8')
    assert.equal(full, await renderLlmsFull())
    for (const name of ['renderAt', 'setLoopDuration', 'checkShader', 'bundleShader']) assert.ok(full.includes(`#### \`${name}\``))
})

test('renderAt exposes image content separately while retaining time and playback metadata', () => {
    const { envelope, image } = imageResult({ command: 'renderAt', ok: true, result: {
        time: 0.25, playing: false, bytes: 'AQID', mimeType: 'image/png', width: 1, height: 1,
    } })
    assert.equal(envelope.result.bytes, undefined)
    assert.equal(envelope.result.time, 0.25)
    assert.equal(envelope.result.playing, false)
    assert.deepEqual(image, { type: 'image', data: 'AQID', mimeType: 'image/png' })
})
