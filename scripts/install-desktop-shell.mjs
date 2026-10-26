import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const shellPackage = process.env.DESKTOP_SHELL_PATH
if (!shellPackage) {
    console.error('Set DESKTOP_SHELL_PATH to the desktop shell package.')
    process.exit(1)
}
const npmCli = process.env.npm_execpath
if (!npmCli) {
    console.error('Run desktop preparation through npm run dev.')
    process.exit(1)
}
const result = spawnSync(process.execPath, [
    npmCli, 'install', '--no-save', '--package-lock=false', '--install-links', '--bin-links=false', resolve(shellPackage),
], { stdio: 'inherit' })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
