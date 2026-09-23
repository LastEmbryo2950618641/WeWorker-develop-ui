import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../components/exploration/ExplorationPage.jsx', import.meta.url), 'utf8')
function handler(name, context) {
  const start = source.indexOf(`  const ${name} = async () => {`)
  const end = source.indexOf('\n  const ', start + 1)
  assert.ok(start >= 0 && end > start)
  vm.runInContext(source.slice(start, end) + `\n globalThis.invoke = ${name}`, context)
  return context.invoke()
}

for (const status of ['awaiting_approval', 'completed']) {
  test(`desktop confirms the displayed review and reports ${status} accurately`, async () => {
    const calls = [], messages = [], updated = []
    const next = { generationRun: { status, lastError: { message: 'Review changed' } } }
    const context = vm.createContext({
      run: { taskId: 'fixture' }, generation: { artifacts: { installationReview: { reviewId: 'review' } } },
      busyAction: '', actionBusy: false, setBusyAction() {}, setActionBusy() {}, window: { confirm: () => true },
      normalizeError: error => error.message, setGenerationMessage: value => messages.push(value), setRun: value => updated.push(value),
      publishExplorationGeneration: async (...args) => { calls.push(args); return next },
    })
    await handler('handlePublishGeneration', context)
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['fixture', { reviewId: 'review', acceptChanges: true }])
    assert.equal(updated[0], next)
    assert.equal(messages.at(-1), status === 'completed' ? 'Adapter 已安装，目标页面已刷新。' : 'Review changed')
  })
}

test('desktop quick generation tracks a run and describes validation before installation', async () => {
  const messages = [], updated = []
  const run = { generationRunId: 'fixture-draft' }
  const context = vm.createContext({
    run: { taskId: 'fixture' }, busyAction: '', actionBusy: false, setBusyAction() {}, setActionBusy() {},
    normalizeError: error => error.message, setGenerationMessage: value => messages.push(value), setRun: value => updated.push(value),
    generateExplorationScaffold: async () => ({ run }),
  })
  await handler('handleQuickGenerate', context)
  assert.equal(updated[0], run)
  assert.match(messages.at(-1), /验证.*安装/)
  assert.doesNotMatch(messages.at(-1), /已安装|已刷新/)
})
