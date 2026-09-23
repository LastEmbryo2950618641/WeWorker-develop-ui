import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── 站点列名映射（中文列名静态文件）───────────────────────────────────────

let columnMappingsCache = null
let migratedCommandsCache = null
let columnAliasesCache = null

function loadMigratedCommandsMap() {
  if (migratedCommandsCache) return migratedCommandsCache
  try {
    const jsonUrl = new URL('./wecli-migrated-commands.json', import.meta.url)
    migratedCommandsCache = JSON.parse(fs.readFileSync(jsonUrl, 'utf8'))
  } catch {
    migratedCommandsCache = {}
  }
  return migratedCommandsCache
}

function loadColumnAliasesMap() {
  if (columnAliasesCache) return columnAliasesCache
  try {
    const jsonUrl = new URL('./wecli-column-aliases.json', import.meta.url)
    columnAliasesCache = JSON.parse(fs.readFileSync(jsonUrl, 'utf8'))
  } catch {
    columnAliasesCache = {}
  }
  return columnAliasesCache
}

/**
 * 加载站点列名映射：直接合并 webcli/wecli-columns/*.json（每站点一个可维护静态文件）。
 * 懒加载并缓存；目录缺失时返回空映射（渲染退化为全字段 table）。
 * 人工修改站点文件后，下次 CLI 调用（新进程）自动生效。
 * 容错：单个站点文件损坏/不可读时仅跳过该文件并提示，不影响其他站点。
 * @param {string} [dirPath] 测试用目录覆盖；生产不传（默认 wecli-columns/）
 */
export function loadColumnMappingsMap(dirPath) {
  if (columnMappingsCache && !dirPath) return columnMappingsCache
  const merged = {}
  let dir
  try {
    dir = dirPath || fileURLToPath(new URL('./wecli-columns/', import.meta.url))
  } catch {
    columnMappingsCache = merged
    return merged
  }
  try {
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json')) continue
        try {
          const siteMap = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
          if (siteMap && typeof siteMap === 'object' && !Array.isArray(siteMap)) {
            Object.assign(merged, siteMap)
          }
        } catch (error) {
          // 单个站点文件损坏/不可读：跳过该文件，不影响其他站点映射
          process.stderr.write(`[WebCLI] 跳过损坏的列名映射文件 ${file}: ${error?.message || error}\n`)
        }
      }
    }
  } catch (error) {
    // 目录整体不可读（极少见）：退化为空映射
    process.stderr.write(`[WebCLI] 无法读取列名映射目录: ${error?.message || error}\n`)
  }
  columnMappingsCache = merged
  return columnMappingsCache
}

/**
 * 按工具名查询列名映射（{ 字段: 中文 }）。解析链：
 * 1) 精确命中公开工具名（webcli call tickets.example.com.get_ticket_detail）
 * 2) WeCLI 简写（webcli tickets detail → tickets.detail）经迁移映射反查公开工具名
 * 3) catalog 别名（pipeline.params → pipeline.update-params）再走迁移反查
 * 4) 无映射返回 undefined（渲染为全字段 table）
 */
export function lookupColumnMapping(name) {
  if (!name) return undefined
  const map = loadColumnMappingsMap()
  if (map[name]) return map[name]
  const migrated = loadMigratedCommandsMap()
  const publicName = migrated[name]?.publicName
  if (publicName && map[publicName]) return map[publicName]
  const aliases = loadColumnAliasesMap()
  const canonical = aliases[name]
  if (canonical) {
    const canonicalPublicName = migrated[canonical]?.publicName
    if (canonicalPublicName && map[canonicalPublicName]) return map[canonicalPublicName]
    if (map[canonical]) return map[canonical]
  }
  return undefined
}
