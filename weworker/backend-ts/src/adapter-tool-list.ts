/**
 * Resolve adapter tool lists by merging static index.js tools with dynamically
 * registered tools from webcli-generated support files.
 *
 * Keeps adapter-parser.ts unchanged; call resolveAdapterToolList() when a full
 * tool catalog (including registerTool-based modules) is needed.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { ParsedAdapter, StaticToolDef, ToolExecution } from './adapter-parser.js'

export type AdapterManifestForTools = {
  support_files?: string[]
  tool_execution?: Record<string, { type?: string; runtime?: string }>
}

const GENERATED_TOOLS_SUBDIR = path.join('webcli-generated', 'tools')

function readManifest(adapterDir: string): AdapterManifestForTools | null {
  const manifestPath = path.join(adapterDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return null
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as AdapterManifestForTools
  } catch {
    return null
  }
}

/**
 * Locate candidate JS files that may define tools via registerTool().
 * Scans webcli-generated/tools/*.js and relevant manifest.support_files entries.
 */
export function findAdapterToolSourceFiles(
  adapterDir: string,
  manifest?: AdapterManifestForTools | null,
): string[] {
  const files = new Set<string>()

  const generatedToolsDir = path.join(adapterDir, GENERATED_TOOLS_SUBDIR)
  if (fs.existsSync(generatedToolsDir)) {
    for (const entry of fs.readdirSync(generatedToolsDir)) {
      if (entry.endsWith('.js')) {
        files.add(path.join(generatedToolsDir, entry))
      }
    }
  }

  for (const relPath of manifest?.support_files ?? []) {
    if (typeof relPath !== 'string' || !relPath.endsWith('.js')) continue
    if (relPath.includes('.runtime.') || relPath.includes('.site-entry.')) continue
    const absPath = path.join(adapterDir, relPath)
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) continue
    if (relPath.replace(/\\/g, '/').includes(`${GENERATED_TOOLS_SUBDIR.replace(/\\/g, '/')}/`)) {
      files.add(absPath)
      continue
    }
    try {
      const source = fs.readFileSync(absPath, 'utf-8')
      if (/registerTool\s*\(/.test(source)) {
        files.add(absPath)
      }
    } catch { /* skip unreadable file */ }
  }

  return [...files].sort()
}

function extractToolDescription(block: string): string {
  const descSingle = block.match(/description\s*:\s*\n?\s*'([^']*(?:'\s*\+\s*'[^']*)*)'/)
  const descDouble = block.match(/description\s*:\s*\n?\s*"([^"]*)"/)
  const descTmpl = block.match(/description\s*:\s*\n?\s*`([^`]*)`/)
  if (descSingle) return descSingle[1].replace(/'\s*\+\s*'/g, '')
  if (descDouble) return descDouble[1]
  if (descTmpl) return descTmpl[1].replace(/\s+/g, ' ').trim()
  return ''
}

function extractParameters(block: string): Record<string, unknown> {
  const paramMatch = block.match(/parameters\s*:\s*\{/)
  if (!paramMatch) return { type: 'object', properties: {}, required: [] }

  const start = paramMatch.index! + paramMatch[0].length - 1
  let depth = 0
  let end = start
  for (let i = start; i < block.length; i++) {
    if (block[i] === '{') depth++
    else if (block[i] === '}') {
      depth--
      if (depth === 0) { end = i + 1; break }
    }
  }

  const paramStr = block.slice(start, end)
  try {
    const jsonStr = paramStr
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/(\{|,)\s*(\w+)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
    return JSON.parse(jsonStr)
  } catch {
    return extractParametersManual(paramStr)
  }
}

function extractParametersManual(paramStr: string): Record<string, unknown> {
  const result: Record<string, unknown> = { type: 'object', properties: {}, required: [] }
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  const propsMatch = paramStr.match(/properties\s*:\s*\{/)
  if (propsMatch) {
    const propsBlock = paramStr.slice(propsMatch.index! + propsMatch[0].length)
    const propRe = /(\w+)\s*:\s*\{([^}]*)\}/g
    let m: RegExpExecArray | null
    while ((m = propRe.exec(propsBlock)) !== null) {
      const prop: Record<string, unknown> = {}
      const typeMatch = m[2].match(/type\s*:\s*['"`](\w+)['"`]/)
      if (typeMatch) prop.type = typeMatch[1]
      const descMatch = m[2].match(/description\s*:\s*['"`]([^'"`]*)['"`]/)
      if (descMatch) prop.description = descMatch[1]
      const enumMatch = m[2].match(/enum\s*:\s*\[([^\]]*)\]/)
      if (enumMatch) {
        prop.enum = enumMatch[1].split(',').map((s) => s.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean)
      }
      properties[m[1]] = prop
    }
  }

  const reqMatch = paramStr.match(/required\s*:\s*\[([^\]]*)\]/g)
  if (reqMatch) {
    const lastReq = reqMatch[reqMatch.length - 1]
    const innerMatch = lastReq.match(/\[([^\]]*)\]/)
    if (innerMatch) {
      required.push(...innerMatch[1].split(',').map((s) => s.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean))
    }
  }

  result.properties = properties
  result.required = required
  return result
}

/**
 * Parse tool definitions from a generated adapter module that calls registerTool().
 */
export function parseRegisterToolFile(filePath: string): StaticToolDef[] {
  const tools: StaticToolDef[] = []
  try {
    const source = fs.readFileSync(filePath, 'utf-8')
    const registerRe = /registerTool\s*\(\s*[^,]+,\s*\{/g
    let match: RegExpExecArray | null

    while ((match = registerRe.exec(source)) !== null) {
      const block = source.slice(match.index + match[0].indexOf('{'))
      const nameSingle = block.match(/^\{\s*\n?\s*name\s*:\s*'([^']+)'/)
      const nameDouble = block.match(/^\{\s*\n?\s*name\s*:\s*"([^"]+)"/)
      const nameTmpl = block.match(/^\{\s*\n?\s*name\s*:\s*`([^`]+)`/)
      const toolName = nameSingle?.[1] || nameDouble?.[1] || nameTmpl?.[1]
      if (!toolName) continue
      const metadataEnd = [block.search(/description\s*:/), block.search(/parameters\s*:/)]
        .filter((index) => index > 0)
        .sort((a, b) => a - b)[0] ?? block.length
      const metadataBlock = block.slice(0, metadataEnd)

      tools.push({
        name: toolName,
        description: extractToolDescription(block),
        parameters: extractParameters(block),
        directCapable: /directCapable\s*:\s*true/.test(metadataBlock),
        executionMode: metadataBlock.match(/executionMode\s*:\s*['"`]([^'"`]+)['"`]/)?.[1],
      })
    }
  } catch { /* skip unreadable file */ }

  return tools
}

/**
 * Parse all dynamically registered tools under an adapter directory.
 */
export function parseDynamicAdapterTools(
  adapterDir: string,
  manifest?: AdapterManifestForTools | null,
): StaticToolDef[] {
  const resolvedManifest = manifest ?? readManifest(adapterDir)
  const files = findAdapterToolSourceFiles(adapterDir, resolvedManifest)
  const byName = new Map<string, StaticToolDef>()
  for (const filePath of files) {
    for (const tool of parseRegisterToolFile(filePath)) {
      if (tool.name) byName.set(tool.name, tool)
    }
  }
  return [...byName.values()]
}

type WecliGeneratedCommand = {
  id?: string
  command?: string
  publicName?: string
  description?: string
  parameters?: Record<string, unknown>
  execution?: ToolExecution
  directCapable?: boolean
  executionMode?: string
}

type WecliGeneratedManifest = {
  registeredCommands?: WecliGeneratedCommand[]
  blockedCommands?: string[]
}

/**
 * Parse tools from `wecli.generated.json` — the code-generator's authoritative
 * command manifest. This is the third tool source (besides static index.js tools
 * and dynamic registerTool modules).
 *
 * Why: some adapters only expose their tools via a runtime `...VAR`
 * spread in index.js AND a variable-form `registerTool(siteKey, definition)` in
 * their generated JS. Neither static parsing nor parseRegisterToolFile can expand
 * those, so the tools fall out of the catalog entirely. wecli.generated.json lists
 * every generated command with full metadata (publicName/parameters/execution/
 * directCapable), so reading it recovers them directly. Returns [] when absent.
 */
export function parseWecliGeneratedTools(adapterDir: string): StaticToolDef[] {
  const jsonPath = path.join(adapterDir, 'wecli.generated.json')
  let raw: WecliGeneratedManifest
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
  } catch {
    return []
  }

  const blocked = new Set(raw.blockedCommands ?? [])
  const byName = new Map<string, StaticToolDef>()
  for (const cmd of raw.registeredCommands ?? []) {
    const name = cmd.publicName || cmd.id
    if (!name) continue
    if ((cmd.command && blocked.has(cmd.command)) || (cmd.id && blocked.has(cmd.id))) continue
    byName.set(name, {
      name,
      description: cmd.description ?? '',
      parameters: cmd.parameters ?? { type: 'object', properties: {}, required: [] },
      ...(cmd.execution ? { execution: cmd.execution } : {}),
      ...(cmd.directCapable ? { directCapable: true } : {}),
      ...(cmd.executionMode ? { executionMode: cmd.executionMode } : {}),
    })
  }
  return [...byName.values()]
}

/**
 * Merge tool lists by name; later groups override earlier ones with the same name.
 */
export function mergeAdapterToolsByName(...groups: StaticToolDef[][]): StaticToolDef[] {
  const byName = new Map<string, StaticToolDef>()
  for (const group of groups) {
    for (const tool of group) {
      if (tool.name) byName.set(tool.name, tool)
    }
  }
  return [...byName.values()]
}

/**
 * Resolve the full tool list for one adapter: static index.js tools plus dynamic
 * registerTool modules. Dynamic tools with duplicate names override static ones.
 */
export function resolveAdapterToolList(options: {
  adapterDir: string
  staticTools?: StaticToolDef[]
  manifest?: AdapterManifestForTools | null
}): StaticToolDef[] {
  const staticTools = options.staticTools ?? []
  const dynamicTools = parseDynamicAdapterTools(options.adapterDir, options.manifest)
  const wecliTools = parseWecliGeneratedTools(options.adapterDir)
  return mergeAdapterToolsByName(staticTools, dynamicTools, wecliTools)
}

/**
 * Resolve tools for a ParsedAdapter from parseAllAdapters().
 */
export function resolveToolsForAdapter(
  adapter: ParsedAdapter,
  adaptersDir: string | null,
): StaticToolDef[] {
  if (adapter.managed) return adapter.tools
  const tools = !adaptersDir ? adapter.tools : resolveAdapterToolList({
    adapterDir: path.join(adaptersDir, adapter.id),
    staticTools: adapter.tools,
  })
  return tools.map((tool) => {
    const execution = adapter.toolExecution?.[tool.name] ?? tool.execution
    const direct = execution?.type === 'api' && execution?.runtime === 'background'
    if (!execution && !tool.directCapable && tool.executionMode !== 'direct') return tool
    return {
      ...tool,
      ...(execution ? { execution } : {}),
      ...(direct || tool.directCapable || tool.executionMode === 'direct'
        ? { directCapable: true, executionMode: 'direct' }
        : {}),
    }
  })
}

/**
 * Find the adapters directory (same candidates as adapter-parser).
 */
export function findAdaptersDirectory(): string | null {
  const resourcesPath = process.env.WEWORKER_RESOURCES_PATH || ''
  const candidates = [
    ...(resourcesPath ? [path.join(resourcesPath, 'extension', 'adapters')] : []),
    path.join(process.cwd(), '..', '..', 'extension', 'adapters'),
    path.join(process.cwd(), '..', 'extension', 'adapters'),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'extension', 'adapters'),
  ]

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        const entries = fs.readdirSync(dir)
        if (entries.some((e) => fs.existsSync(path.join(dir, e, 'manifest.json')))) {
          return dir
        }
      }
    } catch { /* skip */ }
  }
  return null
}
