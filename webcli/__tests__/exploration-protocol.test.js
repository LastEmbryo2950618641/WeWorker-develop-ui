import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { callExploration } from '../exploration-client.js';
import { WebSocketBridge } from '../bridge.js';

const servers = [];
afterEach(async () => { for (const server of servers.splice(0)) { for (const client of server.clients) client.terminate(); await new Promise(resolve => server.close(resolve)); } });
async function server(handler) {
  const socket = new WebSocketServer({ port: 0, host: '127.0.0.1' }); servers.push(socket);
  await new Promise(resolve => socket.on('listening', resolve));
  socket.on('connection', ws => ws.on('message', data => handler(ws, JSON.parse(String(data)))));
  return `ws://127.0.0.1:${socket.address().port}`;
}

it('correlates requests, ignores unrelated broadcasts and parses only its response', async () => {
  const url = await server((ws, message) => {
    expect(message).toMatchObject({ type: 'exploration_command', command: 'get', args: { taskId: 'example-task' } });
    ws.send(JSON.stringify({ id: 'unrelated', type: 'exploration_command_result', result: { ok: false } }));
    ws.send(JSON.stringify({ id: message.id, type: 'exploration_command_result', result: { schemaVersion: 1, ok: true, data: { status: 'draft' } } }));
  });
  expect(await callExploration('get', { taskId: 'example-task' }, { url })).toMatchObject({ ok: true, data: { status: 'draft' } });
});

it('returns structured timeout and disconnect errors without replaying commands', async () => {
  let calls = 0;
  const url = await server(() => { calls++; });
  expect((await callExploration('start', {}, { url, timeoutMs: 50 })).error.code).toBe('TIMEOUT');
  expect(calls).toBe(1);
  const closeUrl = await server(ws => ws.close());
  expect((await callExploration('get', {}, { url: closeUrl })).error.code).toBe('BRIDGE_DISCONNECTED');
});

it('Bridge replies only to the requesting local client and rejects extension-origin peers', async () => {
  const bridge = Object.create(WebSocketBridge.prototype);
  const execute = vi.fn(async () => ({ ok: true, data: { taskId: 'example-task' } }));
  bridge._explorationServicePromise = Promise.resolve({ execute });
  bridge._broadcast = vi.fn();
  const ws = { readyState: 1, _explorationLocal: true, send: vi.fn() };
  await bridge._handleExplorationCommand({ id: 'one', command: 'get', args: {} }, ws);
  expect(execute).toHaveBeenCalledOnce();
  expect(JSON.parse(ws.send.mock.calls[0][0])).toMatchObject({ id: 'one', result: { ok: true } });
  expect(bridge._broadcast).not.toHaveBeenCalled();
  await bridge._handleExplorationCommand({ id: 'two', command: 'get' }, { ...ws, _explorationLocal: false });
  expect(execute).toHaveBeenCalledOnce();
});

it('real CLI process exposes offline command discovery and structured unknown-command failure', () => {
  const entry = fileURLToPath(new URL('../index.js', import.meta.url));
  for (const args of [['call', 'exploration.help'], ['exploration', '--help']]) {
    const result = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    const help = JSON.parse(result.stdout);
    expect(help.desktopRequired).toBe(false);
    expect(help.commands.map(item => item.name)).toContain('exploration.draft-write');
  }
  const unknown = spawnSync(process.execPath, [entry, 'call', 'exploration.not-a-command'], { encoding: 'utf8' });
  expect(unknown.status).toBe(1);
  expect(JSON.parse(unknown.stdout).error.code).toBe('UNKNOWN_COMMAND');
});
