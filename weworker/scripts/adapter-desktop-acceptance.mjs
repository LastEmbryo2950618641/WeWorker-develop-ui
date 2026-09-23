/** Launch an isolated packaged desktop for local acceptance. Close its window
 * normally to stop. Browser clients are rejected before they can disclose tabs.
 * Usage: node adapter-desktop-acceptance.mjs <win-unpacked directory>
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const appDir = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(appDir, 'WeWorker.exe'))) throw new Error('Supply a Windows packaged application directory.');
for (const port of [3711, 8765, 8766]) {
  const free = await new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
  if (!free) throw new Error(`Port ${port} is occupied; no process was stopped.`);
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weworker-desktop-acceptance-'));
const resources = path.join(appDir, 'resources');
const profile = JSON.parse(fs.readFileSync(path.join(resources, 'adapters/.profile.json'), 'utf8')).profile;
Object.assign(process.env, {
  HOME: root, USERPROFILE: root, APPDATA: path.join(root, 'roaming'), LOCALAPPDATA: path.join(root, 'local'),
  WEWORKER_USER_ADAPTERS_DIR: path.join(root, 'adapters'), WEBCLI_ADAPTERS_DIR: path.join(root, 'adapters'),
  WEWORKER_ADAPTER_DATA_DIR: path.join(root, '.weworker'),
  WEWORKER_ADAPTERS_DIR: path.join(root, 'legacy'),
  WEWORKER_BUILTIN_ADAPTERS_DIR: path.join(resources, 'adapters'),
  WEWORKER_RESOURCES_PATH: resources, WEWORKER_BUILD_PROFILE: profile,
  WEBWRIGHT_HOME: path.join(root, '.weworker/webwright'), WEBCLI_METRICS_UPLOAD: 'off',
});
for (const dir of [process.env.APPDATA, process.env.LOCALAPPDATA]) fs.mkdirSync(dir, { recursive: true });
const { WebSocketBridge } = await import('../../webcli/bridge.js');
const bridge = new WebSocketBridge();
// Applied synchronously before any upgrade event. Node Backend clients have no
// Origin; existing browser extensions cannot join this test's Bridge.
bridge._wss.options.verifyClient = info => !info.origin;
await once(bridge._wss, 'listening');
const log = fs.openSync(path.join(root, 'desktop.log'), 'a');
const child = spawn(path.join(appDir, 'WeWorker.exe'), ['--user-data-dir=' + path.join(root, 'electron')], {
  cwd: root, env: process.env, windowsHide: false, stdio: ['ignore', log, log],
});
console.log(JSON.stringify({ profile, root, pid: child.pid, appDir }));
const end = await once(child, 'exit');
bridge.stopAdapterStateWatcher();
for (const client of bridge._wss.clients) client.terminate();
await new Promise(resolve => bridge._wss.close(resolve));
fs.closeSync(log);
console.log('Desktop exited: ' + JSON.stringify(end));
process.exitCode = end[0] || 0;
