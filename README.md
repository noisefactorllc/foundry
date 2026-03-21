# Foundry

A web-based effects editor with hot reload capability.

## Features

- **Hot Reload**: Edit DSL code and see changes in real-time (500ms debounce)
- **WebGL2/WebGPU**: Dual backend support for shader rendering
- **Noisemaker DSL**: Full Noisemaker effect DSL support
- **Workspace Management**: Save and load effects locally
- **Parameter Controls**: Interactive uniform controls with sliders
- **Export**: Download workspace as ZIP bundle

## Quick Start

```bash
git clone https://github.com/noisefactorllc/foundry.git
cd foundry

# First-time setup: copies required resources from the shade/ sibling repo
chmod +x setup.sh
./setup.sh

# Install dependencies and start
npm install
npm start

# Or for development with auto-restart
npm run dev
```

Open http://localhost:3000 in your browser.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + Enter` | Force recompile |
| `Space` | Play/Pause animation |
| `Ctrl/Cmd + E` | Export ZIP |
| `F1` | Show help |
| `Escape` | Close overlays |

## Architecture

```
foundry/
├── server/
│   └── index.js          # Express static server
│
└── public/
    ├── index.html        # Single-page app
    ├── css/              # Stylesheets
    └── js/
        ├── app.js        # Main application
        ├── noisemaker/   # Shader rendering pipeline
        ├── workspace/    # Effect storage
        ├── ui/           # UI components
        ├── utils/        # Utilities
        └── vendor/       # Third-party libs
```

## DSL Examples

### Simple Pattern
```
search synth, filter

pattern(type: grid, scale: 50)
  .tint(color: #ff0000)
  .write(o0)

render(o0)
```

### Animated Effect
```
search synth, filter

noise(scaleX: 50, scaleY: 50, speed: 25)
  .chromaticAberration(aberration: 10)
  .vignette()
  .write(o0)

render(o0)
```

## Portable Effects

Foundry supports the Portable Effects Format for creating and sharing custom shader effects.

See the **[Portable Effects Format](https://github.com/noisefactorllc/portable)** repository for:
- Effect format specification
- Parameter definitions
- Example effects

## License

MIT
