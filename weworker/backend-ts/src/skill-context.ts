import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createCachedManagedAdapterSkillValidator } from './adapter-catalog-cache.js'

export interface LoadedSkillContext {
  type: 'skill_context'
  tool_use_id: string
  name: string
  directory: string
  digest: string
  text: string
}

function readSkillSource(directory: string, roots: string[], validate = createCachedManagedAdapterSkillValidator()) {
  try {
    const realDirectory = fs.realpathSync(directory)
    const allowed = roots.some(root => {
      try {
        const relative = path.relative(fs.realpathSync(root), realDirectory)
        return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      } catch {
        return false
      }
    })
    if (!allowed) return undefined
    const file = path.join(realDirectory, 'SKILL.md')
    if (fs.realpathSync(file) !== file) return undefined
    const source = fs.readFileSync(file, 'utf8')
    if (!validate(source, path.basename(directory))) return undefined
    const frontmatter = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? ''
    const name = frontmatter.match(/^name:\s*["']?([^\r\n"']+)/imu)?.[1]?.trim()
    return { directory: realDirectory, name, digest: createHash('sha256').update(source).digest('hex') }
  } catch {
    return undefined
  }
}

export function createSkillContextCollector(roots: string[]) {
  const calls = new Map<string, { name: string; succeeded: boolean }>()
  return {
    observe(message: unknown): LoadedSkillContext[] {
      const event = message as {
        type?: string
        isSynthetic?: boolean
        parent_tool_use_id?: string | null
        tool_use_result?: { success?: boolean; commandName?: string }
        message?: { content?: unknown }
      }
      if (event.parent_tool_use_id || !Array.isArray(event.message?.content)) return []
      const blocks = event.message.content as Array<{
        type: string; id?: string; name?: string; input?: { skill?: string }
        tool_use_id?: string; is_error?: boolean; text?: string
      }>
      if (event.type === 'assistant') {
        for (const block of blocks) {
          if (block.type === 'tool_use' && block.name === 'Skill' && block.id && block.input?.skill && !calls.has(block.id)) {
            calls.set(block.id, { name: block.input.skill, succeeded: false })
          }
        }
        return []
      }
      if (event.type !== 'user') return []
      for (const block of blocks) {
        const call = block.tool_use_id ? calls.get(block.tool_use_id) : undefined
        if (block.type === 'tool_result' && call) {
          call.succeeded = !block.is_error && event.tool_use_result?.success === true
          if (call.succeeded && event.tool_use_result?.commandName) call.name = event.tool_use_result.commandName
        }
      }
      if (event.isSynthetic !== true) return []
      const captured: LoadedSkillContext[] = []
      for (const block of blocks) {
        if (block.type !== 'text' || !block.text) continue
        const directory = block.text.match(/^Base directory for this skill: ([^\r\n]+)/u)?.[1]?.trim()
        if (!directory) continue
        const source = readSkillSource(directory, roots)
        if (!source) continue
        const matches = [...calls].filter(([, call]) => call.succeeded && (
          call.name === path.basename(directory) || call.name === source.name
        ))
        if (matches.length !== 1) continue
        const [toolId, call] = matches[0]
        captured.push({ type: 'skill_context', tool_use_id: toolId, name: call.name, directory: source.directory, digest: source.digest, text: block.text })
        calls.delete(toolId)
      }
      return captured
    },
  }
}

export function buildLoadedSkillContext(messages: Array<{ content: unknown[] }>, roots: string[]): string {
  const latest = new Map<string, LoadedSkillContext>()
  for (const message of messages) {
    for (const candidate of message.content) {
      const block = candidate as LoadedSkillContext
      if (block.type !== 'skill_context' || !block.name || !block.text || !block.directory || !block.digest) continue
      latest.set(block.name, block)
    }
  }
  const validate = createCachedManagedAdapterSkillValidator()
  const texts = [...latest.values()].filter(block => readSkillSource(block.directory, roots, validate)?.digest === block.digest)
    .map(block => block.text)
  return texts.length ? `[已加载的 Skill 说明：以下为已校验当前版本的完整正文，可直接使用其中的工具和参数]\n${texts.join('\n\n')}` : ''
}
