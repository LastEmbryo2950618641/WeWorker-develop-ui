// Isolated CLI catalogs and actual interactive shells; no Bridge or browser.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { toolkitArtifactHash } from '../adapter-registry.js';

const exec = promisify(execFile), source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webcli-completion-acceptance-'));
const bundled = process.argv.includes('--bundled');
const entry = bundled ? path.resolve(source, '../weworker/build/webcli-dist/webcli.cjs') : path.join(source, 'index.js');
const python = process.argv.find(arg => arg.startsWith('--python='))?.slice(9) || 'python3';
const fish = process.argv.find(arg => arg.startsWith('--fish='))?.slice(7);
const checks = [], pass = name => { checks.push(name); console.log('PASS ' + name); };
console.log('Artifacts: ' + root);
const write = async (name, value) => { const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value); };
try {
  await write('builtin/example/manifest.json', JSON.stringify({ schema_version: 2, name: 'example', version: '1.0.0', description: 'Completion fixture', match: ['example.com'], commands: [
    { id: 'read', aliases: ['ls'], legacyNames: ['example-old.read'], runtime: 'extension', module: 'extension/commands/read.js', description: 'Public example', schema: { type: 'object', properties: {} } },
  ] }));
  await write('builtin/example/extension/commands/read.js', 'throw new Error("completion must never execute a module");');
  await write('user/example-legacy/manifest.json', JSON.stringify({ id: 'example-legacy', support_files: ['webcli-generated/tools/read.js'] }));
  await write('user/example-legacy/index.js', 'window.__webmcpRegister({tools:[{name:"example-legacy.read",parameters:{get properties(){throw Error("metadata must not execute");}}}]});');
  await write('user/example-legacy/webcli-generated/tools/read.js', 'registerTool(api,{name:"example-legacy.generated",get description(){throw Error("must not evaluate");}},()=>{});');
  const toolkit = path.join(root, 'toolkit/example-toolkit');
  for (const file of ['scripts/toolkit.py', 'scripts/toolkit_runtime.py']) await write('toolkit/example-toolkit/' + file, 'raise RuntimeError("completion must not run Python")');
  await write('toolkit/example-toolkit/scripts/requirements.txt', ''); await write('toolkit/example-toolkit/SKILL.md', '# Public fixture');
  await write('toolkit/example-toolkit/manifest.json', JSON.stringify({ schema_version: 1, adapter_type: 'toolkit', id: 'example-toolkit', entry: 'scripts/toolkit.py', artifact_hash: toolkitArtifactHash(toolkit), tools: [{ id: 'read', name: 'example-toolkit.read' }] }));
  const env = { ...process.env, HOME: path.join(root, 'home'), ZDOTDIR: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'home/config'), XDG_DATA_HOME: path.join(root, 'home/data'), XDG_CACHE_HOME: path.join(root, 'home/cache'),
    WEWORKER_BUILD_PROFILE: 'public', WEWORKER_BUILTIN_ADAPTERS_DIR: path.join(root, 'builtin'), WEWORKER_USER_ADAPTERS_DIR: path.join(root, 'user'), WEBCLI_ADAPTERS_DIR: path.join(root, 'user'), WEWORKER_ADAPTER_DATA_DIR: path.join(root, 'data'), WEWORKER_ADAPTERS_DIR: path.join(root, 'toolkit'), WEBCLI_METRICS: 'off', WEBCLI_METRICS_UPLOAD: 'off', TERM: 'xterm-256color' };
  delete env.WEWORKER_RESOURCES_PATH;
  await fs.mkdir(env.HOME, { recursive: true });
  // Shell quoting is needed only for the fixed local executable wrapper.
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  await write('bin/webcli', '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(entry) + ' "$@"\n');
  await fs.chmod(path.join(root, 'bin/webcli'), 0o755); env.PATH = path.join(root, 'bin') + ':' + env.PATH;
  const run = args => exec(process.execPath, [entry, ...args], { env, cwd: root });
  const first = (await run(['--get-completions', '--cursor', '1', 'example'])).stdout.trim().split('\n');
  assert.deepEqual(first, ['example', 'example-legacy', 'example-toolkit']);
  const names = (await run(['--get-completions', '--cursor', '2', 'call', 'example'])).stdout.trim().split('\n');
  for (const name of ['example.read', 'example.ls', 'example-old.read', 'example-legacy.read', 'example-legacy.generated', 'example-toolkit.read']) assert.ok(names.includes(name), name);
  assert.equal((await run(['--get-completions', '--cursor', '3', 'call', 'example.read', '--value=$(example)'])).stdout, '');
  pass('actual isolated v2, legacy and Toolkit discovery, aliases and no parameter execution');
  const shells = [['bash', '/bin/bash'], ['zsh', '/bin/zsh'], ...(fish ? [['fish', fish]] : [])];
  for (const [name, binary] of shells) {
    const script = (await run(['completion', name])).stdout;
    await write(name + '.completion', script);
    const parseArgs = name === 'bash' ? ['--noprofile', '--norc', '-n'] : name === 'zsh' ? ['-f', '-n'] : ['--no-config', '--no-execute'];
    await exec(binary, [...parseArgs, path.join(root, name + '.completion')], { env });
  }
  await write('shell-check.py', String.raw`import os,pty,select,signal,sys,time
name,binary,root=sys.argv[1:]
pid,fd=pty.fork()
if pid==0:
    args={'bash':['--noprofile','--norc','-i'],'zsh':['-f','-i'],'fish':['--no-config','--interactive']}[name]
    os.execve(binary,[binary]+args,os.environ)
def wait_for(token):
    result=b''; deadline=time.monotonic()+8
    while time.monotonic()<deadline:
        if select.select([fd],[],[],0.2)[0]:
            try:
                chunk=os.read(fd,65536); result+=chunk
                with open(root+'/'+name+'.pty.log','ab') as log: log.write(chunk)
                if b'\x1b[0c' in chunk: os.write(fd,b'\x1b[?1;2c')
                if b'\x1b[6n' in chunk: os.write(fd,b'\x1b[1;1R')
            except OSError: break
        if token in result: return result
    raise AssertionError(repr(result))
def send(value): os.write(fd,value.encode())
try:
    if name=='bash':
        setup="source '"+root+"/bash.completion'"
    elif name=='zsh':
        setup="autoload -Uz compinit; compinit -D; source '"+root+"/zsh.completion'"
    else:
        setup="source '"+root+"/fish.completion'"
    send(setup+"; printf '__REA''DY__\\n'\n")
    wait_for(b'__READY__'); print(name+' ready',flush=True)
    for prefix,expected in [('webcli call example.r','webcli call example.read'),('webcli example l','webcli example ls'),('webcli call profile.h','webcli call profile.help')]:
        send(prefix+'\t'); time.sleep(0.25)
        # Prepend printf to inspect the completed arguments without executing
        # the Adapter. This also works with macOS Bash 3.2's older Readline.
        send("\x01printf '__BUF''FER__%s__END__\\n' "); send('\n')
        wait_for(('__BUFFER__'+expected.split()[-1]+'__END__').encode()); print(expected,flush=True)
    print(name+' actual interactive Tab completion passed')
finally:
    os.close(fd)
    try: os.kill(pid,signal.SIGKILL)
    except ProcessLookupError: pass
    os.waitpid(pid,0)
`);
  for (const [name, binary] of shells) {
    if (name === 'fish') {
      for (const [prefix, expected] of [['webcli call example.r', 'example.read'], ['webcli example l', 'ls'], ['webcli call profile.h', 'profile.help']]) {
        const result = await exec(binary, ['--no-config', '-c', 'source "$argv[1]"; complete -C "$argv[2]"', path.join(root, name + '.completion'), prefix], { env, timeout: 15000 });
        assert.deepEqual(result.stdout.trim().split('\n').map(line => line.split('\t')[0]), [expected]);
      }
      pass('fish native complete -C invokes registered hooks: call command, shorthand alias and management help');
      continue;
    }
    const result = await exec(python, [path.join(root, 'shell-check.py'), name, binary, root], { env, timeout: 45000 });
    assert.match(result.stdout, /passed/); await write(name + '.log', result.stdout + result.stderr);
    pass(name + ' real interactive Tab: call command, shorthand alias and management help');
  }
  await write('report.json', JSON.stringify({ passed: true, bundled, checks, missing: fish ? [] : ['fish executable: pass --fish for acceptance'] }, null, 2));
} catch (error) { await write('failure.json', JSON.stringify({ message: error.message, stack: error.stack, stderr: error.stderr }, null, 2)); throw error; }
