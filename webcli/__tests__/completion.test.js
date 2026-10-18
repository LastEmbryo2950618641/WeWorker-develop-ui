import { expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { completionCandidates, completionScript, runCompletion } from '../completion.js';
import { loadAdapterTools, parseToolsFromSource } from '../adapter-cli.js';

const loadViews = async () => [{ id: 'example', tools: [{ name: 'example.read', aliases: ['example.ls', 'example.read', 'legacy_read'] }] }, { id: 'bad;touch', tools: [{ name: '$(example)' }] }];
it('completes builtins, adapters, canonical names and aliases without duplicates or shell fragments', async () => {
  const first = await completionCandidates([''], 1, { loadViews });
  expect(first).toContain('example'); expect(first).toContain('completion'); expect(first).not.toContain('bad;touch');
  expect(await completionCandidates(['call', 'example.'], 2, { loadViews })).toEqual(['example.ls', 'example.read']);
  expect(await completionCandidates(['example', ''], 2, { loadViews })).toEqual(['ls', 'read']);
  expect(await completionCandidates(['call', 'legacy'], 2, { loadViews })).toEqual(['legacy_read']);
});
it('includes management help/commands, prefixes and current cursor without parameter guessing', async () => {
  expect(await completionCandidates(['call', 'profile.'], 2, { loadViews })).toEqual(['profile.help', 'profile.list', 'profile.rename', 'profile.use']);
  expect(await completionCandidates(['browser', 'sta'], 2, { loadViews })).toContain('state');
  expect(await completionCandidates(['exploration', 'repair'], 2, { loadViews })).toContain('repair-info');
  expect(await completionCandidates(['call', 'example.read', ''], 3, { loadViews })).toEqual([]);
  expect(await completionCandidates(['adapter', ''], 2, { loadViews })).toEqual([]);
  expect(await completionCandidates(['ex', 'read'], 1, { loadViews })).toContain('example');
});
it('retains builtin help if the catalog is unavailable and validates input before loading it', async () => {
  const loadViews = vi.fn(async () => { throw new Error('unavailable'); });
  expect(await completionCandidates(['call', 'profile.'], 2, { loadViews })).toContain('profile.help');
  for (const [words, cursor] of [[[], 0], [[], 2], [[''], 1.5], [[null], 1], [['x'.repeat(10001)], 1]]) {
    await expect(completionCandidates(words, cursor, { loadViews })).rejects.toThrow();
  }
  expect(loadViews).toHaveBeenCalledTimes(1);
});
it('never evaluates legacy metadata, dynamic schemas, generated handlers or getters during name discovery', async () => {
  const root = mkdtempSync(join(tmpdir(), 'webcli-completion-test-'));
  const evaluated = vi.spyOn(vm, 'runInNewContext').mockImplementation(() => { throw new Error('must not execute'); });
  try {
    mkdirSync(join(root, 'webcli-generated/tools'), { recursive: true });
    writeFileSync(join(root, 'manifest.json'), JSON.stringify({ id: 'example', support_files: ['webcli-generated/tools/read.js'], command_aliases: { 'example.list': 'example.read' } }));
    writeFileSync(join(root, 'index.js'), `window.__webmcpRegister({tools:[{name:'example.read',aliases:['example.ls'],parameters:{get properties(){throw Error('execute');}}, handler:()=>{}}]});`);
    writeFileSync(join(root, 'webcli-generated/tools/read.js'), `registerTool(api,{name:'example.generated',aliases:['example.gen'],get parameters(){throw Error('execute');}},()=>{}); registerTool(api,{name:'example.'+compute(),schema:{name:'example.nested'}},()=>{});`);
    expect((await loadAdapterTools('example', { adapterDir: root, namesOnly: true })).map(tool => ({ name: tool.name, aliases: tool.aliases }))).toEqual([
      { name: 'example.read', aliases: ['example.ls', 'example.list'] }, { name: 'example.generated', aliases: ['example.gen'] },
    ]);
    expect(evaluated).not.toHaveBeenCalled();
  } finally { evaluated.mockRestore(); rmSync(root, { recursive: true, force: true }); }
});
it('keeps legacy spread names and hidden-tool filtering while skipping computed names and aliases', () => {
  const source = "const defs=[{name:'example.read',aliases:['example.ls']},{name:'example.hidden'}]; const disabledTools=new Set(['example.hidden']); window.__webmcpRegister({tools:[...defs,{name:'example.'+dynamic(),schema:{name:'example.nested'}},{name:'example.last',aliases:['example.'+dynamic()]}]});";
  expect(parseToolsFromSource(source, {}, { namesOnly: true }).map(tool => ({ name: tool.name, aliases: tool.aliases }))).toEqual([{ name: 'example.read', aliases: ['example.ls'] }, { name: 'example.last', aliases: [] }]);
});
it.each(['bash', 'zsh', 'fish'])('generates %s scripts without changing configuration', async shell => {
  expect(await runCompletion(['completion', shell])).toBe(completionScript(shell));
  expect(completionScript(shell)).toContain('--get-completions --cursor');
});
it('rejects unsupported shells and malformed internal invocations', async () => {
  await expect(runCompletion(['completion', 'invalid'])).rejects.toThrow('Unsupported shell');
  await expect(runCompletion(['completion', 'bash', 'extra'])).rejects.toThrow('Usage');
  await expect(runCompletion(['--get-completions', '--cursor', '1;touch'])).rejects.toThrow('cursor');
});
