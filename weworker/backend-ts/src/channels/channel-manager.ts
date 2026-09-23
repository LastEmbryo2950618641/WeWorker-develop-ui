import type { Settings } from '../config.js'
import type { ChannelPermissionMode } from './channel-permissions.js'
import * as store from '../works-store.js'
import { generateAssistantStatusLine, streamChat } from '../agent.js'
import { ensureAssistantStatusLine } from '../assistant-status.js'
import { createLogger } from '../logger.js'
import type { MemoryScope } from '../memory/memory-types.js'

const log = createLogger('channel-manager')

export interface ChannelStatus {
  status: 'starting' | 'connected' | 'error'
  error?: string
}

export interface Channel {
  start(): Promise<void>
  stop(): Promise<void>
  getStatus(): ChannelStatus
  /** 主动发送通知消息（可选，不是所有通道都支持） */
  sendNotification?(text: string): Promise<void>
}

export class ChannelManager {
  private _channels = new Map<string, Channel>()

  register(name: string, channel: Channel): void {
    this._channels.set(name, channel)
  }

  async unregister(name: string): Promise<void> {
    const ch = this._channels.get(name)
    if (ch) {
      await ch.stop()
      this._channels.delete(name)
    }
  }

  has(name: string): boolean {
    return this._channels.has(name)
  }

  getChannel(name: string): Channel | undefined {
    return this._channels.get(name)
  }

  async startAll(): Promise<void> {
    await Promise.allSettled([...this._channels.values()].map(c => c.start()))
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled([...this._channels.values()].map(c => c.stop()))
  }

  getStatuses(): Record<string, ChannelStatus> {
    const result: Record<string, ChannelStatus> = {}
    for (const [name, channel] of this._channels) {
      result[name] = channel.getStatus()
    }
    return result
  }
}

export const channelManager = new ChannelManager()

export async function runChannelChat(
  messages: store.Message[],
  settings: Settings,
  opts?: {
    channelPermissionMode?: ChannelPermissionMode
    memoryScope?: MemoryScope
    /** Called when ask_user tool fires — channel should send options to user and wait for reply */
    askUserHandler?: (question: string, options: Array<{ label: string; description?: string }>) => Promise<string>
  },
): Promise<{ text: string; images: string[]; toolCalls: store.ContentBlock[]; timing: store.ContentBlock | null }> {
  let text = ''
  const images: string[] = []
  // Collect tool call records for desktop-side debugging
  const toolCalls: store.ContentBlock[] = []
  const toolCallMap = new Map<string, { name: string; args: unknown; thinkMs?: number; startMs?: number }>()

  // Per-turn timing (mirrors server.ts / task-executor.ts so channel turns are observable)
  const chatStartTime = Date.now()
  let lastStepEndTime = chatStartTime
  // Per-tool start timestamps (parallel tool_use blocks overlap; see server.ts /chat)
  const toolStartTimes = new Map<string, number>()
  let llmMsTotal = 0
  let execMsTotal = 0
  let stepIndex = 0
  const seenToolIds = new Set<string>()

  for await (const event of streamChat(messages, settings, undefined, {
    streaming: false,
    channelPermissionMode: opts?.channelPermissionMode ?? 'full',
    memoryScope: opts?.memoryScope,
    channelAskUserHandler: opts?.askUserHandler,
  })) {
    if (event.type === 'skill_context' && event.skillContext) {
      toolCalls.push(event.skillContext)
    } else if (event.type === 'text_delta' && event.content) {
      text += event.content
    } else if (event.type === 'tool_call_start' && event.id) {
      const isNew = !seenToolIds.has(event.id)
      let thinkMs: number | undefined
      let startMs: number | undefined
      if (isNew) {
        seenToolIds.add(event.id)
        stepIndex++
        startMs = Date.now()
        // Charge think only when no tool is outstanding (parallel starts' gaps are
        // LLM arg streaming covered by each tool's own exec window)
        thinkMs = toolStartTimes.size === 0 ? startMs - lastStepEndTime : 0
        llmMsTotal += thinkMs
        toolStartTimes.set(event.id, startMs)
      } else {
        // Dedup re-emission: keep the original per-tool start instead of clobbering
        // it with whatever tool started most recently
        startMs = toolCallMap.get(event.id)?.startMs
      }
      toolCallMap.set(event.id, {
        name: event.name ?? '',
        args: event.args,
        ...(thinkMs !== undefined ? { thinkMs } : {}),
        ...(startMs !== undefined ? { startMs } : {}),
      })
    } else if (event.type === 'tool_call_result' && event.id) {
      const started = toolCallMap.get(event.id)
      const toolDuration = started?.startMs ? Date.now() - started.startMs : 0
      toolStartTimes.delete(event.id)
      execMsTotal += toolDuration
      lastStepEndTime = Date.now()
      toolCalls.push({
        type: 'tool_use',
        id: event.id,
        name: started?.name ?? '',
        args: started?.args ?? {},
        result: event.result ?? '',
        status: event.isError ? 'failed' : 'done',
        execMs: toolDuration,
        ...(started?.thinkMs !== undefined ? { thinkMs: started.thinkMs } : {}),
      })
    } else if (event.type === 'tool_call_image' && event.data) {
      images.push(event.data)
      // Attach image to the most recent tool call if possible
      if (toolCalls.length > 0) {
        const last = toolCalls[toolCalls.length - 1]
        if (last.type === 'tool_use') last.image = event.data
      }
    } else if (event.type === 'error' && event.content) {
      text = event.content
      break
    } else if (event.type === 'done') {
      break
    }
  }

  // Account for trailing LLM text generation after the last tool
  llmMsTotal += Date.now() - lastStepEndTime
  const totalMs = Date.now() - chatStartTime
  const timing: store.ContentBlock = { type: 'timing', totalMs, llmMs: llmMsTotal, execMs: execMsTotal, steps: stepIndex }
  log.info(`runChannelChat turn — total=${(totalMs / 1000).toFixed(2)}s llm=${(llmMsTotal / 1000).toFixed(2)}s exec=${(execMsTotal / 1000).toFixed(2)}s steps=${stepIndex}`)

  const finalizedText = text
    ? await ensureAssistantStatusLine({
        text,
        generateStatusLine: () => generateAssistantStatusLine(text, settings),
        fallbackStatusLine: '当前状态：已完成当前回复，等待下一步指令',
      })
    : text

  return { text: finalizedText, images, toolCalls, timing }
}
