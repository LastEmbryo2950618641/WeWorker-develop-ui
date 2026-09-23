import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { saveAdapterStream } from '../website-adapter-export.js'

test('export commits complete bytes and preserves the previous file on stream failure or cancellation', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'weworker-export-'))
  try {
    const destination = path.join(dir, 'adapter.zip')
    await writeFile(destination, 'previous')
    const failure = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.error(new Error('connection lost')) } })
    await assert.rejects(saveAdapterStream(failure, destination))
    assert.equal(await readFile(destination, 'utf8'), 'previous')
    const abort = new AbortController(); abort.abort()
    await assert.rejects(saveAdapterStream(new Response('partial').body, destination, abort.signal))
    assert.equal(await readFile(destination, 'utf8'), 'previous')
    await saveAdapterStream(new Response('complete').body, destination)
    assert.equal(await readFile(destination, 'utf8'), 'complete')
    assert.deepEqual(await readdir(dir), ['adapter.zip'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
