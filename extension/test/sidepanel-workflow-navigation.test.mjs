import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const html = fs.readFileSync(new URL('../sidepanel/sidepanel.html', import.meta.url), 'utf8')
const source = fs.readFileSync(new URL('../sidepanel/sidepanel.js', import.meta.url), 'utf8')

test('guided workflow steps are clickable navigation controls', () => {
  for (const step of ['explore', 'capture', 'generate']) {
    assert.match(html, new RegExp(`<button[^>]+data-workflow-step="${step}"`))
  }
  assert.match(source, /querySelectorAll\('\[data-workflow-step\]'\)/)
  assert.match(source, /setDevWorkflowStep\(stepEl\.dataset\.workflowStep\)/)
})

test('completed action capture stays on step 2 until the user chooses generation', () => {
  const resultBranchStart = source.indexOf("if (state.type === 'action_capture' && state.result)")
  const nextFunction = source.indexOf('\nasync function clearActionCaptureState', resultBranchStart)
  assert.ok(resultBranchStart >= 0 && nextFunction > resultBranchStart)

  const resultBranch = source.slice(resultBranchStart, nextFunction)
  assert.match(resultBranch, /setDevWorkflowStep\('capture'\)/)
  assert.doesNotMatch(resultBranch, /setDevWorkflowStep\('generate'\)/)
  assert.match(source, /data-capture-action="go-generate"/)
})

test('capture review lets the user choose the primary request', () => {
  assert.match(source, /data-capture-action="select-primary"/)
  assert.match(source, /sidepanel_action_capture_select_candidate/)
  assert.match(source, /已更新主接口，生成工具时将优先使用该请求/)
})

test('successful installation remains on step 3 after tab state refresh', () => {
  const generateStart = source.indexOf('async function publishGenerationRun()')
  const generateEnd = source.indexOf('\nfunction clearActionCapturePolling', generateStart)
  assert.ok(generateStart >= 0 && generateEnd > generateStart)
  const generateSource = source.slice(generateStart, generateEnd)
  assert.match(generateSource, /await refreshCurrentTabState\(\);\s*[\s\S]*?setDevWorkflowStep\('generate'\)/)
})

test('restoring completed capture content preserves the current workflow step', () => {
  const restoreStart = source.indexOf('async function restoreActionCaptureState()')
  const restoreEnd = source.indexOf('\n// ── Config Tab', restoreStart)
  const restoreSource = source.slice(restoreStart, restoreEnd)
  assert.match(restoreSource, /const workflowStepBeforeRestore = devWorkflowStep/)
  assert.match(restoreSource, /renderActionCaptureState\(saved\);[\s\S]*?setDevWorkflowStep\(workflowStepBeforeRestore\)/)
})
