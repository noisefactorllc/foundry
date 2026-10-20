import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
test('the release fetcher installs only pinned regular-file knowledge with the browser entry', () => {
    const python = String.raw`
import io, importlib.machinery, importlib.util, json, os, pathlib, tarfile, tempfile
from unittest.mock import patch
loader=importlib.machinery.SourceFileLoader('pull', 'pull-shade-mcp')
spec=importlib.util.spec_from_loader(loader.name, loader)
pull=importlib.util.module_from_spec(spec)
loader.exec_module(pull)
with tempfile.TemporaryDirectory() as root:
    pull.VENDOR_DIR=os.path.join(root, 'public/vendor/shade-mcp')
    pull.PIN_FILE=os.path.join(root, 'shade-mcp-release.json')
    files={'knowledge/index.js':b'export const index=1;', 'knowledge/shader-craft.js':b'export const checkShaderSource=()=>[];'}
    def curl(args, **kwargs):
        dest=args[args.index('-o')+1]
        with tarfile.open(dest,'w:gz') as archive:
            for name,data in files.items():
                item=tarfile.TarInfo('./'+name);item.size=len(data);archive.addfile(item,io.BytesIO(data))
    with patch.object(pull,'run_curl',curl),patch('sys.argv',['pull-shade-mcp','--release','v0.5.0']):
        assert pull.main()==0
    pin=json.loads(pathlib.Path(pull.PIN_FILE).read_text())
    assert pin['tag']=='v0.5.0'
    assert pin['knowledge_sha256']==pull.tree_digest(os.path.join(pull.VENDOR_DIR,'knowledge'))
    assert pathlib.Path(pull.VENDOR_DIR,'knowledge/shader-craft.js').read_bytes()==files['knowledge/shader-craft.js']
    with patch.object(pull,'run_curl',curl),patch('sys.argv',['pull-shade-mcp']):
        assert pull.main()==0
    files['knowledge/shader-craft.js']=b'changed source'
    with patch.object(pull,'run_curl',curl),patch('sys.argv',['pull-shade-mcp']):
        assert pull.main()==1
    assert pathlib.Path(pull.VENDOR_DIR,'knowledge/shader-craft.js').read_bytes()!=b'changed source'
`
    const result = spawnSync('python3', ['-B', '-'], { cwd: root, input: python, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
})
test('build, deployment and desktop preparation include the same pinned knowledge files', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
    assert.match(pkg.scripts.build, /pull-shade-mcp/)
    const deploy = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
    assert.ok(deploy.indexOf('run: python3 pull-shade-mcp') < deploy.indexOf('rsync -avz'))
    assert.match(deploy, /- 'shade-mcp-release.json'/)
    const desktop = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url)))
    assert.match(desktop.scripts.predist, /pull-shade-mcp/)
})
