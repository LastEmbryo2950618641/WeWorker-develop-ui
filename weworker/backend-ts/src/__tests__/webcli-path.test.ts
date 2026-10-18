import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveWebcliDir, resolveWebcliEntry } from '../webcli-path.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('desktop CLI distribution resolution', () => {
  it('uses the same prepared distribution for PATH, execution and bundled Skills', () => {
    vi.stubEnv('WEWORKER_PACKAGED', '')
    vi.spyOn(fs, 'existsSync').mockImplementation(file => String(file) === path.join(root, 'weworker/build/webcli-dist/webcli.cjs'))
    expect(resolveWebcliDir()).toBe(path.join(root, 'weworker/build/webcli-dist'))
    expect(resolveWebcliEntry()).toBe(path.join(resolveWebcliDir(), 'webcli.cjs'))
  })
  it('falls back to source only in an unbuilt development checkout', () => {
    vi.stubEnv('WEWORKER_PACKAGED', '')
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    expect(resolveWebcliDir()).toBe(path.join(root, 'webcli'))
    expect(resolveWebcliEntry()).toBe(path.join(resolveWebcliDir(), 'index.js'))
  })
  it('never falls back to a global or development CLI when packaged resources are missing', () => {
    vi.stubEnv('WEWORKER_PACKAGED', '1')
    vi.stubEnv('WEWORKER_RESOURCES_PATH', '/example/resources')
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    expect(resolveWebcliDir()).toBe('/example/resources/webcli')
    expect(resolveWebcliEntry()).toBe('/example/resources/webcli/webcli.cjs')
  })
})
