/**
 * Shared desktop Adapter catalog snapshot.
 *
 * Building the catalog reads and hashes every package file. One chat turn used
 * to build it four or more times (system prompt, Skill refresh, Skill index,
 * Skill replay), costing about 0.5 s each on Windows. The snapshot is reused
 * while its inputs are unchanged:
 * - registry state (installations, selections, development roots, revision);
 * - built-in profile metadata, which pins every built-in package digest;
 * - top-level entries of the built-in and user Adapter roots;
 * - size and mtime of files in development roots, which are edited in place,
 *   and in installed user package snapshots (normally immutable and few).
 * Built-in package contents are pinned by the profile metadata; an in-place
 * edit that keeps the metadata is seen after the next registry or profile change.
 *
 * This snapshot only feeds prompts, Skill files and management views.
 * `webcli call` builds and verifies its own catalog before executing package code.
 */
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
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function listNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort()
  } catch {
    return []
  }
}

/** Development roots are small source trees; stat them so in-place edits are seen. */
function statTree(root: string, out: string[], depth = 0): void {
  if (depth > 8) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    out.push(`${root}:missing`)
    return
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) {
      statTree(file, out, depth + 1)
    } else {
      try {
        const stat = fs.lstatSync(file)
        out.push(`${file}:${stat.size}:${stat.mtimeMs}`)
      } catch {
        out.push(`${file}:gone`)
      }
    }
  }
}

export function adapterCatalogCacheKey(paths: DesktopAdapterPaths, state: DesktopAdapterState): string {
  const developmentStats: string[] = []
  for (const record of Object.values(state.development ?? {})) {
    if (record && typeof record.root === 'string' && record.root) statTree(record.root, developmentStats)
  }
  // User installs are few; stat them so a damaged snapshot is reported without waiting for a registry change.
  const installedStats: string[] = []
  for (const [name, record] of Object.entries(state.installations ?? {})) {
    if (record && typeof record.digest === 'string' && /^[a-f0-9]{64}$/.test(record.digest)) {
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

/** Current catalog, rebuilt only when one of its inputs changed. */
export function getDesktopAdapterCatalog(): DesktopAdapterCatalog {
  let inputs: ReturnType<typeof readDesktopAdapterCatalogInputs>
  try {
    inputs = readDesktopAdapterCatalogInputs()
  } catch {
    // Invalid paths or registry: let the catalog report its own diagnostics, uncached.
    cached = null
    return buildDesktopAdapterCatalog()
  }
  const key = adapterCatalogCacheKey(inputs.paths, inputs.state)
  if (cached?.key === key) return cached.catalog
  const catalog = buildDesktopAdapterCatalog({ paths: inputs.paths, state: inputs.state })
  cached = { key, catalog }
  return catalog
}

export function clearDesktopAdapterCatalogCache(): void {
  cached = null
  lastSkillRefresh = null
}

let lastSkillRefresh: { target: string; catalog: DesktopAdapterCatalog; stamp: string } | null = null

/**
 * Directory mtimes of the managed Skill folders. Creating, deleting or
 * replacing a SKILL.md (the sync writes by rename) changes its folder's mtime,
 * and adding or removing a folder changes the root's mtime.
 */
function managedSkillTargetStamp(target: string): string {
  const parts: string[] = []
  try {
    parts.push(`root:${fs.statSync(target).mtimeMs}`)
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('webcli-')) continue
      parts.push(`${entry.name}:${fs.statSync(path.join(target, entry.name)).mtimeMs}`)
    }
  } catch {
    parts.push('unreadable')
  }
  return parts.sort().join('|')
}

/**
 * Per-turn managed Skill refresh. Even with nothing to write, a full sync
 * checks and reads every managed SKILL.md (about 0.5 s on Windows), so it is
 * skipped while the catalog snapshot and the target folders are unchanged.
 */
export function refreshDesktopAdapterSkillsIfStale(target: string): { skipped: boolean } {
  const catalog = getDesktopAdapterCatalog()
  const stamp = managedSkillTargetStamp(target)
  if (lastSkillRefresh && lastSkillRefresh.target === target && lastSkillRefresh.catalog === catalog
    && lastSkillRefresh.stamp === stamp) {
    return { skipped: true }
  }
  lastSkillRefresh = null
  refreshDesktopAdapterSkills(target, { catalog })
  lastSkillRefresh = { target, catalog, stamp: managedSkillTargetStamp(target) }
  return { skipped: false }
}

/** Skill validator backed by the shared snapshot instead of a fresh catalog build. */
export function createCachedManagedAdapterSkillValidator(): ReturnType<typeof createManagedAdapterSkillValidator> {
  // The getter keeps the validator's laziness: plain user Skills never touch the
  // catalog, and catalog errors stay inside the validator's own try/catch.
  return createManagedAdapterSkillValidator({
    get catalog() {
      return getDesktopAdapterCatalog()
    },
  })
}
