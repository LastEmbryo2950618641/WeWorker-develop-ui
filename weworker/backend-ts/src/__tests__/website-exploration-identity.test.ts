import express from 'express'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, test, vi } from 'vitest'
import { createWebsiteExplorationRouter } from '../website-exploration.js'

afterEach(() => vi.unstubAllEnvs())

async function request(instanceId: string, upstream: typeof fetch) {
  const app = express()
  app.use(createWebsiteExplorationRouter({ instanceId, fetch: upstream }))
  const server = app.listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/health`)
    return { status: response.status, body: await response.json() }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

test.each([
  ['', '独立启动的后端'],
  ['backend-fixture', '未传入网站探索服务实例信息'],
])('missing identity explains backend ownership: %s', async (backendId, message) => {
  vi.stubEnv('WEWORKER_BACKEND_INSTANCE_ID', backendId)
  const upstream = vi.fn()
  const result = await request('', upstream)
  expect(result.status).toBe(503)
  expect(result.body.detail).toContain(message)
  expect(upstream).not.toHaveBeenCalled()
})

test.each(['other-instance', undefined])('rejects foreign or old service: %s', async instanceId => {
  const result = await request('host-fixture', vi.fn(async () => Response.json({ ok: true, instance_id: instanceId })))
  expect(result.status).toBe(503)
  expect(result.body.detail).toContain('实例不匹配')
})

test('matching managed service becomes available', async () => {
  const health = { ok: true, instance_id: 'host-fixture' }
  const result = await request('host-fixture', vi.fn(async () => Response.json(health)))
  expect(result).toEqual({ status: 200, body: health })
})

test('unhealthy service is reported as starting', async () => {
  const result = await request('host-fixture', vi.fn(async () => new Response('', { status: 503 })))
  expect(result.status).toBe(503)
  expect(result.body.detail).toContain('尚未就绪')
})

test('unreachable service is reported as waiting for recovery', async () => {
  const result = await request('host-fixture', vi.fn(async () => { throw new Error('connection refused') }))
  expect(result.status).toBe(503)
  expect(result.body.detail).toContain('暂时无法连接')
})
