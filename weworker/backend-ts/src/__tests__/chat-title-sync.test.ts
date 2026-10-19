import fs from 'node:fs'
import vm from 'node:vm'
import { expect, it, vi } from 'vitest'

const source = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8')

it('publishes the initial saved title without waiting for the model response', () => {
  const start = source.indexOf('  if (isFirstMessage && retryCompaction !== true) {')
  const end = source.indexOf('\n  const workWithMessages =', start)
  const saved = vi.fn()
  const broadcastSSE = vi.fn()
  vm.runInNewContext(source.slice(start, end), {
    isFirstMessage: true, retryCompaction: false, workId: 'fixture-work', titleSource: 'fixture prompt',
    generateTitle: () => 'fixture title', store: { updateTitle: saved }, broadcastSSE,
  })
  expect(saved).toHaveBeenCalledWith('fixture-work', 'fixture title')
  expect(broadcastSSE).toHaveBeenCalledWith({ type: 'title_update', workId: 'fixture-work', title: 'fixture title' })
})

it.each([
  { state: 'ended', writableEnded: true, destroyed: false, writes: 0 },
  { state: 'disconnected', writableEnded: false, destroyed: true, writes: 0 },
  { state: 'open', writableEnded: false, destroyed: false, writes: 1 },
])('publishes generated titles globally with an $state chat response', async ({ writableEnded, destroyed, writes }) => {
  const sendStart = source.indexOf('  const send = (event: object) => {', source.indexOf("app.post('/works/:id/chat'"))
  const sendEnd = source.indexOf('\n  const processMemoryCandidate', sendStart)
  const titleStart = source.indexOf('  // Fire async LLM title generation', sendEnd)
  const titleEnd = source.indexOf('\n  const chatStartTime', titleStart)
  const res = { writableEnded, destroyed, write: vi.fn() }
  const updateTitle = vi.fn()
  const broadcastSSE = vi.fn()
  const scope = vm.createContext({
    res, isFirstMessage: true, workId: 'fixture-work', titleSource: 'fixture prompt', settings: {},
    store: { updateTitle }, broadcastSSE, generateTitleWithLLM: async () => 'generated fixture title',
  })
  vm.runInContext(source.slice(sendStart, sendEnd).replace('(event: object)', '(event)') + source.slice(titleStart, titleEnd), scope)
  await Promise.resolve()
  await Promise.resolve()
  expect(updateTitle).toHaveBeenCalledWith('fixture-work', 'generated fixture title')
  expect(res.write).toHaveBeenCalledTimes(writes)
  if (writes) {
    expect(res.write).toHaveBeenCalledWith('data: ' + JSON.stringify({ type: 'title_update', title: 'generated fixture title', workId: 'fixture-work' }) + '\n\n')
  }
  expect(broadcastSSE).toHaveBeenCalledWith({ type: 'title_update', workId: 'fixture-work', title: 'generated fixture title' })
})
