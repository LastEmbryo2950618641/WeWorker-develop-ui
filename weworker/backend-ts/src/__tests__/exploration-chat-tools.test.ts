import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  registeredTools: new Map<string, (args: Record<string, unknown>) => Promise<unknown>>(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, _description: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
    mocks.registeredTools.set(name, handler)
    return { name, handler }
  },
  createSdkMcpServer: (config: { tools: unknown[] }) => config,
}))

vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
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

const { buildMcpServer } = await import('../tools.js')

const legacyNames = [
  'list_explorable_tabs', 'start_api_exploration', 'list_api_explorations',
  'start_adapter_generation', 'get_adapter_generation', 'resume_adapter_generation',
  'publish_adapter_generation',
]

describe('shared WebCLI chat entry', () => {
  it.each(['full', 'no_bash', 'qa_only'] as const)('does not expose competing legacy lifecycle tools in %s', (mode) => {
    const server = buildMcpServer({ channelPermissionMode: mode }) as unknown as { tools: Array<{ name: string }> }
    const names = server.tools.map(tool => tool.name)
    for (const name of legacyNames) expect(names).not.toContain(name)
    if (mode === 'qa_only') expect(names).toEqual([])
    else expect(names).toContain('ask_user')
  })
})
