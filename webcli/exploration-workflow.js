import { normalizeWorkflowOrigin } from './page-workflow-origins.js';
import { explorationError as fail } from './exploration-commands.js';
import { normalizePageQuery, pageQueryValues } from './exploration-query.js';
import { normalizeWorkflowControl } from './page-workflow-control.js';
import { navigationParameters } from './page-navigation-parameters.js';

const invalid = message => { throw fail('INVALID_PAGE_WORKFLOW', message); };
// Kept data-only to match the extension's manifest guard; result extraction may
// be repaired independently, but actions, arguments and routes stay fixed.
export function pageWorkflowContract(source) {
  return { steps: source.steps.map(({ pathname, query, ...control }) => {
    const { result, ...action } = query;
    return { pathname, query: action, ...control };
  }), timeoutMs: source.timeoutMs };
}
export function validatePageWorkflowContract(contract) {
  if (!contract || Object.keys(contract).some(key => !['steps', 'timeoutMs'].includes(key))) invalid('Unsupported workflow contract fields.');
  const source = normalizePageWorkflow({ mode: 'workflow', timeoutMs: contract.timeoutMs, steps: contract.steps?.map(step => {
    const { strategy, mode, ...query } = step.query;
    if (strategy !== 'UI_SELECTOR') invalid('Workflow actions must use UI_SELECTOR.');
    if (query.pathParameters?.length === 0) delete query.pathParameters;
    return { ...step, query: { ...query, ...(mode === 'query' ? {} : { mode }), result: { strategy: 'DOM_STATE', path: ['publicResult'] } } };
  }) });
  if (JSON.stringify(pageWorkflowContract(source)) !== JSON.stringify(contract)) invalid('Workflow must use normalized, complete action declarations.');
  return source;
}
export function workflowParameters(source) {
  const parameters = new Map();
  for (const { query } of source.steps) {
    const bindings = query.mode === 'navigate' ? navigationParameters(query) : query.trigger.parameter ? [{ name: query.trigger.parameter, description: query.trigger.description }] : [];
    for (const binding of bindings) {
      const previous = parameters.get(binding.name);
      const maxLength = query.mode === 'navigate' ? 512 : 1000;
      parameters.set(binding.name, { name: binding.name, description: binding.description, maxLength: Math.min(previous?.maxLength || 1000, maxLength) });
    }
  }
  return [...parameters.values()];
}

export function normalizePageWorkflow(input) {
  if (!input || Object.keys(input).some(key => !['mode', 'steps', 'timeoutMs'].includes(key))
    || !Array.isArray(input.steps) || input.steps.length < 2 || input.steps.length > 8) invalid('Declare 2–8 ordered page query steps.');
  const timeoutMs = input.timeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) invalid('Workflow timeoutMs must be 1000–30000 for the entire sequence.');
  const steps = input.steps.map((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step) || Object.keys(step).some(key => !['pathname', 'origin', 'query', 'when', 'repeat'].includes(key))) invalid('Each step declares its starting pathname and query.');
    let url;
    try { url = new URL(step.pathname, 'https://example.com'); } catch {}
    if (typeof step.pathname !== 'string' || !/^\/(?!\/)/.test(step.pathname) || !url || url.origin !== 'https://example.com'
      || url.pathname !== step.pathname || url.search || url.hash) invalid('Step pathname must be an exact same-origin path or the previous destination template.');
    if (step.query?.mode === 'workflow') invalid('Nested workflows are unsupported.');
    const query = normalizePageQuery(step.query, { allowStaticNavigation: true });
    if (query.mode === 'filter' && query.resultPathname !== step.pathname) invalid('A filter must stay on its declared starting pathname.');
    if (index === 0 && step.pathname.includes(':id')) invalid('Begin the workflow on an exact entry pathname.');
    let origin; try { if (step.origin !== undefined) origin = normalizeWorkflowOrigin(step.origin); } catch (error) { invalid(error.message); }
    let control; try { control = normalizeWorkflowControl({ ...step, query }, index); } catch (error) { invalid(error.message); }
    return { pathname: step.pathname, ...(origin ? { origin } : {}), query, ...control };
  });
  for (let i = 1; i < steps.length; i++) if (steps[i].pathname !== steps[i - 1].query.resultPathname) invalid('Each step must start on the preceding destination path.');
  const result = steps.at(-1).query.result;
  return { strategy: 'UI_SELECTOR', mode: 'workflow', steps, resultPathname: steps.at(-1).query.resultPathname, result, timeoutMs };
}

export function workflowValues(source, values = {}) {
  const names = workflowParameters(source).map(binding => binding.name);
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(name => !names.includes(name))) invalid('Provide only the declared workflow parameters.');
  for (const { query } of source.steps) pageQueryValues(query, stepValues(query, values));
  return { ...values };
}

export function stepValues(query, values) {
  const names = query.mode === 'navigate' ? navigationParameters(query).map(binding => binding.name) : query.trigger.parameter ? [query.trigger.parameter] : [];
  return Object.fromEntries(names.filter(name => Object.hasOwn(values, name)).map(name => [name, values[name]]));
}
