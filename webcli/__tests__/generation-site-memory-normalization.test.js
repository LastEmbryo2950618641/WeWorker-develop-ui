import { describe, expect, it } from 'vitest';
import { normalizeSiteMemoryForScaffold } from '../bridge.js';

describe('generation site-memory normalization', () => {
  it('merges duplicate response shapes without bringing samples back into the task', () => {
    const normalized = normalizeSiteMemoryForScaffold({ siteKey: 'example.com', listApiCandidates: [
      { url: 'https://example.com/api/list', method: 'GET', responsePreview: '' },
      { url: 'https://example.com/api/list', method: 'GET', responsePreview: '{"title":"fixture-private-sample"}' },
    ] });
    expect(normalized.listApiCandidates).toHaveLength(1);
    expect(normalized.listApiCandidates[0].responseEvidence).toMatchObject({ bodyKind: 'json', bodyKeys: ['title'] });
    expect(normalized.listApiCandidates[0]).not.toHaveProperty('responsePreview');
    expect(JSON.stringify(normalized)).not.toContain('fixture-private-sample');
  });

  it('preserves response structure from legacy fallback without captured values', () => {
    const normalized = normalizeSiteMemoryForScaffold({
      siteKey: 'example.test',
      listApiCandidates: [{
        method: 'GET',
        url: 'https://example.test/api/search?page=1',
        requestBodyPreview: '',
      }],
      apiCandidates: [{
        method: 'GET',
        url: 'https://example.test/api/search?page=1',
        status: 200,
        contentType: 'application/json',
        responsePreview: '{"code":0,"data":{"records":[]}}',
      }],
    });

    expect(normalized.listApiCandidates).toEqual([expect.objectContaining({
      status: 200,
      responseContentType: 'application/json',
      responseEvidence: expect.objectContaining({ bodyKind: 'json', bodyKeys: ['code', 'data'] }),
      sourceEvidence: expect.objectContaining({
        version: 'api-source-v2',
        sourceKind: 'passive_list',
        risk: expect.objectContaining({ level: 'read', confidence: 0.97 }),
      }),
    })]);
  });

  it('keeps only response structure already attached to list candidates', () => {
    const normalized = normalizeSiteMemoryForScaffold({
      siteKey: 'example.test',
      listApiCandidates: [{
        method: 'POST',
        url: 'https://example.test/api/query',
        requestBodyPreview: '{"page":1}',
        responsePreview: '[{"id":1}]',
        responseContentType: 'application/json',
      }],
    });

    expect(normalized.listApiCandidates[0]).toMatchObject({
      requestEvidence: expect.objectContaining({
        bodyKind: 'json',
        bodyKeys: ['page'],
        bodyOmitted: false,
      }),
      responseEvidence: expect.objectContaining({ bodyKind: 'json', bodyOmitted: false }),
      responseContentType: 'application/json',
      sourceEvidence: {
        version: 'api-source-v2',
        fingerprint: expect.stringMatching(/^api-v1-/),
        sourceKind: 'passive_list',
        method: 'POST',
        endpoint: 'https://example.test/api/query',
        queryKeys: [],
        bodyKeys: ['page'],
        requestEvidence: expect.objectContaining({ bodyKind: 'json', bodyKeys: ['page'], bodyOmitted: false }),
        risk: expect.objectContaining({ level: 'read', confidence: 0.97 }),
      },
    });
    expect(normalized.listApiCandidates[0]).not.toHaveProperty('requestBodyPreview');
    expect(normalized.listApiCandidates[0]).not.toHaveProperty('responsePreview');
  });

  it('persists write evidence for interfaces captured from user actions', () => {
    const normalized = normalizeSiteMemoryForScaffold({
      siteKey: 'todo.example.com',
      actionApiCandidates: [{
        actionName: '审批待办',
        toolName: 'todo.example.com.approve_todo',
        method: 'POST',
        url: 'https://todo.example.com/api/approve/myApprove',
        requestBodyPreview: '{"todoId":"1"}',
      }],
    });

    expect(normalized.actionApiCandidates[0].sourceEvidence).toMatchObject({
      sourceKind: 'action_capture',
      method: 'POST',
      endpoint: 'https://todo.example.com/api/approve/myApprove',
      bodyKeys: ['todoId'],
      risk: { level: 'write', confidence: 0.99 },
    });
    expect(normalized.actionApiCandidates[0].requestBodyPreview).toBeUndefined();
    expect(normalized.actionApiCandidates[0].requestEvidence).toMatchObject({ bodyKind: 'json', bodyKeys: ['todoId'] });
  });
});
