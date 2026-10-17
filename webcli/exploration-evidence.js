import { createHash } from 'node:crypto';
import { normalizeRequestBodyEvidence, normalizeResponseBodyEvidence, classifyApiCandidateRisk } from './generation-harness/source-evidence.js';

// Only structure crosses the persisted evidence boundary. Neither request headers
// nor captured scalar values are copied into task state or agent-visible output.
export function structuralUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Expected an HTTP(S) page URL without credentials.');
  url.hash = '';
  url.pathname = url.pathname.split('/').map(segment => /^\d{3,}$/.test(segment)
    || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) || /@|%40/i.test(segment) ? ':id' : segment).join('/');
  for (const key of [...url.searchParams.keys()]) {
    if (/token|cookie|auth|password|secret|session|credential|api.?key|csrf|ticket/i.test(key)) url.searchParams.delete(key);
    else url.searchParams.set(key, '<value>');
  }
  return url.href;
}

function cleanShape(shape, depth = 0) {
  if (!shape || depth > 8) return { type: 'unknown' };
  const type = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null', 'unknown'].includes(shape.type) ? shape.type : 'unknown';
  if (type === 'array') return { type, items: cleanShape(shape.items, depth + 1) };
  if (type === 'object') return { type, properties: Object.fromEntries(Object.entries(shape.properties || {}).slice(0, 100).map(([k, v]) => [k.slice(0, 100), cleanShape(v, depth + 1)])) };
  return { type };
}

function cleanBody(evidence) {
  return { version: evidence.version, bodyKind: ['none', 'json', 'form', 'opaque'].includes(evidence.bodyKind) ? evidence.bodyKind : 'opaque',
    bodyShape: evidence.bodyShape ? cleanShape(evidence.bodyShape) : null,
    bodyKeys: evidence.bodyShape ? Object.keys(cleanShape(evidence.bodyShape).properties || {}) : [],
    bodyFullSize: evidence.bodyFullSize, bodyTruncated: evidence.bodyTruncated, bodyOmitted: evidence.bodyOmitted };
}

function listPath(shape, prefix = '', depth = 0) {
  if (!shape || depth > 6) return '';
  if (shape.type === 'array') return prefix || '$';
  for (const [key, nested] of Object.entries(shape.properties || {})) {
    const found = listPath(nested, prefix ? `${prefix}.${key}` : key, depth + 1);
    if (found) return found;
  }
  return '';
}

export function extractExplorationEvidence(capture, origin) {
  const entries = [...(capture.initialNetwork?.entries || []), ...(capture.network?.entries || []), ...(capture.networkDelta?.entries || []), ...(capture.entries || [])];
  const candidates = new Map();
  for (const entry of entries.slice(0, 300)) {
    try {
      const raw = new URL(entry.url);
      // Cross-origin APIs need an explicit reviewed grant; never infer it from traffic.
      if (raw.origin !== origin) continue;
      const url = structuralUrl(raw.href);
      const method = String(entry.method || 'GET').toUpperCase();
      const responseEvidence = cleanBody(normalizeResponseBodyEvidence(entry));
      const requestEvidence = cleanBody(normalizeRequestBodyEvidence(entry));
      const candidate = { url, method, status: Number.isInteger(entry.status) ? entry.status : null,
        responseContentType: String(entry.responseContentType || entry.contentType || '').split(';')[0].slice(0, 80),
        requestEvidence, responseEvidence };
      candidate.risk = classifyApiCandidateRisk(candidate);
      candidate.responseHints = { listPath: listPath(responseEvidence.bodyShape) };
      candidate.id = createHash('sha256').update(`${method} ${url}`).digest('hex').slice(0, 16);
      candidates.set(candidate.id, candidate);
    } catch { /* Ignore malformed or non-page URLs. */ }
  }
  return [...candidates.values()].slice(0, 100);
}
