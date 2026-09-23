import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'


/** Matches install.cjs: postinstall may leave a stub when optional deps were not linked. */
const STUB_MAX_BYTES = 4096

const PLATFORM_PACKAGES = {
  'win32-x64': 'claude-code-win32-x64',
  'win32-arm64': 'claude-code-win32-arm64',
  'darwin-arm64': 'claude-code-darwin-arm64',
  'darwin-x64': 'claude-code-darwin-x64',
  'linux-x64': 'claude-code-linux-x64',
  'linux-arm64': 'claude-code-linux-arm64',
}

function isStubBinary(filePath) {
  try {
    return fs.statSync(filePath).size < STUB_MAX_BYTES
  } catch {
    return true
  }
}

function resolvePlatformBinary(runtimeRoot, platform, arch) {
  const pkg = PLATFORM_PACKAGES[`${platform}-${arch}`]
  if (!pkg) return null
  const binaryName = platform === 'win32' ? 'claude.exe' : 'claude'
  const candidate = path.join(runtimeRoot, pkg, binaryName)
  try {
    if (fs.statSync(candidate).isFile() && !isStubBinary(candidate)) return candidate
  } catch {}
  return null
}

export function resolveClaudeCodePath({ packaged, resourcesPath, appRoot, platform = process.platform, arch = os.arch() }) {
  const runtimeRoot = packaged
    ? resourcesPath
    : path.join(appRoot, 'backend-ts', 'node_modules', '@anthropic-ai')
  // The upstream installer writes bin/claude.exe on every platform, including macOS.
  const defaultPath = path.join(runtimeRoot, 'claude-code', 'bin', 'claude.exe')
  if (!isStubBinary(defaultPath)) return defaultPath
  return resolvePlatformBinary(runtimeRoot, platform, arch) || defaultPath
}
