import fs from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'

export async function saveAdapterStream(body, destination, signal) {
  const temporary = destination + '.' + randomUUID() + '.partial'
  try {
    await pipeline(body, fs.createWriteStream(temporary, { flags: 'wx' }), { signal })
    signal?.throwIfAborted()
    await rename(temporary, destination)
  } finally {
    // Only remove the temporary file created by this export; preserve existing downloads on failure.
    await rm(temporary, { force: true })
  }
}
