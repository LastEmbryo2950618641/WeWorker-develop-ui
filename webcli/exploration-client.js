import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

export function callExploration(command, args, { url = 'ws://127.0.0.1:3711', timeoutMs = 20000 } = {}) {
  return new Promise(resolve => {
    const socket = new WebSocket(url);
    const id = `exploration-${randomUUID()}`;
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.close(); resolve(result);
    };
    const error = (code, message) => finish({ schemaVersion: 1, ok: false, command: `exploration.${command}`, error: { code, message } });
    const timer = setTimeout(() => {
      error('TIMEOUT', 'Bridge did not respond. Check its version; use the same requestId to retry start without duplicating a task.');
      socket.terminate();
    }, timeoutMs);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'exploration_command', id, command, args })));
    socket.on('message', data => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (message.id === id && message.type === 'exploration_command_result') finish(message.result);
    });
    socket.on('error', () => error('BRIDGE_UNAVAILABLE', 'Start WebCLI Bridge with webcli service start -d. No desktop client is needed.'));
    socket.on('close', () => error('BRIDGE_DISCONNECTED', 'Bridge disconnected; reconnect and inspect exploration.list before retrying.'));
  });
}
