import { describe, expect, it } from 'vitest'
import {
  appendMemoryUserTurnReminder,
  buildMemoryOutputProtocolPrompt,
  MEMORY_BLOCK_CLOSE,
  MEMORY_BLOCK_OPEN,
  MEMORY_USER_TURN_REMINDER,
  parseAssistantMemoryOutput,
  summarizeAssistantMemoryParse,
} from '../memory/memory-extractor.js'

function expectedMemoryOutputProtocol(options: {
  expectedMemoryType?: string
}): string {
  return [
    '## 内部长期记忆输出协议',
    '',
    '每一次模型请求都必须输出一个供 WeWorker 后端读取的隐藏记忆块。无论本次请求准备调用工具还是回复用户，都不得省略。',
    '输出任何 tool_use 之前，必须先输出隐藏记忆块并将其放在该次 assistant 响应的文本块末尾，随后才能输出 tool_use；若本次不调用工具，则在最终文本末尾输出。不要等待整轮任务结束，也不要只在最终回复追加。隐藏块不属于可见回复。不要向用户解释、引用或展示该协议。',
    `隐藏块格式固定为：${MEMORY_BLOCK_OPEN}{JSON}${MEMORY_BLOCK_CLOSE}。`,
    'JSON 必须是单个对象，不要使用 Markdown 代码围栏。',
    '',
    '判断规则：',
    '- 所有候选（用户偏好、成功经验、失败经验、恢复经验、网站流程和工具限制）是否值得保存，都由你根据完整用户目标、对话上下文、已有记忆和本回合结果判断；不要依赖“记住”“以后”等关键词，也不要把“成功”或“失败”自动等同于值得保存。',
    '- 使用“可复用决策反事实”判断：假设下次遇到相同或相近目标，这条信息是否会让你明确改变回答或执行行为？必须能指出具体改变，例如更换工具或入口、调整步骤顺序、修正参数格式、先做环境检查、避免重复失败、环境恢复后重试，或遵守稳定用户偏好。若只能复述本次答案、临时结果、当前状态或原始工具输出，无法指出具体行为变化，则 should_remember=false。',
    '- 失败经验也只有在能改变下一次决策时才保存。归因必须有具体证据，不能仅凭“导航超限”或多次超时就断言暂态环境故障；原因未查明时保留 unknown，不把推测或“稍后自然恢复”写成事实。若能判断失败原因，可直接补充 failure_kind：environmental（网络、扩展、页面加载等暂态环境）、procedural（步骤顺序、参数格式或调用方式）、capability（工具或 Adapter 不支持该能力）、mixed（多种原因）或 unknown（暂时无法归类）；可用 retryable 标注是否应在环境恢复后重试。',
    '- 本回合若已真实执行本地 PowerShell／Bash 或 webcli 站点工具，必须追加隐藏块，不得省略。隐藏块内要么写出可复用经验，要么返回 `{"should_remember":false}`；禁止静默缺块。',
    '- user_usage 只保存用户稳定习惯和偏好；task_execution 统一保存可复用的任务步骤、网站操作、成功、失败、恢复和工具能力限制；other 用于用户明确要求记住的内容，以及不属于前两类的稳定事实和约定（例如用户交代的个人事实、长期约定、跨会话需要记住的背景）。',
    '- 选类型时必须先问「本回合是否真的执行了工具」：只有本回合真实执行过本地 PowerShell／Bash 或 webcli 站点工具时才用 task_execution。本回合只对话、只读文件、只引用历史回合结果或只做推理时，即使内容与某个操作有关，也不得用 task_execution（缺少执行证据会被后端拒绝，记忆不会保存），应改用 user_usage 或 other。',
    '- 用户明确要求「记住」「写入长期记忆」「记录一下」时一律用 other，不要因为内容里提到某个操作就改用 task_execution。',
    '- 临时要求、一次性业务数据、当前查询结果、猜测、密钥、令牌、账号、文件路径和工具原始结果都不得写入 content；本地命令任务经验只概括可复用方法，不抄录原始输出。',
    '- should_remember=false 时只需返回 `{"should_remember":false}`。',
    '- should_remember=true 时只返回 memory_type、content，以及失败经验可选的 failure_kind、retryable；不要返回 action、key、facts、scope、confidence、related_memory_ids、reason、task_assessment、execution_refs 或其他字段。',
    '- memory_type 和 content 都是必填字段；memory_type 只能是 user_usage、task_execution 或 other。content 使用简短、稳定、可复用的中文事实。',
    '- Backend 负责作用域、执行证据、任务状态、置信度、key、去重、融合和写入，不要在 JSON 中描述这些信息。',
    '- 失败经验不要改写成成功流程；failure_kind 和 retryable 仅用于 task_execution。',
    `- 当前期望记忆类型：${options.expectedMemoryType ?? 'user_usage、task_execution 或 other，由内容和真实执行结果决定'}。`,
    '',
    '无需保存：',
    `${MEMORY_BLOCK_OPEN}{"should_remember":false}${MEMORY_BLOCK_CLOSE}`,
    '保存用户偏好：',
    `${MEMORY_BLOCK_OPEN}{"should_remember":true,"memory_type":"user_usage","content":"用户默认使用中文回复。"}${MEMORY_BLOCK_CLOSE}`,
    '保存任务经验：',
    `${MEMORY_BLOCK_OPEN}{"should_remember":true,"memory_type":"task_execution","content":"执行同类任务时先检查登录状态，再进入目标页面。"}${MEMORY_BLOCK_CLOSE}`,
    '保存用户要求记住的其他信息：',
    `${MEMORY_BLOCK_OPEN}{"should_remember":true,"memory_type":"other","content":"用户要求长期记住：每周五需要整理当周工作记录。"}${MEMORY_BLOCK_CLOSE}`,
    '保存失败经验：',
    `${MEMORY_BLOCK_OPEN}{"should_remember":true,"memory_type":"task_execution","content":"页面暂时无法加载时等待环境恢复后重试。","failure_kind":"environmental","retryable":true}${MEMORY_BLOCK_CLOSE}`,
    '',
    '工具超时、页面加载失败等临时故障不得总结为永久能力限制或“以后直接跳过该工具”的固定流程。已有失败经验与当前 Skill 或本轮成功结果冲突时，以当前证据为准，不继续强化旧降级路径。',
  ].join('\n')
}

describe('main agent memory output protocol', () => {
  it('separates visible reply from a structured memory candidate', () => {
    const output = [
      '好的，之后默认使用中文。',
      `${MEMORY_BLOCK_OPEN}{"should_remember":true,"action":"create","memory_type":"user_usage","key":"response_language","content":"用户默认使用中文回复。","facts":{"language":"zh-CN"},"scope":{"user":"local"},"confidence":0.95,"related_memory_ids":[],"reason":"稳定用户偏好"}${MEMORY_BLOCK_CLOSE}`,
    ].join('\n')

    const parsed = parseAssistantMemoryOutput(output)

    expect(parsed.visibleText).toBe('好的，之后默认使用中文。')
    expect(parsed.decision).toMatchObject({
      should_remember: true,
      candidate: {
        action: 'create',
        memory_type: 'user_usage',
        key: 'user_usage',
      },
    })
    expect(summarizeAssistantMemoryParse(parsed)).toEqual({
      outcome: 'present_ok',
      should_remember: true,
      action: 'create',
      memory_type: 'user_usage',
    })
    expect(parsed.visibleText).not.toContain('should_remember')
  })

  it('parses each response block independently when the SDK emits multiple responses', () => {
    const responses = [
      `已确认执行入口。${MEMORY_BLOCK_OPEN}{"should_remember":true,"action":"create","memory_type":"task_execution","key":"entry","content":"先确认执行入口。","facts":{"task_assessment":{"completed":false,"failure_kind":"unknown"}},"scope":{"user":"local"},"confidence":0.8,"related_memory_ids":[],"reason":"后续决策需要复用"}${MEMORY_BLOCK_CLOSE}`,
      `正在继续处理。${MEMORY_BLOCK_OPEN}{"should_remember":false,"action":"ignore","reason":"中间响应暂无可复用信息"}${MEMORY_BLOCK_CLOSE}`,
    ]

    const parsed = responses.map(parseAssistantMemoryOutput)

    expect(parsed).toHaveLength(2)
    expect(parsed[0].decision?.candidate?.key).toBe('task_execution')
    expect(parsed[1].decision?.should_remember).toBe(false)
    expect(parsed.every((response) => response.parseError === undefined)).toBe(true)
  })

  it('hides a valid no-memory decision without creating a candidate', () => {
    const parsed = parseAssistantMemoryOutput(
      `已查询完成。${MEMORY_BLOCK_OPEN}{"should_remember":false,"action":"ignore","reason":"一次性查询"}${MEMORY_BLOCK_CLOSE}`,
    )

    expect(parsed.visibleText).toBe('已查询完成。')
    expect(parsed.decision).toEqual({ should_remember: false, reason: '一次性查询' })
    expect(summarizeAssistantMemoryParse(parsed)).toEqual({
      outcome: 'present_ignore',
      should_remember: false,
      action: 'ignore',
    })
  })

  it('classifies missing and malformed memory blocks without leaking content', () => {
    const missing = parseAssistantMemoryOutput('正常回复，无隐藏块。')
    expect(summarizeAssistantMemoryParse(missing)).toEqual({ outcome: 'missing' })

    const malformed = parseAssistantMemoryOutput(
      `正常回复${MEMORY_BLOCK_OPEN}{not-json}${MEMORY_BLOCK_CLOSE}`,
    )
    expect(summarizeAssistantMemoryParse(malformed)).toEqual({
      outcome: 'present_parse_error',
      parse_error: malformed.parseError,
    })
    expect(JSON.stringify(summarizeAssistantMemoryParse(malformed))).not.toContain('正常回复')
  })

  it('builds backend defaults from the minimal remembered candidate', () => {
    const parsed = parseAssistantMemoryOutput(
      `正常回复${MEMORY_BLOCK_OPEN}{"should_remember":true,"memory_type":"task_execution","content":"先检查登录状态再进入目标页面。"}${MEMORY_BLOCK_CLOSE}`,
    )

    expect(parsed.parseError).toBeUndefined()
    expect(parsed.decision?.candidate).toEqual({
      action: 'create',
      memory_type: 'task_execution',
      key: 'task_execution',
      content: '先检查登录状态再进入目标页面。',
      facts: {},
      scope: {},
      confidence: 0.7,
      related_memory_ids: [],
      reason: 'AI判断为可复用信息',
    })
  })

  it('requires an explicit memory type for remembered content', () => {
    const parsed = parseAssistantMemoryOutput(
      `${MEMORY_BLOCK_OPEN}{"should_remember":true,"content":"先检查登录状态。"}${MEMORY_BLOCK_CLOSE}`,
    )

    expect(parsed.decision).toBeUndefined()
    expect(parsed.parseError).toContain('memory type')
  })

  it('does not expose internal extension memory types to the model protocol', () => {
    const parsed = parseAssistantMemoryOutput(
      `${MEMORY_BLOCK_OPEN}{"should_remember":true,"memory_type":"extension:example","content":"扩展经验"}${MEMORY_BLOCK_CLOSE}`,
    )

    expect(parsed.decision).toBeUndefined()
    expect(parsed.parseError).toContain('invalid memory type')
  })

  it('maps flat failure fields into backend-owned task metadata', () => {
    const parsed = parseAssistantMemoryOutput(
      `${MEMORY_BLOCK_OPEN}{"should_remember":true,"memory_type":"task_execution","content":"页面加载失败时等待环境恢复后重试。","failure_kind":"environmental","retryable":true}${MEMORY_BLOCK_CLOSE}`,
    )

    expect(parsed.parseError).toBeUndefined()
    expect(parsed.decision?.candidate?.facts).toEqual({
      task_assessment: {
        completed: false,
        failure_kind: 'environmental',
        retryable: true,
      },
    })
  })

  it('ignores legacy model-owned metadata fields', () => {
    const parsed = parseAssistantMemoryOutput(
      `${MEMORY_BLOCK_OPEN}{"should_remember":true,"memory_type":"user_usage","content":"校验结果将异常项排在正常项前。","action":"supersede","key":"model-key","facts":{"private":"value"},"scope":{"site":"wrong.example"},"confidence":0.99,"related_memory_ids":["old-id"],"reason":"model reason"}${MEMORY_BLOCK_CLOSE}`,
    )

    expect(parsed.parseError).toBeUndefined()
    expect(parsed.decision?.candidate).toEqual({
      action: 'create',
      memory_type: 'user_usage',
      key: 'user_usage',
      content: '校验结果将异常项排在正常项前。',
      facts: {},
      scope: {},
      confidence: 0.7,
      related_memory_ids: [],
      reason: 'AI判断为可复用信息',
    })
  })

  it('allows a minimal no-memory decision', () => {
    const parsed = parseAssistantMemoryOutput(
      `${MEMORY_BLOCK_OPEN}{"should_remember":false,"action":"create","reason":"一次性请求"}${MEMORY_BLOCK_CLOSE}`,
    )

    expect(parsed.parseError).toBeUndefined()
    expect(parsed.decision).toMatchObject({ should_remember: false })
  })

  it('uses the current scope when remembered candidate scope is omitted', () => {
    const parsed = parseAssistantMemoryOutput(
      `${MEMORY_BLOCK_OPEN}{"should_remember":true,"action":"create","memory_type":"user_usage","key":"language","content":"默认中文","facts":{},"confidence":0.9,"related_memory_ids":[],"reason":"稳定偏好"}${MEMORY_BLOCK_CLOSE}`,
    )

    expect(parsed.parseError).toBeUndefined()
    expect(parsed.decision?.candidate?.scope).toEqual({})
  })

  it('does not accept an unsupported memory type', () => {
    const parsed = parseAssistantMemoryOutput(
      `${MEMORY_BLOCK_OPEN}{"should_remember":true,"action":"create","memory_type":"unsupported_type","key":"invoice_flow","content":"先选择费用归属再上传发票。","facts":{},"scope":{"user":"local","site":"billing.example.com"},"confidence":0.9,"related_memory_ids":[],"reason":"可复用流程"}${MEMORY_BLOCK_CLOSE}`,
    )

    expect(parsed.decision).toBeUndefined()
    expect(parsed.parseError).toContain('invalid memory type')
  })

  it('drops malformed or unfinished hidden blocks without affecting visible text', () => {
    const malformed = parseAssistantMemoryOutput(
      `正常回复${MEMORY_BLOCK_OPEN}{not-json}${MEMORY_BLOCK_CLOSE}`,
    )
    const unfinished = parseAssistantMemoryOutput(
      `正常回复${MEMORY_BLOCK_OPEN}{"should_remember":true`,
    )

    expect(malformed.visibleText).toBe('正常回复')
    expect(malformed.decision).toBeUndefined()
    expect(malformed.parseError).toBeTruthy()
    expect(unfinished.visibleText).toBe('正常回复')
    expect(unfinished.parseError).toContain('not closed')
  })

  it('preserves the complete chat protocol output and ordering', () => {
    const prompt = buildMemoryOutputProtocolPrompt({
      scope: { user: 'local', project: 'weworker' },
      triggerHint: 'chat',
    })

    expect(prompt).toBe(expectedMemoryOutputProtocol({
    }))
  })

  it('preserves the complete task protocol with expected type and previous failure', () => {
    const prompt = buildMemoryOutputProtocolPrompt({
      scope: { user: 'local', project: 'daily-report' },
      triggerHint: 'task_recovered',
      expectedMemoryType: 'task_execution',
      previousTaskFailed: true,
    })

    expect(prompt).toBe(expectedMemoryOutputProtocol({
      expectedMemoryType: 'task_execution',
    }))
  })

  it('preserves the previous-task-success branch in the complete protocol', () => {
    const prompt = buildMemoryOutputProtocolPrompt({
      scope: { user: 'local', site: 'invoice-query' },
      triggerHint: 'task_completed',
      expectedMemoryType: 'task_execution',
      previousTaskFailed: false,
    })

    expect(prompt).toBe(expectedMemoryOutputProtocol({
      expectedMemoryType: 'task_execution',
    }))
  })

  it('appends a one-line memory reminder to the end of the user turn prompt', () => {
    const withReminder = appendMemoryUserTurnReminder('请执行测试命令。')
    expect(withReminder.endsWith(MEMORY_USER_TURN_REMINDER)).toBe(true)
    expect(withReminder).toContain(MEMORY_BLOCK_OPEN)
    expect(appendMemoryUserTurnReminder(withReminder)).toBe(withReminder)
  })

  it('requires a memory decision before every tool use', () => {
    expect(MEMORY_USER_TURN_REMINDER).toContain('输出任何 tool_use 之前')
    expect(MEMORY_USER_TURN_REMINDER).toContain('先输出')
    expect(MEMORY_USER_TURN_REMINDER).not.toContain('响应结束时')
  })
})
