# Contributing to Foundry

Use the setup commands in [README.md](README.md#running-locally). The browser app runs from this checkout without credentials or sibling repositories.

## Changes

Keep changes focused on an agreed problem. Describe the current behavior, the intended behavior, and how you verified the change. Discuss new features and dependencies with the maintainers before implementing them. Preserve existing copyright and license notices.

Foundry uses JavaScript ES modules without a framework or transpiler. Browser code lives in `public/js/`; styles live in `public/css/`. Follow the surrounding code's conventions. Keep user images and other large browser data in IndexedDB, and retain binary image data when saving, exporting, or sharing programs.

## Checks

Run the build and the Node suite before submitting a change:

```sh
npm run build
npm test
```

Run `npm run test:smoke` after installing Chromium as described below. This checks startup, the source link, ZIP export, and runtime asset origins.

For browser changes, also verify the affected behavior in a supported browser and provide the browser, operating system, steps, and observed result. Test WebGL2 and WebGPU separately when a renderer change affects both.

Browser integration tests are separate from `npm test`. They use the installed Playwright package; install its Chromium browser with `node node_modules/playwright/cli.js install chromium`. Read the selected test's setup before running it with `node --test`: integration tests may require related service sources, and the root `test-*.mjs` scripts may expect an already-running server. The sharing integration test requires an isolated local API supplied through `SHARING_TEST_URL`; it accepts only a loopback URL. Image-helper tests can use `PORTABLE_IMAGES_MODULE` to select a local module instead of the public helper. Do not report a Node-only run as browser coverage.

The agent relay integration uses a local [Seance](https://github.com/noisefactorllc/seance) build configured by `SEANCE_ROOT`, `SEANCE_DIST_DIR`, and `SEANCE_PYTHON`. For its connect-agent test, download the [public agent tool](https://noisedeck.app/agent/seance-agent.mjs) and set `SEANCE_AGENT_CLI` to that file's path.

When changing the agent contract, update `public/llms.txt` and regenerate the full reference with `node scripts/build-llms-full.mjs`. The Node suite checks that the generated file is current.

## Contact

Send proposed changes and reproducible non-security bug reports to [team@noisefactor.io](mailto:team@noisefactor.io). Include the relevant source revision and test results. Do not include credentials, personal data, or unpublished workspace content. Report vulnerabilities through [SECURITY.md](SECURITY.md).

Contributions to Foundry's original source are provided under its [MIT License](LICENSE). Follow the [Trademark Policy](TRADEMARK.md) when distributing a derivative.
