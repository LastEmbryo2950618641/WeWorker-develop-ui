import { explorationError as fail } from './exploration-commands.js';
import { structuralUrl } from './exploration-evidence.js';

const safeName = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(value);
const methods = ['get', 'head', 'post', 'put', 'patch', 'delete', 'options'];

/** Document declarations are suggestions, never observed responses or permission grants. */
export function discoverOpenApi(document, sourceUrl, allowedOrigins) {
  if (!document || typeof document !== 'object' || (!/^3\.[01](?:\.|$)/.test(document.openapi || '') && document.swagger !== '2.0')
    || !document.paths || typeof document.paths !== 'object' || Array.isArray(document.paths)) throw fail('OPENAPI_UNSUPPORTED', 'Provide an OpenAPI 3.0/3.1 or Swagger 2.0 JSON document.');
  const warnings = new Set();
  const dereference = (input, seen = new Set()) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    if (!input.$ref) return input;
    if (typeof input.$ref !== 'string' || !input.$ref.startsWith('#/') || seen.has(input.$ref) || seen.size >= 8) { warnings.add('unresolved_ref'); return {}; }
    seen.add(input.$ref);
    const target = input.$ref.slice(2).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~')).reduce((value, key) =>
      value && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined, document);
    if (!target) warnings.add('unresolved_ref');
    return dereference(target, seen);
  };
  let schemaNodes = 0;
  const shape = (input, depth = 0) => {
    if (++schemaNodes > 3000 || depth > 8) { warnings.add('schema_truncated'); return { type: 'unknown' }; }
    const schema = dereference(input);
    const type = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(schema.type) ? schema.type
      : schema.properties ? 'object' : schema.items ? 'array' : 'unknown';
    if (schema.oneOf || schema.anyOf || schema.allOf) warnings.add('composite_schema_not_expanded');
    if (type === 'object') {
      const properties = Object.entries(schema.properties || {});
      if (properties.length > 100) warnings.add('schema_truncated');
      return { type, properties: Object.fromEntries(properties.slice(0, 100).filter(([name]) => safeName(name)).map(([name, value]) => [name, shape(value, depth + 1)])) };
    }
    if (type === 'array') return { type, items: shape(schema.items, depth + 1) };
    return { type };
  };
  const bases = (pathItem, operation) => {
    if (document.swagger === '2.0') {
      const source = new URL(sourceUrl);
      const schemes = operation.schemes ?? document.schemes ?? [source.protocol.slice(0, -1)];
      if (!Array.isArray(schemes) || (document.host !== undefined && typeof document.host !== 'string')
        || (document.basePath !== undefined && (typeof document.basePath !== 'string' || !document.basePath.startsWith('/')))) { warnings.add('invalid_server'); return []; }
      return schemes.slice(0, 4).flatMap(scheme => {
        if (!['http', 'https'].includes(scheme)) { warnings.add('invalid_server'); return []; }
        return [`${scheme}://${document.host || source.host}${document.basePath || '/'}`];
      });
    }
    const servers = operation.servers || pathItem.servers || document.servers || [{ url: '/' }];
    if (!Array.isArray(servers)) { warnings.add('invalid_server'); return []; }
    return servers.slice(0, 16).flatMap(server => {
      if (typeof server?.url !== 'string' || /[{}]/.test(server.url)) { warnings.add('server_variables_unresolved'); return []; }
      try { return [new URL(server.url, sourceUrl).href]; } catch { warnings.add('invalid_server'); return []; }
    });
  };
  const operations = [];
  let total = 0, deniedOrigins = 0;
  for (const [template, rawPath] of Object.entries(document.paths)) {
    if (!template.startsWith('/') || template.startsWith('//') || template.includes('?') || template.includes('#') || template.length > 2000) { warnings.add('invalid_path'); continue; }
    const pathItem = dereference(rawPath);
    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;
      for (const base of bases(pathItem, operation)) {
        total++;
        let url, pathParameters;
        try {
          const resolved = new URL(base);
          if (resolved.username || resolved.password || resolved.search || resolved.hash || !allowedOrigins.includes(resolved.origin)) { deniedOrigins++; continue; }
          // Server base paths are prefixes; a leading operation slash does not discard them.
          const segments = template.slice(1).split('/');
          if (segments.some(segment => ['.', '..'].includes(decodeURIComponent(segment)))) { warnings.add('invalid_path'); continue; }
          const prefix = resolved.pathname.replace(/\/$/, '');
          const offset = prefix ? prefix.slice(1).split('/').length : 0;
          pathParameters = segments.flatMap((segment, index) => /^\{[A-Za-z_][A-Za-z0-9_-]*\}$/.test(segment) ? [{ name: segment.slice(1, -1), segmentIndex: offset + index }] : []);
          resolved.pathname = prefix + '/' + segments.map(segment => /^\{[A-Za-z_][A-Za-z0-9_-]*\}$/.test(segment) ? ':id' : segment).join('/');
          url = structuralUrl(resolved.href);
        } catch { warnings.add('invalid_path'); continue; }
        if (operations.length >= 200) { warnings.add('operations_truncated'); continue; }
        const declared = [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])];
        const parameters = new Map();
        for (const raw of declared.slice(0, 100)) {
          const parameter = dereference(raw);
          if (!safeName(parameter.name) || !['path', 'query', 'header', 'body', 'formData', 'cookie'].includes(parameter.in)) continue;
          parameters.set(parameter.in + ':' + parameter.name, { name: parameter.name, in: parameter.in, required: parameter.required === true, shape: shape(parameter.schema || parameter) });
        }
        const responses = Object.entries(operation.responses || {}).filter(([status]) => /^2\d\d$/.test(status)).slice(0, 8).map(([status, raw]) => {
          const response = dereference(raw);
          return { status: Number(status), shape: shape(response.schema || response.content?.['application/json']?.schema) };
        });
        const body = dereference(operation.requestBody);
        const contentTypes = Object.keys(body.content || {}).filter(value => ['application/json', 'application/x-www-form-urlencoded'].includes(value));
        const security = operation.security ?? document.security;
        operations.push({ method: method.toUpperCase(), url, ...(safeName(operation.operationId) ? { operationId: operation.operationId } : {}),
          parameters: [...parameters.values()], pathParameters, responses, requestBody: contentTypes.map(contentType => ({ contentType, shape: shape(body.content[contentType]?.schema) })),
          authenticationDeclared: Array.isArray(security) && security.length > 0, observed: false });
      }
    }
  }
  return { url: structuralUrl(sourceUrl), format: document.swagger === '2.0' ? 'swagger-2' : 'openapi-3', operations, totalOperations: total,
    omittedOrigins: deniedOrigins, warnings: [...warnings], structuralOnly: true, executedOperations: 0 };
}
