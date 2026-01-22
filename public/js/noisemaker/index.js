/**
 * Noisemaker integration for Shade
 *
 * Re-exports the ShadeRenderer and useful utilities from the vendored
 * noisemaker bundle.
 *
 * @module noisemaker
 */

export { ShadeRenderer } from './renderer.js'
export {
    extractEffectNamesFromDsl,
    extractEffectsFromDsl,
    parse,
    unparse,
    lex,
    compile
} from './bundle.js'
