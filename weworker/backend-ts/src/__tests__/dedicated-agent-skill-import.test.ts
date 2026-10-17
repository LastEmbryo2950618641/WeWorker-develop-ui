import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import yazl from 'yazl'
import { importSkillFromPath, inspectZipEntries } from '../dedicated-agents/skill-import.js'

// ── Minimal stored-ZIP writer so malformed archives can be crafted precisely ──

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** declaredSize: claimed size in both headers; centralOnlySize: only the central directory lies. */
type RawEntry = { name: string; data?: Buffer | string; flags?: number; unixMode?: number; declaredSize?: number; centralOnlySize?: number }

function buildStoredZip(entries: RawEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '', 'utf8')
    const crc = crc32(data)
    const flags = (entry.flags ?? 0) | 0x0800 // UTF-8 names
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.declaredSize ?? data.length, 18)
    local.writeUInt32LE(entry.declaredSize ?? data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, data)

    const isDirectory = entry.name.endsWith('/')
    const mode = entry.unixMode ?? (isDirectory ? 0o040755 : 0o100644)
    const declared = entry.centralOnlySize ?? entry.declaredSize ?? data.length
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(declared, 20)
    central.writeUInt32LE(declared, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + data.length
  }
  const centralDirectory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralDirectory, eocd])
}

function buildDeflatedZip(files: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    for (const [name, content] of Object.entries(files)) zip.addBuffer(Buffer.from(content, 'utf8'), name)
    zip.end()
    const chunks: Buffer[] = []
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zip.outputStream.on('error', reject)
  })
}

const SKILL = '---\nname: inventory-helper\ndescription: "Use for example.com inventory questions"\n---\n\n# Inventory helper\n\nCheck stock on example.com.\n'

describe('dedicated agent skill import', () => {
  let dir = ''

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weworker-skill-import-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const write = (name: string, content: Buffer | string) => {
    const file = path.join(dir, name)
    fs.writeFileSync(file, content)
    return file
  }

  it('imports a single Markdown file and keeps the frontmatter name', async () => {
    const result = await importSkillFromPath(write('notes.md', SKILL))
    expect(result.source).toBe('markdown')
    expect(result.skillName).toBe('inventory-helper')
    expect(result.markdown).toMatch(/^---\nname: inventory-helper\n/)
    expect(result.markdown).toContain('allowed-tools: Bash(webcli call *)')
    expect(result.files.size).toBe(0)
  })

  it('lets the caller override the skill name', async () => {
    const result = await importSkillFromPath(write('notes.md', SKILL), 'staging-helper')
    expect(result.skillName).toBe('staging-helper')
    expect(result.markdown).toMatch(/^---\nname: staging-helper\n/)
  })

  it('imports a deflated ZIP with SKILL.md at the root and resource files', async () => {
    const archive = await buildDeflatedZip({
      'SKILL.md': SKILL,
      'reference/fields.md': '# Fields\n\nSKU, quantity, warehouse.\n',
      'templates/reply.txt': 'Stock for {sku}: {quantity}\n',
    })
    const result = await importSkillFromPath(write('inventory.zip', archive))
    expect(result.source).toBe('zip')
    expect(result.skillName).toBe('inventory-helper')
    expect([...result.files.keys()].sort()).toEqual(['reference/fields.md', 'templates/reply.txt'])
    expect(result.files.get('templates/reply.txt')?.toString('utf8')).toBe('Stock for {sku}: {quantity}\n')
  })

  it('unwraps exactly one top-level folder', async () => {
    const archive = await buildDeflatedZip({
      'inventory-helper/SKILL.md': SKILL,
      'inventory-helper/notes/orders.md': 'orders.example.com uses order numbers.\n',
    })
    const result = await importSkillFromPath(write('wrapped.zip', archive))
    expect([...result.files.keys()]).toEqual(['notes/orders.md'])
  })

  it('accepts explicit directory entries in stored archives', async () => {
    const archive = buildStoredZip([
      { name: 'pack/' },
      { name: 'pack/SKILL.md', data: SKILL },
      { name: 'pack/docs/' },
      { name: 'pack/docs/readme.txt', data: 'example.org\n' },
    ])
    const result = await importSkillFromPath(write('stored.zip', archive))
    expect([...result.files.keys()]).toEqual(['docs/readme.txt'])
  })

  it.each([
    ['path traversal', [{ name: 'SKILL.md', data: SKILL }, { name: '../evil.txt', data: 'x' }], '不安全路径'],
    ['nested traversal', [{ name: 'SKILL.md', data: SKILL }, { name: 'docs/../../evil.txt', data: 'x' }], '不安全路径'],
    ['absolute path', [{ name: 'SKILL.md', data: SKILL }, { name: '/etc/evil.txt', data: 'x' }], '绝对路径'],
    ['drive path', [{ name: 'SKILL.md', data: SKILL }, { name: 'C:/evil.txt', data: 'x' }], '绝对路径'],
    ['backslash path', [{ name: 'SKILL.md', data: SKILL }, { name: 'docs\\evil.txt', data: 'x' }], '不安全路径'],
    ['symbolic link', [{ name: 'SKILL.md', data: SKILL }, { name: 'link', data: '/etc/passwd', unixMode: 0o120777 }], '符号链接'],
    ['special file', [{ name: 'SKILL.md', data: SKILL }, { name: 'fifo', data: '', unixMode: 0o010644 }], '特殊文件'],
    ['encrypted entry', [{ name: 'SKILL.md', data: SKILL, flags: 0x1 }], '加密'],
    ['two top-level folders', [{ name: 'a/SKILL.md', data: SKILL }, { name: 'b/notes.md', data: 'x' }], '外层目录'],
    ['missing SKILL.md', [{ name: 'pack/notes.md', data: 'x' }], '缺少 SKILL.md'],
    ['oversized resource', [{ name: 'SKILL.md', data: SKILL }, { name: 'big.bin', data: 'x', declaredSize: 3 * 1024 * 1024 }], '过大'],
  ] as Array<[string, RawEntry[], string]>)('rejects %s', async (_label, entries, message) => {
    await expect(importSkillFromPath(write('bad.zip', buildStoredZip(entries)))).rejects.toThrow(message)
  })

  it('rejects too many entries before decompressing', () => {
    const entries: RawEntry[] = [{ name: 'SKILL.md', data: SKILL }]
    for (let index = 0; index < 128; index += 1) entries.push({ name: `docs/${index}.txt`, data: 'x' })
    expect(() => inspectZipEntries(buildStoredZip(entries))).toThrow('ZIP 文件数量')
  })

  it('rejects archives whose declared sizes exceed the expanded limit', () => {
    const entries: RawEntry[] = [{ name: 'SKILL.md', data: SKILL }]
    for (let index = 0; index < 5; index += 1) entries.push({ name: `docs/${index}.bin`, data: 'x', declaredSize: 2 * 1024 * 1024 })
    expect(() => inspectZipEntries(buildStoredZip(entries))).toThrow('8 MB')
  })

  it('rejects entries whose data does not match the central directory size', async () => {
    const archive = buildStoredZip([
      { name: 'SKILL.md', data: SKILL },
      { name: 'docs/a.txt', data: 'actual content that is longer', centralOnlySize: 4 },
    ])
    await expect(importSkillFromPath(write('mismatch.zip', archive))).rejects.toThrow('不一致')
  })

  it('rejects unsupported file types, missing and empty files', async () => {
    await expect(importSkillFromPath(write('skill.txt', SKILL))).rejects.toThrow('.md 或 .zip')
    await expect(importSkillFromPath(write('empty.md', ''))).rejects.toThrow('为空')
    await expect(importSkillFromPath(path.join(dir, 'missing.md'))).rejects.toThrow('不存在')
    await expect(importSkillFromPath('')).rejects.toThrow('请选择')
  })

  it('rejects non-UTF-8 Markdown', async () => {
    await expect(importSkillFromPath(write('binary.md', Buffer.from([0xff, 0xfe, 0x00, 0x41])))).rejects.toThrow('UTF-8')
  })

  it('rejects files that are not ZIP archives', async () => {
    await expect(importSkillFromPath(write('fake.zip', 'not a zip archive at all'))).rejects.toThrow()
  })
})
