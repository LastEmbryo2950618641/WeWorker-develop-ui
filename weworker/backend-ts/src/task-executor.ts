/**
 * Task Executor — 执行单个定时任务的 AI 对话流程。
 * 复用现有 streamChat + runChannelChat 模式，非交互式执行。
 */
import { getSettings } from './config.js'
import { generateAssistantStatusLine, streamChat } from './agent.js'
import { resolveZcfPrefs } from './zcf-sync.js'
import * as store from './works-store.js'
import type { ScheduledTask, ContentBlock } from './works-store.js'
import { parseAllAdapters } from './adapter-parser.js'
import { getSiteEnabled } from './config.js'
import { ensureAssistantStatusLine } from './assistant-status.js'
import { createLogger } from './logger.js'
import { processMemoryEvent } from './memory/memory-lifecycle.js'
import { buildMemoryEventContext, type MemoryAdapterIdentity } from './memory/memory-event-context.js'
import { planTaskMemoryEvent } from './memory/memory-event-planner.js'
import { getMemoryStore } from './memory/memory-store.js'
import type { MemoryEventTrigger, MemoryScope, MemoryType, MemoryUpdateCandidate } from './memory/memory-types.js'
import { redactSensitive } from './http-security.js'

const memoryLog = createLogger('memory')

export interface ExecutionResult {
  workId: string
  executionId: string
  status: 'completed' | 'failed'
  summary?: string
  error?: string
}

interface NotificationPayload {
  taskId: string
  taskTitle: string
  status: 'completed' | 'failed'
  summary?: string
  fullText?: string
  error?: string
  executionId: string
  workId: string
}

/**
 * 安全调用通知器。notifier.ts 将在 task 5.1 中创建，
 * 在此之前动态导入会失败，静默忽略。
 */
async function safeNotify(payload: NotificationPayload, channels: string[]): Promise<void> {
  try {
    const mod = await import(/* webpackIgnore: true */ './notifier.js')
    await mod.notify(payload, channels)
  } catch {
    // Notifier module not yet available — silently skip
  }
}

function queueTaskMemoryProcessing(input: {
  executionId: string
  trigger: MemoryEventTrigger
  scope: MemoryScope
  expectedMemoryType?: MemoryType
  candidate: MemoryUpdateCandidate
}): void {
  let store: ReturnType<typeof getMemoryStore>
  try {
    store = getMemoryStore()
  } catch (error) {
    memoryLog.warn('task memory store unavailable', { executionId: input.executionId, error: redactSensitive(error instanceof Error ? error.message : String(error)) })
    return
  }
  void processMemoryEvent({
    eventId: `task:${input.executionId}:${input.trigger}`,
    scope: input.scope,
    expectedMemoryType: input.expectedMemoryType,
    store,
    candidate: input.candidate,
  }).then((result) => {
    if (result.status === 'failed') {
      memoryLog.warn('task memory processing failed', { executionId: input.executionId, error: redactSensitive(result.error) })
    }
  }).catch((error) => {
    memoryLog.warn('task memory processing crashed', { executionId: input.executionId, error: redactSensitive(error instanceof Error ? error.message : String(error)) })
  })
}

/**
 * 执行一个定时任务：创建 work、记录执行、调用 AI Agent、更新状态。
 */
export async function executeTask(task: ScheduledTask): Promise<ExecutionResult> {
  // Skip tasks with empty prompt — nothing to execute
  if (!task.prompt_template?.trim()) {
    const work = store.createWork(`[定时] ${task.title} · 跳过`)
    const execution = store.createTaskExecution(task.id, work.id)
    store.updateTaskExecution(execution.id, {
      status: 'failed',
      error_message: '任务提示词为空，跳过执行',
      completed_at: new Date().toISOString(),
    })
    return { workId: work.id, executionId: execution.id, status: 'failed', error: '任务提示词为空' }
  }

  // 1. Create a new work for this execution (with scheduled task identifier)
  const previousExecution = store.listTaskExecutions(task.id)[0]
  const now = new Date()
  const timeStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const workTitle = `[定时] ${task.title} · ${timeStr}`
  const work = store.createWork(workTitle)

  // 2. Create execution record (pending)
  const execution = store.createTaskExecution(task.id, work.id)
  const assistantContent: ContentBlock[] = []
  let memoryAdapters: MemoryAdapterIdentity[] = []
  let taskMemoryContext = buildMemoryEventContext({
    baseScope: { user: 'local' },
    userMessage: task.prompt_template,
    adapters: [],
    toolCalls: [],
  })
  let memoryCandidate: MemoryUpdateCandidate | undefined

  // 3. Append the prompt template as user message
  store.appendMessage(work.id, 'user', [{ type: 'text', text: task.prompt_template }])

  // 4. Update execution to running
  store.updateTaskExecution(execution.id, { status: 'running' })

  try {
    // 5. Get work with messages and settings
    const workWithMessages = store.getWorkWithMessages(work.id)!
    const settings = getSettings()

    // 6. Build enabled adapter IDs (same pattern as server.ts chat endpoint)
    const allAdapters = parseAllAdapters()
    const enabledAdapterIds = new Set(
      [...allAdapters.entries()].filter(([id, a]) => getSiteEnabled(id, a.defaultEnabled, a.managed?.enabled)).map(([id]) => id),
    )
    memoryAdapters = [...allAdapters.values()].map((adapter) => ({
      id: adapter.id,
      name: adapter.name,
      match: adapter.match,
    }))
    taskMemoryContext = buildMemoryEventContext({
      baseScope: { user: 'local' },
      userMessage: task.prompt_template,
      adapters: memoryAdapters,
      toolCalls: [],
    })

    // 7. Call streamChat and iterate to completion (non-streaming, like runChannelChat)
    let currentText = ''
    // Per-turn timing (mirrors server.ts /chat handler so scheduled results also show durations)
    const chatStartTime = Date.now()
    let lastStepEndTime = chatStartTime
    // Per-tool start timestamps (parallel tool_use blocks overlap; see server.ts /chat)
    const toolStartTimes = new Map<string, number>()
    let llmMsTotal = 0
    let execMsTotal = 0
    let stepIndex = 0
    const seenToolIds = new Set<string>()

    const zcfPrefs = resolveZcfPrefs(workWithMessages, settings)

    for await (const event of streamChat(workWithMessages.messages, settings, undefined, {
      streaming: false,
      enabledAdapterIds,
      workId: workWithMessages.id,
      zcfRole: zcfPrefs.zcfRole,
      zcfMode: zcfPrefs.zcfMode,
      memoryScope: taskMemoryContext.scope,
      memoryExpectedType: 'task_execution',
      memoryTriggerHint: previousExecution?.status === 'failed' ? 'task_recovered' : 'task_completed',
      previousTaskFailed: previousExecution?.status === 'failed',
    })) {
      if (event.type === 'skill_context' && event.skillContext) {
        assistantContent.push(event.skillContext)
      } else if (event.type === 'text_delta' && event.content) {
        currentText += event.content
      } else if (event.type === 'memory_candidate' && event.candidate) {
        memoryCandidate = event.candidate
      } else if (event.type === 'tool_call_start' && event.id) {
        if (currentText) {
          assistantContent.push({ type: 'text', text: currentText })
          currentText = ''
        }
        const isNew = !seenToolIds.has(event.id)
        let thinkMs: number | undefined
        if (isNew) {
          seenToolIds.add(event.id)
          stepIndex++
          const startTs = Date.now()
          thinkMs = toolStartTimes.size === 0 ? startTs - lastStepEndTime : 0
          llmMsTotal += thinkMs
          toolStartTimes.set(event.id, startTs)
        }
        assistantContent.push({
          type: 'tool_use',
          id: event.id,
          name: event.name ?? '',
          args: event.args,
          status: 'running',
          ...(thinkMs !== undefined ? { thinkMs } : {}),
        })
      } else if (event.type === 'tool_call_result' && event.id) {
        const startTs = toolStartTimes.get(event.id)
        const toolDuration = startTs !== undefined ? Date.now() - startTs : 0
        toolStartTimes.delete(event.id)
        execMsTotal += toolDuration
        lastStepEndTime = Date.now()
        const idx = assistantContent.findIndex(
          b => b.type === 'tool_use' && (b as { id: string }).id === event.id,
        )
        if (idx >= 0) {
          assistantContent[idx] = {
            ...(assistantContent[idx] as object),
            result: event.result,
            status: event.isError ? 'failed' : 'done',
            execMs: toolDuration,
          } as ContentBlock
        }
      } else if (event.type === 'tool_call_image' && event.id) {
        const idx = assistantContent.findIndex(
          b => b.type === 'tool_use' && (b as { id: string }).id === event.id,
        )
        if (idx >= 0) {
          const currentStatus = (assistantContent[idx] as Extract<ContentBlock, { type: 'tool_use' }>).status
          assistantContent[idx] = {
            ...(assistantContent[idx] as object),
            image: event.data,
            status: currentStatus === 'failed' ? 'failed' : 'done',
          } as ContentBlock
        }
      } else if (event.type === 'error') {
        throw new Error(event.content ?? 'AI Agent error')
      }
    }

    // Finalize remaining text
    if (currentText) {
      assistantContent.push({ type: 'text', text: currentText })
    }

    // Account for trailing LLM text generation
    llmMsTotal += Date.now() - lastStepEndTime

    const assistantText = assistantContent
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('')

    if (assistantText) {
      const finalizedText = await ensureAssistantStatusLine({
        text: assistantText,
        generateStatusLine: () => generateAssistantStatusLine(assistantText, settings),
        fallbackStatusLine: '当前状态：已完成当前回复，等待下一步指令',
      })
      const statusSuffix = finalizedText.slice(assistantText.length)
      let patched = false
      for (let i = assistantContent.length - 1; i >= 0; i -= 1) {
        const block = assistantContent[i]
        if (block.type === 'text') {
          assistantContent[i] = { ...block, text: block.text + statusSuffix }
          patched = true
          break
        }
      }
      if (!patched) {
        assistantContent.push({ type: 'text', text: finalizedText })
      }
    }

    // 8. Persist assistant message
    if (assistantContent.length > 0) {
      assistantContent.push({ type: 'timing', totalMs: Date.now() - chatStartTime, llmMs: llmMsTotal, execMs: execMsTotal, steps: stepIndex })
      store.appendMessage(work.id, 'assistant', assistantContent)
    }

    // 9. Extract summary from accumulated text
    const fullText = assistantContent
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('')
    const summary = fullText.slice(0, 200) || undefined
    const taskMemoryPlan = planTaskMemoryEvent({
      executionId: execution.id,
      trigger: previousExecution?.status === 'failed' ? 'task_recovered' : 'task_completed',
      baseScope: { user: 'local' },
      taskPrompt: task.prompt_template,
      adapters: memoryAdapters,
      toolCalls: assistantContent
        .filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')
        .map((block) => ({ name: block.name, args: block.args, status: block.status })),
    })
    // 10. Mark execution as completed
    store.updateTaskExecution(execution.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    })

    if (memoryCandidate) {
      queueTaskMemoryProcessing({
        executionId: execution.id,
        trigger: taskMemoryPlan.event.trigger,
        scope: taskMemoryPlan.event.scope,
        expectedMemoryType: taskMemoryPlan.event.expectedMemoryType,
        candidate: memoryCandidate,
      })
    }

    // 11. Send notification (notifier will be created in task 5.1)
    await safeNotify(
      {
        taskId: task.id,
        taskTitle: task.title,
        status: 'completed',
        summary,
        fullText: fullText || undefined,
        executionId: execution.id,
        workId: work.id,
      },
      task.notify_channels,
    )

    return {
      workId: work.id,
      executionId: execution.id,
      status: 'completed',
      summary,
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    const failedMemoryPlan = planTaskMemoryEvent({
      executionId: execution.id,
      trigger: 'task_failed',
      baseScope: { user: 'local' },
      taskPrompt: task.prompt_template,
      adapters: memoryAdapters,
      toolCalls: assistantContent
        .filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')
        .map((block) => ({ name: block.name, args: block.args, status: block.status })),
    })
    // Mark execution as failed
    store.updateTaskExecution(execution.id, {
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })

    try {
      if (memoryCandidate) {
        queueTaskMemoryProcessing({
          executionId: execution.id,
          trigger: 'task_failed',
          scope: failedMemoryPlan.event.scope,
          expectedMemoryType: failedMemoryPlan.event.expectedMemoryType,
          candidate: memoryCandidate,
        })
      }
    } catch {
      // A missing model configuration must not change the task failure result.
    }

    // Send failure notification
    await safeNotify(
      {
        taskId: task.id,
        taskTitle: task.title,
        status: 'failed',
        error: errorMessage,
        executionId: execution.id,
        workId: work.id,
      },
      task.notify_channels,
    )

    return {
      workId: work.id,
      executionId: execution.id,
      status: 'failed',
      error: errorMessage,
    }
  }
}
