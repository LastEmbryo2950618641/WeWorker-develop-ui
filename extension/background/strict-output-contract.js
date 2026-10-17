/** Exact assertions over the final command output; no fallback to nearby fields. */
export function verifyStrictOutput(output, fixture) {
  if (!fixture) return [];
  if (fixture.version !== 1) return [{ code: 'OUTPUT_CONTRACT_UNSUPPORTED', message: 'Unsupported output contract version.' }];
  const errors = [];
  const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const error = (code, path) => errors.push({ code, path, message: `Output assertion failed at ${path}.` });
  function at(path) {
    let values = [output], missing = false;
    for (const segment of path.replace(/^\$\.?/, '').split('.').filter(Boolean)) {
      const next = [];
      for (const value of values) {
        if (segment === '*' && Array.isArray(value)) next.push(...value);
        else if (value !== null && typeof value === 'object' && Object.hasOwn(value, segment)) next.push(value[segment]);
        else missing = true;
      }
      values = next;
    }
    return { values, missing };
  }
  for (const path of fixture.requiredPaths || []) if (at(path).missing) error('OUTPUT_REQUIRED_PATH_MISSING', path);
  for (const [path, type] of Object.entries(fixture.types || {})) {
    const found = at(path), types = type.split('|');
    if (found.missing || found.values.some(value => !types.includes(kind(value)) && !(types.includes('integer') && Number.isInteger(value)))) error('OUTPUT_FIELD_TYPE_MISMATCH', path);
  }
  for (const path of fixture.notEmpty || []) {
    const found = at(path);
    if (found.missing || !found.values.length || found.values.some(value => value == null || (typeof value === 'string' ? !value.trim() : Array.isArray(value) ? !value.length : typeof value === 'object' ? !Object.keys(value).length : false))) error('OUTPUT_EXPECTED_NON_EMPTY', path);
  }
  for (const [path, expected] of Object.entries(fixture.equals || {})) {
    const found = at(path);
    if (found.missing || found.values.some(value => value !== expected)) error('OUTPUT_VALUE_MISMATCH', path);
  }
  for (const [path, pattern] of Object.entries(fixture.patterns || {})) {
    const found = at(path);
    try {
      const expression = new RegExp(pattern);
      if (found.missing || found.values.some(value => typeof value !== 'string' || value.length > 2048 || !expression.test(value))) error('OUTPUT_PATTERN_MISMATCH', path);
    } catch { error('OUTPUT_PATTERN_INVALID', path); }
  }
  if (fixture.rowCount) {
    const { path, min, max } = fixture.rowCount; const found = at(path);
    if (found.missing || !found.values.length || found.values.some(value => !Array.isArray(value) || (min !== undefined && value.length < min) || (max !== undefined && value.length > max))) error('OUTPUT_ROW_COUNT_MISMATCH', path);
  }
  return errors;
}
