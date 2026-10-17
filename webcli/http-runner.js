import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { readPackageDirectory, adapterError } from './adapter-package-files.js';
import { validateHttpContract } from './http-contract.js';
import { createHttpClient } from './http-client.js';
import { httpWorkerMain } from './http-worker.js';

const fail = (code, message) => adapterError('HTTP_' + code, message);

/** Execute a verified package snapshot. Credentials exist only in the host request closure. */
export async function runHttpTool(match, args = {}, options = {}) {
  const pkg = readPackageDirectory(match.adapter.root);
  if (match.adapter.digest && pkg.digest !== match.adapter.digest) throw fail('STALE_PACKAGE', 'Adapter changed before HTTP execution.');
  const command = pkg.commands.find(entry => entry.id === match.command.id);
  if (!command || command.runtime !== 'http') throw fail('COMMAND_UNAVAILABLE', 'HTTP command is unavailable.');
  validateHttpContract(command);
  if ((command.requires_confirmation ?? command.safety === 'write') && args.__confirmed !== true) throw fail('CONFIRMATION_REQUIRED', 'Explicit confirmation is required for this command.');
  if (options.signal?.aborted) throw fail('ABORTED', 'HTTP operation cancelled.');
  const controller = new AbortController();
  const client = createHttpClient(command, { ...options, signal: controller.signal });
  const { request, redact } = client;
  const worker = new Worker('(' + httpWorkerMain.toString() + ')()', { eval: true, env: {},
    resourceLimits: { maxOldGenerationSizeMb: 64 },
    workerData: { module: command.module, args, files: Object.fromEntries([...pkg.files]
      .filter(([name]) => name.startsWith('http/')).map(([name, bytes]) => [name, bytes.toString('utf8')])) } });
  const traceID = options.traceID || randomUUID();
  let finished = false;
  try {
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(fail('TIMEOUT', 'HTTP command timed out. No request was retried.')), options.timeoutMs || 30_000);
      const abort = () => reject(fail('ABORTED', 'HTTP operation cancelled.'));
      options.signal?.addEventListener('abort', abort, { once: true });
      worker.once('error', () => reject(fail('COMMAND_FAILED', 'HTTP worker failed.')));
      worker.once('exit', () => reject(fail('COMMAND_FAILED', 'HTTP worker exited without a result.')));
      worker.on('message', async message => {
        if (finished) return;
        if (message.type === 'result') resolve(redact(message.result));
        else if (message.type === 'failure') reject(adapterError(message.error.code, message.error.message));
        else if (message.type === 'request') {
          try { const result = await request(message.options); if (!finished) worker.postMessage({ id: message.id, result }); }
          catch (error) { if (!finished) worker.postMessage({ id: message.id, error: { code: error.code || 'HTTP_REQUEST_FAILED', message: 'HTTP request failed under its declared contract.' } }); }
        }
      });
      worker.once('exit', () => { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); });
    });
    return { result, traceID, exitCode: 0 };
  } finally {
    finished = true; controller.abort(); await worker.terminate(); client.dispose();
  }
}
