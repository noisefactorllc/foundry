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
    const placeholder = `# Welcome to Effect Workspace

## By [Noise Factor](https://noisefactor.io)

Effect Workspace is a distraction-free editor for GLSL and WGSL shaders authored in Noise Factor's [effect definition format](https://noisemaker.readthedocs.io/en/latest/shaders/effects.html). This is a *low-level* editor that directly exposes the underlying shader code running on GPU metal -- serious and unforgiving business. For a more lighthearted and high-level kind of experimentation, we encourage you to check out [Polymorphic](https://polymorphic.noisedeck.app), and of course our flagship app [Noisedeck](https://noisedeck.app). For our agentic shader coding assistant, check out [Shade](https://noisedeck.app/?slide=7).

---

## Quick Start

An Effect is a self-contained unit that transforms inputs to outputs using one or more render or compute passes.

\`\`\`javascript
import { Effect } from '../../../src/runtime/effect.js';

export default new Effect({
  name: "Invert",
  namespace: "filter",
  func: "inv",
  passes: [
    {
      name: "main",
      program: "invert",
      inputs: { inputTex: "inputTex" },
      outputs: { fragColor: "outputTex" }
    }
  ]
});
\`\`\`

That's a minimal working effect. Of course, it needs shader code to actually do something. The shader files go in \`glsl/\` and \`wgsl/\` subdirectories alongside the effect definition file.

---

## Effect Properties

### Required

- **name** — Display name for the effect
- **passes** — One or more render/compute passes

### Optional

- **namespace** — Logical grouping: \`synth\`, \`filter\`, \`mixer\`, \`sim\`, \`synth3d\`, \`filter3d\`
- **func** — DSL function name (defaults to lowercase \`name\`)
- **tags** — Categorization: \`color\`, \`distort\`, \`geometric\`, \`noise\`, \`transform\`, \`util\`, \`agents\`, \`sim\`, \`3d\`
- **globals** — Uniform parameters exposed to shaders and UI
- **textures** — Internal render targets

---

## Namespaces

| Namespace | Description |
|-----------|-------------|
| \`synth\` | 2D generator modules |
| \`filter\` | Apply special effects to 2D input |
| \`mixer\` | Blend two sources from A to B |
| \`sim\` | Simulations with temporal state |
| \`synth3d\` | 3D volumetric generators |
| \`filter3d\` | 3D volumetric processors |
| \`classicNoisedeck\` | Ported from original noisedeck.app |
| \`classicNoisemaker\` | Shader implementations of classic noisemaker effects |

---

## Globals (Uniforms)

Parameters exposed to both shaders and editor UI:

\`\`\`javascript
globals: {
  intensity: {
    type: "float",
    default: 0.5,
    min: 0,
    max: 1,
    ui: { label: "Intensity", control: "slider" }
  },
  mode: {
    type: "int",
    enum: "interpolation",  // References global enum
    default: "linear"
  }
}
\`\`\`

**Supported types:** \`float\`, \`int\`, \`uint\`, \`bool\`, \`vec2\`, \`vec3\`, \`vec4\`, \`mat3\`, \`mat4\`

**UI controls:** \`slider\`, \`dropdown\`, \`color\`, \`checkbox\`

---

## Textures

Define internal render targets:

\`\`\`javascript
textures: {
  _blurTemp: {
    width: "input",
    height: "input",
    format: "rgba8unorm"
  },
  downsampled: {
    width: "25%",
    height: "25%",
    format: "rgba16float"
  }
}
\`\`\`

**Dimension specs:** absolute numbers, \`"screen"\`, \`"input"\`, percentages (\`"50%"\`)

**Reserved names:** \`inputTex\`, \`outputTex\`, \`inputTex3d\`, \`inputGeo\` — synthesized by runtime

---

## Passes

Each pass transforms inputs to outputs:

\`\`\`javascript
passes: [
  {
    name: "blurH",
    type: "render",        // or "compute"
    program: "blurH",
    inputs: { inputTex: "inputTex" },
    outputs: { fragColor: "_blurTemp" }
  },
  {
    name: "blurV",
    program: "blurV",
    inputs: { inputTex: "_blurTemp" },
    outputs: { fragColor: "outputTex" }
  }
]
\`\`\`

**Pass properties:**
- **name** — Unique identifier
- **type** — \`render\` (fragment shader) or \`compute\` (compute shader)
- **program** — Shader filename (without extension)
- **inputs** — Maps sampler uniforms to texture names
- **outputs** — Maps output locations to texture names
- **iterations** — Number of times to run this pass
- **pingpong** — Array of two textures to swap each iteration

---

## On-Disk Layout

\`\`\`
my-effect/
├── definition.js       # Effect configuration
├── glsl/
│   └── my-shader.glsl  # WebGL implementation
├── wgsl/
│   └── my-shader.wgsl  # WebGPU implementation
└── help.md             # User documentation
\`\`\`

---

## UI Categories

Group controls in the editor UI:

\`\`\`javascript
globals: {
  temperature: {
    type: "float",
    ui: {
      label: "Temperature",
      control: "slider",
      category: "primary"     // camelCase required
    }
  },
  hueCenter: {
    type: "float",
    ui: {
      label: "Hue Center",
      category: "hslSecondary",
      enabledBy: "hslEnable"  // Only enabled when hslEnable is truthy
    }
  }
}
\`\`\`

**Rules:** Category names MUST be camelCase (no spaces, underscores, or PascalCase)

---

## Conditional Controls (enabledBy)

Control when parameters are enabled:

\`\`\`javascript
// Simple truthy check
enabledBy: "advancedMode"

// Comparison operators
enabledBy: { param: "intensity", gt: 0.5 }
enabledBy: { param: "mode", eq: 1 }
enabledBy: { param: "mode", in: [1, 2, 3] }

// Logical operators
enabledBy: {
  or: [
    { param: "mode", eq: 1 },
    { param: "enabled", eq: true }
  ]
}
\`\`\`

**Operators:** \`eq\`, \`neq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\`, \`in\`, \`notIn\`, \`or\`, \`and\`, \`not\`

---

## Lifecycle Hooks

For effects needing CPU-side state management:

\`\`\`javascript
export default new Effect({
  name: "PulseEffect",
  namespace: "examples",

  onInit() {
    this.state.phase = 0;
  },

  onUpdate({ time, delta, uniforms }) {
    this.state.phase += delta * uniforms.speed;
    return {
      u_pulse: Math.sin(this.state.phase) * uniforms.intensity
    };
  },

  onDestroy() {
    // Cleanup resources
  }
});
\`\`\`

---

## 3D Volumes & Geometry

Effects can produce 3D volume or geometry buffer outputs:

\`\`\`javascript
export default new Effect({
  name: "VolumeGenerator",
  namespace: "synth3d",
  textures: {
    volumeCache: { width: 64, height: 4096, format: "rgba16float" },
    geoBuffer: { width: "screen", height: "screen", format: "rgba16float" }
  },
  passes: [ /* ... */ ],
  outputTex3d: "volumeCache",  // Expose as 3D output
  outputGeo: "geoBuffer"       // Expose as geometry output
});
\`\`\`

---

## Full Example

\`\`\`javascript
import { Effect } from '../../../src/runtime/effect.js';

export default new Effect({
  name: "SimpleBloom",
  namespace: "filter",
  func: "bloom",
  tags: ["color"],

  globals: {
    intensity: {
      type: "float",
      default: 0.5,
      min: 0,
      max: 1,
      ui: { label: "Intensity", control: "slider" }
    },
    threshold: {
      type: "float",
      default: 0.5,
      min: 0,
      max: 1,
      ui: { label: "Threshold", control: "slider" }
    }
  },

  textures: {
    downsampled: { width: "25%", height: "25%", format: "rgba16float" }
  },

  passes: [
    {
      name: "downsample",
      program: "downsample",
      inputs: { scene: "inputTex" },
      outputs: { color: "downsampled" }
    },
    {
      name: "composite",
      program: "composite",
      inputs: { scene: "inputTex", bloom: "downsampled" },
      outputs: { color: "outputTex" }
    }
  ]
});
\`\`\`

---

*For full documentation, see the [Effect Definition Spec](https://noisemaker.readthedocs.io/en/latest/shaders/effects.html)*
`
    renderDocContent(placeholder)
}
