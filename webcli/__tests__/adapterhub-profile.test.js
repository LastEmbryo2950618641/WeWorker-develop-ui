import { afterEach, describe, expect, it } from 'vitest';
import profile from '../adapterhub-profile.json' with { type: 'json' };
import { resolveEndpoint } from '../adapterhub-client.js';

const original = process.env.WEBCLI_ADAPTERHUB_ENDPOINT;
afterEach(() => {
  if (original === undefined) delete process.env.WEBCLI_ADAPTERHUB_ENDPOINT;
  else process.env.WEBCLI_ADAPTERHUB_ENDPOINT = original;
});

describe('AdapterHub deployment endpoint', () => {
  it('uses only the explicitly configured default', () => {
    delete process.env.WEBCLI_ADAPTERHUB_ENDPOINT;
    if (profile.endpoint) expect(resolveEndpoint()).toBe(profile.endpoint.replace(/\/+$/, ''));
    else expect(() => resolveEndpoint()).toThrow('端点为空');
  });
  it('allows HTTPS and loopback development endpoints', () => {
    for (const endpoint of ['https://hub.example.com/api/', 'http://127.0.0.1:12345/']) {
      process.env.WEBCLI_ADAPTERHUB_ENDPOINT = endpoint;
      expect(resolveEndpoint()).toBe(endpoint.replace(/\/+$/, ''));
    }
  });
  it('rejects arbitrary remote HTTP and invalid URLs', () => {
    for (const endpoint of ['http://hub.example.com', 'file:///tmp/hub', 'invalid']) {
      process.env.WEBCLI_ADAPTERHUB_ENDPOINT = endpoint;
      expect(() => resolveEndpoint()).toThrow();
    }
    if (profile.allowHttp && profile.endpoint) {
      process.env.WEBCLI_ADAPTERHUB_ENDPOINT = `${profile.endpoint.replace(/\/+$/, '')}-untrusted`;
      expect(() => resolveEndpoint()).toThrow();
    }
  });
});
