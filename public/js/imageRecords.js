/**
 * Image records for the images a program names as `image:<id>`.
 *
 * A record holds the image's bytes as a Blob: `{ id, blob, mimeType, width,
 * height }`, where the id is the SHA-256 of the bytes. Workspaces saved and
 * shares made before images were files carry `{ id, dataUrl }` records with
 * a base64 data URL instead; those are read into Blob records as they are
 * loaded, and no record is written back as text.
 *
 * @module imageRecords
 */

// The image types sharing carries, as an earlier record's base64 data URL.
const LEGACY_IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/

/** Decode an earlier record's base64 image bytes into a Blob. */
function legacyImageBlob(dataUrl) {
    const match = LEGACY_IMAGE_DATA_URL.exec(dataUrl)
    if (!match) throw new Error('not a base64 PNG, JPEG, GIF or WebP data URL')
    const raw = atob(match[2])
    const bytes = new Uint8Array(raw.length)
    for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index)
    return new Blob([bytes], { type: match[1] })
}

/**
 * An image record that holds its bytes as a Blob. An earlier `{ id, dataUrl }`
 * record is decoded into one; an earlier record whose data URL cannot be
 * decoded is left out (null) and logged, so no image is kept as text. Any
 * other record is returned as it is.
 * @param {object} image
 * @returns {object|null}
 */
export function imageFileRecord(image) {
    if (image?.blob instanceof Blob || typeof image?.dataUrl !== 'string') return image ?? null
    const { dataUrl, ...record } = image
    try {
        const blob = legacyImageBlob(dataUrl)
        return { ...record, blob, mimeType: blob.type }
    } catch (error) {
        console.warn(`Image ${image.id} was not loaded:`, error)
        return null
    }
}

/**
 * imageFileRecord for every image in a list, leaving out the ones that
 * cannot be read.
 * @param {Array<object>} [images]
 * @returns {Array<object>}
 */
export function imageFileRecords(images) {
    return Array.isArray(images) ? images.map(imageFileRecord).filter(Boolean) : []
}

/**
 * Whether two image lists name the same images with the same bytes, in order.
 * @param {Array<object>} a
 * @param {Array<object>} b
 * @returns {boolean}
 */
export function sameImages(a, b) {
    return a.length === b.length && a.every((image, index) => image === b[index] || (image.id === b[index].id && image.blob === b[index].blob))
}
