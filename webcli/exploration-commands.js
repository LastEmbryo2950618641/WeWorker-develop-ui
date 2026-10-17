/** Public, model-independent API exploration contract. */
export const explorationCommands = {
  help: { description: 'Describe the standalone API exploration commands.', params: [] },
  capabilities: { description: 'Inspect Bridge and extension availability; no desktop or model key required.', params: [] },
  tabs: { description: 'List HTTP(S) tabs available for exploration.', params: [] },
  start: { description: 'Create a persisted task and collect evidence by reloading the selected page. The calling agent interprets the goal.', params: ['tabId', 'goal', 'requestId'] },
  list: { description: 'List persisted exploration tasks.', params: [] },
  get: { description: 'Read task state and next actions.', params: ['taskId'] },
  events: { description: 'Read bounded task events after a cursor.', params: ['taskId', 'cursor?'] },
  evidence: { description: 'Read structural API evidence, without captured values or credentials.', params: ['taskId'] },
  collect: { description: 'Collect fresh evidence after manual page interaction, without reloading.', params: ['taskId'] },
  actions: { description: 'Inspect safe search/filter/pagination controls on the bound page.', params: ['taskId'] },
  probe: { description: 'Execute one freshly inspected safe read action and collect its network delta (three probes per task).', params: ['taskId', 'candidateId', 'value?'] },
  cancel: { description: 'Cancel task processing; an already dispatched browser request may finish but its result is discarded.', params: ['taskId'] },
  generate: { description: 'Create an isolated read-only draft from evidence. Optional plan is authored by the calling agent; no model is called.', params: ['taskId', 'plan?'] },
  'draft-read': { description: 'List draft files or read one file and its content hash.', params: ['taskId', 'file?'] },
  'draft-write': { description: 'Replace an existing draft file using an expected hash; invalidates validation and review.', params: ['taskId', 'file', 'content', 'expectedHash'] },
  validate: { description: 'Run static checks and real read-only browser preview validation.', params: ['taskId'] },
  review: { description: 'Review the validated package, permissions and installation changes.', params: ['taskId'] },
  install: { description: 'Install a validated package locally after explicit user consent to the current review.', params: ['taskId', 'reviewId', 'confirmed'] },
};

export function explorationHelp() {
  return { namespace: 'exploration', schemaVersion: 1, usage: 'webcli call exploration.<command> --key=value',
    requirements: ['WebCLI Bridge', 'WeWorker browser extension'], model: 'calling-agent', desktopRequired: false,
    commands: Object.entries(explorationCommands).map(([name, spec]) => ({ name: `exploration.${name}`, ...spec })) };
}

export function explorationError(code, message) { return Object.assign(new Error(message), { code }); }

export function integerArg(value, name, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(String(value)) || !['string', 'number'].includes(typeof value)
      || !Number.isSafeInteger(Number(value))) throw explorationError('INVALID_ARGUMENT', `${name} must be a non-negative integer.`);
  return Number(value);
}

export function textArg(value, name, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw explorationError('INVALID_ARGUMENT', `${name} must be a non-empty string of at most ${max} characters.`);
  return value.trim();
}
