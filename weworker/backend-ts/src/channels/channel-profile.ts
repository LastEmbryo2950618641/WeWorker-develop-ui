/**
 * Shared contract between IM channels (企业微信 / 微信) and whoever decides
 * who a bot serves. The default profiles keep each channel's original
 * single-bot behavior; dedicated agents supply their own profile so several
 * bots can run side by side.
 */
import type { streamChat } from '../agent.js'
import type { ChannelPermissionMode } from './channel-permissions.js'
import type { MemoryScope } from '../memory/memory-types.js'

export type ChannelCommand = '/new' | '/stop' | '/id' | '/myid' | '/help'

const COMMAND_ALIASES: Record<string, ChannelCommand> = {
  '/new': '/new', '/reset': '/new', '/clear': '/new', '新对话': '/new', '/新对话': '/new', '新建对话': '/new',
  '/stop': '/stop', '停止': '/stop', '/停止': '/stop',
  '/id': '/id',
  '/myid': '/myid',
  '/help': '/help', '帮助': '/help', '/帮助': '/help',
}

/**
 * Recognize channel commands tolerantly: full-width slash, zero-width or
 * non-breaking spaces and trailing punctuation from IM input methods.
 */
export function parseChannelCommand(text: string): ChannelCommand | null {
  const normalized = String(text ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[／⁄∕]/g, '/')
    .trim()
    .replace(/[。.!！?？]+$/u, '')
    .trim()
    .toLowerCase()
  return COMMAND_ALIASES[normalized] ?? null
}

export type ChannelAccessDecision =
  | { kind: 'allow'; mode: ChannelPermissionMode }
  | { kind: 'reply'; text: string }

type StreamChatOptions = NonNullable<Parameters<typeof streamChat>[3]>

/** Extra per-turn agent options a profile may contribute. */
export type ChannelProfileChatOptions = Pick<
  StreamChatOptions,
  'isolatedClaudeConfigDir' | 'appendSystemPrompt' | 'extraToolGuard' | 'extraDisallowedTools'
>

export interface ChannelProfile {
  /** Namespace for channel sessions and notify targets. */
  channelKey: string
  /** Prefix shown in conversation titles, e.g. 企微 / 微信. */
  titleLabel(chatType: 'single' | 'group'): string
  /** Greeting for channels that report "user entered the chat" (企业微信). */
  welcomeText(): string
  /** Called before any other handling. A reply short-circuits the message. */
  authorize(userId: string, text: string): ChannelAccessDecision
  memoryScope(userId: string): MemoryScope
  /** May prepare per-turn resources (e.g. an isolated skills directory). */
  chatOptions(userId: string): ChannelProfileChatOptions
  /** Reject a new turn from the same user while one is still running. */
  serializeTurns?: boolean
  /** Project used for conversations created by this profile. */
  projectId?(): string | null
  helpText?(): string
  onWorkCreated?(workId: string): void
}
