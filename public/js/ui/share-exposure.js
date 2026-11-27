/**
 * The sentence beside Share in the Share dialog: what anyone with the link
 * can open. It leaves out the original images or the custom shader code only
 * when the share does not carry them.
 *
 * @module ui/share-exposure
 */

/**
 * @param {{images?: boolean, shaders?: boolean}} [kinds] - What the share
 *     carries; both when nothing has been checked
 * @returns {string}
 */
export function shareExposureText({ images = true, shaders = true } = {}) {
    const carried = images && shaders ? ', including the original images and custom shader code it uses'
        : images ? ', including the original images it uses'
        : shaders ? ', including custom shader code it uses'
        : ''
    return `Anyone with the link can open the editable effect${carried}.`
}
