// Shared data-only control declarations. No expressions, scripts or implicit retries.
const validPath = path => typeof path === 'string' && path.length <= 200
  && /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*$/.test(path)
  && !/password|passwd|secret|token|cookie|auth|credential|api.?key|session|csrf|constructor|prototype/i.test(path);
export function normalizeWorkflowCondition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2
    || !validPath(value.path) || !Object.hasOwn(value, 'equals')
    || !(value.equals === null || typeof value.equals === 'boolean' || typeof value.equals === 'number' && Number.isFinite(value.equals)
      || typeof value.equals === 'string' && value.equals.length <= 512)) throw new Error('Conditions require one public scalar path and an exact JSON scalar equals.');
  return { path: value.path, equals: value.equals };
}
export function normalizeWorkflowControl(step, index) {
  const result = {};
  if (step.when !== undefined) {
    if (index === 0 || step.pathname !== step.query.resultPathname) throw new Error('Conditional steps require a preceding result and must keep the declared path.');
    result.when = normalizeWorkflowCondition(step.when);
  }
  if (step.repeat !== undefined) {
    const repeat = step.repeat;
    if (!repeat || typeof repeat !== 'object' || Array.isArray(repeat) || Object.keys(repeat).some(key => !['maxIterations', 'until', 'collect'].includes(key))
      || !Number.isSafeInteger(repeat.maxIterations) || repeat.maxIterations < 2 || repeat.maxIterations > 8
      || step.pathname !== step.query.resultPathname) throw new Error('Repeat requires 2–8 bounded iterations on the same declared path.');
    result.repeat = { maxIterations: repeat.maxIterations, until: normalizeWorkflowCondition(repeat.until) };
    if (repeat.collect !== undefined) {
      const collect = repeat.collect;
      if (!collect || typeof collect !== 'object' || Array.isArray(collect) || Object.keys(collect).some(key => !['path', 'identityPath', 'maxItems', 'includePrevious'].includes(key))
        || collect.includePrevious !== undefined && typeof collect.includePrevious !== 'boolean' || collect.includePrevious && index === 0
        || !validPath(collect.path) || !validPath(collect.identityPath) || !Number.isSafeInteger(collect.maxItems) || collect.maxItems < 1 || collect.maxItems > 1000) throw new Error('Collection requires a public array path, row identityPath and maxItems from 1 to 1000.');
      result.repeat.collect = { path: collect.path, identityPath: collect.identityPath, maxItems: collect.maxItems, ...(collect.includePrevious !== undefined ? { includePrevious: collect.includePrevious } : {}) };
    }
  }
  return result;
}
export function workflowValue(data, path) {
  for (const key of path.split('.')) {
    if (data === null || typeof data !== 'object' || !Object.hasOwn(data, key)) throw new Error('The declared workflow result path is missing.');
    data = data[key];
  }
  return data;
}
export function workflowConditionMatches(data, condition) {
  const value = workflowValue(data, condition.path);
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('The declared workflow condition is not a scalar.');
  return value === condition.equals;
}
export const usesWorkflowControl = source => Boolean(source?.steps?.some(step => step.when || step.repeat));
