import { SCHEMAS } from './schemas.js'
import { COMMAND_GROUPS } from './descriptions.js'

export const DESCRIPTIONS = Object.assign({}, ...COMMAND_GROUPS.map(group => group.commands))
const READ_ONLY = new Set(['getState', 'getProgram', 'validateProgram', 'listFiles', 'readFile', 'listSavedEffects', 'searchEffects', 'getEffectDefinition', 'getThumbnail', 'checkShader'])
/** Commands that an agent in the person's Seance session can run in this tab. */
export const REMOTE = new Set(Object.keys(SCHEMAS).filter(name => DESCRIPTIONS[name].remote !== false))

/** The command list that the relay's `describe` returns. */
export function catalog() {
    return COMMAND_GROUPS.flatMap(group => Object.entries(group.commands).map(([name, entry]) => ({
        name,
        group: group.title,
        does: entry.does,
        returns: entry.returns,
        args: jsonSchema(SCHEMAS[name]),
        readOnly: READ_ONLY.has(name),
        remote: REMOTE.has(name),
    })))
}

export function jsonSchema(schema) {
    const { min, max, properties, ...out } = schema
    if (min !== undefined) out.minimum = min
    if (max !== undefined) out.maximum = max
    if (properties) out.properties = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, jsonSchema(value)]))
    return out
}

export function imageResult(envelope) {
    if (!['getThumbnail', 'renderAt'].includes(envelope.command) || !envelope.ok) return { envelope }
    const { bytes, ...metadata } = envelope.result
    return { envelope: { ...envelope, result: metadata }, image: { type: 'image', data: bytes, mimeType: metadata.mimeType } }
}

export function registerWebMCP(agent) {
    const context = document.modelContext || navigator.modelContext
    if (typeof context?.registerTool !== 'function') return
    for (const [name, schema] of Object.entries(SCHEMAS)) {
        const returns = ['getThumbnail', 'renderAt'].includes(name)
            ? 'an image content block and a text envelope containing mimeType, width and height'
            : DESCRIPTIONS[name].returns
        const tool = {
            name: `foundry_${name}`,
            description: `${DESCRIPTIONS[name].does} Returns ${returns}. Commands wait for startup and run in order.`,
            inputSchema: jsonSchema(schema),
            annotations: { readOnlyHint: READ_ONLY.has(name) },
            async execute(args) {
                const { envelope, image } = imageResult(await agent[name](args))
                return {
                    content: [{ type: 'text', text: JSON.stringify(envelope) }, ...(image ? [image] : [])],
                    isError: !envelope.ok,
                }
            },
        }
        try {
            Promise.resolve(context.registerTool(tool)).catch(err => console.warn(`[agent] WebMCP ${name}:`, err))
        } catch (err) {
            console.warn(`[agent] WebMCP ${name}:`, err)
        }
    }
}
