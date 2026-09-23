// Legacy compatibility tests must not accidentally exercise a same-name v2
// package or a developer's installed packages. Managed precedence has its own
// temporary-package integration suite in adapter-views.test.js.
import { afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'legacy-adapter-test-'));
vi.stubEnv('WEWORKER_BUILD_PROFILE', 'public');
vi.stubEnv('WEWORKER_BUILTIN_ADAPTERS_DIR', join(root, 'v2-builtin'));
vi.stubEnv('WEWORKER_USER_ADAPTERS_DIR', join(root, 'user'));
vi.stubEnv('WEBCLI_ADAPTERS_DIR', undefined);
vi.stubEnv('WEWORKER_ADAPTER_DATA_DIR', join(root, 'data'));
vi.stubEnv('WEWORKER_ADAPTERS_DIR', join(root, 'toolkit'));
afterAll(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
