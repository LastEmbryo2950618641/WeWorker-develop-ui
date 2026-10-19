import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  registeredTools: new Map<string, (args: Record<string, unknown>) => Promise<unknown>>(),
  toolDescriptions: new Map<string, string>(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, description: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
    mocks.registeredTools.set(name, handler)
    mocks.toolDescriptions.set(name, description)
    return { name, handler }
  },
  createSdkMcpServer: (config: { tools: unknown[] }) => config,
}))

vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../works-store.js', () => ({
  createScheduledTask: vi.fn(),
  listScheduledTasks: vi.fn(() => []),
}))

vi.mock('../scheduler.js', () => ({
  scheduler: { register: vi.fn() },
  Scheduler: { validateCron: vi.fn(() => ({ valid: true })), getNextRun: vi.fn() },
}))

vi.mock('../channels/channel-manager.js', () => ({
  channelManager: { getChannel: vi.fn(() => null) },
}))

vi.mock('../file-tools.js', () => ({
  listFiles: vi.fn(() => []),
}))

describe('Adapter command boundary', () => {
  const nativeShell = process.platform === 'win32' ? 'PowerShell' : 'Bash'

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.registeredTools.clear()
    mocks.toolDescriptions.clear()
  })

  it('does not expose website automation tools in qa_only mode', async () => {
    const { buildMcpServer } = await import('../tools.js')

    const server = buildMcpServer({ channelPermissionMode: 'qa_only' })

    expect((server as unknown as { tools: unknown[] }).tools).toEqual([])
    expect(mocks.registeredTools.has('webcli_call')).toBe(false)
  })

  it('registers the in-process webcli_call MCP only in full mode', async () => {
    const { buildMcpServer } = await import('../tools.js')

    buildMcpServer({ channelPermissionMode: 'full' })

    expect(mocks.registeredTools.has('webcli_call')).toBe(true)
    expect(mocks.registeredTools.has('call_adapter_tool')).toBe(false)
    expect(mocks.toolDescriptions.get('webcli_call')).toContain('避免为每次网站操作启动新的 webcli CLI 进程')
  })

  it('rejects webcli through WeWorker Shell in full mode', async () => {
    const { buildMcpServer } = await import('../tools.js')

    buildMcpServer({ channelPermissionMode: 'full' })
    const handler = mocks.registeredTools.get('weworker_powershell')

    const result = await handler!({
      command: 'cd /tmp && webcli call blog-admin.search-blog --limit=5',
    })

    expect(result).toEqual({
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: `Adapter commands must run with Claude Code native ${nativeShell} instead of WeWorker Shell.`,
        }),
      }],
    })
  })

  it('does not expose webcli_call in no_bash mode', async () => {
    const { buildMcpServer } = await import('../tools.js')

    buildMcpServer({ channelPermissionMode: 'no_bash' })
    expect(mocks.registeredTools.has('webcli_call')).toBe(false)
  })

  it('rejects webcli through WeWorker Shell in no_bash mode', async () => {
    const { buildMcpServer } = await import('../tools.js')
    buildMcpServer({ channelPermissionMode: 'no_bash' })
    const handler = mocks.registeredTools.get('weworker_powershell')

    const result = await handler!({ command: 'webcli call open_browser --url=https://expense.example.com/' })

    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({
        error: 'Adapter commands require full permission mode and the platform-native Claude Code command tool.',
      }) }],
    })
  })
})
