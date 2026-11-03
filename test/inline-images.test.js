import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'

// The same public image helpers the browser loads. A local module can be supplied explicitly.
const sharingLoaderText = await readFile(new URL('../public/js/sharingLoader.js', import.meta.url), 'utf8')
const helperPin = sharingLoaderText.match(/^export const PORTABLE_IMAGES_URL = '(.+)'$/m)?.[1]
const tools = process.env.PORTABLE_IMAGES_MODULE
    ? await import(pathToFileURL(process.env.PORTABLE_IMAGES_MODULE).href)
    : await (async () => {
        const response = await fetch(helperPin)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const text = await response.text()
        if (!/\bexport\b/.test(text)) throw new Error('served helper is not a module')
        return import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`)
    })()
const { mayHaveInlineImages, takeInlineImages } = await import('../public/js/inlineImages.js')

/** A 2x2 PNG of one color and its SHA-256 id. */
function png(red, green, blue) {
    const chunk = (type, data) => {
        const body = Buffer.concat([Buffer.from(type), data])
        let crc = 0xffffffff
        for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
        const length = Buffer.alloc(4), checksum = Buffer.alloc(4)
        length.writeUInt32BE(data.length)
        checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
        return Buffer.concat([length, body, checksum])
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2
    const row = Buffer.from([0, red, green, blue, red, green, blue])
    const bytes = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.concat([row, row]))),
        chunk('IEND', Buffer.alloc(0)),
    ])
    return { bytes, id: createHash('sha256').update(bytes).digest('hex'), dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }
}

const RED = png(255, 0, 0)
const BLUE = png(0, 0, 255)

test('an inline image media URL is named by the SHA-256 of its bytes, which are kept as a Blob', { timeout: 30000 }, async () => {
    const dsl = `search synth\nmedia(url: "${RED.dataUrl}").write(o0)\nrender(o0)`
    assert.equal(mayHaveInlineImages(dsl), true)
    const stored = await takeInlineImages(dsl, tools)
    assert.equal(stored.dsl, `search synth\nmedia(url: "image:${RED.id}").write(o0)\nrender(o0)`)
    assert.equal(stored.images.length, 1)
    const [image] = stored.images
    assert.equal(image.id, RED.id)
    assert.ok(image.blob instanceof Blob)
    assert.equal(image.blob.type, 'image/png')
    assert.deepEqual(Buffer.from(await image.blob.arrayBuffer()), RED.bytes)
    assert.equal(Object.values(image).some(value => typeof value === 'string' && /base64|data:image/.test(value)), false)
})

test('the same inline image twice is one image, and other media URLs are left as they are', { timeout: 30000 }, async () => {
    const dsl = [
        'search synth, mixer',
        `media(url: "${RED.dataUrl}").write(o1)`,
        `media(url: "image:${BLUE.id}").write(o2)`,
        `media(url: "${RED.dataUrl}").write(o3)`,
        'render(o3)',
    ].join('\n')
    const stored = await takeInlineImages(dsl, tools)
    assert.equal(stored.dsl, [
        'search synth, mixer',
        `media(url: "image:${RED.id}").write(o1)`,
        `media(url: "image:${BLUE.id}").write(o2)`,
        `media(url: "image:${RED.id}").write(o3)`,
        'render(o3)',
    ].join('\n'))
    assert.deepEqual(stored.images.map(image => image.id), [RED.id])
})

test('a program without an inline image is returned unchanged', { timeout: 30000 }, async () => {
    const dsl = `search synth\nmedia(url: "image:${BLUE.id}").write(o0)\nrender(o0)`
    assert.equal(mayHaveInlineImages(dsl), false)
    assert.deepEqual(await takeInlineImages(dsl, tools), { dsl, images: [] })
})
