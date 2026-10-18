import { buildApiSourceEvidence } from './generation-harness/source-evidence.js';
import { normalizeWriteResult } from './exploration-write-result.js';

const fail = message => { throw Object.assign(new Error(message), { code: 'INVALID_UI_WRITE' }); };
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => object(v) && Object.keys(v).sort().join(',') === keys.sort().join(',');
const publicName = v => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v) && !/token|cookie|auth|password|secret|session|credential|api.?key|csrf|ticket|prototype|constructor/i.test(v);
const selector = v => typeof v === 'string' && v.trim() && v.length <= 300 && !/[\r\n\0]/.test(v);

/** Native fields only. The page owns submission; this is not an HTTP/idempotency contract. */
export function validateUiWrite(command) {
  if (command.uiWrite === undefined) return;
  const spec = command.uiWrite, route = command.pageRoute;
  if (!exact(spec, ['version', 'url', 'method', 'form', 'inputs', 'submit', 'confirmation', 'inputMode', ...(spec?.result !== undefined ? ['result'] : [])]) || spec.version !== 1
    || spec.inputMode !== 'native-setter-no-events' || spec.method !== 'POST'
    || command.runtime !== 'extension' || command.safety !== 'write' || command.requires_confirmation === false
    || command.pageWrite || command.execution || command.pageWorkflow || command.pageStrategy || !exact(route, ['origin', 'pathname'])) fail('UI writes require a fixed foreground route, explicit confirmation and a native form contract.');
  let url, page;
  try { url = new URL(spec.url); page = new URL(route.origin + route.pathname); } catch { fail('Invalid UI write URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== route.origin || url.href !== spec.url || url.search || url.hash || url.username || url.password || url.pathname.includes(':id')
    || typeof route.pathname !== 'string' || !/^\/(?!\/)/.test(route.pathname) || page.origin !== route.origin || page.pathname !== route.pathname || page.search || page.hash || page.username || page.password || route.pathname.includes(':id')) fail('UI writes require fixed same-origin form and page URLs.');
  if (!selector(spec.form) || !Array.isArray(spec.inputs) || !spec.inputs.length || spec.inputs.length > 10
    || spec.inputs.some(v => !exact(v, ['selector', 'name', 'parameter']) || !selector(v.selector) || !publicName(v.name) || !publicName(v.parameter))
    || ['name', 'parameter', 'selector'].some(key => new Set(spec.inputs.map(v => v[key])).size !== spec.inputs.length)
    || !exact(spec.submit, ['selector', 'text']) || !selector(spec.submit.selector) || typeof spec.submit.text !== 'string' || !spec.submit.text.trim() || spec.submit.text.length > 200
    || !exact(spec.confirmation, ['selector', 'attribute', 'parameter']) || !selector(spec.confirmation.selector)
    || !/^data-[a-z][a-z0-9-]{0,63}$/.test(spec.confirmation.attribute) || !publicName(spec.confirmation.attribute.slice(5).replaceAll('-', '_'))
    || !spec.inputs.some(v => v.parameter === spec.confirmation.parameter)) fail('Declare unique public native inputs, a named submit button and an input-correlated confirmation attribute.');
  if (spec.result !== undefined && (!exact(spec.result, ['attribute', 'publicId', 'idType']) || spec.result.publicId !== true
    || !['string', 'integer'].includes(spec.result.idType) || !/^data-[a-z][a-z0-9-]{0,63}$/.test(spec.result.attribute)
    || !publicName(spec.result.attribute.slice(5).replaceAll('-', '_')) || spec.result.attribute === spec.confirmation.attribute)) fail('UI results require a distinct public ID attribute on the same receipt and an explicit string/integer type.');
  const names = spec.inputs.map(v => v.parameter).sort(), schema = command.schema;
  if (!schema || schema.type !== 'object' || schema.additionalProperties !== false || schema['x-webcli-requires-confirmation'] !== true
    || JSON.stringify(Object.keys(schema.properties || {}).sort()) !== JSON.stringify([...names, '__confirmed'].sort())
    || schema.properties.__confirmed?.type !== 'boolean' || JSON.stringify([...(schema.required || [])].sort()) !== JSON.stringify(names)
    || names.some(name => schema.properties[name]?.type !== 'string' || Object.hasOwn(schema.properties[name], 'default'))) fail('UI write parameters must be required strings without defaults.');
}
export function resolveUiWrite(command, args) {
  validateUiWrite(command);
  if (args?.__confirmed !== true) throw Object.assign(new Error('Explicit confirmation is required.'), { code: 'CONFIRMATION_REQUIRED' });
  const names = command.uiWrite.inputs.map(v => v.parameter);
  if (!object(args) || Object.keys(args).some(key => key !== '__confirmed' && !names.includes(key))
    || names.some(name => typeof args[name] !== 'string' || args[name].length > 10000 || /[\r\n\0]/.test(args[name]))
    || !args[command.uiWrite.confirmation.parameter]?.trim()) fail('Provide exact single-line strings and a nonempty public correlation value.');
  return { url: command.uiWrite.url, method: 'POST', body: Object.fromEntries(command.uiWrite.inputs.map(v => [v.name, args[v.parameter]])) };
}
export function uiWriteModule(id) {
  return `(function () { window.__webcliRegisterCommand(${JSON.stringify(id)}, function (args = {}) {
  if (args.__confirmed !== true) return {blocked:true, requiresConfirmation:true};
  throw new Error('UI_WRITE_DISPATCH_REQUIRED');
}); })();\n`;
}
export function assertUiWriteModule(command, files) {
  if (command.uiWrite && files.get(command.module)?.toString('utf8') !== uiWriteModule(command.id)) fail('UI write modules are fixed registration stubs.');
}
export function buildUiWriteTool(site, tool, candidate, origin) {
  if (typeof tool.name !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(tool.name)) fail('UI write names must be portable identities.');
  const uiWrite = { ...tool.uiWrite, version: 1, url: candidate.url, method: candidate.method };
  const names = (uiWrite.inputs || []).map(v => v.parameter);
  if (JSON.stringify((uiWrite.inputs || []).map(v => v.name).sort()) !== JSON.stringify([...(candidate.requestEvidence?.bodyKeys || [])].sort())) fail('Input names must match the source declaration.');
  const schema = { type: 'object', additionalProperties: false, required: names,
    properties: { ...Object.fromEntries(names.map(name => [name, { type: 'string', maxLength: 10000 }])), __confirmed: { type: 'boolean' } },
    'x-webcli-requires-confirmation': true, 'x-webcli-agent-authored': true };
  const command = { runtime: 'extension', safety: 'write', uiWrite, pageRoute: { origin, pathname: tool.pagePathname }, schema };
  validateUiWrite(command);
  return { toolDefinition: { name: site + '.' + tool.name, access: 'write', description: tool.purpose || 'Submit one confirmed native form and correlate its page acknowledgement.',
    uiWrite, pageRoute: command.pageRoute, parameters: schema,
    generationSource: { ...buildApiSourceEvidence(candidate, { sourceKind: candidate.declared ? 'authored_ui_write_declaration' : 'observed_write' }), risk: { level: 'write', confidence: 1 } } },
    v2Content: uiWriteModule(tool.name.replaceAll('_', '-')) };
}

export const uiWriteSuccess = { ok: true, submitted: true, confirmationMatched: true, effectVerified: false };
export const uiWriteFailure = { ok: false, errorCode: 'UI_WRITE_CONFIRMATION_FAILED' };
// An offline submission model, never a source for the real execution's ID.
export const uiWriteMockSuccess = command => ({ ...uiWriteSuccess, ...(command.uiWrite.result ? { resultId: command.uiWrite.result.idType === 'integer' ? 7 : 'example-ui-result' } : {}) });

// Bind all authored inputs to independent resource fields, including a changed
// correlation field. Canonical paths prevent $ aliases from weakening this proof.
export function validateUiEffect(command, fixture) {
  const spec = command.uiWrite, paths = fixture.effect.argumentPaths;
  const names = spec.inputs.map(v => v.parameter).sort();
  const result = fixture.effect.resultReadback;
  if (Boolean(spec.result) !== (result !== undefined) || !object(paths) || JSON.stringify(Object.keys(paths).sort()) !== JSON.stringify(names)
    || new Set(Object.values(paths)).size !== names.length) fail('UI effects require one distinct readback field per input and a matching declared receipt ID readback.');
  if (spec.result) {
    normalizeWriteResult(result, uiWriteMockSuccess(command), command.pageRoute.origin);
    if (result.responsePath !== 'resultId' || (result.idType || 'string') !== spec.result.idType) fail('UI result readback must use the declared receipt resultId with the exact type.');
  }
  for (const name of names) {
    const field = paths[name];
    if (typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+){0,7}$/.test(field) || field.split('.').some(v => !publicName(v))) fail('UI readback bindings require exact public property paths.');
    if (fixture.effect.after.equals?.[field] !== fixture.representativeArgs[name]) fail('Every after field must equal its exact reviewed input.');
    if (result && result.expect.equals?.[field] !== fixture.representativeArgs[name]) fail('Every result resource field must also equal its exact reviewed input.');
  }
  const identity = fixture.effect.identityPath;
  if (typeof identity !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+){0,7}$/.test(identity) || identity.split('.').some(v => !publicName(v))
    || typeof fixture.effect.before.equals?.[identity] !== 'string' || !fixture.effect.before.equals[identity].trim()
    || fixture.effect.before.equals[identity] !== fixture.effect.after.equals?.[identity]) fail('Declare a stable public resource identity field in both before and after.');
  const correlation = paths[spec.confirmation.parameter];
  if (!Object.hasOwn(fixture.effect.before.equals || {}, correlation) || fixture.effect.before.equals[correlation] === fixture.effect.after.equals[correlation]) fail('Before/after must prove a changed correlation field.');
}
