import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { resolveWebcliDir } from './webcli-path.js'

export const SHARED_WEBCLI_SKILLS = ['webcli', 'webcli-browser', 'webcli-api-exploration'] as const

/** Refresh the instructions from the same distribution as the command on PATH.
 * Runs before SDK discovery, including the first turn while startup install is pending.
 * Adapter Skills still use the existing catalog/event refresh path.
 */
export function syncBundledWebcliSkills(target: string, source = path.join(resolveWebcliDir(), 'skills')): string {
  const files: Array<{ relative: string; content: Buffer }> = []
  function readTree(relative: string): void {
    for (const entry of fs.readdirSync(path.join(source, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name)
      if (entry.isDirectory()) readTree(child)
      else if (entry.isFile()) files.push({ relative: child, content: fs.readFileSync(path.join(source, child)) })
    }
  }
  try {
    for (const name of SHARED_WEBCLI_SKILLS) {
      if (!fs.statSync(path.join(source, name, 'SKILL.md')).isFile()) throw new Error('missing Skill')
      readTree(name)
    }
  } catch {
    throw new Error('当前客户端缺少配套 WebCLI 探索 Skill。开发态请重新构建 WebCLI；安装版请更新客户端，不要改用全局旧版 CLI。')
  }
  for (const { relative, content } of files) {
    const destination = path.join(target, relative)
    if (fs.existsSync(destination) && fs.readFileSync(destination).equals(content)) continue
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, content)
  }
  const hash = createHash('sha256')
  for (const { relative, content } of files.sort((a, b) => a.relative.localeCompare(b.relative))) {
    hash.update(relative).update('\0').update(content).update('\0')
  }
  return hash.digest('hex')
}
