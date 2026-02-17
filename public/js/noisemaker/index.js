/**
 * Noisemaker integration for Shade
 *
 * Re-exports the ShadeRenderer and useful utilities from the
 * noisemaker bundle (loaded from CDN).
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
