import { describe, expect, it, vi } from 'vitest'

const runWeWorkerPowerShell = vi.fn(async (options) => ({
  sessionId: 'ps-test',
  command: options.command,
  cwd: options.cwd || 'cwd',
  shell: options.shell || 'bash',
  exitCode: 0,
  signal: null,
  output: 'ok',
  stdout: 'ok',
  stderr: '',
}))

vi.mock('../powershell-runner.js', () => ({
  runWeWorkerPowerShell,
}))

vi.mock('../webcli-runner.js', () => ({
  runWebcliCall: vi.fn(),
}))

describe('MCP tool context', () => {
  it('reads the adopted work and current turn cancellation when a prewarmed tool runs', async () => {
    const { buildMcpServer } = await import('../tools.js')
    const workIdRef: { current: string | null } = { current: null }
    const abortSignalRef: { current: AbortSignal | null } = { current: null }
    const server = buildMcpServer({ workIdRef, abortSignalRef })
    const tools = server.instance as unknown as { _registeredTools: Record<string, { handler(input: { command: string }): Promise<unknown> }> }
    workIdRef.current = 'adopted-work'
    const abort = new AbortController()
    abortSignalRef.current = abort.signal
    await tools._registeredTools.weworker_powershell.handler({ command: 'echo adopted' })
    expect(runWeWorkerPowerShell.mock.calls.at(-1)?.[0]).toMatchObject({ workId: 'adopted-work', signal: abort.signal })
    runWeWorkerPowerShell.mockClear()
  })
  it('keeps shell tool work context scoped to each MCP server instance', async () => {
    const { buildMcpServer } = await import('../tools.js')
    const firstAbort = new AbortController()
    const secondAbort = new AbortController()
    const firstServer = buildMcpServer({ workId: 'work-1', abortSignal: firstAbort.signal })
    const secondServer = buildMcpServer({ workId: 'work-2', abortSignal: secondAbort.signal })
    type RegisteredTool = { handler: (input: { command: string }) => Promise<unknown> }
    type ServerWithRegisteredTools = { _registeredTools: Record<string, RegisteredTool> }
    const firstTools = firstServer.instance as unknown as ServerWithRegisteredTools
    const secondTools = secondServer.instance as unknown as ServerWithRegisteredTools

    await firstTools._registeredTools.weworker_powershell.handler({ command: 'echo first' })
    await secondTools._registeredTools.weworker_powershell.handler({ command: 'echo second' })
    await firstTools._registeredTools.weworker_powershell.handler({ command: 'echo again' })

    expect(runWeWorkerPowerShell.mock.calls.map(([options]) => ({
      command: options.command,
      workId: options.workId,
      signal: options.signal,
    }))).toEqual([
      { command: 'echo first', workId: 'work-1', signal: firstAbort.signal },
      { command: 'echo second', workId: 'work-2', signal: secondAbort.signal },
      { command: 'echo again', workId: 'work-1', signal: firstAbort.signal },
    ])
  })
})
