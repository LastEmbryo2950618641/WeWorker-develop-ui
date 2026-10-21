import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { runStats } from '../stats.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('remote statistics contract', () => {
  it('documents that all stats queries require the remote endpoint', () => {
    const cli = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    expect(cli).not.toContain('调用频次（本地）');
    expect(cli).toContain('远程统计，需配置 WEBCLI_METRICS_ENDPOINT');
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).not.toContain('离线可用');
  });
  it('fails without configuration and explains that no local statistics are available', async () => {
    vi.stubEnv('WEBCLI_METRICS_ENDPOINT', '');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(runStats(['--json'])).rejects.toThrow('exit');
    expect(error.mock.calls[0][0]).toContain('不提供本地统计');
  });
  it('queries the configured endpoint with filters without enabling upload', async () => {
    vi.stubEnv('WEBCLI_METRICS_ENDPOINT', 'http://127.0.0.1:12345/v1/metrics/batch');
    vi.stubEnv('WEBCLI_METRICS_UPLOAD', 'off');
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ rows: [], totalCalls: 0 }) }));
    vi.stubGlobal('fetch', fetch);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runStats(['--by', 'tool', '--kind', 'adapter', '--since', '7d', '--json']);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/v1/stats');
    expect(Object.fromEntries(url.searchParams)).toEqual({ by: 'tool', since: '7d', kind: 'adapter' });
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ rows: [], totalCalls: 0, by: 'tool' });
  });
  it.each(['http', 'timeout'])('reports %s failure without fabricating empty successful data', async kind => {
    vi.stubEnv('WEBCLI_METRICS_ENDPOINT', 'http://127.0.0.1:12345');
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (kind === 'timeout') throw new Error('fixture timeout');
      return { ok: false, status: 503 };
    }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(runStats(['--json'])).rejects.toThrow('exit');
    expect(error.mock.calls[0][0]).toContain('远程查询失败');
    expect(log).not.toHaveBeenCalled();
  });
});
