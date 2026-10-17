/**
 * Per-agent runtime: an isolated Claude config directory whose skills/ folder
 * contains only what the agent needs, plus its system prompt and tool limits.
 */
import fs from 'node:fs'
import path from 'node:path'
import { getConfigDirectory } from '../config.js'
import { getRuntimeSkillsDir } from '../runtime-skills-dir.js'
import { createLogger } from '../logger.js'
import { parseAllAdapters } from '../adapter-parser.js'
import type { DedicatedAgentRecord } from './agent-store.js'
import { createFocusedToolGuard, FOCUSED_AGENT_DISALLOWED_TOOLS } from './focused-tool-guard.js'
import { locateSkill } from './skill-library.js'
import type { WecomProfileChatOptions } from '../channels/wecom-channel.js'

const log = createLogger('dedicated-agent-runtime')
const CUSTOM_SKILL_MARKER = '.weworker-custom-skill.json'
const BASE_WEBCLI_SKILL = 'webcli'

export function getDedicatedAgentsRoot(): string {
  return process.env.WEWORKER_DEDICATED_AGENTS_DIR || path.join(getConfigDirectory(), 'dedicated-agents')
}

export function getAgentClaudeConfigDir(agentId: string, root = getDedicatedAgentsRoot()): string {
  if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw new Error('Invalid agent id')
  return path.join(root, agentId, 'claude-config')
}

function readCustomSkillSiteId(dir: string): string | null {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(dir, CUSTOM_SKILL_MARKER), 'utf8')) as { siteId?: unknown }
    return typeof marker.siteId === 'string' ? marker.siteId : null
  } catch {
    return null
  }
}

/**
 * Skill directories an agent should see, mapped to their source directory:
 * the base webcli skill, the site's Adapter skill, site custom skills, and the
 * agent's own skill (private library first, then the public skills dir).
 */
export function resolveAgentSkillSources(
  agent: Pick<DedicatedAgentRecord, 'site_id' | 'skill_name'>,
  runtimeSkillsDir = getRuntimeSkillsDir(),
  libraryDir?: string,
): Map<string, string> {
  const sources = new Map<string, string>()
  const addPublic = (name: string) => {
    const dir = path.join(runtimeSkillsDir, name)
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) sources.set(name, dir)
  }
  addPublic(BASE_WEBCLI_SKILL)
  addPublic(`webcli-${agent.site_id}`)
  try {
    for (const entry of fs.readdirSync(runtimeSkillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (readCustomSkillSiteId(path.join(runtimeSkillsDir, entry.name)) === agent.site_id) addPublic(entry.name)
    }
  } catch {
    // Runtime skills dir missing: only explicit skills below.
  }
  if (agent.skill_name) {
    const located = locateSkill(agent.skill_name, { runtimeSkillsDir, libraryDir })
    if (located) sources.set(agent.skill_name, located.dir)
  }
  return sources
}

export function resolveAgentSkillNames(
  agent: Pick<DedicatedAgentRecord, 'site_id' | 'skill_name'>,
  runtimeSkillsDir = getRuntimeSkillsDir(),
  libraryDir?: string,
): string[] {
  return [...resolveAgentSkillSources(agent, runtimeSkillsDir, libraryDir).keys()]
}

/** Cheap change detector: relative path + size + mtime of every file. */
function directoryFingerprint(dir: string): string {
  const parts: string[] = []
  const walk = (current: string, prefix: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name)
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) walk(absolute, relative)
      else if (entry.isFile()) {
        const stat = fs.statSync(absolute)
        parts.push(`${relative}:${stat.size}:${Math.floor(stat.mtimeMs)}`)
      }
    }
  }
  walk(dir, '')
  return parts.join('|')
}

const FINGERPRINT_FILE = '.weworker-agent-copy'

/**
 * Mirror the agent's skills into its isolated skills directory.
 * The agent directory is fully owned by WeWorker, so stale entries are removed.
 */
export function syncAgentSkills(
  agent: Pick<DedicatedAgentRecord, 'id' | 'site_id' | 'skill_name'>,
  options: { runtimeSkillsDir?: string; agentsRoot?: string; libraryDir?: string } = {},
): { claudeConfigDir: string; skills: string[]; missingPrivateSkill: boolean } {
  const runtimeSkillsDir = options.runtimeSkillsDir ?? getRuntimeSkillsDir()
  const claudeConfigDir = getAgentClaudeConfigDir(agent.id, options.agentsRoot)
  const targetRoot = path.join(claudeConfigDir, 'skills')
  fs.mkdirSync(targetRoot, { recursive: true })

  const sources = resolveAgentSkillSources(agent, runtimeSkillsDir, options.libraryDir)
  const skills = [...sources.keys()]
  const wanted = new Set(skills)
  for (const entry of fs.readdirSync(targetRoot, { withFileTypes: true })) {
    if (!wanted.has(entry.name)) fs.rmSync(path.join(targetRoot, entry.name), { recursive: true, force: true })
  }
  for (const name of skills) {
    const source = sources.get(name)!
    const target = path.join(targetRoot, name)
    const fingerprint = directoryFingerprint(source)
    let previous = ''
    try { previous = fs.readFileSync(path.join(target, FINGERPRINT_FILE), 'utf8') } catch { /* first copy */ }
    if (previous === fingerprint && fs.existsSync(path.join(target, 'SKILL.md'))) continue
    fs.rmSync(target, { recursive: true, force: true })
    fs.cpSync(source, target, { recursive: true, dereference: false, filter: (src) => !fs.lstatSync(src).isSymbolicLink() })
    fs.writeFileSync(path.join(target, FINGERPRINT_FILE), fingerprint)
  }
  const missingPrivateSkill = !!agent.skill_name && !wanted.has(agent.skill_name)
  if (missingPrivateSkill) log.warn(`agent ${agent.id}: private skill ${agent.skill_name} not found`)
  return { claudeConfigDir, skills, missingPrivateSkill }
}

export function buildAgentSystemPrompt(input: {
  agent: Pick<DedicatedAgentRecord, 'name' | 'description' | 'site_id' | 'skill_name'>
  siteName: string
  privateSkillAvailable: boolean
}): string {
  const { agent, siteName } = input
  const lines = [
    '## 专属 Agent',
    '',
    `你是「${agent.name}」，一个只为主人服务、专注于「${siteName}」（${agent.site_id}）的专属 Agent。${agent.description ? `职责：${agent.description}` : ''}`,
    '',
    '- 只处理与该网站及你的专属知识相关的请求；超出范围时简短说明你能做什么，不要尝试其他网站或本地操作。',
  ]
  if (input.privateSkillAvailable && agent.skill_name) {
    // Load once per conversation: a later turn sees the earlier load in its own
    // context or in the replayed "已加载的 Skill 说明", so it must not reload.
    lines.push(`- 本对话中第一次处理请求前，用 Skill 工具加载专属 Skill「${agent.skill_name}」，按其中的知识、步骤和约束执行；它的规则优先于你的一般判断。上下文里已有它的完整说明（包括“已加载的 Skill 说明”）时直接使用，不要重复加载。`)
  }
  lines.push(
    `- 网站操作只能用原生命令工具执行单条 \`webcli call ${agent.site_id}.<工具名> --参数名=参数值\`（也可用 \`webcli call open_browser --url=...\` 打开该网站）。`,
    '- 一次只执行一条 webcli 命令；引号外不能出现管道、重定向、变量、`;`、`#` 或多条命令（不要写 `Start-Sleep; webcli ...`），也不要使用 `webcli trace`。需要传给网站的复杂文本放进单引号参数里。',
    '- 未登录、扩展需要重载、没有匹配的页面或命令被拒绝时，等待和重试不会恢复：不要 Start-Sleep 或重复调用，直接告诉主人需要做什么；参数或命令格式错误时先修正再调用。',
    '- 你的回复会发到企业微信或微信聊天里：先给结论，再给关键依据；只贴必要的原始输出，避免大段刷屏。',
    '- 不读取、修改或发送本机文件，不创建定时任务。',
  )
  return lines.join('\n')
}

export function buildAgentChatOptions(input: {
  agent: DedicatedAgentRecord
  siteName: string
  runtimeSkillsDir?: string
  agentsRoot?: string
  libraryDir?: string
  /** Installed Adapter ids; defaults to the live Adapter registry. */
  knownSiteIds?: string[]
}): WecomProfileChatOptions {
  const synced = syncAgentSkills(input.agent, {
    runtimeSkillsDir: input.runtimeSkillsDir,
    agentsRoot: input.agentsRoot,
    libraryDir: input.libraryDir,
  })
  return {
    isolatedClaudeConfigDir: synced.claudeConfigDir,
    appendSystemPrompt: buildAgentSystemPrompt({
      agent: input.agent,
      siteName: input.siteName,
      privateSkillAvailable: !!input.agent.skill_name && !synced.missingPrivateSkill,
    }),
    extraToolGuard: createFocusedToolGuard([input.agent.site_id], input.knownSiteIds ?? [...parseAllAdapters().keys()]),
    extraDisallowedTools: [...FOCUSED_AGENT_DISALLOWED_TOOLS],
  }
}

export function removeAgentRuntime(agentId: string, root = getDedicatedAgentsRoot()): void {
  const dir = path.dirname(getAgentClaudeConfigDir(agentId, root))
  fs.rmSync(dir, { recursive: true, force: true })
}
