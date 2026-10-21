import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { createHostAdapterRuntime } from '../../extension/background/host-adapter-runtime.js';

const source = readFileSync(new URL('../../adapters/github.com/extension/internal/legacy.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../../adapters/github.com/manifest.json', import.meta.url)));
const base = 'https://github.com/example/project';
function page(url, { links = [], title = 'Example issue', body = 'Example body', missing = false, store = new Map() } = {}) {
  const location = new URL(url);
  const context = { URL, console, location, setTimeout: fn => setTimeout(fn, 0),
    sessionStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    document: { title: missing ? 'Page not found · GitHub' : title,
      querySelector: selector => selector.includes('issue-title') ? (title ? { innerText: title } : null)
        : selector.includes('markdown-body') ? (body === null ? null : { innerText: body }) : null,
      querySelectorAll: selector => selector.startsWith('a[') ? links.map(href => ({ getAttribute: () => href })) : [],
    }, __webmcpRegister() {},
  };
  context.window = context;
  vm.createContext(context); vm.runInContext(source, context);
  return args => context.__github_com_internal.invoke('github.com.get_issue_or_pr_detail', args);
}

describe('GitHub detail navigation and completion', () => {
  it.each(['issues', 'pulls'])('completes %s list navigation without returning to the original list', async section => {
    const detail = `${base}/${section === 'pulls' ? 'pull' : 'issues'}/123`;
    const store = new Map();
    let operation = page(`${base}/${section}`, { links: ['https://example.org/issues/9', detail], store });
    const navigations = [];
    const runtime = createHostAdapterRuntime({ bundle: async () => [], prepare: async () => {}, clear: async () => {}, inject: async () => {},
      navigate: async (_tab, url) => { navigations.push(url); operation = page(url, { store }); return url; },
    });
    const result = await runtime.execute(1, manifest, `${base}/${section}`, () => operation({ issue_url: `${base}/${section}`, max_comments: 0 }), { id: 'get-issue-or-pr-detail' });
    expect(navigations).toEqual([detail]);
    expect(result).toMatchObject({ title: 'Example issue', body_summary: 'Example body', comments_count: 0, url: detail });
    expect(result.needs_retry).toBeUndefined();
  });
  it('requests host navigation for a direct detail URL on another page', async () => {
    const result = await page('https://github.com/')({ issue_url: `${base}/issues/123` });
    expect(result.__webcli_navigation).toMatchObject({ version: 1, resume: true, url: `${base}/issues/123` });
    const fromMissing = await page('https://github.com/missing', { missing: true })({ issue_url: `${base}/issues/123` });
    expect(fromMissing.__webcli_navigation.url).toBe(`${base}/issues/123`);
  });
  it('accepts relative list links and a deliberately empty body', async () => {
    const result = await page(`${base}/issues`, { links: ['/example/project/issues/123'] })({ issue_url: `${base}/issues` });
    expect(result.__webcli_navigation.url).toBe(`${base}/issues/123`);
    expect(await page(`${base}/issues/123`, { body: '' })({})).toMatchObject({ title: 'Example issue', body_summary: '' });
  });
  it('rejects 404 and unloaded DOM instead of returning empty detail objects', async () => {
    await expect(page(`${base}/issues/123`, { missing: true, title: '', body: null })({})).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(page(`${base}/issues/123`, { title: '', body: null })({})).rejects.toMatchObject({ code: 'NOT_READY' });
  });
  it('stops at login instead of repeatedly navigating back to the protected detail', async () => {
    await expect(page('https://github.com/login')({ issue_url: `${base}/issues/123` })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });
  it('does not mistake a list, another repository, or a foreign URL for an issue', async () => {
    await expect(page(`${base}/issues`, { links: ['https://github.com/other/project/issues/1'] })({})).rejects.toMatchObject({ code: 'NOT_READY' });
    await expect(page(`${base}/issues/123`)({ issue_url: 'https://example.org/issues/123' })).rejects.toMatchObject({ code: 'INVALID_ARGS' });
  });
  it('rejects a forged or expired continuation to another repository', async () => {
    const other = 'https://github.com/other/project/issues/123';
    for (const at of [Date.now(), Date.now() - 180000]) {
      const store = new Map([['__weworker_github_detail_navigation', JSON.stringify({ list: `${base}/issues`, detail: other, at })]]);
      const result = await page(other, { store })({ issue_url: `${base}/issues` });
      expect(result.__webcli_navigation.url).toBe(`${base}/issues`);
    }
  });
});
