import fs from 'node:fs'
import path from 'node:path'
import { createManagedAdapterSkillValidator } from '../../../../webcli/adapter-desktop.js'
import type { RuntimeContext } from './context-types.js'

export interface RuntimeContextInput {
  systemPrompt: string
  identityPrompt: string
  toolDefinitions?: string
  skillIndex?: string
  loadedSkills?: string
  mcpDynamicTools?: string
  subagentDefinitions?: string
}

export function splitSystemPromptForContext(systemPrompt: string, identityPrompt: string): {
  system_prompt: string
  rules: string
} {
  const identity = String(identityPrompt || '')
  const index = identity ? systemPrompt.indexOf(identity) : -1
  if (index < 0) return { system_prompt: '', rules: systemPrompt }
  return {
    system_prompt: identity,
    rules: `${systemPrompt.slice(0, index)}${systemPrompt.slice(index + identity.length)}`,
  }
}

export function createRuntimeContext(input: RuntimeContextInput): RuntimeContext {
  const classifiedSystem = splitSystemPromptForContext(input.systemPrompt, input.identityPrompt)
  return {
    system_prompt: classifiedSystem.system_prompt,
    rules: classifiedSystem.rules,
    tool_definitions: input.toolDefinitions ?? '',
    skills: [input.skillIndex, input.loadedSkills].filter(Boolean).join('\n\n'),
    mcp_dynamic_tools: input.mcpDynamicTools ?? '',
    subagent_definitions: input.subagentDefinitions ?? '',
  }
}

function readSkillIndexEntry(skillFile: string, fallbackName: string, validate: ReturnType<typeof createManagedAdapterSkillValidator>): string {
  try {
    const source = fs.readFileSync(skillFile, 'utf8')
    if (!validate(source, fallbackName)) return ''
    const content = source.slice(0, 16_384)
    const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? ''
    const name = frontmatter.match(/^name:\s*["']?([^\r\n"']+)/imu)?.[1]?.trim() || fallbackName
    const description = frontmatter.match(/^description:\s*["']?([^\r\n"']+)/imu)?.[1]?.trim() || ''
    return description ? `${name}: ${description}` : name
  } catch {
    return fallbackName
  }
}

export function buildEnabledSkillIndex(skillsDir: string): string {
  const validate = createManagedAdapterSkillValidator()
  try {
    return fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const skillFile = path.join(skillsDir, entry.name, 'SKILL.md')
        return fs.existsSync(skillFile) ? readSkillIndexEntry(skillFile, entry.name, validate) : ''
      })
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .join('\n')
  } catch {
    return ''
  }
}
