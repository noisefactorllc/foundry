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
    if (!Array.isArray(images)) return []
    // One record per id: the id is the SHA-256 of the bytes, so it is one image.
    const records = new Map()
    for (const image of images) {
        const record = imageFileRecord(image)
        if (record && !records.has(record.id)) records.set(record.id, record)
    }
    return [...records.values()]
}

/** The file earlier workspaces and exported ZIPs listed their images in, as base64 text. */
export const LEGACY_IMAGES_FILE = 'images.json'

/**
 * Read the images an earlier images.json file listed as base64 text into
 * Blob records. A file that holds no image list gives no images, logged.
 * @param {string} content - The file's JSON text
 * @returns {Array<object>}
 */
export function readLegacyImagesFile(content) {
    let images
    try {
        images = JSON.parse(content)
    } catch {
        images = null
    }
    if (!Array.isArray(images)) {
        console.warn(`${LEGACY_IMAGES_FILE} holds no image list; its images were left out`)
        return []
    }
    return imageFileRecords(images)
}

// Workspace ZIPs keep each image as a binary file, images/<id>.<ext>, relative
// to the effect's definition, in the layout Shade's ZIPs use.
const IMAGE_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
const IMAGE_FILE_PATH = /^images\/([a-f0-9]{64})\.([A-Za-z0-9]+)$/

/**
 * The path a workspace ZIP keeps an image record's bytes at: images/<id>.<ext>.
 * @param {{id: string, blob: Blob, mimeType?: string}} image
 * @returns {string}
 */
export function imageFilePath(image) {
    return `images/${image.id}.${IMAGE_EXTENSIONS[image.mimeType || image.blob?.type] || 'img'}`
}

/**
 * Whether a workspace ZIP path, relative to the effect's definition, names an image file.
 * @param {string} path
 * @returns {boolean}
 */
export function isImageFilePath(path) {
    return IMAGE_FILE_PATH.test(path)
}

/**
 * An image file from a workspace ZIP as a Blob record, checked against the
 * SHA-256 id its path names. A file that does not match is left out and logged.
 * @param {string} path - images/<id>.<ext>
 * @param {Uint8Array} bytes - The file's bytes
 * @returns {Promise<object|null>}
 */
export async function readImageFile(path, bytes) {
    const match = IMAGE_FILE_PATH.exec(path)
    if (!match) return null
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
    if (digest !== match[1]) {
        console.warn(`Image file ${path} was left out: its bytes do not match its id`)
        return null
    }
    const mimeType = IMAGE_TYPES[match[2].toLowerCase()] || ''
    return { id: match[1], blob: new Blob([bytes], { type: mimeType }), mimeType }
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
