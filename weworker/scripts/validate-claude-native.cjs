const fs = require('node:fs')
const path = require('node:path')

function nativeArchitectures(header, platform) {
  if (platform === 'win32') {
    if (header.length < 64 || header.toString('ascii', 0, 2) !== 'MZ') return []
    const pe = header.readUInt32LE(60)
    if (pe > header.length - 24 || header.readUInt32LE(pe) !== 0x4550) return []
    return [{ 0x8664: 'x64', 0xaa64: 'arm64' }[header.readUInt16LE(pe + 4)]].filter(Boolean)
  }
  if (platform === 'darwin') {
    if (header.length < 8) return []
    const cpuName = cpu => ({ 0x01000007: 'x64', 0x0100000c: 'arm64' }[cpu])
    const magic = header.readUInt32BE(0)
    if (magic === 0xcffaedfe) return [cpuName(header.readUInt32LE(4))].filter(Boolean)
    if (magic === 0xfeedfacf) return [cpuName(header.readUInt32BE(4))].filter(Boolean)
    if (magic === 0xcafebabe || magic === 0xcafebabf) {
      const count = header.readUInt32BE(4)
      const stride = magic === 0xcafebabf ? 32 : 20
      if (count > (header.length - 8) / stride) return []
      return Array.from({ length: count }, (_, i) => cpuName(header.readUInt32BE(8 + i * stride))).filter(Boolean)
    }
  }
  return []
}

function validatePackagedClaude(resourcesPath, platform, arch) {
  if (!['win32', 'darwin'].includes(platform)) return
  const file = path.join(resourcesPath, 'claude-code', 'bin', 'claude.exe')
  const hint = 'Install the matching Claude Code optional native package and run its install.cjs before rebuilding. A wrapper placeholder cannot be shipped.'
  if (!fs.existsSync(file)) throw new Error('[claude-native] Missing packaged native executable. ' + hint)
  const fd = fs.openSync(file, 'r')
  let architectures
  try {
    const header = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 65536))
    fs.readSync(fd, header, 0, header.length, 0)
    architectures = nativeArchitectures(header, platform)
  } finally {
    fs.closeSync(fd)
  }
  const targets = arch === 'universal' ? ['x64', 'arm64'] : [arch]
  if (!targets.every(target => architectures.includes(target))) {
    throw new Error(`[claude-native] Packaged executable is not a ${platform}/${arch} native binary. ` + hint)
  }
  if (platform === 'darwin' && (fs.statSync(file).mode & 0o111) === 0) {
    throw new Error('[claude-native] Packaged executable has no execute permission.')
  }
  return file
}

module.exports = { nativeArchitectures, validatePackagedClaude }
