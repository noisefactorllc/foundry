/**
 * Images a program carries inline.
 *
 * A program can name an image inline, as a `data:image/...;base64,...` media
 * URL, when someone pastes one or opens an earlier program. Saved state keeps
 * no image as text: it names the image as `image:<sha256>`, and the image's
 * bytes are a Blob record among the program's images, which the workspace
 * keeps in IndexedDB.
 *
 * @module inlineImages
 */

/**
 * Whether a program may carry an inline image: a quick test before it is parsed.
 * @param {string} dsl
 * @returns {boolean}
 */
export function mayHaveInlineImages(dsl) {
    return typeof dsl === 'string' && dsl.includes('data:image/')
}

/**
 * The program with each inline image media URL replaced by `image:<sha256>`,
 * and a Blob record for each of those images.
 * @param {string} dsl
 * @param {object} tools - The sharing image helpers (see loadImageTools)
 * @returns {Promise<{dsl: string, images: Array<object>}>}
 */
export async function takeInlineImages(dsl, tools) {
    if (!mayHaveInlineImages(dsl)) return { dsl, images: [] }
    const ids = new Map(), images = new Map()
    for (const { url, mediaIndex } of tools.getMediaSources(dsl)) {
        if (!url?.startsWith('data:image/')) continue
        const image = await tools.prepareImageFile(tools.imageToBlob({ dataUrl: url }))
        ids.set(mediaIndex, `image:${image.id}`)
        if (!images.has(image.id)) images.set(image.id, image)
    }
    if (!ids.size) return { dsl, images: [] }
    return {
        dsl: tools.replaceMediaUrls(dsl, (url, index) => ids.get(index) ?? url),
        images: [...images.values()]
    }
}
