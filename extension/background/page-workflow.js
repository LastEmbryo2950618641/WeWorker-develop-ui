import { matchesPagePath, resolvePageDestination } from './page-navigation.js';
import { navigationParameters } from './page-navigation-parameters.js';

const fail = (code, message) => Object.assign(new Error(message), { code });
const namesFor = query => query.mode === 'navigate' ? navigationParameters(query).map(binding => binding.name) : query.trigger?.parameter ? [query.trigger.parameter] : [];
export function pageWorkflowContract(source) {
  return { steps: source.steps.map(({ pathname, query }) => {
    const { result, ...action } = query;
    return { pathname, query: action };
  }), timeoutMs: source.timeoutMs };
}
export function pageRoutePaths(route) {
  return [route.pathname, ...(route.additionalPaths || []), ...(route.navigation ? [route.navigation.pathname] : []),
    ...(route.workflow?.steps || []).map(step => step.query.resultPathname)];
}

/** A sequence has one owner and one deadline. Only observations are polled. */
export async function executePageWorkflow(options, executeStep) {
  const { chrome, tabId, payload, now } = options;
  const { source, values = {}, expectedOrigin, expectedPath } = payload;
  if (!Array.isArray(source.steps) || source.steps.length < 2 || source.steps.length > 8
    || !Number.isSafeInteger(source.timeoutMs) || source.timeoutMs < 1000 || source.timeoutMs > 30000) throw fail('INVALID_PAGE_WORKFLOW', 'Invalid workflow steps or total deadline.');
  const names = new Set(source.steps.flatMap(step => namesFor(step.query)));
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(name => !names.has(name))) throw fail('INVALID_PAGE_QUERY_ARGUMENT', 'Unexpected workflow parameter.');
  // Validate every parameter before dispatching the first action.
  for (let i = 0; i < source.steps.length; i++) {
    const { pathname, query } = source.steps[i];
    if (!['navigate', 'query', 'filter'].includes(query?.mode) || !query.result || (i && pathname !== source.steps[i - 1].query.resultPathname)) throw fail('INVALID_PAGE_WORKFLOW', 'Workflow paths and steps must form an ordered chain.');
    const argumentsForStep = Object.fromEntries(namesFor(query).filter(name => Object.hasOwn(values, name)).map(name => [name, values[name]]));
    if (query.mode === 'navigate') resolvePageDestination(expectedOrigin, query, argumentsForStep, true);
    else if (namesFor(query).some(name => typeof values[name] !== 'string' || !values[name].trim() || values[name].length > 1000)) throw fail('INVALID_PAGE_QUERY_ARGUMENT', 'Provide every declared workflow parameter.');
  }
  const initial = new URL((await chrome.tabs.get(tabId)).url);
  const entry = source.steps[0];
  const entryPaths = entry.query.mode === 'navigate' ? [expectedPath, ...source.steps.map(step => step.query.resultPathname)] : [entry.pathname];
  if (initial.origin !== expectedOrigin || !entryPaths.some(path => matchesPagePath(initial.pathname, path))) throw fail('PAGE_QUERY_ROUTE_CHANGED', 'Open a declared workflow entry page.');
  const deadline = now() + source.timeoutMs;
  const assertRunning = () => {
    options.assertRunning();
    if (now() >= deadline) throw fail('PAGE_WORKFLOW_TIMEOUT', 'Workflow deadline reached; remaining steps were not dispatched.');
  };
  let completedSteps = 0, output, previousPage;
  for (const step of source.steps) {
    options.assertRunning();
    const index = completedSteps;
    const remaining = deadline - now();
    if (remaining < 1000) return { ok: false, error: { code: 'PAGE_WORKFLOW_TIMEOUT', message: 'Workflow deadline reached; remaining steps were not dispatched.', stepIndex: index, completedSteps } };
    const current = new URL((await chrome.tabs.get(tabId)).url);
    if (previousPage) {
      const frame = (await chrome.debugger.sendCommand({ tabId }, 'Page.getFrameTree'))?.frameTree?.frame;
      if (current.href !== previousPage.url || frame?.id !== previousPage.frameId || frame?.loaderId !== previousPage.loaderId) return {
        ok: false, error: { code: 'PAGE_QUERY_ROUTE_CHANGED', message: 'The previous step document was replaced; remaining actions were not dispatched.', stepIndex: index, completedSteps },
      };
    }
    const startPath = index === 0 && step.query.mode === 'navigate' ? initial.pathname : step.pathname;
    if (current.origin !== expectedOrigin || !matchesPagePath(current.pathname, startPath)) return { ok: false, error: { code: 'PAGE_QUERY_ROUTE_CHANGED', message: 'Page changed between workflow steps.', stepIndex: index, completedSteps } };
    const query = { ...step.query, timeoutMs: Math.min(step.query.timeoutMs, remaining) };
    output = await executeStep({ ...options, assertRunning, payload: { source: query, values: Object.fromEntries(namesFor(query).map(name => [name, values[name]])),
      expectedOrigin, expectedPath: current.pathname, metadataOnly: payload.metadataOnly && index === source.steps.length - 1 }, allowStaticNavigation: true, captureWorkflowPage: true });
    if (!output?.ok) return { ok: false, error: { ...output?.error, stepIndex: index, completedSteps, message: `Workflow step ${index + 1} failed after ${completedSteps} completed steps. ${output?.error?.message || 'Later steps were not dispatched.'}` } };
    completedSteps++;
    previousPage = output.internalWorkflowPage;
    if (!previousPage?.frameId || !previousPage.loaderId) throw fail('PAGE_QUERY_ROUTE_CHANGED', 'Workflow step did not retain its completed document identity.');
  }
  const { internalWorkflowPage, ...result } = output;
  return { ...result, workflow: { completedSteps } };
}
