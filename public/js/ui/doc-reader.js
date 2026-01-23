/**
 * Documentation Reader Panel
 * 
 * Renders markdown documentation in a side panel.
 * @module ui/doc-reader
 */

let docReaderPanel = null
let docReaderContent = null

/**
 * Initialize the doc reader panel references
 */
export function initDocReader() {
    docReaderPanel = document.getElementById('doc-reader-panel')
    docReaderContent = document.getElementById('doc-reader-content')
    
    // Set up click handlers for internal links
    if (docReaderContent) {
        docReaderContent.addEventListener('click', handleDocClick)
    }
}

/**
 * Handle clicks within the doc reader content
 */
function handleDocClick(e) {
    const link = e.target.closest('a')
    if (!link) return
    
    const href = link.getAttribute('href')
    if (!href) return
    
    // Handle back links
    if (href === '#back') {
        e.preventDefault()
        showPlaceholderContent()
        return
    }
    
    // Allow external links to open normally
}

/**
 * Show the documentation reader panel
 */
export function showDocReader() {
    if (!docReaderPanel) return
    docReaderPanel.classList.add('visible')
}

/**
 * Hide the documentation reader panel
 */
export function hideDocReader() {
    if (!docReaderPanel) return
    docReaderPanel.classList.remove('visible')
}

/**
 * Toggle the documentation reader panel visibility
 * @returns {boolean} Whether the panel is now visible
 */
export function toggleDocReader() {
    if (!docReaderPanel) return false
    docReaderPanel.classList.toggle('visible')
    return docReaderPanel.classList.contains('visible')
}

/**
 * Check if the doc reader is currently visible
 * @returns {boolean}
 */
export function isDocReaderVisible() {
    return docReaderPanel?.classList.contains('visible') ?? false
}

/**
 * Render markdown content in the doc reader
 * @param {string} markdown - The markdown content to render
 */
export function renderDocContent(markdown) {
    if (!docReaderContent) return
    
    // Use the globally loaded marked library
    if (typeof marked !== 'undefined') {
        docReaderContent.innerHTML = marked.parse(markdown)
        
        // Add build info at the end
        const addBuildInfo = (hash = 'LOCAL', dateStr = 'n/a') => {
            // Remove any existing build info first
            const existing = docReaderContent.querySelector('.doc-build-info')
            if (existing) existing.remove()
            
            const buildInfo = document.createElement('div')
            buildInfo.className = 'doc-build-info'
            buildInfo.style.cssText = 'font-family: ui-monospace, \'Cascadia Mono\', \'Consolas\', monospace; font-size: 9px; color: #444; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 1em; margin-top: 1em;'
            buildInfo.textContent = `build: ${hash} / deployed: ${dateStr}`
            docReaderContent.appendChild(buildInfo)
        }
        
        fetch('/deployment-meta.json')
            .then(r => r.json())
            .then(meta => {
                const hash = meta.git_hash ? meta.git_hash.trim().slice(0, 8) : 'LOCAL'
                let dateStr = 'n/a'
                
                if (meta.date) {
                    const date = new Date(meta.date * 1000)
                    const pad = (n) => String(n).padStart(2, '0')
                    dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
                }
                
                addBuildInfo(hash, dateStr)
            })
            .catch(() => addBuildInfo())
        
        // Scroll to top when content changes
        docReaderContent.scrollTop = 0
    } else {
        // Fallback: display as preformatted text
        docReaderContent.innerHTML = `<pre>${markdown}</pre>`
    }
}

/**
 * Show placeholder documentation content
 */
export function showPlaceholderContent() {
    const placeholder = `# Welcome to Foundry

## By [Noise Factor](https://noisefactor.io)

Foundry is a distraction-free editor for portable GLSL and WGSL shader effects. Effects you create here work across the entire Noise Factor ecosystem, and can be modified to run anywhere shaders are used.

Based on the [Portable Effect Format](https://github.com/noisedeck/portable).

---

## Quick Start

A portable effect is a folder containing shader files and a JSON definition:

\`\`\`
my-effect/
├── definition.json     # Effect metadata & parameters
├── glsl/
│   └── main.glsl       # WebGL shader*
├── wgsl/
│   └── main.wgsl       # WebGPU shader*
└── help.md             # Documentation (optional)
\`\`\`

Backend may be implemented in either GLSL or WGSL, or both. We recommend developing in one or the other and then porting when the effect is finished. Check out [Shade](https://shade.noisedeck.app) to automatically convert between languages.

---

## definition.json

The definition file describes your effect's identity, parameters, and rendering structure.

### Minimal Example

\`\`\`json
{
  "name": "My Effect",
  "func": "myEffect"
}
\`\`\`

### Complete Example

\`\`\`json
{
  "name": "Plasma Wave",
  "func": "plasmaWave",
  "namespace": "synth",
  "description": "Animated plasma effect",
  "starter": true,
  "tags": ["noise", "animation"],
  "globals": {
    "scale": {
      "type": "float",
      "default": 2.0,
      "min": 0.1,
      "max": 10.0
    },
    "color": {
      "type": "vec3",
      "default": [1.0, 0.5, 0.0]
    }
  },
  "passes": [
    {
      "name": "render",
      "program": "main",
      "inputs": {},
      "outputs": { "fragColor": "outputTex" }
    }
  ]
}
\`\`\`

---

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| \`name\` | string | Display name for the effect |
| \`func\` | string | DSL function name (camelCase) |

---

## Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| \`namespace\` | string | \`"synth"\` | Effect category |
| \`description\` | string | \`""\` | Brief description |
| \`starter\` | boolean | \`false\` | True if generates from nothing |
| \`hasTex\` | boolean | \`false\` | True if accepts texture input |
| \`tags\` | array | \`[]\` | Categorization tags |
| \`globals\` | object | \`{}\` | Parameters/uniforms |
| \`passes\` | array | auto | Render pass configuration |

---

## Parameters (globals)

Parameters expose shader uniforms to the UI and DSL:

\`\`\`json
"globals": {
  "intensity": {
    "type": "float",
    "default": 1.0,
    "min": 0.0,
    "max": 2.0
  },
  "mode": {
    "type": "int",
    "default": 0,
    "choices": {
      "normal": 0,
      "inverted": 1,
      "saturated": 2
    }
  }
}
\`\`\`

### Supported Types

| Type | GLSL Type | Default Format | UI Control |
|------|-----------|----------------|------------|
| \`float\` | \`float\` | \`1.0\` | Slider |
| \`int\` | \`int\` | \`4\` | Slider |
| \`boolean\` | \`bool\` | \`true\` | Toggle |
| \`vec2\` | \`vec2\` | \`[0.5, 0.5]\` | XY pad |
| \`vec3\` | \`vec3\` | \`[1.0, 0.0, 0.5]\` | Color picker |
| \`vec4\` / \`color\` | \`vec4\` | \`[1, 0, 0.5, 1]\` | Color picker |

### Parameter Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| \`type\` | string | Yes | Data type |
| \`default\` | varies | Yes | Default value |
| \`uniform\` | string | No | GLSL uniform name |
| \`min\` | number | No | Minimum value |
| \`max\` | number | No | Maximum value |
| \`step\` | number | No | Slider increment |
| \`choices\` | object | No | Enum options |

---

## Writing Shaders

### GLSL Template

\`\`\`glsl
#version 300 es
precision highp float;

uniform vec2 resolution;
uniform float time;

in vec2 vUv;
out vec4 fragColor;

void main() {
    vec2 uv = vUv;
    vec3 color = vec3(uv, 0.5);
    fragColor = vec4(color, 1.0);
}
\`\`\`

### Built-in Uniforms

| Uniform | Type | Description |
|---------|------|-------------|
| \`resolution\` | \`vec2\` | Canvas size in pixels |
| \`time\` | \`float\` | Normalized time 0.0–1.0 |
| \`aspectRatio\` | \`float\` | Width / height |
| \`frame\` | \`int\` | Current frame number |
| \`mouse\` | \`vec4\` | Mouse state |

### Texture Coordinates

\`vUv\` provides normalized coordinates:
- Origin: bottom-left (0, 0)
- Top-right: (1, 1)
- Center: (0.5, 0.5)

\`\`\`glsl
// Center at origin, aspect-corrected
vec2 centered = (vUv - 0.5) * vec2(aspectRatio, 1.0);
\`\`\`

---

## Multi-Pass Effects

For complex effects requiring multiple render passes:

\`\`\`json
{
  "name": "Blur",
  "func": "blur",
  "textures": {
    "_temp": { "width": "input", "height": "input" }
  },
  "passes": [
    {
      "name": "blurH",
      "program": "blurH",
      "inputs": { "inputTex": "inputTex" },
      "outputs": { "fragColor": "_temp" }
    },
    {
      "name": "blurV",
      "program": "blurV",
      "inputs": { "inputTex": "_temp" },
      "outputs": { "fragColor": "outputTex" }
    }
  ]
}
\`\`\`

---

## Effect Types

### Starter Effects

Generate output from nothing (noise, shapes, patterns):

\`\`\`json
{
  "name": "Noise",
  "starter": true,
  "passes": [{
    "inputs": {},
    "outputs": { "fragColor": "outputTex" }
  }]
}
\`\`\`

### Filter Effects

Process an input texture:

\`\`\`json
{
  "name": "Invert",
  "hasTex": true,
  "passes": [{
    "inputs": { "inputTex": "inputTex" },
    "outputs": { "fragColor": "outputTex" }
  }]
}
\`\`\`

---

## Namespaces

| Namespace | Description |
|-----------|-------------|
| \`synth\` | 2D generators |
| \`filter\` | 2D processors |
| \`mixer\` | Blend two sources |
| \`sim\` | Temporal simulations |
| \`synth3d\` | 3D volume generators |
| \`filter3d\` | 3D volume processors |

---

## Using Effects in DSL

Once registered, effects are called in DSL programs:

\`\`\`
search user

myEffect(scale: 2.0, color: #ff8800)
  .blur(radius: 5)
  .write(o0)

render(o0)
\`\`\`

---

*For complete documentation, see [portable](https://github.com/noisedeck/portable)*
`
    renderDocContent(placeholder)
}
