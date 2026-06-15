#!/usr/bin/env node
/**
 * Downloads pinned Noisemaker engine + effect bundles to <repo>/vendor/noisemaker/<v>/.
 * Writes SHA256SUMS for app-launch integrity verification.
 */
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const REPO_ROOT = path.resolve(__dirname, '..')
const PIN_PATH = path.join(REPO_ROOT, 'desktop', 'noisemaker.version.json')

// ---------------------------------------------------------------------------
// Input validation. `version`, `baseUrl` (from the pin file) and effect `id`s
// (from the remote manifest) are interpolated into BOTH download URLs and local
// file paths. Validate them so a hostile pin file or manifest can't cause path
// traversal (writing outside the vendor dir) or SSRF (fetching internal hosts).
// ---------------------------------------------------------------------------

/**
 * Validate the pinned engine version (used in URLs and local paths).
 * @param {string} version
 * @returns {string} the validated version
 */
function validateVersion(version) {
    if (typeof version !== 'string' || version.length === 0) {
        throw new Error(`Invalid version: expected a non-empty string, got ${JSON.stringify(version)}`)
    }
    if (version.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
        throw new Error(`Unsafe version "${version}": only [A-Za-z0-9._-] allowed, no path separators or ".."`)
    }
    return version
}

/**
 * Validate the base URL: https only, a public host (no loopback/link-local/IP
 * literals → SSRF), and no embedded credentials.
 * @param {string} baseUrl
 * @returns {string} the validated baseUrl
 */
function validateBaseUrl(baseUrl) {
    let url
    try {
        url = new URL(baseUrl)
    } catch {
        throw new Error(`Invalid baseUrl: ${JSON.stringify(baseUrl)} is not a valid URL`)
    }
    if (url.protocol !== 'https:') {
        throw new Error(`Unsafe baseUrl "${baseUrl}": must use https`)
    }
    if (url.username || url.password) {
        throw new Error(`Unsafe baseUrl "${baseUrl}": must not contain credentials`)
    }
    const host = url.hostname.toLowerCase()
    const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')
    if (host === 'localhost' || host.endsWith('.localhost') || isIpLiteral) {
        throw new Error(`Unsafe baseUrl "${baseUrl}": host must be a public hostname, not an IP or localhost`)
    }
    return baseUrl
}

/**
 * Validate a manifest effect id. May contain "/" (namespace/name) but must not
 * escape the target directory.
 * @param {string} id
 * @returns {string} the validated id
 */
function validateEffectId(id) {
    if (typeof id !== 'string' || id.length === 0) {
        throw new Error(`Invalid effect id: expected a non-empty string, got ${JSON.stringify(id)}`)
    }
    if (id.includes('..') || id.includes('\\') || id.startsWith('/') ||
        !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(id)) {
        throw new Error(`Unsafe effect id "${id}": only [A-Za-z0-9._/-] allowed, no "..", backslash, or leading slash`)
    }
    return id
}

/**
 * Defense in depth: ensure a resolved target path stays within rootDir.
 * @param {string} rootDir
 * @param {string} targetPath
 * @returns {string} targetPath
 */
function assertWithin(rootDir, targetPath) {
    const resolvedRoot = path.resolve(rootDir)
    const resolved = path.resolve(targetPath)
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
        throw new Error(`Refusing to write outside ${resolvedRoot}: ${resolved}`)
    }
    return targetPath
}

async function main() {
    const pin = JSON.parse(await fs.readFile(PIN_PATH, 'utf8'))
    const { version, baseUrl } = pin
    validateVersion(version)
    validateBaseUrl(baseUrl)
    const versionUrl = `${baseUrl}/${version}`
    const destRoot = path.join(REPO_ROOT, 'public', 'vendor', 'noisemaker', version)
    const effectsDest = path.join(destRoot, 'effects')
    await fs.mkdir(effectsDest, { recursive: true })

    const checksums = []

    async function download(url, destPath) {
        assertWithin(destRoot, destPath)
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(`Failed ${resp.status}: ${url}`)
        const buf = Buffer.from(await resp.arrayBuffer())
        await fs.mkdir(path.dirname(destPath), { recursive: true })
        await fs.writeFile(destPath, buf)
        const hash = crypto.createHash('sha256').update(buf).digest('hex')
        checksums.push(`${hash}  ${path.relative(destRoot, destPath).split(path.sep).join('/')}`)
    }

    console.log(`Fetching Noisemaker ${version} from ${versionUrl}`)

    await download(
        `${versionUrl}/noisemaker-shaders-core.esm.min.js`,
        path.join(destRoot, 'noisemaker-shaders-core.esm.min.js')
    )

    const manifestResp = await fetch(`${versionUrl}/effects/manifest.json`)
    if (!manifestResp.ok) throw new Error(`Manifest fetch failed: ${manifestResp.status}`)
    const manifestText = await manifestResp.text()
    const manifest = JSON.parse(manifestText)

    const effectIds = Object.keys(manifest)
    console.log(`Downloading ${effectIds.length} effect bundles...`)
    for (const id of effectIds) {
        validateEffectId(id)
        const rel = `${id}.js`
        await download(`${versionUrl}/effects/${rel}`, path.join(effectsDest, rel))
    }

    const manifestDest = path.join(effectsDest, 'manifest.json')
    await fs.writeFile(manifestDest, manifestText)
    const manifestHash = crypto.createHash('sha256').update(manifestText).digest('hex')
    checksums.push(`${manifestHash}  effects/manifest.json`)

    const sumsPath = path.join(destRoot, 'SHA256SUMS')
    await fs.writeFile(sumsPath, checksums.join('\n') + '\n')
    console.log(`Wrote ${checksums.length} checksums to ${sumsPath}`)
}

module.exports = { validateVersion, validateBaseUrl, validateEffectId, assertWithin }

if (require.main === module) {
    main().catch((err) => {
        console.error(err)
        process.exit(1)
    })
}
