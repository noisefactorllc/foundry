/**
 * Structural queries over a parsed Noisemaker DSL program.
 *
 * Reading values out of DSL *source* with regexes is a trap: the text
 * arguments alone can contain quotes, parens, and triple-quoted newlines, so
 * any pattern that stops at the first `)` or `"` silently reads the wrong
 * value — or none, falling back to a default. Parse once, then query the tree.
 *
 * These helpers are pure and take an already-parsed program, so they are unit
 * testable without the CDN bundle. Callers parse with `parse(lex(dsl))`.
 *
 * @module dslQuery
 */

/**
 * Whether a call's name refers to `target`, with or without its namespace.
 * `text` and `filter.text` both match a target of `text`.
 *
 * @param {*} callName
 * @param {string} target
 * @returns {boolean}
 */
function nameMatches(callName, target) {
    if (typeof callName !== 'string') return false
    return callName === target || callName.endsWith(`.${target}`)
}

/**
 * Find every call to `name` in a parsed program, in source order.
 *
 * Walks the whole tree rather than a known set of node types, so calls nested
 * in subchains, in later plans, or inside another call's arguments are all
 * found.
 *
 * @param {object} ast - Program returned by `parse(lex(dsl))`
 * @param {string} name - Effect name, with or without namespace
 * @returns {object[]} Matching Call nodes
 */
export function findCalls(ast, name) {
    const calls = []
    if (!ast || typeof ast !== 'object') return calls

    const seen = new Set()
    const walk = (node) => {
        if (!node || typeof node !== 'object' || seen.has(node)) return
        seen.add(node)

        if (Array.isArray(node)) {
            for (const item of node) walk(item)
            return
        }

        if (node.type === 'Call' && nameMatches(node.name, name)) calls.push(node)

        for (const [key, value] of Object.entries(node)) {
            if (key === 'loc') continue
            if (value && typeof value === 'object') walk(value)
        }
    }

    walk(ast)
    return calls
}

/**
 * Read a string argument off a call, trying each name in turn so callers can
 * accept a parameter's aliases.
 *
 * Only returns genuine string literals — a numeric or enum argument of the
 * same name reads as absent rather than being coerced.
 *
 * @param {object} call - A Call node
 * @param {...string} names - Argument names, most preferred first
 * @returns {string|undefined}
 */
export function stringArg(call, ...names) {
    for (const name of names) {
        const value = call?.kwargs?.[name]
        if (value && value.type === 'String' && typeof value.value === 'string') {
            return value.value
        }
    }
    return undefined
}
