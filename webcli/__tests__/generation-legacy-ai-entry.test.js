import { expect, it, vi } from 'vitest';
import { WebSocketBridge } from '../bridge.js';

it('legacy AI entry creates a tracked package task without writing or merging extension sources', async () => {
  const bridge = Object.create(WebSocketBridge.prototype);
  bridge._generationWorkers = { start: vi.fn(async () => ({ id: 'fixture-run', status: 'planning' })) };
  const ws = { send: vi.fn() };
  await bridge._handleGenerateAdapterWithAI({ type: 'generate_adapter_with_ai', id: 'fixture-request', siteKey: 'example.com', tabId: 7,
    apiEntries: [{ method: 'GET', url: 'https://example.com/api/list?query=fixture-captured-private', responsePreview: '{"name":"fixture-private-response"}' }],
  }, ws);
  expect(bridge._generationWorkers.start).toHaveBeenCalledWith(expect.objectContaining({ siteKey: 'example.com', input: expect.objectContaining({ mode: 'agent', tabId: 7 }) }), undefined);
  const input = JSON.stringify(bridge._generationWorkers.start.mock.calls[0][0]);
  expect(input).not.toContain('fixture-captured-private');
  expect(input).not.toContain('fixture-private-response');
  expect(JSON.parse(ws.send.mock.calls[0][0])).toMatchObject({ type: 'generate_adapter_with_ai_result', ok: true, run: { id: 'fixture-run' } });
});
