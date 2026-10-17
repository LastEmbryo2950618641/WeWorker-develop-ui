import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setMasterKeyForTests } from '../secret-store.js'
import {
  addAgentWork,
  completePairing,
  createAgent,
  deleteAgent,
  findAgentByBotId,
  findAgentByWorkId,
  getAgent,
  getAgentBotSecret,
  listAgentWorkIds,
  normalizeSkillName,
  removeAgentWork,
  resetPairing,
  toAgentView,
  updateAgent,
} from '../dedicated-agents/agent-store.js'

const TEST_MASTER_KEY = '00112233445566778899aabbccddeeff'
const BOT_SECRET = 'placeholder-bot-secret'

describe('dedicated agent store', () => {
  let dir = ''
  let previousFile: string | undefined

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weworker-agent-store-'))
    previousFile = process.env.WEWORKER_DEDICATED_AGENTS_FILE
    process.env.WEWORKER_DEDICATED_AGENTS_FILE = path.join(dir, 'dedicated-agents.json')
    setMasterKeyForTests(TEST_MASTER_KEY)
  })

  afterEach(() => {
    if (previousFile === undefined) delete process.env.WEWORKER_DEDICATED_AGENTS_FILE
    else process.env.WEWORKER_DEDICATED_AGENTS_FILE = previousFile
    setMasterKeyForTests(null)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const create = (overrides: Partial<Parameters<typeof createAgent>[0]> = {}) => createAgent({
    name: 'Example Operations Assistant',
    description: 'Handles routine work on example.com',
    site_id: 'example.com',
    skill_name: 'inventory-helper',
    examples: ['Check today\'s orders', ''],
    bot_id: 'placeholder-bot-1',
    secret: BOT_SECRET,
    ...overrides,
  })

  it('creates an agent with an encrypted secret and a 6-digit pairing code', () => {
    const agent = create()
    expect(agent.pairing_code).toMatch(/^\d{6}$/)
    expect(agent.examples).toEqual(['Check today\'s orders'])
    expect(agent.wecom.secret_enc).not.toContain(BOT_SECRET)
    expect(getAgentBotSecret(agent)).toBe(BOT_SECRET)

    const raw = fs.readFileSync(process.env.WEWORKER_DEDICATED_AGENTS_FILE!, 'utf8')
    expect(raw).not.toContain(BOT_SECRET)
  })

  it('never exposes the secret in API views', () => {
    const view = toAgentView(create())
    expect(JSON.stringify(view)).not.toContain(BOT_SECRET)
    expect(view.wecom).toEqual({ bot_id: 'placeholder-bot-1', has_secret: true })
    expect(view.paired).toBe(false)
    expect(view.pairing_code).toMatch(/^\d{6}$/)
  })

  it('refuses to store credentials when the secret store is unavailable', () => {
    setMasterKeyForTests(null)
    expect(() => create()).toThrow('密钥存储不可用')
  })

  it('allows a bot to serve only one agent and not the main channel', () => {
    create()
    expect(() => create({ name: 'Second', bot_id: 'placeholder-bot-1' })).toThrow('只能连接一个 Agent')
    expect(() => create({ name: 'Third', bot_id: 'placeholder-main-bot' }, )).not.toThrow()
    expect(() => createAgent({
      name: 'Fourth', site_id: 'example.org', bot_id: 'placeholder-reserved', secret: BOT_SECRET,
    }, { reservedBotIds: ['placeholder-reserved'] })).toThrow('设置 → 通道 → 企业微信')
    expect(findAgentByBotId('placeholder-bot-1')?.name).toBe('Example Operations Assistant')
    expect(findAgentByBotId('')).toBeNull()
  })

  it('validates names, bots and skill names', () => {
    expect(() => create({ name: '  ' })).toThrow('请填写 Agent 名称')
    expect(() => create({ site_id: '' })).toThrow('请选择要操作的网站')
    expect(() => create({ bot_id: 'a b' })).toThrow('BotID')
    expect(() => create({ secret: '' })).toThrow('Secret')
    expect(normalizeSkillName('')).toBe('')
    expect(normalizeSkillName('staging.helper_1')).toBe('staging.helper_1')
    expect(() => normalizeSkillName('webcli-example')).toThrow('webcli')
    expect(() => normalizeSkillName('../escape')).toThrow()
  })

  it('pairs once and re-pairs when the bot changes', () => {
    const agent = create()
    const paired = completePairing(agent.id, 'owner-user')
    expect(paired.owner_user_id).toBe('owner-user')
    expect(paired.pairing_code).toBe('')
    expect(toAgentView(paired).pairing_code).toBe('')

    const sameBot = updateAgent(agent.id, { bot: { bot_id: 'placeholder-bot-1', secret: 'placeholder-rotated' } })
    expect(sameBot.owner_user_id).toBe('owner-user')
    expect(getAgentBotSecret(sameBot)).toBe('placeholder-rotated')

    const otherBot = updateAgent(agent.id, { bot: { bot_id: 'placeholder-bot-2', secret: BOT_SECRET } })
    expect(otherBot.owner_user_id).toBe('')
    expect(otherBot.pairing_code).toMatch(/^\d{6}$/)

    const reset = resetPairing(agent.id)
    expect(reset.pairing_code).toMatch(/^\d{6}$/)
  })

  it('tracks conversations owned by agents', () => {
    const agent = create()
    addAgentWork(agent.id, 'work-a')
    addAgentWork(agent.id, 'work-a')
    addAgentWork(agent.id, 'work-b')
    addAgentWork('missing-agent', 'work-c')
    expect(getAgent(agent.id)?.work_ids).toEqual(['work-a', 'work-b'])
    expect(findAgentByWorkId('work-b')?.id).toBe(agent.id)
    expect([...listAgentWorkIds()].sort()).toEqual(['work-a', 'work-b'])
    removeAgentWork(agent.id, 'work-a')
    expect(findAgentByWorkId('work-a')).toBeNull()
    expect(deleteAgent(agent.id)?.id).toBe(agent.id)
    expect(listAgentWorkIds().size).toBe(0)
  })

  it('updates editable fields and rejects unknown agents', () => {
    const agent = create()
    const updated = updateAgent(agent.id, { name: 'Renamed', enabled: false, examples: ['a', 'b'], skill_name: '' })
    expect(updated).toMatchObject({ name: 'Renamed', enabled: false, examples: ['a', 'b'], skill_name: '' })
    expect(() => updateAgent('missing', { name: 'x' })).toThrow('不存在')
  })
})
