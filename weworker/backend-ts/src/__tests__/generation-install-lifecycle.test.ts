import { expect, it, vi } from 'vitest'
import { ExplorationAgentCoordinator } from '../exploration-agent.js'

function fixture() {
  const run = { taskId: 'fixture', status: 'completed', tab: { id: 7 }, siteMemory: { siteKey: 'example.com' }, generationRunId: null, generationRun: null } as any
  const coordinator = Object.create(ExplorationAgentCoordinator.prototype)
  coordinator.requireRun = () => run
  coordinator.saveMemory = () => run
  coordinator._persistRuns = vi.fn()
  coordinator._settingsProvider = vi.fn(() => { throw new Error('Quick generation must not read model settings') })
  coordinator._bridge = {
    startGenerationRun: vi.fn(async () => ({ id: 'draft', siteKey: 'example.com', status: 'planning' })),
    getGenerationRun: vi.fn(async () => ({ id: 'draft', siteKey: 'example.com', status: 'needs_user_input', artifacts: { generationMode: 'quick' } })),
    resumeGenerationRun: vi.fn(async () => ({ id: 'draft', status: 'awaiting_approval' })),
    publishGenerationRun: vi.fn(async () => ({ id: 'draft', siteKey: 'example.com', status: 'awaiting_approval' })),
    refreshAdapterTabs: vi.fn(),
  }
  return { coordinator, run, bridge: coordinator._bridge }
}

it('starts and resumes quick generation without model settings, including a restored minimal snapshot', async () => {
  const { coordinator, run, bridge } = fixture()
  await coordinator.startGeneration('fixture', undefined, 'quick')
  expect(bridge.startGenerationRun).toHaveBeenCalledWith(expect.objectContaining({ mode: 'quick', tabId: 7 }))
  expect(bridge.startGenerationRun.mock.calls[0][0]).not.toHaveProperty('modelConfig')
  run.generationRun = { id: 'draft', status: 'needs_user_input' }
  await coordinator.resumeGeneration('fixture', 'Fixture page is ready')
  expect(bridge.resumeGenerationRun).toHaveBeenCalledWith('draft', 'Fixture page is ready', undefined)
  expect(coordinator._settingsProvider).not.toHaveBeenCalled()
})

it.each([
  [undefined, 'List articles and support liking'],
  ['  Only list articles  ', 'Only list articles'],
])('preserves the exploration goal unless generation explicitly overrides it', async (override, expected) => {
  const { coordinator, run, bridge } = fixture()
  run.goal = 'List articles and support liking'
  await coordinator.startGeneration('fixture', override, 'quick')
  expect(bridge.startGenerationRun).toHaveBeenCalledWith(expect.objectContaining({ goal: expected }))
})

it('forwards exact approval and refreshes consumers only after a completed installation', async () => {
  const { coordinator, run, bridge } = fixture()
  run.generationRunId = 'draft'
  const approval = { reviewId: 'a'.repeat(64), acceptChanges: true }
  const pending = await coordinator.publishGeneration('fixture', approval)
  expect(bridge.publishGenerationRun).toHaveBeenCalledWith('draft', approval)
  expect(pending.generationRun.status).toBe('awaiting_approval')
  expect(bridge.refreshAdapterTabs).not.toHaveBeenCalled()
  bridge.publishGenerationRun.mockResolvedValueOnce({ id: 'draft', siteKey: 'example.com', status: 'completed' })
  await coordinator.publishGeneration('fixture', approval)
  expect(bridge.refreshAdapterTabs).toHaveBeenCalledWith('example.com')
})
