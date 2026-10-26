# Foundry

Foundry is a browser-based shader effects editor built on [Noisemaker](https://noisemaker.app/). Edit GLSL and WGSL shaders, define effect parameters, and compose effects with the Noisemaker DSL. Changes compile into a live canvas preview.

[Use Foundry](https://foundry.noisedeck.app/) · [Noise Factor](https://noisefactor.io/) · [More projects](https://github.com/noisefactorllc)

## Running locally

Requires Node.js 18 or later with npm, Python 3, curl, and a browser with WebGL2 or WebGPU support. CI uses Node.js 22.

```sh
git clone https://github.com/noisefactorllc/foundry.git
cd foundry
npm ci --ignore-scripts --no-bin-links
npm run build
npm start
```

Open [localhost:3000](http://localhost:3000). Use `npm run dev` instead of `npm start` to restart the local server when server files change.

The build downloads the shader reference material selected by `shade-mcp-release.json` and verifies its content digest. It does not require credentials or another checkout. The browser loads the engine, interface components, and fonts from Noise Factor's public services, so local use requires an internet connection. The Node server binds to the loopback interface by default; it is a development server.

## Editing and storage

Foundry edits a DSL program and an optional custom effect containing its definition, shader files, and help text. It supports WebGL2 and WebGPU rendering, interactive parameter controls, local workspace storage in IndexedDB, and ZIP import and export. Browser storage belongs to the current site origin; export work you need to keep before clearing browser data or changing origins.

Online collaboration and sharing use Noise Factor services when you choose those actions. The [agent API](public/llms.txt) describes program and shader commands; [the full reference](public/llms-full.txt) includes their parameters. The [Portable Effects Format](https://github.com/noisefactorllc/portable) specifies the effect archive format.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl/Cmd + Enter | Compile and run the DSL program |
| Ctrl/Cmd + O | Open an effect |
| Ctrl/Cmd + E | Export an effect as ZIP |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z | Redo |
| Space | Play or pause |
| F1 | Show help |
| Escape | Close the active overlay |

## Development

```sh
npm test
```

This runs the Node test suite in `test/*.test.js`. For the browser startup and ZIP export check:

```sh
node node_modules/playwright/cli.js install chromium
npm run test:smoke
```

CI requires both checks. They do not run the service integration suites. Those are separate `test/*.spec.js` files and root `test-*.mjs` scripts; some require a running app, GPU support, or related service sources. See [CONTRIBUTING.md](CONTRIBUTING.md) before running them.

`public/` contains the browser application. `server/index.js` serves it locally. `pull-shade-mcp` prepares the pinned shader reference material. `scripts/build-llms-full.mjs` generates the full agent reference from its source documents and command definitions.

`desktop/` contains the application-specific integration for the Noise Factor desktop shell. It is not a standalone desktop build: it requires that shell package and the platform's packaging and signing tools. The browser application above is runnable directly from this repository.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and contribution guidance. Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

## Components and licensing

Foundry uses [Noisemaker](https://github.com/noisefactorllc/noisemaker), [Handfish](https://github.com/noisefactorllc/handfish), and the shader knowledge module from [shade-mcp](https://github.com/noisefactorllc/shade-mcp). Runtime assets are served by Noise Factor.

The source tree also contains [JSZip](public/js/lib/jszip.min.js) by Stuart Knightley and contributors, including pako, and [Marked](public/js/vendor/marked.min.js) by Christopher Jeffrey and contributors. Their embedded copyright and license notices apply to those files. Installed Node packages retain their own licenses.

Foundry's original source is released under the [MIT License](LICENSE). Use of project branding is covered by the [Trademark Policy](TRADEMARK.md).
