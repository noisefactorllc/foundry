/**
 * HTML escaping utilities
 *
 * Shared helper for safely interpolating untrusted strings (effect names,
 * parameter labels, shared-composition titles, imported file paths, etc.)
 * into HTML template strings before assigning to innerHTML.
 *
 * @module utils/html
 */

/**
 * Escape a value for safe inclusion in HTML text content OR inside a
 * double/single-quoted attribute value.
 *
 * Escapes the five characters that can break out of HTML/attribute context:
 * `&`, `<`, `>`, `"`, `'`. `&` is escaped first so existing entities in the
 * input are not double-decoded by the browser. Non-string values are coerced
 * to a string; `null`/`undefined` become an empty string.
 *
 * @param {*} value - Value to escape
 * @returns {string} Escaped string safe for innerHTML / quoted attributes
 */
export function escapeHtml(value) {
    if (value === null || value === undefined) return ''
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}
