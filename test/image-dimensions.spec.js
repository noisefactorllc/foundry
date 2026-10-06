import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

test('original image dimensions survive ProgramState controls and DSL regeneration', { timeout: 60000 }, async () => {
    const root = fileURLToPath(new URL('../public/', import.meta.url))
    const helper = process.env.PORTABLE_IMAGES_MODULE || fileURLToPath(new URL('../../sharing/public/js/portableImages.js', import.meta.url))
    const server = createServer(async (request, response) => {
        const path = new URL(request.url, 'http://localhost').pathname
        if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><body></body>'); return }
        const file = resolve(root, '.' + path)
        if (!file.startsWith(root)) { response.writeHead(403); response.end(); return }
        try {
            response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : 'application/octet-stream')
            response.end(await readFile(file))
        } catch { response.writeHead(404); response.end() }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        browser = await chromium.launch({ headless: true, args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader'] })
        const page = await browser.newPage()
        await page.route('https://sharing.noisedeck.app/js/portableImages.js*', route => route.fulfill({
            contentType: 'text/javascript', path: helper, headers: { 'Access-Control-Allow-Origin': '*' },
        }))
        await page.goto(`http://127.0.0.1:${server.address().port}`)
        const result = await page.evaluate(async () => {
            const { ShadeRenderer } = await import('/js/noisemaker/renderer.js')
            const { PORTABLE_IMAGES_URL } = await import('/js/sharingLoader.js')
            const tools = await import(PORTABLE_IMAGES_URL)
            const images = []
            for (const [width, height, color] of [[96, 32, '#ff0000'], [24, 80, '#00ff00']]) {
                const source = document.createElement('canvas'); source.width = width; source.height = height
                const context = source.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, width, height)
                const blob = await new Promise(resolve => source.toBlob(resolve))
                // The first image arrives as an earlier base64 record, the second as a Blob record.
                images.push(images.length ? await tools.prepareImageFile(blob) : await tools.prepareImage(blob))
            }
            const canvas = document.createElement('canvas')
            const wrapper = new ShadeRenderer(canvas, { width: 128, height: 128, preferWebGPU: false })
            wrapper.images = images
            const held = wrapper.images.map(image => ({ id: image.id, blob: image.blob instanceof Blob, dataUrl: 'dataUrl' in image, type: image.blob?.type }))
            const dsl = `search synth\nmedia(url:"image:${images[0].id}").write(o0)\nmedia(url:"image:${images[1].id}").write(o1)\nrender(o0)`
            const loaded = await wrapper.compile(dsl)
            if (!loaded.success) throw new Error(loaded.error)
            const engine = wrapper._renderer
            engine.stop()
            const dimensions = () => engine.pipeline.graph.passes.filter(pass => pass.effectKey === 'synth.media').map(pass => [...pass.uniforms.imageSize])
            const before = dimensions()
            wrapper.programState.setValue('step_0', 'offsetX', 1)
            wrapper.programState.setValue('step_2', 'scaleAmt', 120)
            engine.render(0)
            const gl = canvas.getContext('webgl2'), pixel = new Uint8Array(4)
            gl.readPixels(64, 64, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
            const result = { before, after: dimensions(), pixel: [...pixel], dsl: wrapper.programState.toDsl(), ids: images.map(image => image.id), held, url: PORTABLE_IMAGES_URL }
            wrapper.dispose?.()
            return result
        })
        assert.equal(result.url, 'https://sharing.noisedeck.app/js/portableImages.js?v=images-20261006')
        // The renderer holds both images as Blob records, the earlier base64 one read into a Blob.
        assert.deepEqual(result.held, result.ids.map(id => ({ id, blob: true, dataUrl: false, type: 'image/png' })))
        assert.deepEqual(result.before, [[96, 32], [24, 80]])
        assert.deepEqual(result.after, [[96, 32], [24, 80]])
        assert.deepEqual(result.pixel, [255, 0, 0, 255])
        for (const id of result.ids) assert.ok(result.dsl.includes(`image:${id}`), 'controls retain each original image reference')
    } finally {
        await browser?.close()
        await new Promise(resolve => server.close(resolve))
    }
})
