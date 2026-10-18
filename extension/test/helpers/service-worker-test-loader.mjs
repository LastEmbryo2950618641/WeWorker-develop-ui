import { scopedGenerationPreviewScripts } from '../../background/generation-preview-bundle.js';
import { recordBrowserFrameEvent, clearBrowserFrames } from '../../background/browser-frames.js';
import { recordBrowserDownload, clearBrowserDownloads } from '../../background/browser-downloads.js';
import { recordBrowserEvent, clearBrowserEvents } from '../../background/browser-events.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { createHostAdapterClient } from '../../background/host-adapter-client.js';
import { matchesPagePath, assertPageQueryRoute } from '../../background/page-navigation.js';
import { usesWorkflowOrigins, matchesOriginTarget } from '../../background/page-workflow-origins.js';
import { pageRoutePaths, pageRouteTargets } from '../../background/page-workflow.js';
import { cancelPageWorkflow, cancelAllPageWorkflows, assertPageWorkflowActive } from '../../background/page-query.js';
import { createHostAdapterRuntime, assertAdapterNavigationUrl, createNavigationGuard, classifyNavigationTarget, navigateAdapterTab } from '../../background/host-adapter-runtime.js';
import { createManagedBackgroundRuntime, MANAGED_RUNNER_PATH } from '../../background/managed-background-runtime.js';
import { buildV2Bootstrap, v2InjectionFiles } from '../../background/v2-loader.js';
import { injectAdapterSources } from '../../background/adapter-script-loader.js';
import { selectCompatibleCaptureBoundEntry, validateGenerationPreviewOutputV2 } from '../../background/generation-output-validator.js';

export function runServiceWorkerInContext(context, { repoRoot = process.cwd() } = {}) {
  const source = readFileSync(join(repoRoot, 'extension/background/service-worker.js'), 'utf8')
    .replace(/^import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?\s*/gm, '');
  Object.assign(context, { cancelPageWorkflow, cancelAllPageWorkflows, assertPageWorkflowActive, pageRoutePaths, pageRouteTargets, usesWorkflowOrigins, matchesOriginTarget, matchesPagePath, assertPageQueryRoute, recordBrowserEvent, clearBrowserEvents, recordBrowserDownload, clearBrowserDownloads, recordBrowserFrameEvent, clearBrowserFrames, scopedGenerationPreviewScripts, createHostAdapterClient, createHostAdapterRuntime, assertAdapterNavigationUrl, createNavigationGuard, classifyNavigationTarget, navigateAdapterTab, buildV2Bootstrap,
    createManagedBackgroundRuntime, MANAGED_RUNNER_PATH,
    v2InjectionFiles, injectAdapterSources, selectCompatibleCaptureBoundEntry, validateGenerationPreviewOutputV2 });
  vm.runInContext(source, context, { filename: 'service-worker.js', timeout: 5000 });
}
