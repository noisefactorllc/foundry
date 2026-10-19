/**
 * Argument schemas for FoundryAgent commands, and the validator that checks
 * them. Every schema is strict: an undeclared field fails with
 * INVALID_ARGS_UNKNOWN, so a command with no arguments accepts only {}.
 * `default` documents the value a handler uses when the field is omitted.
 *
 * Supported subset: object (properties, required, additionalProperties),
 * string (enum, minLength), number and integer (min, max), boolean.
 *
 * @module agent/schemas
 */

const strict = (properties, required = []) =>
    ({ type: 'object', properties, required, additionalProperties: false })

// A Portable effect: the definition fields and `shaders` that Foundry,
// Shade and sharing compositions carry. The handler checks its fields.
const EFFECT = { type: 'object' }
const PROGRAM = strict({ dsl: { type: 'string', minLength: 1 }, effect: EFFECT }, ['dsl'])
const NAME = { type: 'string', minLength: 1 }
const PATH = { type: 'string', minLength: 1 }
const NONE = strict({})

export const SCHEMAS = {
    getState: NONE,
    getProgram: NONE,
    validateProgram: PROGRAM,
    setProgram: PROGRAM,
    undo: NONE,
    redo: NONE,
    listFiles: NONE,
    readFile: strict({ path: PATH }, ['path']),
    writeFile: strict({ path: PATH, content: { type: 'string' } }, ['path', 'content']),
    newEffect: strict({ name: NAME }, ['name']),
    loadEffect: strict({ effectId: NAME, name: NAME }, ['effectId']),
    listSavedEffects: NONE,
    loadSavedEffect: strict({ id: NAME }, ['id']),
    saveEffect: strict({ name: NAME }, ['name']),
    deleteSavedEffect: strict({ id: NAME }, ['id']),
    searchEffects: strict({
        query: { type: 'string' },
        namespace: { type: 'string' },
        limit: { type: 'integer', min: 1, max: 500, default: 50 },
    }),
    getEffectDefinition: strict({ effectId: NAME }, ['effectId']),
    play: NONE,
    pause: NONE,
    setBackend: strict({ backend: { type: 'string', enum: ['webgl2', 'webgpu'] } }, ['backend']),
    getThumbnail: strict({
        maxDimension: { type: 'integer', min: 16, max: 1024, default: 256 },
        format: { type: 'string', enum: ['png', 'jpg'], default: 'jpg' },
    }),
    exportZip: NONE,
    importComposition: strict({ link: NAME }, ['link']),
}

function fail(code, message, details) {
    return { ok: false, code, message, details }
}

function typeName(v) {
    if (v === null) return 'null'
    if (Array.isArray(v)) return 'array'
    return typeof v
}

/**
 * Validate `value` against `schema`.
 *
 * @returns {{ok: true} | {ok: false, code: string, message: string, details: object}}
 */
export function validate(value, schema, path = '') {
    if (!schema) return { ok: true }
    const field = path || 'args'
    switch (schema.type) {
        case 'object': {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                return fail('INVALID_ARGS_TYPE', `${field}: expected object, got ${typeName(value)}`,
                    { field, expected: 'object', got: typeName(value) })
            }
            for (const req of schema.required || []) {
                if (!(req in value)) {
                    const f = path ? `${path}.${req}` : req
                    return fail('INVALID_ARGS_REQUIRED', `${f} is required`, { field: f })
                }
            }
            for (const key of Object.keys(value)) {
                const f = path ? `${path}.${key}` : key
                const sub = schema.properties?.[key]
                if (!sub) {
                    if (schema.additionalProperties === false) {
                        return fail('INVALID_ARGS_UNKNOWN', `${f}: unknown field`, { field: f })
                    }
                    continue
                }
                const r = validate(value[key], sub, f)
                if (!r.ok) return r
            }
            return { ok: true }
        }
        case 'string':
            if (typeof value !== 'string') {
                return fail('INVALID_ARGS_TYPE', `${field}: expected string, got ${typeName(value)}`,
                    { field, expected: 'string', got: typeName(value) })
            }
            if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
                return fail('INVALID_ARGS_RANGE', `${field}: shorter than ${schema.minLength} characters`,
                    { field, min: schema.minLength, got: value.length })
            }
            if (schema.enum && !schema.enum.includes(value)) {
                return fail('INVALID_ARGS_ENUM', `${field}: expected one of [${schema.enum.join(', ')}]`,
                    { field, allowed: schema.enum, got: value })
            }
            return { ok: true }
        case 'number':
        case 'integer':
            if (typeof value !== 'number' || !Number.isFinite(value)
                || (schema.type === 'integer' && !Number.isInteger(value))) {
                return fail('INVALID_ARGS_TYPE', `${field}: expected ${schema.type}, got ${typeName(value)}`,
                    { field, expected: schema.type, got: typeName(value) })
            }
            if ((typeof schema.min === 'number' && value < schema.min)
                || (typeof schema.max === 'number' && value > schema.max)) {
                return fail('INVALID_ARGS_RANGE', `${field}: ${value} is outside ${schema.min} to ${schema.max}`,
                    { field, min: schema.min, max: schema.max, got: value })
            }
            return { ok: true }
        case 'boolean':
            if (typeof value !== 'boolean') {
                return fail('INVALID_ARGS_TYPE', `${field}: expected boolean, got ${typeName(value)}`,
                    { field, expected: 'boolean', got: typeName(value) })
            }
            return { ok: true }
        default:
            return { ok: true }
    }
}
