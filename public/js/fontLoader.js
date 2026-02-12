/**
 * Font Loader for Foundry
 *
 * Dynamically loads fonts from fonts.noisedeck.app for text effects.
 * Uses FontFace API for fast loading without full bundle download.
 *
 * @module fontLoader
 */

const FONTS_BASE_URL = 'https://fonts.noisedeck.app'

class FontLoader {
    constructor() {
        this._catalog = null
        this._loadedFonts = new Set()
        this._loadingPromises = new Map()
    }

    async loadCatalog() {
        if (this._catalog) return this._catalog

        try {
            const response = await fetch(`${FONTS_BASE_URL}/bundle/fonts.json`)
            if (!response.ok) {
                throw new Error(`Failed to load font catalog: ${response.status}`)
            }
            this._catalog = await response.json()
            return this._catalog
        } catch (err) {
            console.error('Failed to load font catalog:', err)
            return null
        }
    }

    findFont(fontName) {
        if (!this._catalog?.fonts) return null

        let font = this._catalog.fonts.find(f => f.name === fontName)
        if (font) return font

        const lowerName = fontName.toLowerCase()
        font = this._catalog.fonts.find(f => f.name.toLowerCase() === lowerName)
        if (font) return font

        const normalize = s => s.toLowerCase().replace(/[\s-]/g, '')
        const normalizedName = normalize(fontName)
        return this._catalog.fonts.find(f => normalize(f.name) === normalizedName)
    }

    getBestFile(font) {
        if (!font?.files?.length) return null

        const files = font.files

        const variableFiles = files.filter(f =>
            /\.woff2$/i.test(f.filename) &&
            /\[.*wght.*\]/i.test(f.filename) &&
            !/italic/i.test(f.filename)
        )
        if (variableFiles.length > 0) return variableFiles[0]

        const woff2Files = files.filter(f =>
            /\.woff2$/i.test(f.filename) &&
            !/italic/i.test(f.filename)
        )

        const regularFile = woff2Files.find(f =>
            /regular/i.test(f.filename) ||
            !/\b(thin|light|medium|bold|black|extra|semi)\b/i.test(f.filename)
        )
        if (regularFile) return regularFile

        if (woff2Files.length > 0) return woff2Files[0]

        return files.find(f => /\.woff2$/i.test(f.filename)) || files[0]
    }

    async loadFont(fontName) {
        const genericFonts = ['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui']
        if (genericFonts.includes(fontName.toLowerCase())) {
            return true
        }

        if (this._loadedFonts.has(fontName)) {
            return true
        }

        if (this._loadingPromises.has(fontName)) {
            return this._loadingPromises.get(fontName)
        }

        const loadPromise = this._loadFontInternal(fontName)
        this._loadingPromises.set(fontName, loadPromise)

        try {
            const result = await loadPromise
            return result
        } finally {
            this._loadingPromises.delete(fontName)
        }
    }

    async _loadFontInternal(fontName) {
        await this.loadCatalog()

        const font = this.findFont(fontName)
        if (!font) {
            console.warn(`Font not found in catalog: ${fontName}`)
            return false
        }

        const file = this.getBestFile(font)
        if (!file) {
            console.warn(`No suitable font file for: ${fontName}`)
            return false
        }

        const fontFolder = font.dir_name.replace(/^\d+-/, '')
        const url = `${FONTS_BASE_URL}/fonts/${fontFolder}/${file.filename}`

        try {
            const fontFace = new FontFace(font.name, `url(${url})`, {
                display: 'swap'
            })

            await fontFace.load()
            document.fonts.add(fontFace)

            await document.fonts.load(`16px "${font.name}"`)

            this._loadedFonts.add(fontName)
            if (font.name !== fontName) {
                this._loadedFonts.add(font.name)
            }

            console.log(`Loaded font: ${font.name}`)
            return true
        } catch (err) {
            console.error(`Failed to load font ${fontName}:`, err)
            return false
        }
    }

    extractFontsFromDsl(dsl) {
        const fonts = new Set()

        const textCallRegex = /\.?text\s*\([^)]*\)/gi
        const matches = dsl.match(textCallRegex) || []

        for (const match of matches) {
            const fontParamRegex = /font\s*:\s*["']([^"']+)["']/i
            const fontMatch = match.match(fontParamRegex)
            if (fontMatch) {
                fonts.add(fontMatch[1])
            }
        }

        return Array.from(fonts)
    }

    async preloadFontsForDsl(dsl) {
        const fontNames = this.extractFontsFromDsl(dsl)

        if (fontNames.length === 0) return

        console.log(`Preloading fonts for DSL: ${fontNames.join(', ')}`)

        await Promise.all(fontNames.map(name => this.loadFont(name)))
        await document.fonts.ready
    }
}

let _instance = null

export function getFontLoader() {
    if (!_instance) {
        _instance = new FontLoader()
    }
    return _instance
}

export async function preloadFontsForDsl(dsl) {
    return getFontLoader().preloadFontsForDsl(dsl)
}
