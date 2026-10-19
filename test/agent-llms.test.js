// Guards the agent contract: every command is described, llms-full.txt is
// current, and llms.txt lists every error code the agent API returns.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { COMMAND_GROUPS } from '../public/js/agent/descriptions.js'
import { SCHEMAS, validate } from '../public/js/agent/schemas.js'
import { LLMS_PATH, LLMS_FULL_PATH, renderLlmsFull } from '../scripts/build-llms-full.mjs'

const AGENT_DIR = new URL('../public/js/agent/', import.meta.url)
const described = () => COMMAND_GROUPS.flatMap(group => Object.keys(group.commands))

test('every command has exactly one description and one schema entry', () => {
    const names = described()
    assert.deepEqual(names.filter((name, i) => names.indexOf(name) !== i), [], 'a command is described twice')
    assert.deepEqual([...names].sort(), Object.keys(SCHEMAS).sort())
})

test('every command has a handler in commands.js', async () => {
    const source = await readFile(new URL('commands.js', AGENT_DIR), 'utf8')
    const handlers = new Set([...source.matchAll(/^export (?:async )?function (\w+)/gm)].map(m => m[1]))
    assert.deepEqual(Object.keys(SCHEMAS).filter(name => !handlers.has(name)), [])
})

test('public/llms-full.txt matches a fresh render (run node scripts/build-llms-full.mjs)', async () => {
    assert.equal(await readFile(LLMS_FULL_PATH, 'utf8'), await renderLlmsFull())
})

test('llms.txt lists every error code that the agent API returns', async () => {
    const codes = new Set()
    for (const name of await readdir(AGENT_DIR)) {
        if (!name.endsWith('.js')) continue
        const source = await readFile(new URL(name, AGENT_DIR), 'utf8')
        // commandError('X', ...), fail('X', ...), makeFailure(name, 'X', ...)
        const pattern = /(?:commandError|fail)\(\s*'([A-Z][A-Z_]+)'|makeFailure\(\w+,\s*'([A-Z][A-Z_]+)'/g
        for (const m of source.matchAll(pattern)) codes.add(m[1] || m[2])
    }
    for (const code of ['INVALID_PROGRAM', 'INVALID_ARGS_UNKNOWN', 'INTERNAL_ERROR']) {
        assert.ok(codes.has(code), `the code scan no longer finds ${code}`)
    }
    const llms = await readFile(LLMS_PATH, 'utf8')
    assert.deepEqual([...codes].filter(code => !llms.includes(`| \`${code}\` |`)).sort(), [])
    // And the reverse: the table lists no code that the API no longer returns.
    const listed = [...llms.matchAll(/^\| `([A-Z][A-Z_]+)` \|/gm)].map(m => m[1])
    assert.deepEqual(listed.filter(code => !codes.has(code)).sort(), [])
})

test('a command with no arguments accepts only an empty object', () => {
    for (const [name, schema] of Object.entries(SCHEMAS)) {
        if (Object.keys(schema.properties).length) continue
        assert.equal(validate({}, schema).ok, true, name)
        assert.equal(validate({ force: true }, schema).code, 'INVALID_ARGS_UNKNOWN', name)
        assert.equal(validate('x', schema).code, 'INVALID_ARGS_TYPE', name)
    }
})

test('documented defaults match the handler defaults', async () => {
    const source = await readFile(new URL('commands.js', AGENT_DIR), 'utf8')
    for (const [name, schema] of Object.entries(SCHEMAS)) {
        for (const [field, spec] of Object.entries(schema.properties)) {
            if (spec.default === undefined) continue
            const literal = typeof spec.default === 'string' ? `'${spec.default}'` : String(spec.default)
            const signature = new RegExp(`export async function ${name}\\(\\{[^)]*\\b${field} = ${literal}[,\\s}]`)
            assert.match(source, signature, `${name}.${field} default ${literal}`)
        }
    }
})

test('schemas reject undeclared fields and accept declared ones', () => {
    assert.equal(validate({ dsl: 'x' }, SCHEMAS.setProgram).ok, true)
    assert.equal(validate({ dsl: 'x', force: true }, SCHEMAS.setProgram).code, 'INVALID_ARGS_UNKNOWN')
    assert.equal(validate({}, SCHEMAS.setProgram).code, 'INVALID_ARGS_REQUIRED')
    assert.equal(validate({ maxDimension: 2048 }, SCHEMAS.getThumbnail).code, 'INVALID_ARGS_RANGE')
    assert.equal(validate({ format: 'gif' }, SCHEMAS.getThumbnail).code, 'INVALID_ARGS_ENUM')
    assert.equal(validate({ dsl: 'x', effect: { func: 'fx', shaders: {} } }, SCHEMAS.setProgram).ok, true)
    assert.equal(validate({ dsl: 'x', effect: 'fx' }, SCHEMAS.setProgram).code, 'INVALID_ARGS_TYPE')
    assert.equal(validate({ backend: 'webgl' }, SCHEMAS.setBackend).code, 'INVALID_ARGS_ENUM')
})

test('the relay is the shared Seance relay, byte for byte', async () => {
    // relay.js stays byte-compatible with the shared agent tool: it is a
    // verbatim copy of Noisedeck's app/js/agent/relay.js, pinned by its hash.
    const ours = await readFile(new URL('relay.js', AGENT_DIR))
    assert.equal(createHash('sha256').update(ours).digest('hex'), '216941786293349e905b21b15d09c086594dc43575a5e4c07ae7d93dd2d09eff')
})

test('llms.txt cites the Noisemaker source for every convention it states', async () => {
    const llms = await readFile(LLMS_PATH, 'utf8')
    for (const topic of ['Looping', 'Arg binding', 'Dead branch pruning']) {
        assert.match(llms, new RegExp(`^### ${topic}`, 'm'), `llms.txt has no ${topic} section`)
    }
    const section = llms.slice(llms.indexOf('## Noisemaker conventions'), llms.indexOf('\n## ', llms.indexOf('## Noisemaker conventions') + 3))
    const bullets = section.split('\n').filter(line => line.startsWith('- '))
    assert.ok(bullets.length > 10, 'the conventions section lists the conventions')
    assert.deepEqual(bullets.filter(line => !/\[[^\]]+\]/.test(line) && !/\(source: /.test(line)), [], 'a convention without a source')
})
