/** Serialize page replacement and calls so an update cannot replace a running command's globals. */
export function createHostAdapterRuntime({ bundle, prepare, clear, inject }) {
  const queues = new Map();
  const stamps = new Map();
  const documents = new Map();
  return {
    invalidate(tabId) {
      stamps.delete(tabId);
      documents.set(tabId, (documents.get(tabId) || 0) + 1);
    },
    execute(tabId, manifest, url, operation = null) {
      const task = (queues.get(tabId) || Promise.resolve()).catch(() => {}).then(async () => {
        const stamp = JSON.stringify([manifest.name, manifest._hostSnapshot, url]);
        if (stamps.get(tabId) !== stamp) {
          const document = documents.get(tabId) || 0;
          const sources = await bundle(manifest);
          await prepare(tabId);
          await clear(tabId, manifest.name);
          stamps.delete(tabId);
          await inject(tabId, manifest, url, sources);
          if ((documents.get(tabId) || 0) !== document) throw new Error('Adapter document changed during injection.');
          stamps.set(tabId, stamp);
        }
        return operation ? operation() : undefined;
      });
      queues.set(tabId, task);
      void task.finally(() => { if (queues.get(tabId) === task) queues.delete(tabId); }).catch(() => {});
      return task;
    },
  };
}
