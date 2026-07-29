/**
 * Tests for structural DSL queries.
 *
 * PROGRAM below is verbatim `parse(lex(dsl))` output from the Noisemaker
 * parser for this source:
 *
 *   search synth, filter
 *
 *   solid(alpha: 0)
 *     .subchain(name: "grp", id: "abc") {
 *       .text(text: "in sub :) ok", font: "Inter")
 *     }
 *     .write(o0)
 *
 *   media(url: "https://x/File_(1).png?a=1&b=2")
 *     .text(text: """multi\nline""", font: "Monaspace")
 *     .write(o1)
 *
 *   render(o1)
 *
 * It exercises the three things source-level regexes get wrong: a call nested
 * in a subchain, a second plan, and arguments containing the very characters
 * the regexes used as delimiters.
 *
 * Run: npm test
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { findCalls, stringArg } from '../public/js/noisemaker/dslQuery.js'

const PROGRAM = {
    type: 'Program',
    plans: [
        {
            chain: [
                { type: 'Call', name: 'solid', args: [], kwargs: { alpha: { type: 'Number', value: 0 } } },
                {
                    type: 'Subchain',
                    name: 'grp',
                    id: 'abc',
                    body: [
                        {
                            type: 'Call',
                            name: 'text',
                            args: [],
                            kwargs: {
                                text: { type: 'String', value: 'in sub :) ok' },
                                font: { type: 'String', value: 'Inter' }
                            }
                        }
                    ],
                    loc: { line: 4, col: 4 }
                },
                { type: 'Write', surface: { type: 'OutputRef', name: 'o0' }, loc: { line: 7, col: 4 } }
            ],
            write: { type: 'OutputRef', name: 'o0' },
            write3d: null
        },
        {
            chain: [
                {
                    type: 'Call',
                    name: 'media',
                    args: [],
                    kwargs: { url: { type: 'String', value: 'https://x/File_(1).png?a=1&b=2' } }
                },
                {
                    type: 'Call',
                    name: 'text',
                    args: [],
                    kwargs: {
                        text: { type: 'String', value: 'multi\nline' },
                        font: { type: 'String', value: 'Monaspace' }
                    }
                },
                { type: 'Write', surface: { type: 'OutputRef', name: 'o1' }, loc: { line: 10, col: 4 } }
            ],
            write: { type: 'OutputRef', name: 'o1' },
            write3d: null
        }
    ],
    render: { type: 'OutputRef', name: 'o1' }
}

test('finds calls nested in a subchain', () => {
    const calls = findCalls(PROGRAM, 'text')
    assert.equal(calls.length, 2)
    assert.equal(stringArg(calls[0], 'text'), 'in sub :) ok')
})

test('finds calls across every plan, in source order', () => {
    const fonts = findCalls(PROGRAM, 'text').map(c => stringArg(c, 'font'))
    assert.deepEqual(fonts, ['Inter', 'Monaspace'])
})

test('a multi-line triple-quoted argument reads back verbatim', () => {
    const [, second] = findCalls(PROGRAM, 'text')
    assert.equal(stringArg(second, 'text'), 'multi\nline')
})

test('a url containing parens and a query string is not truncated', () => {
    const [media] = findCalls(PROGRAM, 'media')
    assert.equal(stringArg(media, 'url'), 'https://x/File_(1).png?a=1&b=2')
})

test('an argument value containing a close paren is not truncated', () => {
    const [first] = findCalls(PROGRAM, 'text')
    assert.equal(stringArg(first, 'text'), 'in sub :) ok')
    // The old `\.?text\s*\([^)]*\)` chunker stopped at the ) inside the text,
    // which put `font:` outside the chunk and lost the font entirely.
    assert.equal(stringArg(first, 'font'), 'Inter')
})

test('matches a name with or without its namespace', () => {
    const ast = { plans: [{ chain: [{ type: 'Call', name: 'filter.text', kwargs: { font: { type: 'String', value: 'X' } } }] }] }
    assert.equal(findCalls(ast, 'text').length, 1)
    assert.equal(findCalls(ast, 'filter.text').length, 1)
})

test('does not match effects whose names merely contain the target', () => {
    const ast = { plans: [{ chain: [
        { type: 'Call', name: 'testPattern', kwargs: {} },
        { type: 'Call', name: 'synth.testPattern', kwargs: {} },
        { type: 'Call', name: 'glyphMap', kwargs: {} }
    ] }] }
    assert.deepEqual(findCalls(ast, 'text'), [])
})

test('finds a call nested inside another call argument', () => {
    const ast = { plans: [{ chain: [
        { type: 'Call', name: 'blend', kwargs: { tex: { type: 'Call', name: 'media', kwargs: { url: { type: 'String', value: 'u' } } } } }
    ] }] }
    assert.equal(stringArg(findCalls(ast, 'media')[0], 'url'), 'u')
})

test('non-string arguments read as absent rather than being coerced', () => {
    const [call] = findCalls(PROGRAM, 'solid')
    assert.equal(stringArg(call, 'alpha'), undefined)
})

test('stringArg falls through a list of aliases', () => {
    const call = { type: 'Call', name: 'x', kwargs: { bgColor: { type: 'String', value: '#111111' } } }
    assert.equal(stringArg(call, 'matteColor', 'bgColor'), '#111111')
    assert.equal(stringArg(call, 'missing'), undefined)
})

test('a missing argument reads as undefined', () => {
    const [first] = findCalls(PROGRAM, 'text')
    assert.equal(stringArg(first, 'size'), undefined)
})

test('malformed input does not throw', () => {
    assert.deepEqual(findCalls(null, 'text'), [])
    assert.deepEqual(findCalls(undefined, 'text'), [])
    assert.deepEqual(findCalls({}, 'text'), [])
    assert.deepEqual(findCalls('not an ast', 'text'), [])
    assert.equal(stringArg(null, 'font'), undefined)
    assert.equal(stringArg({}, 'font'), undefined)
})

test('a cyclic tree terminates', () => {
    const node = { type: 'Call', name: 'text', kwargs: {} }
    node.self = node
    assert.equal(findCalls({ plans: [{ chain: [node] }] }, 'text').length, 1)
})
