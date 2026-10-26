import test from 'node:test'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')

function runStep(name, env = {}) {
    const section = workflow.split(`      - name: ${name}\n`)[1]?.split('\n      - name:')[0]
    assert.ok(section, `Missing release step: ${name}`)
    const lines = section.split('        run: |\n')[1]?.split('\n')
    assert.ok(lines, `Missing shell body: ${name}`)
    const script = lines.filter(line => line.startsWith('          ') || !line.trim()).map(line => line.slice(10)).join('\n')
    const dir = mkdtempSync(join(tmpdir(), 'foundry-release-test-'))
    try {
        writeFileSync(join(dir, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$CALL_LOG"\nexit "${GH_EXIT:-0}"\n', { mode: 0o755 })
        const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: {
            ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: join(dir, 'call'),
            SOURCE_SHA: 'a'.repeat(40), GITHUB_REPOSITORY_OWNER: 'example',
            RELEASE_REPOSITORY: 'release-target', STATIC_SITE_RELEASE_WORKFLOW: 'site.yml', ...env
        } })
        let args = []
        try { args = readFileSync(join(dir, 'call'), 'utf8').trim().split('\n') } catch {}
        return { ...result, args }
    } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('release dispatch sends the checked source SHA and requires current main', () => {
    const result = runStep('Dispatch verified source')
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.args, ['workflow', 'run', 'site.yml', '--repo', 'example/release-target', '--ref', 'main', '-f', 'site=foundry', '-f', `sha=${'a'.repeat(40)}`, '-f', 'require_latest=true'])
})

test('release dispatch rejects malformed source and propagates dispatch failure', () => {
    for (const SOURCE_SHA of ['', 'main', 'a'.repeat(39), 'a'.repeat(40) + ';echo unsafe']) {
        const result = runStep('Dispatch verified source', { SOURCE_SHA })
        assert.notEqual(result.status, 0)
        assert.deepEqual(result.args, [])
    }
    assert.equal(runStep('Dispatch verified source', { GH_EXIT: '9' }).status, 9)
})

test('release configuration fails closed when either destination setting is absent', () => {
    assert.equal(runStep('Check release configuration').status, 0)
    for (const name of ['RELEASE_REPOSITORY', 'STATIC_SITE_RELEASE_WORKFLOW']) {
        assert.notEqual(runStep('Check release configuration', { [name]: '' }).status, 0)
    }
})

test('automatic release accepts successful main CI and rejects untrusted or failed runs', () => {
    const match = workflow.match(/    if: >-\n((?:      .+\n)+)/)
    assert.ok(match)
    const expression = match[1].split('\n').map(line => line.trim()).join(' ')
    const base = { event_name: 'workflow_run', repository: 'example/foundry', ref: 'refs/heads/main', event: { workflow_run: {
        conclusion: 'success', head_repository: { full_name: 'example/foundry' }, head_branch: 'main', event: 'push',
    } } }
    const allowed = github => vm.runInNewContext(expression, { github })
    assert.equal(allowed(base), true)
    for (const change of [{ conclusion: 'failure' }, { conclusion: 'cancelled' }, { head_branch: 'other' }, { event: 'pull_request' }, { head_repository: { full_name: 'untrusted/foundry' } }]) {
        assert.equal(allowed({ ...base, event: { workflow_run: { ...base.event.workflow_run, ...change } } }), false)
    }
    assert.equal(allowed({ ...base, event: { workflow_run: { ...base.event.workflow_run, event: 'workflow_dispatch' } } }), true)
    assert.equal(allowed({ ...base, event_name: 'workflow_dispatch' }), true)
    assert.equal(allowed({ ...base, event_name: 'workflow_dispatch', ref: 'refs/heads/other' }), false)
})
