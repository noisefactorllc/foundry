import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

test('the Seance integration requires an explicitly configured agent tool', t => {
    const directory = mkdtempSync(join(tmpdir(), 'foundry-agent-check-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    copyFileSync(join(root, 'test/seance-local.js'), join(directory, 'helper.mjs'))
    const env = { ...process.env }
    delete env.SEANCE_AGENT_CLI
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { runJoinLine } from './helper.mjs'
        try { runJoinLine('', { server: 'http://127.0.0.1', origin: 'http://127.0.0.1' }) }
        catch (error) { console.log(error.message) }
    `], { cwd: directory, env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), 'Set SEANCE_AGENT_CLI to the shared agent tool (seance-agent.mjs).')
})

test('the Seance integration runs the configured tool with the local session settings', t => {
    const directory = mkdtempSync(join(tmpdir(), 'foundry-agent-check-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    copyFileSync(join(root, 'test/seance-local.js'), join(directory, 'helper.mjs'))
    const agentTool = join(directory, 'agent fixture.mjs')
    writeFileSync(agentTool, `console.log(JSON.stringify({
        args: process.argv.slice(2), server: process.env.SEANCE_AGENT_SERVER, origin: process.env.SEANCE_AGENT_ORIGIN,
    }))\n`)
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { runJoinLine } from './helper.mjs'
        const tool = runJoinLine('node seance-agent.mjs join test-session', {
            server: 'http://127.0.0.1:3100', origin: 'http://127.0.0.1:3200',
        })
        try { console.log(JSON.stringify(await tool.joined)) } finally { await tool.stop() }
    `], { cwd: directory, env: { ...process.env, SEANCE_AGENT_CLI: agentTool }, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), {
        args: ['join', 'test-session'], server: 'http://127.0.0.1:3100', origin: 'http://127.0.0.1:3200',
    })
})

test('desktop preparation passes the selected package path directly to npm and propagates failure', t => {
    const directory = mkdtempSync(join(tmpdir(), 'foundry-desktop-check-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const npmCli = join(directory, 'npm fixture.cjs')
    writeFileSync(npmCli, 'console.log(JSON.stringify(process.argv.slice(2))); process.exit(17)\n')
    const shellPackage = join(directory, 'shell package $literal & characters')
    const desktop = JSON.parse(readFileSync(join(root, 'desktop/package.json')))
    assert.match(desktop.scripts.predev, /^node [\w./-]+$/)
    const result = spawnSync(process.execPath, [desktop.scripts.predev.slice('node '.length)], {
        cwd: join(root, 'desktop'), encoding: 'utf8',
        env: { ...process.env, DESKTOP_SHELL_PATH: shellPackage, npm_execpath: npmCli },
    })
    assert.equal(result.status, 17, result.stdout + result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), [
        'install', '--no-save', '--package-lock=false', '--install-links', '--bin-links=false', shellPackage,
    ])
})

test('desktop preparation rejects a missing package setting before invoking npm', () => {
    const desktop = JSON.parse(readFileSync(join(root, 'desktop/package.json')))
    assert.match(desktop.scripts.predev, /^node [\w./-]+$/)
    const env = { ...process.env, npm_execpath: 'must-not-run' }
    delete env.DESKTOP_SHELL_PATH
    const result = spawnSync(process.execPath, [desktop.scripts.predev.slice('node '.length)], {
        cwd: join(root, 'desktop'), env, encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Set DESKTOP_SHELL_PATH/)
    assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND/)
})
