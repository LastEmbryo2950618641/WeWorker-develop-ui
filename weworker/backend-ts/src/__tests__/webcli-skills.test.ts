import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SHARED_WEBCLI_SKILLS, syncBundledWebcliSkills } from '../webcli-skills.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-webcli-skills-'))
  roots.push(root)
  const source = path.join(root, 'distribution', 'skills')
  const target = path.join(root, 'runtime', 'skills')
  for (const name of SHARED_WEBCLI_SKILLS) {
    fs.mkdirSync(path.join(source, name), { recursive: true })
    fs.writeFileSync(path.join(source, name, 'SKILL.md'), `---\nname: ${name}\n---\nQuery https://example.com/items`)
  }
  return { source, target }
}

describe('desktop shared WebCLI Skill synchronization', () => {
  it('refreshes stale bundled instructions and references before discovery without changing user Skills', () => {
    const { source, target } = fixture()
    fs.mkdirSync(path.join(source, 'webcli-api-exploration', 'references'))
    fs.writeFileSync(path.join(source, 'webcli-api-exploration', 'references', 'query.md'), 'Read-only list contract')
    fs.mkdirSync(path.join(target, 'personal'), { recursive: true })
    fs.writeFileSync(path.join(target, 'personal', 'SKILL.md'), 'personal content')
    const originalDigest = syncBundledWebcliSkills(target, source)
    const skill = path.join(target, 'webcli-api-exploration', 'SKILL.md')
    const stamp = fs.statSync(skill).mtimeMs
    expect(syncBundledWebcliSkills(target, source)).toBe(originalDigest)
    expect(fs.statSync(skill).mtimeMs).toBe(stamp)
    fs.writeFileSync(path.join(source, 'webcli-api-exploration', 'SKILL.md'), 'Updated contract')
    expect(syncBundledWebcliSkills(target, source)).not.toBe(originalDigest)
    expect(fs.readFileSync(skill, 'utf8')).toBe('Updated contract')
    expect(fs.readFileSync(path.join(target, 'webcli-api-exploration', 'references', 'query.md'), 'utf8')).toBe('Read-only list contract')
    expect(fs.readFileSync(path.join(target, 'personal', 'SKILL.md'), 'utf8')).toBe('personal content')
  })

  it('reports incomplete distributions before partially replacing runtime instructions', () => {
    const { source, target } = fixture()
    fs.renameSync(path.join(source, 'webcli-api-exploration', 'SKILL.md'), path.join(source, 'webcli-api-exploration', 'incomplete.md'))
    expect(() => syncBundledWebcliSkills(target, source)).toThrow('重新构建 WebCLI')
    expect(fs.existsSync(target)).toBe(false)
  })
})
