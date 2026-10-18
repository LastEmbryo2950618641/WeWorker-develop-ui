import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatCallOutput } from './output-format.js';

const bundledRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'skills');
const fail = message => { throw new Error(message); };
function safeParts(value) {
  if (typeof value !== 'string' || !value || value.length > 500 || value.includes('\\') || value.includes('\0')
    || path.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')
    || !/^[a-zA-Z0-9_./-]+$/.test(value)) fail('Use a relative bundled Skill name/path without traversal.');
  return value.split('/');
}
function regular(root, parts, directory = false) {
  let current = path.resolve(root);
  const rootStat = fs.lstatSync(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('Bundled Skill root must be a regular directory.');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (i < parts.length - 1 || directory ? !stat.isDirectory() : !stat.isFile())) fail('Bundled Skill files cannot follow links or special files.');
  }
  return current;
}
function textFile(file) {
  if (fs.statSync(file).size > 512000) fail('Bundled Skill text exceeds 512000 bytes.');
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(file));
}
function metadata(content, name) {
  const front = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || '';
  const values = {};
  for (const key of ['name', 'description', 'version']) {
    let value = front.match(new RegExp('^' + key + ':\\s*([^\\r\\n]*)', 'm'))?.[1]?.trim() || '';
    if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { fail('Invalid bundled Skill metadata: ' + name); } }
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replaceAll("''", "'");
    values[key] = value;
  }
  return { name, description: values.description, version: values.version, path: name + '/SKILL.md' };
}
export function listBundledSkills(root = bundledRoot) {
  regular(root, [], true);
  return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
    .map(entry => {
      const parts = safeParts(entry.name + '/SKILL.md');
      if (!fs.existsSync(path.join(root, ...parts))) return null;
      return metadata(textFile(regular(root, parts)), entry.name);
    }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}
export function readBundledSkill(target, relative, root = bundledRoot) {
  const parts = safeParts(target);
  if (relative !== undefined && parts.length !== 1) fail('Specify the path either in the target or as a separate argument.');
  const name = parts.shift();
  regular(root, [name, 'SKILL.md']);
  const fileParts = relative === undefined ? parts.length ? parts : ['SKILL.md'] : safeParts(relative);
  return { skill: name, path: fileParts.join('/'), content: textFile(regular(root, [name, ...fileParts])) };
}
export function runSkillsCli(args, { outputFormat, root = bundledRoot } = {}) {
  if (!args.length || ['help', '--help', '-h'].includes(args[0])) {
    const help = { usage: 'webcli skills list | webcli skills read <skill[/path]> [path]',
      commands: ['list', 'read'], formats: 'list supports --output-format; read defaults to raw text, or --json / --output-format for an envelope',
      scope: 'Bundled resources only. Use adapter skill <id> for an installed Adapter.' };
    console.log(formatCallOutput(help, outputFormat ?? 'json')); return;
  }
  const json = args.includes('--json'), positionals = args.filter(arg => arg !== '--json');
  if (positionals[0] === 'list' && positionals.length === 1) {
    console.log(formatCallOutput(listBundledSkills(root), outputFormat ?? (json ? 'json' : 'table'))); return;
  }
  if (positionals[0] === 'read' && [2, 3].includes(positionals.length)) {
    const result = readBundledSkill(positionals[1], positionals[2], root);
    if (outputFormat !== undefined || json) console.log(formatCallOutput(result, outputFormat ?? 'json'));
    else process.stdout.write(result.content);
    return;
  }
  fail('Usage: webcli skills list | webcli skills read <skill[/path]> [path] [--json]');
}
