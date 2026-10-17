/**
 * Safe import for user-selected dedicated-agent Skill files.
 *
 * Accepted input:
 * - one UTF-8 .md file (becomes SKILL.md)
 * - one ZIP containing SKILL.md at the archive root, optionally wrapped in one
 *   top-level directory and with ordinary resource files.
 *
 * Archives are validated from their ZIP central directory before yauzl
 * decompresses them (in memory, with per-entry size checks). No symlinks,
 * encrypted entries, traversal, ZIP64, special files, oversized archives, or
 * arbitrary nested wrapper layouts are allowed.
 */
import fs from 'node:fs'
import path from 'node:path'
import yauzl from 'yauzl'
import { DedicatedAgentError, normalizeSkillName } from './agent-store.js'
import { normalizeSkillMarkdown } from './skill-author.js'

const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024
const MAX_FILES = 128
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024
const MAX_RESOURCE_BYTES = 2 * 1024 * 1024
const MAX_SKILL_BYTES = 200 * 1024
const MAX_PATH_DEPTH = 8
const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const ZIP64_SENTINEL_16 = 0xffff
const ZIP64_SENTINEL_32 = 0xffffffff

type ZipEntry = { name: string; size: number; isDirectory: boolean }
export type ImportedSkill = { skillName: string; markdown: string; files: Map<string, Buffer>; source: 'markdown' | 'zip' }

function invalid(message: string): never {
  throw new DedicatedAgentError(message)
}

function assertRegularSource(sourcePath: unknown): { resolved: string; extension: string } {
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) invalid('请选择要导入的文件')
  const resolved = path.resolve(sourcePath)
  let stat: fs.Stats
  try { stat = fs.lstatSync(resolved) } catch { invalid('选择的文件不存在') }
  if (!stat.isFile() || stat.isSymbolicLink()) invalid('只能导入普通文件，不能导入符号链接')
  const extension = path.extname(resolved).toLowerCase()
  if (extension !== '.md' && extension !== '.zip') invalid('只支持导入 .md 或 .zip 文件')
  const limit = extension === '.zip' ? MAX_ARCHIVE_BYTES : MAX_SKILL_BYTES
  if (stat.size <= 0) invalid('导入文件为空')
  if (stat.size > limit) invalid(extension === '.zip' ? 'ZIP 包超过 4 MB 限制' : 'Markdown 文件超过 200 KB 限制')
  return { resolved, extension }
}

function assertUtf8(bytes: Buffer, label: string): string {
  if (bytes.includes(0)) invalid(`${label} 不是 UTF-8 文本文件`)
  const text = bytes.toString('utf8')
  if (text.includes('\uFFFD')) invalid(`${label} 不是有效的 UTF-8 文本文件`)
  return text
}

function safeArchivePath(name: string): string {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0')) invalid(`ZIP 包含不安全路径：${String(name)}`)
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) invalid(`ZIP 包含绝对路径：${name}`)
  const raw = name.endsWith('/') ? name.slice(0, -1) : name
  if (!raw) return ''
  const parts = raw.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) invalid(`ZIP 包含不安全路径：${name}`)
  if (parts.length > MAX_PATH_DEPTH) invalid(`ZIP 内目录层级超过 ${MAX_PATH_DEPTH} 层`)
  return raw
}

/**
 * The local file header must agree with its central-directory entry, so the
 * name and sizes validated here are the ones the extractor actually reads.
 */
function assertLocalHeaderMatches(bytes: Buffer, centralOffset: number, localOffset: number): void {
  if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) invalid('ZIP 文件头无效')
  const centralFlags = bytes.readUInt16LE(centralOffset + 8)
  const localFlags = bytes.readUInt16LE(localOffset + 6)
  if ((centralFlags & 0x1) !== (localFlags & 0x1)) invalid('ZIP 文件头与目录信息不一致')
  const nameLength = bytes.readUInt16LE(centralOffset + 28)
  if (bytes.readUInt16LE(localOffset + 26) !== nameLength) invalid('ZIP 文件头与目录信息不一致')
  const centralName = bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength)
  const localName = bytes.subarray(localOffset + 30, localOffset + 30 + nameLength)
  if (!centralName.equals(localName)) invalid('ZIP 文件头与目录信息不一致')
  // With a data descriptor (bit 3) the local sizes are zero; yauzl then checks the real size.
  if (localFlags & 0x8) return
  if (bytes.readUInt32LE(localOffset + 18) !== bytes.readUInt32LE(centralOffset + 20)
    || bytes.readUInt32LE(localOffset + 22) !== bytes.readUInt32LE(centralOffset + 24)) {
    invalid('ZIP 文件头与目录信息不一致')
  }
}

/** Read central-directory metadata first, so size/path checks happen pre-unzip. */
export function inspectZipEntries(input: Buffer): ZipEntry[] {
  const bytes = Buffer.from(input)
  if (bytes.length < 22) invalid('不是有效的 ZIP 文件')
  let eocd = -1
  const start = Math.max(0, bytes.length - 0xffff - 22)
  for (let index = bytes.length - 22; index >= start; index -= 1) {
    if (bytes.readUInt32LE(index) === EOCD_SIGNATURE) { eocd = index; break }
  }
  if (eocd < 0) invalid('ZIP 文件缺少目录信息')
  const disk = bytes.readUInt16LE(eocd + 4)
  const centralDisk = bytes.readUInt16LE(eocd + 6)
  const entryCount = bytes.readUInt16LE(eocd + 10)
  const centralSize = bytes.readUInt32LE(eocd + 12)
  const centralOffset = bytes.readUInt32LE(eocd + 16)
  if (disk !== 0 || centralDisk !== 0 || entryCount === ZIP64_SENTINEL_16 || centralSize === ZIP64_SENTINEL_32 || centralOffset === ZIP64_SENTINEL_32) {
    invalid('不支持分卷或 ZIP64 格式的压缩包')
  }
  if (!entryCount || entryCount > MAX_FILES) invalid(`ZIP 文件数量必须在 1 到 ${MAX_FILES} 之间`)
  if (centralOffset + centralSize > bytes.length) invalid('ZIP 目录信息无效')

  const entries: ZipEntry[] = []
  let total = 0
  let offset = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== CENTRAL_SIGNATURE) invalid('ZIP 中央目录条目无效')
    const flags = bytes.readUInt16LE(offset + 8)
    const uncompressedSize = bytes.readUInt32LE(offset + 24)
    const fileNameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const externalAttributes = bytes.readUInt32LE(offset + 38)
    const localOffset = bytes.readUInt32LE(offset + 42)
    const end = offset + 46 + fileNameLength + extraLength + commentLength
    if (end > bytes.length || uncompressedSize === ZIP64_SENTINEL_32 || localOffset === ZIP64_SENTINEL_32) invalid('不支持 ZIP64 条目')
    if (flags & 0x1) invalid('不支持加密 ZIP 包')
    assertLocalHeaderMatches(bytes, offset, localOffset)
    // Unix mode lives in the upper 16 bits. Reject symbolic links and special files.
    const unixMode = externalAttributes >>> 16
    const fileType = unixMode & 0o170000
    if (fileType && fileType !== 0o100000 && fileType !== 0o040000) invalid('ZIP 不能包含符号链接或特殊文件')
    const rawName = assertUtf8(bytes.subarray(offset + 46, offset + 46 + fileNameLength), 'ZIP 路径')
    const isDirectory = rawName.endsWith('/')
    const name = safeArchivePath(rawName)
    if (name) {
      if (!isDirectory) {
        if (uncompressedSize > MAX_RESOURCE_BYTES && path.posix.basename(name) !== 'SKILL.md') invalid(`ZIP 中单个资料文件过大：${name}`)
        total += uncompressedSize
        if (total > MAX_EXPANDED_BYTES) invalid('ZIP 解压后总大小超过 8 MB 限制')
      }
      entries.push({ name, size: uncompressedSize, isDirectory })
    }
    offset = end
  }
  return entries
}

function unwrapArchive(entries: ZipEntry[]): { wrapper: string; files: ZipEntry[] } {
  const files = entries.filter((entry) => !entry.isDirectory)
  if (!files.length) invalid('ZIP 包中没有文件')
  const rootSkill = files.find((entry) => entry.name === 'SKILL.md')
  if (rootSkill) return { wrapper: '', files }
  const prefixes = new Set(files.map((entry) => entry.name.split('/')[0]))
  if (prefixes.size !== 1) invalid('ZIP 包必须在根目录包含 SKILL.md，或只包含一个外层目录')
  const wrapper = [...prefixes][0]
  const unwrapped = files.map((entry) => ({ ...entry, name: entry.name.slice(wrapper.length + 1) }))
  if (!unwrapped.some((entry) => entry.name === 'SKILL.md')) invalid('ZIP 包缺少 SKILL.md')
  return { wrapper, files: unwrapped }
}

function normalizeResourcePath(name: string): string {
  const safe = safeArchivePath(name)
  if (!safe || safe === 'SKILL.md' || safe === 'SKILL.md.disabled') return safe
  return safe
}

/**
 * Decompress only the file entries already accepted by inspectZipEntries.
 * Each entry is capped at its declared size, so a forged header cannot expand
 * past the validated limits; yauzl also verifies the actual decompressed size.
 */
function extractArchive(bytes: Buffer, expected: Map<string, number>): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(new DedicatedAgentError('无法解压 ZIP 文件'))
        return
      }
      const extracted = new Map<string, Buffer>()
      let settled = false
      const fail = (message: string) => {
        if (settled) return
        settled = true
        zipFile.close()
        reject(new DedicatedAgentError(message))
      }
      zipFile.on('error', () => fail('无法解压 ZIP 文件'))
      zipFile.on('end', () => {
        if (settled) return
        settled = true
        resolve(extracted)
      })
      zipFile.on('entry', (entry: yauzl.Entry) => {
        if (settled) return
        const name = entry.fileName.endsWith('/') ? entry.fileName.slice(0, -1) : entry.fileName
        if (entry.fileName.endsWith('/') || !expected.has(name)) {
          zipFile.readEntry()
          return
        }
        if (extracted.has(name)) {
          fail(`ZIP 包含重复或无效文件：${name}`)
          return
        }
        const limit = expected.get(name)!
        if (entry.uncompressedSize !== limit) {
          fail(`ZIP 文件内容校验失败：${name}`)
          return
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail('无法解压 ZIP 文件')
            return
          }
          const chunks: Buffer[] = []
          let size = 0
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > limit) {
              stream.destroy()
              fail(`ZIP 文件内容校验失败：${name}`)
              return
            }
            chunks.push(chunk)
          })
          stream.on('error', () => fail('无法解压 ZIP 文件'))
          stream.on('end', () => {
            if (settled) return
            extracted.set(name, Buffer.concat(chunks, size))
            zipFile.readEntry()
          })
        })
      })
      zipFile.readEntry()
    })
  })
}

export async function importSkillFromPath(sourcePath: unknown, requestedName = ''): Promise<ImportedSkill> {
  const { resolved, extension } = assertRegularSource(sourcePath)
  const bytes = fs.readFileSync(resolved)
  if (extension === '.md') {
    const source = assertUtf8(bytes, 'Markdown 文件')
    const skillName = normalizeSkillName(requestedName || readFrontmatterName(source) || path.basename(resolved, extension))
    if (!skillName) invalid('请填写 Skill 名称')
    return { skillName, markdown: normalizeSkillMarkdown(source, skillName), files: new Map(), source: 'markdown' }
  }

  const entries = inspectZipEntries(bytes)
  const { wrapper, files } = unwrapArchive(entries)
  const expected = new Map(files.map((entry) => [wrapper ? `${wrapper}/${entry.name}` : entry.name, entry.size]))
  const archive = await extractArchive(bytes, expected)
  const normalized = new Map<string, Buffer>()
  for (const entry of files) {
    const archiveName = wrapper ? `${wrapper}/${entry.name}` : entry.name
    const content = archive.get(archiveName)
    if (!content || content.length !== entry.size) invalid(`ZIP 文件内容校验失败：${entry.name}`)
    const name = normalizeResourcePath(entry.name)
    if (!name || name === 'SKILL.md.disabled') invalid(`ZIP 包含不支持的文件：${entry.name}`)
    if (normalized.has(name)) invalid(`ZIP 包含重复或无效文件：${entry.name}`)
    normalized.set(name, Buffer.from(content))
  }
  const skillBytes = normalized.get('SKILL.md')
  if (!skillBytes) invalid('ZIP 包缺少 SKILL.md')
  if (skillBytes.length > MAX_SKILL_BYTES) invalid('SKILL.md 超过 200 KB 限制')
  const source = assertUtf8(skillBytes, 'SKILL.md')
  normalized.delete('SKILL.md')
  normalized.delete('SKILL.md.disabled')
  const skillName = normalizeSkillName(requestedName || readFrontmatterName(source) || path.basename(resolved, extension))
  if (!skillName) invalid('请填写 Skill 名称')
  return { skillName, markdown: normalizeSkillMarkdown(source, skillName), files: normalized, source: 'zip' }
}

function readFrontmatterName(markdown: string): string {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
  const line = frontmatter.split(/\r?\n/).find((item) => /^\s*name\s*:/.test(item)) ?? ''
  return line.replace(/^\s*name\s*:\s*/, '').trim().replace(/^['"]|['"]$/g, '')
}
