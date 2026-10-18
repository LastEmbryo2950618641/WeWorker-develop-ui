import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getUserDirectory } from './config.js'
import { listFiles } from './file-tools.js'
import { assertPathInsideUserDirectory } from './user-directory-guard.js'
import type { ChannelPermissionMode } from './channels/channel-permissions.js'
import * as store from './works-store.js'
import { scheduler, Scheduler } from './scheduler.js'
import { channelManager } from './channels/channel-manager.js'
import type { WecomChannel } from './channels/wecom-channel.js'
import {
  getLatestCacheFile,
  readCacheResult,
  isCacheFresh,
  WEBCLI_RESULT_CACHE_TTL_MS,
} from './webcli-result-cache.js'
import { projectResult } from './webcli-result-project.js'
import { checkFileEncryptionCached } from './encryption-check-cache.js'
import { createLogger } from './logger.js'
import { runWeWorkerPowerShell } from './powershell-runner.js'
import { invokesWebcli } from './agent-tool-policy.js'

const log = createLogger('tools')

// ── ask_user pending requests（实现见 ask-user-pending.ts，此处 re-export 保留既有导入路径）──
import {
  setPendingAskUser,
  resolvePendingAskUser,
  hasPendingAskUser,
  getPendingAskUser,
  type AskUserRequest,
} from './ask-user-pending.js'
export {
  setPendingAskUser,
  resolvePendingAskUser,
  hasPendingAskUser,
  getPendingAskUser,
  type AskUserRequest,
}

type AskUserSSECallback = (event: { type: string; id: string; question: string; options: Array<{ label: string; description?: string }> }) => void
type ChannelAskUserHandler = (question: string, options: Array<{ label: string; description?: string }>) => Promise<string>

interface McpServerContext {
  platform?: NodeJS.Platform
  channelPermissionMode?: ChannelPermissionMode
  workId?: string | null
  /**
   * Work resolved at tool-call time. A pre-started chat session is created
   * before its work is known and is bound to the work on its first turn.
   */
  workIdRef?: { current: string | null }
  abortSignal?: AbortSignal | null
  askUserSSECallback?: AskUserSSECallback | null
  channelAskUserHandler?: ChannelAskUserHandler | null
}

/** Names only: used by the context inspector, never sent as an extra prompt. */
export function getMcpToolDefinitionSummary(mode: ChannelPermissionMode = 'full'): string {
  if (mode === 'qa_only') return ''
  const names = [
    'webcli_result',
    'weworker_powershell',
    'ask_user',
    'create_scheduled_task',
    'list_scheduled_tasks',
    'list_files',
    'send_file_to_user',
    'send_image_to_user',
  ]
  if (process.platform === 'win32') names.push('check_file_encryption', 'decrypt_file')
  return names.join('\n')
}

export function resolveToolDisplayName(sdkName: string): string {
  return sdkName.replace(/^mcp__weworker__/, '')
}

// ── File decrypt helpers (Windows only) ───────────────────────────────────────

function _findDecryptExe(): string | null {
  const resourcesPath = process.env.WEWORKER_RESOURCES_PATH || ''
  const candidates = [
    ...(resourcesPath ? [path.join(resourcesPath, 'tools', 'sd_decrypt.exe')] : []),
    path.join(process.cwd(), '..', 'build', 'decrypt-dist', 'sd_decrypt.exe'),
    path.join(process.cwd(), 'build', 'decrypt-dist', 'sd_decrypt.exe'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

// ── Encryption check cache (work-scoped, keyed by path + mtime) ────────────────
// Avoids re-spawning sd_decrypt.exe for an unchanged file within a work.
// Implementation + TTL in ./encryption-check-cache.ts; mtime in the key means
// decrypt_file rewriting the file auto-invalidates the cached result.

// ── MCP Server (weworker-specific tools only) ─────────────────────────────────

export function buildMcpServer(opts?: McpServerContext) {
  const fixedWorkId = opts?.workId ?? null
  const currentWorkId = (): string | null => (opts?.workIdRef ? opts.workIdRef.current : fixedWorkId)
  const abortSignal = opts?.abortSignal ?? null
  const askUserSSECallback = opts?.askUserSSECallback ?? null
  const channelAskUserHandler = opts?.channelAskUserHandler ?? null
  const channelPermissionMode = opts?.channelPermissionMode ?? 'full'
  const platform = opts?.platform ?? process.platform
  const nativeCommandTool = platform === 'win32' ? 'PowerShell' : 'Bash'

  if (opts?.channelPermissionMode === 'qa_only') {
    return createSdkMcpServer({
      name: 'weworker-tools',
      version: '1.0.0',
      tools: [],
    })
  }

  const systemTools = [
    tool(
      'webcli_result',
      `读取 webcli 工具落盘的大结果（large_output 指针）并按需投影成精简文本，避免大模型直接读取超大 JSON。当 webcli 工具返回 type="large_output" 的指针时，用本工具查具体内容。缓存有 ${Math.round(WEBCLI_RESULT_CACHE_TTL_MS / 60000)} 分钟有效期，过期会提示重新调用原查询刷新。`,
      {
        file: z.string().optional().describe('缓存文件绝对路径（来自 large_output 指针的 file 字段）。省略时取本会话最近一次大结果。'),
        mode: z.enum(['summary', 'keys', 'page', 'pick', 'item']).optional().describe('summary=可读总览(默认,剥raw)；keys=查看结构；page=分页(剥raw)；pick=挑字段；item=取单条(可选含raw)。'),
        fields: z.string().optional().describe('pick 模式：逗号分隔字段名(支持 a.b 路径)。'),
        keyword: z.string().optional().describe('page 模式：按关键字过滤数组项(匹配任意字段)。'),
        index: z.number().int().optional().describe('item 模式：数组下标(0 起)。'),
        page: z.number().int().optional().describe('page 模式：页码(默认 1)。'),
        pageSize: z.number().int().optional().describe('page 模式：每页条数(默认 20)。'),
        includeRaw: z.boolean().optional().describe('item 模式：是否包含原始 raw 字段(默认 false)。'),
      },
      async ({ file, mode, fields, keyword, index, page, pageSize, includeRaw }) => {
        try {
          let resolved = file ? assertPathInsideUserDirectory(file, 'file') : getLatestCacheFile(currentWorkId())
          if (!resolved) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  type: 'no_cached_result',
                  hint: '没有可读取的缓存结果。请先调用原 webcli 工具，再用返回的 large_output 指针里的 file 路径读取。',
                }),
              }],
            }
          }
          if (!isCacheFresh(resolved)) {
            const mtimeMs = (() => { try { return fs.statSync(resolved).mtimeMs } catch { return null } })()
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  type: 'cache_expired',
                  file: resolved,
                  savedAt: mtimeMs ? new Date(mtimeMs).toISOString() : null,
                  ttlMs: WEBCLI_RESULT_CACHE_TTL_MS,
                  hint: '缓存已过期，请重新调用原 webcli 工具刷新后再读取，避免给出陈旧结果。',
                }),
              }],
            }
          }
          const obj = readCacheResult(resolved)
          const text = projectResult(obj, {
            mode: mode ?? 'summary',
            fields,
            keyword,
            index,
            page,
            pageSize,
            includeRaw,
          })
          return { content: [{ type: 'text' as const, text }] }
        } catch (e) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }] }
        }
      },
    ),
    tool(
      'weworker_powershell',
      channelPermissionMode === 'full'
        ? `Run a local command through WeWorker Shell with live output visible in the terminal panel. Do not use it for Adapter commands; webcli must use Claude Code native ${nativeCommandTool}.`
        : 'Run a local command through WeWorker Shell with live output visible in the terminal panel. Adapter commands are unavailable because Claude Code native command tools are disabled.',
      {
        command: z.string().describe('Shell command to run. It must comply with WeWorker user-directory restrictions.'),
        cwd: z.string().optional().describe('Working directory. Defaults to the configured user directory and must stay inside it.'),
        shell: z.enum(['bash', 'powershell']).optional().describe('Shell to use. Defaults to PowerShell on Windows and bash elsewhere.'),
        outputEncoding: z.string().optional().describe('Terminal stdout/stderr decoding label. Defaults to utf-8, and Windows native commands such as xcopy/copy/dir are auto-decoded as gbk unless explicitly set.'),
      },
      async ({ command, cwd, shell, outputEncoding }) => {
        try {
          if (invokesWebcli(command)) {
            const error = channelPermissionMode === 'full'
              ? `Adapter commands must run with Claude Code native ${nativeCommandTool} instead of WeWorker Shell.`
              : 'Adapter commands require full permission mode and the platform-native Claude Code command tool.'
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error }) }] }
          }
          const result = await runWeWorkerPowerShell({
            command,
            cwd,
            shell,
            outputEncoding,
            source: 'ai',
            workId: currentWorkId(),
            signal: abortSignal,
          })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: result.exitCode === 0,
                sessionId: result.sessionId,
                shell: result.shell,
                outputEncoding: result.outputEncoding,
                exitCode: result.exitCode,
                signal: result.signal,
                cwd: result.cwd,
                output: result.output,
              }, null, 2),
            }],
          }
        } catch (e) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
            }],
          }
        }
      },
    ),
    tool(
      'ask_user',
      '向用户提出选择题，等待用户回答后返回结果。当操作涉及用户偏好决策时使用（如支付方式、商品选择、收货地址等）。选项应尽量来自前一步工具返回的真实数据。',
      {
        question: z.string().describe('要问用户的问题'),
        options: z.array(z.object({
          label: z.string().describe('选项标签（用户看到的文字）'),
          description: z.string().optional().describe('选项的补充说明'),
        })).describe('可选项列表（2-6个）'),
      },
      async ({ question, options }) => {
        const workId = currentWorkId()
        if (!workId) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active work context' }) }] }
        }

        if (channelAskUserHandler) {
          const answer = await channelAskUserHandler(question, options)
          return { content: [{ type: 'text' as const, text: JSON.stringify({ answer }) }] }
        }

        const toolCallId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

        if (askUserSSECallback) {
          askUserSSECallback({ type: 'user_choice', id: toolCallId, question, options })
        }

        const answer = await new Promise<string>((resolve) => {
          setPendingAskUser(workId, { toolCallId, question, options, resolve })
          setTimeout(() => {
            if (hasPendingAskUser(workId)) {
              resolvePendingAskUser(workId, '用户未在规定时间内回答')
            }
          }, 5 * 60 * 1000)
        })

        return { content: [{ type: 'text' as const, text: JSON.stringify({ answer }) }] }
      }
    ),

    tool(
      'create_scheduled_task',
      '创建一个定时任务。定时任务会按照 cron 表达式周期性执行指定的 AI 任务。创建后任务默认启用，会立即注册到调度器。',
      {
        title: z.string().describe('任务标题，简要描述任务内容'),
        cron_expression: z.string().describe('Cron 表达式，例如 "0 9 * * *" 表示每天9点'),
        prompt_template: z.string().describe('任务描述/提示词，AI 执行时会收到这段文字作为指令'),
        notify_channels: z.array(z.string()).optional().describe('通知通道列表，可选值: "qq", "weixin"'),
      },
      async ({ title, cron_expression, prompt_template, notify_channels }) => {
        const validation = Scheduler.validateCron(cron_expression)
        if (!validation.valid) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `无效的 cron 表达式: ${validation.error}` }) }] }
        }
        const task = store.createScheduledTask({
          title, cron_expression, prompt_template, enabled: true,
          notify_channels: notify_channels ?? [],
        })
        scheduler.register(task.id, task.cron_expression)
        const nextRun = Scheduler.getNextRun(cron_expression)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true, task,
              next_run: nextRun?.toISOString() ?? null,
              message: `定时任务「${title}」已创建并启用，下次执行时间: ${nextRun ? nextRun.toLocaleString('zh-CN') : '未知'}`,
            }, null, 2),
          }],
        }
      }
    ),

    tool(
      'list_scheduled_tasks',
      '列出所有定时任务及其最近一次执行状态。',
      {},
      async () => {
        const tasks = store.listScheduledTasks()
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              total: tasks.length,
              tasks: tasks.map(t => ({
                ...t,
                next_run: t.enabled ? Scheduler.getNextRun(t.cron_expression)?.toISOString() ?? null : null,
              })),
            }, null, 2),
          }],
        }
      }
    ),

    tool(
      'list_files',
      `列出用户目录中的文件（仅限 ${getUserDirectory()} 及其子目录，按修改时间倒序排列）。`,
      {
        directory: z.string().optional().describe(`用户目录内的子目录路径（默认 ${getUserDirectory()}）`),
        keyword: z.string().optional().describe('按文件名关键词过滤'),
        limit: z.number().optional().describe('最大返回数量（默认 50）'),
      },
      async ({ directory, keyword, limit }) => {
        try {
          const result = listFiles(directory, keyword, limit)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (e) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }] }
        }
      }
    ),

    tool(
      'send_file_to_user',
      '通过企业微信发送文件给用户。需要企业微信通道已连接且有用户对话过。',
      {
        file_path: z.string().describe('文件的绝对路径（必须在用户目录内）'),
      },
      async ({ file_path }) => {
        try {
          const resolved = assertPathInsideUserDirectory(file_path, 'file_path')
          const wecom = channelManager.getChannel('wecom') as WecomChannel | undefined
          if (!wecom) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: '企业微信通道未启用' }) }] }
          }
          const result = await wecom.sendFile(resolved)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
        } catch (e) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }] }
        }
      }
    ),

    tool(
      'send_image_to_user',
      '通过企业微信发送图片给用户。需要企业微信通道已连接且有用户对话过。',
      {
        file_path: z.string().describe('图片文件的绝对路径（必须在用户目录内）'),
      },
      async ({ file_path }) => {
        try {
          const resolved = assertPathInsideUserDirectory(file_path, 'file_path')
          const wecom = channelManager.getChannel('wecom') as WecomChannel | undefined
          if (!wecom) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: '企业微信通道未启用' }) }] }
          }
          const result = await wecom.sendImage(resolved)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
        } catch (e) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }] }
        }
      }
    ),

    ...(process.platform === 'win32' ? [
      tool(
        'check_file_encryption',
        '检查文件是否被公司 DLP 系统加密（仅 Windows）。',
        { file_path: z.string().describe('文件的绝对路径') },
        async ({ file_path }) => {
          try {
            const resolved = assertPathInsideUserDirectory(file_path, 'file_path')
            let mtimeMs = 0
            try { mtimeMs = fs.statSync(resolved).mtimeMs } catch {}
            const exePath = _findDecryptExe()
            if (!exePath) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: '未找到 sd_decrypt.exe' }) }] }
            const execFileAsync = promisify(execFile)
            const { text } = await checkFileEncryptionCached(currentWorkId(), resolved, mtimeMs, async () => {
              const { stdout } = await execFileAsync(exePath, ['--check', '--json', resolved], { timeout: 15000 })
              return stdout.trim()
            })
            return { content: [{ type: 'text' as const, text }] }
          } catch (e: any) {
            const output = e.stdout?.trim() || ''
            if (output) return { content: [{ type: 'text' as const, text: output }] }
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }) }] }
          }
        }
      ),
      tool(
        'decrypt_file',
        '解密被公司 DLP 系统加密的文件（仅 Windows）。',
        {
          file_path: z.string().describe('文件或文件夹的绝对路径（必须在用户目录内）'),
          extensions: z.array(z.string()).optional().describe('文件扩展名过滤，如 [".pdf", ".docx"]'),
        },
        async ({ file_path, extensions }) => {
          try {
            const resolved = assertPathInsideUserDirectory(file_path, 'file_path')
            const exePath = _findDecryptExe()
            if (!exePath) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: '未找到 sd_decrypt.exe' }) }] }
            const args = ['--json', resolved]
            if (extensions) { for (const ext of extensions) { args.splice(1, 0, '--ext', ext) } }
            const execFileAsync = promisify(execFile)
            const { stdout } = await execFileAsync(exePath, args, { timeout: 60000 })
            return { content: [{ type: 'text' as const, text: stdout.trim() }] }
          } catch (e: any) {
            const output = e.stdout?.trim() || ''
            if (output) return { content: [{ type: 'text' as const, text: output }] }
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }) }] }
          }
        }
      ),
    ] : []),
  ]

  return createSdkMcpServer({
    name: 'weworker-tools',
    version: '1.0.0',
    tools: systemTools,
  })
}
