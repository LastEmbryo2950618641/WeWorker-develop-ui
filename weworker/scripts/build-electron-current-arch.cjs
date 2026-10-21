const { spawnSync } = require('child_process')
const path = require('path')
const { loadDeploymentConfig } = require('./deployment-config.cjs')

function buildElectronArgs(target, platform = process.platform, arch = process.arch) {
  if (target === '--mac') {
    if (platform !== 'darwin') throw new Error('macOS packages must be built on macOS')
    if (arch !== 'arm64' && arch !== 'x64') throw new Error(`Unsupported macOS architecture: ${arch}`)
    return ['--mac', `--${arch}`]
  }
  if (target === '--win') {
    if (platform !== 'win32') throw new Error('Windows packages must be built on Windows')
    if (arch !== 'x64') throw new Error(`Windows packages require x64; got ${arch}`)
    return ['--win', '--x64']
  }
  throw new Error(`Expected --mac or --win; got ${target || 'nothing'}`)
}

function buildElectronCommand(
  target,
  platform = process.platform,
  arch = process.arch,
  nodeExecutable = process.execPath,
  cliPath = require.resolve('electron-builder/cli.js'),
) {
  return {
    executable: nodeExecutable,
    args: [cliPath, ...buildElectronArgs(target, platform, arch)],
  }
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) throw new Error('Usage: node scripts/build-electron-current-arch.cjs --mac|--win')
  const { executable, args } = buildElectronCommand(argv[0])
  const deployment = loadDeploymentConfig()
  const result = spawnSync(executable, args, {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, WEWORKER_PUBLISH_URL: deployment.downloadUrl },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`electron-builder exited with code ${result.status}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[build] ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { buildElectronArgs, buildElectronCommand }
