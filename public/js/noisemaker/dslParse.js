/**
 * Parse DSL source into a program tree.
 *
 * Separate from dslQuery.js so the query helpers stay free of the CDN bundle
 * and can be unit tested directly.
 *
 * This is the syntax parser, not the compiler: it does not validate arguments
 * against effect definitions. That matters for arguments the engine rejects
 * but the app still owns (media's `url`), and it means a program referencing
 * effects that are not loaded yet still parses.
 *
 * @module dslParse
 */

import { lex, parse } from './bundle.js'

/**
 * @param {string} dsl - DSL source code
 * @returns {object|null} Parsed program, or null if it does not parse
 */
export function parseDsl(dsl) {
    if (!dsl || typeof dsl !== 'string') return null
    try {
        return parse(lex(dsl))
    } catch {
        // Callers run against editor content that is routinely mid-edit and
        // therefore transiently unparseable. Nothing to read from it.
        return null
    }
}
