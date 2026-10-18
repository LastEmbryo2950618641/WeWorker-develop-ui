// Shared explicit origin declarations for read-only workflows. No dynamic
// origins, inferred redirects, credentials or fallback to another browser tab.
export function normalizeWorkflowOrigin(value) {
  let url;
  try { url = new URL(value); } catch {}
  if (typeof value !== 'string' || value.length > 2048 || !url || !['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.origin !== value) throw new Error('Declare an exact public HTTP(S) origin without credentials, paths, queries or fragments.');
  return value;
}
export function workflowOriginRoutes(source, entryOrigin) {
  normalizeWorkflowOrigin(entryOrigin);
  if (!Array.isArray(source?.steps) || !source.steps.length) throw new Error('Declare workflow steps before resolving origins.');
  let previous;
  return source.steps.map((step, index) => {
    const origin = normalizeWorkflowOrigin(step.origin ?? entryOrigin);
    const resultOrigin = normalizeWorkflowOrigin(step.query.resultOrigin ?? origin);
    if (index === 0 && origin !== entryOrigin) throw new Error('The first workflow origin must be the observed entry origin.');
    if (previous && origin !== previous.resultOrigin) throw new Error('Each workflow origin must equal the preceding destination origin.');
    if (resultOrigin !== origin && step.query.mode !== 'navigate') throw new Error('Only an explicitly declared navigation may change origin.');
    if ((step.when || step.repeat) && resultOrigin !== origin) throw new Error('Conditional and repeated steps must preserve their origin.');
    previous = { origin, pathname: step.pathname, resultOrigin, resultPathname: step.query.resultPathname };
    return previous;
  });
}
export function workflowOriginTargets(source, entryOrigin) {
  const routes = workflowOriginRoutes(source, entryOrigin);
  return [{ origin: entryOrigin, pathname: routes[0].pathname }, ...routes.map(route => ({ origin: route.resultOrigin, pathname: route.resultPathname }))];
}
export const usesWorkflowOrigins = source => Boolean(source?.resultOrigin || source?.steps?.some(step => step.origin || step.query?.resultOrigin));

export function pageSourceOriginTargets(source, entryOrigin, entryPath) {
  if (source?.mode === 'workflow') return workflowOriginTargets(source, entryOrigin);
  return [{ origin: entryOrigin, pathname: entryPath }, ...(source?.mode === 'navigate'
    ? [{ origin: normalizeWorkflowOrigin(source.resultOrigin ?? entryOrigin), pathname: source.resultPathname }] : [])];
}
export function matchesOriginTarget(url, target, allowStructuralPath = false) {
  if (url.origin !== target.origin) return false;
  const actual = url.pathname.split('/'), expected = target.pathname.split('/');
  return actual.length === expected.length && expected.every((part, index) => {
    if (part !== ':id') return part === actual[index];
    if (allowStructuralPath && actual[index] === ':id') return true;
    let value; try { value = decodeURIComponent(actual[index]); } catch { return false; }
    return value.trim().length > 0 && value.length <= 512 && !['.', '..', ':id', '<value>'].includes(value) && !/[/\\%\u0000-\u001f\u007f]/.test(value);
  });
}
