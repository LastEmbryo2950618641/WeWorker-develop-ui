import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function compareSharedFiles(left, right, files) {
  return files.flatMap(file => {
    if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) throw new Error('Invalid shared path')
    const paths = [left, right].map(base => path.join(base, file))
    if (paths.some(target => !fs.existsSync(target))) return [{ file, reason: 'missing' }]
    const contents = paths.map(target => fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n'))
    return contents[0] === contents[1] ? [] : [{ file, reason: 'different' }]
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const peer = process.argv[2]
  if (!peer) throw new Error('Usage: node scripts/check-shared-parity.mjs <peer-repository>')
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/shared-core-files.json'), 'utf8'))
  const differences = compareSharedFiles(root, path.resolve(peer), manifest.files)
  console.log(JSON.stringify({ scope: manifest.scope, checked: manifest.files.length, differences }, null, 2))
  process.exitCode = differences.length ? 1 : 0
}
