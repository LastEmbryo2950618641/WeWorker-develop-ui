import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { validateBuiltinOutput } from '../builtin-adapter-build.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultWebcliDir = path.resolve(scriptDir, '..')
const defaultSourceExtensionDir = path.resolve(defaultWebcliDir, '..', 'extension')

const EXCLUDED_DIRS = new Set(['.git', 'node_modules'])
const EXCLUDED_FILE_SUFFIXES = [
  '.index-snippet.generated.txt',
  '.integration.generated.md',
]

function assertRegularDirectory(root) {
  const stat = fs.lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Package resource root must be a regular directory: ${root}`)
}

function assertCopyEntry(entry, sourcePath) {
  if (entry.isSymbolicLink()) throw new Error(`Package resource must not be a symbolic link: ${sourcePath}`)
  if (!entry.isDirectory() && !entry.isFile()) throw new Error(`Package resource must be a regular file or directory: ${sourcePath}`)
}

export function syncPackageExtension({
  webcliDir = defaultWebcliDir,
  sourceExtensionDir = defaultSourceExtensionDir,
  sourceBuiltinDir,
} = {}) {
  if (!fs.existsSync(sourceExtensionDir)) {
    throw new Error(`extension source directory not found: ${sourceExtensionDir}`)
  }
  assertRegularDirectory(sourceExtensionDir)
  if (sourceBuiltinDir) validateBuiltinOutput(sourceBuiltinDir)
  const targetExtensionDir = path.join(webcliDir, 'extension')
  fs.rmSync(targetExtensionDir, { recursive: true, force: true })
  const fileCount = copyDirectory(sourceExtensionDir, targetExtensionDir, sourceExtensionDir)
  if (sourceBuiltinDir) {
    const targetBuiltinDir = path.join(webcliDir, 'adapters')
    fs.rmSync(targetBuiltinDir, { recursive: true, force: true })
    copyDirectory(sourceBuiltinDir, targetBuiltinDir, sourceBuiltinDir)
  }
  return { sourceExtensionDir, targetExtensionDir, fileCount }
}

export function checkPackageResources({ webcliDir = defaultWebcliDir, sourceExtensionDir, sourceBuiltinDir }) {
  assertRegularDirectory(sourceExtensionDir)
  validateBuiltinOutput(sourceBuiltinDir)
  validateBuiltinOutput(path.join(webcliDir, 'adapters'))
  for (const [source, target] of [
    [sourceExtensionDir, path.join(webcliDir, 'extension')],
    [sourceBuiltinDir, path.join(webcliDir, 'adapters')],
  ]) {
    assertRegularDirectory(target)
    const list = (dir, root = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(dir, entry.name)
      assertCopyEntry(entry, file)
      if (shouldSkipEntry(entry, file, root)) return []
      return entry.isDirectory() ? list(file, root) : [path.relative(root, file)]
    }).sort()
    const sourceFiles = list(source)
    if (JSON.stringify(sourceFiles) !== JSON.stringify(list(target))) throw new Error('Package resource set is stale; synchronize the prepared profile.')
    for (const file of sourceFiles) {
      if (!fs.readFileSync(path.join(source, file)).equals(fs.readFileSync(path.join(target, file)))) {
        throw new Error('Package resource content is stale; synchronize the prepared profile.')
      }
    }
  }
}

function copyDirectory(sourceDir, targetDir, sourceRoot) {
  let fileCount = 0
  fs.mkdirSync(targetDir, { recursive: true })
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)
    assertCopyEntry(entry, sourcePath)
    if (shouldSkipEntry(entry, sourcePath, sourceRoot)) continue
    if (entry.isDirectory()) {
      fileCount += copyDirectory(sourcePath, targetPath, sourceRoot)
    } else {
      fs.copyFileSync(sourcePath, targetPath)
      fileCount += 1
    }
  }
  return fileCount
}

function shouldSkipEntry(entry, sourcePath, sourceRoot) {
  if (entry.isDirectory()) {
    return EXCLUDED_DIRS.has(entry.name) || path.relative(sourceRoot, sourcePath) === 'test'
  }
  return EXCLUDED_FILE_SUFFIXES.some(suffix => entry.name.endsWith(suffix))
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectExecution) {
  const repoRoot = path.resolve(defaultWebcliDir, '..')
  const internalEntry = path.join(repoRoot, 'internal/scripts/run-profile-build.cjs')
  const prepareArgs = fs.existsSync(internalEntry) ? [internalEntry, 'prepare'] : [path.join(repoRoot, 'weworker/scripts/prepare-build.cjs')]
  execFileSync(process.execPath, prepareArgs, { cwd: repoRoot, stdio: 'inherit' })
  const result = syncPackageExtension({
    sourceExtensionDir: path.join(repoRoot, 'weworker/build/extension-dist'),
    sourceBuiltinDir: path.join(repoRoot, 'weworker/build/builtin-adapters'),
  })
  console.log(`[prepare-package-extension] copied ${result.fileCount} file(s) from ${result.sourceExtensionDir} to ${result.targetExtensionDir}`)
}
