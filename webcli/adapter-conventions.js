import { Script } from 'node:vm';
import { collectDiagnosticPackages } from './adapter-diagnostics.js';
import { lookupColumnMapping } from './column-mappings.js';
import { formatCallOutput, resolveOutputFormat } from './output-format.js';

export const conventionRules = ['implicit-safety', 'display-column-omission', 'mixed-case-display-key', 'limit-clamp', 'empty-error-fallback', 'placeholder-fallback', 'write-without-inverse'];
const inverses = { like: ['unlike'], follow: ['unfollow'], subscribe: ['unsubscribe'], bookmark: ['unbookmark'], save: ['unsave', 'delete', 'remove'], create: ['delete', 'remove'], post: ['delete', 'remove'] };

// Preserve offsets and strings while masking comments. Patterns remain heuristics,
// not a JavaScript parser or a claim that a matching branch can be reached.
function withoutComments(source) {
  return source.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g,
    (match, quoted) => quoted || match.replace(/[^\n\r]/g, ' '));
}

export function auditAdapterConventions(options = {}) {
  const { packages, diagnostics, profile, scope } = collectDiagnosticPackages(options);
  const findings = [], results = [];
  for (const { pkg, source: packageSource } of packages) {
    const sources = new Map(), errors = [], skipped = [];
    for (const [file, bytes] of pkg.files) {
      if (!/^(extension|http)\/.+\.js$/.test(file)) continue;
      try {
        const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        new Script('(function(module,exports,require){\n' + source + '\n})', { filename: file });
        sources.set(file, withoutComments(source));
      } catch { errors.push({ code: 'JAVASCRIPT_SYNTAX', file }); }
    }
    const add = (command, rule, details = {}, file, offset = 0) => findings.push({ adapter: pkg.name, command: command.id, rule,
      confidence: rule === 'implicit-safety' ? 'declaration' : 'heuristic', ...details,
      ...(file ? { file, line: sources.get(file).slice(0, offset).split('\n').length } : {}) });
    for (const command of pkg.manifest.commands) {
      if (!command.safety) add(command, 'implicit-safety');
      if (!sources.has(command.module)) { skipped.push({ command: command.id, reason: command.runtime === 'wewright' ? 'toolkit-source-not-analyzed' : 'source-not-analyzed' }); continue; }
      const source = sources.get(command.module), file = command.module;
      const mapping = (options.columnMapping || lookupColumnMapping)(pkg.name + '.' + command.id);
      const columns = mapping && typeof mapping === 'object' && !Array.isArray(mapping) ? Object.keys(mapping) : [];
      for (const column of columns.filter(key => /[a-z][A-Z]/.test(key))) add(command, 'mixed-case-display-key', { column });
      // Only explicit return object literals with at least one known display key.
      // Expressions/spreads/helpers and nested objects are not inferred.
      const omissions = new Set();
      for (const match of source.matchAll(/\breturn\s*\{([^{}]*)\}/g)) {
        const keys = [...match[1].matchAll(/(?:^|,)\s*(?:([A-Za-z_$][\w$]*)|["']([^"']+)["'])\s*:/g)].map(item => item[1] || item[2]);
        if (!keys.some(key => columns.includes(key))) continue;
        const missing = keys.filter(key => !['ok', 'error'].includes(key) && !columns.includes(key));
        const signature = missing.sort().join(',');
        if (missing.length && !omissions.has(signature)) { omissions.add(signature); add(command, 'display-column-omission', { columns, missing }, file, match.index); }
      }
      for (const match of source.matchAll(/\bMath\.min\s*\([^;\n]{0,300}\blimit\b[^;\n]{0,300}\)/gi)) add(command, 'limit-clamp', {}, file, match.index);
      for (const match of source.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{[^{}]*\breturn\s*\[\s*\]/g)) add(command, 'empty-error-fallback', {}, file, match.index);
      for (const match of source.matchAll(/(?:\?\?|\|\|)\s*(["'])(?:unknown|n\/a|na|未知|-)\1/gi)) add(command, 'placeholder-fallback', {}, file, match.index);
      if (command.safety === 'write') {
        for (const [verb, alternatives] of Object.entries(inverses)) {
          if (!command.id.split('-').includes(verb)) continue;
          const expected = alternatives.flatMap(word => [command.id.split('-').map(part => part === verb ? word : part).join('-'), word]);
          if (!pkg.manifest.commands.some(other => other.safety === 'write' && expected.includes(other.id))) add(command, 'write-without-inverse', { expected: [...new Set(expected)] });
        }
      }
    }
    results.push({ name: pkg.name, digest: pkg.digest, ...(packageSource ? { source: packageSource } : {}), commands: pkg.commands.length,
      javascriptFiles: sources.size, errors, skipped });
  }
  const errorCount = diagnostics.length + results.reduce((n, item) => n + item.errors.length, 0);
  return { ok: errorCount === 0 && findings.length === 0, executed: false, scope, profile, rules: conventionRules, packages: results, diagnostics, findings,
    summary: { packages: results.length, commands: results.reduce((n, item) => n + item.commands, 0), errors: errorCount, findings: findings.length },
    limits: ['Heuristic findings require source and behavior review; they are not proven defects.',
      'Mixed-case keys and inverse operations are recommendations, not mandatory package conventions.',
      'Only literal command-module patterns are analyzed; shared-helper flow, dynamic objects, Toolkit and legacy code are not analyzed.',
      'No commands, network requests, write effects or installation are executed. JSON output preserves all result fields.'] };
}

export function runConventionAudit(args, { outputFormat } = {}) {
  const format = resolveOutputFormat(outputFormat ?? 'json');
  if (args.includes('--help') || args.includes('-h')) {
    const help = { usage: ['webcli adapter convention-audit <directory>', 'webcli adapter convention-audit --installed [name]'], rules: conventionRules,
      behavior: 'Read-only heuristic audit; findings or invalid packages exit 1. No Adapter execution.' };
    console.log(formatCallOutput(help, format)); return help;
  }
  const positionals = args.filter(value => !value.startsWith('--'));
  if (positionals.length > 1 || args.some(value => value.startsWith('--') && !['--installed', '--json'].includes(value))
    || (!args.includes('--installed') && positionals.length !== 1)) throw new Error('Usage: webcli adapter convention-audit <directory> | --installed [name]');
  const report = auditAdapterConventions(args.includes('--installed') ? { name: positionals[0] } : { directory: positionals[0] });
  console.log(formatCallOutput(report, format));
  if (!report.ok) process.exitCode = 1;
  return report;
}
