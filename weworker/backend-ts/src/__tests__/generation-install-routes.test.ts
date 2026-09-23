import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { z } from 'zod'
import { expect, it, vi } from 'vitest'

function endpoint(route: string, run: Record<string, unknown>) {
  const source = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8')
  const start = source.indexOf(`app.post('${route}'`)
  const end = source.indexOf('\n})', start) + 3
  expect(start).toBeGreaterThanOrEqual(0)
  let handler: (req: any, res: any) => Promise<void>
  const coordinator = { startGeneration: vi.fn(async () => run), publishGeneration: vi.fn(async () => run) }
  const reload = vi.fn()
  const context = vm.createContext({ z, app: { post: (_route: string, callback: typeof handler) => { handler = callback } }, explorationAgentCoordinator: coordinator, scheduleAdapterRuntimeReload: reload })
  vm.runInContext(ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  return { invoke: (body = {}) => handler({ params: { taskId: 'fixture' }, body }, res), coordinator, reload, res }
}

it('quick scaffold endpoint returns a tracked run without installing or refreshing', async () => {
  const run = { generationRunId: 'draft' }
  const fixture = endpoint('/exploration/runs/:taskId/scaffold', run)
  await fixture.invoke()
  expect(fixture.coordinator.startGeneration).toHaveBeenCalledWith('fixture', undefined, 'quick')
  expect(fixture.res.status).toHaveBeenCalledWith(202)
  expect(fixture.res.json).toHaveBeenCalledWith({ run })
  expect(fixture.reload).not.toHaveBeenCalled()
})

it.each(['awaiting_approval', 'completed'])('installation route forwards review and refreshes only on success (%s)', async status => {
  const fixture = endpoint('/exploration/runs/:taskId/generation/publish', { generationRun: { status, siteKey: 'example.com' } })
  const approval = { reviewId: 'a'.repeat(64), acceptChanges: true }
  await fixture.invoke(approval)
  expect(fixture.coordinator.publishGeneration).toHaveBeenCalledWith('fixture', approval)
  expect(fixture.reload).toHaveBeenCalledTimes(status === 'completed' ? 1 : 0)
})

it('rejects malformed installation approval before invoking the coordinator', async () => {
  const fixture = endpoint('/exploration/runs/:taskId/generation/publish', {})
  await fixture.invoke({ reviewId: 'unbounded-invalid-token', acceptChanges: 'yes' })
  expect(fixture.coordinator.publishGeneration).not.toHaveBeenCalled()
  expect(fixture.res.status).toHaveBeenCalledWith(409)
})
