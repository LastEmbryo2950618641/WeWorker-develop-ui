/** Shared Adapter catalog snapshot for prompt, Skill and management reads. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  buildDesktopAdapterCatalog,
  createManagedAdapterSkillValidator,
  readDesktopAdapterCatalogInputs,
  refreshDesktopAdapterSkills,
  type DesktopAdapterCatalog,
  type DesktopAdapterPaths,
  type DesktopAdapterState,
} from '../../../webcli/adapter-desktop.js'

let cached: { key: string; catalog: DesktopAdapterCatalog } | null = null

function readOptional(file: string): string {
  try { return fs.readFileSync(file, 'utf8') } catch { return '' }
}

function listNames(dir: string): string[] {
  try { return fs.readdirSync(dir).sort() } catch { return [] }
}

function statTree(root: string, out: string[], depth = 0): void {
  if (depth > 8) return
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(root, { withFileTypes: true }) }
  catch { out.push(`${root}:missing`); return }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) statTree(file, out, depth + 1)
    else {
      try {
        const stat = fs.lstatSync(file)
        out.push(`${file}:${stat.size}:${stat.mtimeMs}`)
      } catch { out.push(`${file}:gone`) }
    }
  }
}

export function adapterCatalogCacheKey(paths: DesktopAdapterPaths, state: DesktopAdapterState): string {
  const developmentStats: string[] = []
  for (const record of Object.values(state.development ?? {})) {
    if (record?.root) statTree(record.root, developmentStats)
  }
  const installedStats: string[] = []
  for (const [name, record] of Object.entries(state.installations ?? {})) {
    if (record?.digest && /^[a-f0-9]{64}$/.test(record.digest)) {
      statTree(path.join(paths.packageDir, record.digest, name), installedStats)
    }
  }
  return createHash('sha256').update(JSON.stringify({
    profile: paths.profile,
    builtinDir: paths.builtinDir,
    userDir: paths.userDir,
    packageDir: paths.packageDir,
    state,
    builtinProfile: readOptional(path.join(paths.builtinDir, '.profile.json')),
    builtinEntries: listNames(paths.builtinDir),
    userEntries: listNames(paths.userDir),
    developmentStats,
    installedStats,
  })).digest('hex')
}

export function getDesktopAdapterCatalog(): DesktopAdapterCatalog {
  let inputs: ReturnType<typeof readDesktopAdapterCatalogInputs>
  try { inputs = readDesktopAdapterCatalogInputs() }
  catch { cached = null; return buildDesktopAdapterCatalog() }
  const key = adapterCatalogCacheKey(inputs.paths, inputs.state)
  if (cached?.key === key) return cached.catalog
  const catalog = buildDesktopAdapterCatalog({ paths: inputs.paths, state: inputs.state })
  cached = { key, catalog }
  return catalog
}

let lastSkillRefresh: { target: string; catalog: DesktopAdapterCatalog; stamp: string } | null = null

function managedSkillTargetStamp(target: string): string {
  const parts: string[] = []
  try {
    parts.push(`root:${fs.statSync(target).mtimeMs}`)
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('webcli-')) {
        parts.push(`${entry.name}:${fs.statSync(path.join(target, entry.name)).mtimeMs}`)
      }
    }
  } catch { parts.push('unreadable') }
  return parts.sort().join('|')
}

export function clearDesktopAdapterCatalogCache(): void {
  cached = null
  lastSkillRefresh = null
}

export function refreshDesktopAdapterSkillsIfStale(target: string): { skipped: boolean } {
  const catalog = getDesktopAdapterCatalog()
  const stamp = managedSkillTargetStamp(target)
  if (lastSkillRefresh?.target === target && lastSkillRefresh.catalog === catalog && lastSkillRefresh.stamp === stamp) {
    return { skipped: true }
  }
  lastSkillRefresh = null
  refreshDesktopAdapterSkills(target, { catalog })
  lastSkillRefresh = { target, catalog, stamp: managedSkillTargetStamp(target) }
  return { skipped: false }
}

export function createCachedManagedAdapterSkillValidator(): ReturnType<typeof createManagedAdapterSkillValidator> {
  return createManagedAdapterSkillValidator({ get catalog() { return getDesktopAdapterCatalog() } })
}
