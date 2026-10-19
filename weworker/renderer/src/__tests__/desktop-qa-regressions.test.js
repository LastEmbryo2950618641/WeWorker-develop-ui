import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import { useWorksStore } from '../store/works.js'

const NL = String.fromCharCode(10)
function read(relative) { return readFileSync(new URL(relative, import.meta.url), 'utf8') }
function loadFunctions(source, names, context = {}) {
  const scope = vm.createContext(context)
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`)
    assert.ok(start >= 0, `Missing function ${name}`)
    const end = source.indexOf(NL + '}', start) + 2
    vm.runInContext(source.slice(start, end), scope)
  }
  return scope
}

test('D09 keeps separate multiline drafts and attachments across work selection and clears only the sent work', () => {
  const before = useWorksStore.getState()
  try {
    assert.equal(typeof before.updateDraft, 'function')
    const text = ['中文草稿', '第二行'].join(NL)
    before.updateDraft('fixture-a', { text, attachments: [{ name: 'fixture.txt', path: 'C:/weworker-fixtures/fixture.txt' }] })
    useWorksStore.setState({ activeWorkId: 'fixture-b' })
    before.updateDraft('fixture-b', { text: '另一个草稿' })
    useWorksStore.setState({ activeWorkId: 'fixture-a' })
    assert.equal(useWorksStore.getState().drafts['fixture-a'].text, text)
    assert.equal(useWorksStore.getState().drafts['fixture-a'].attachments[0].name, 'fixture.txt')
    before.clearDraft('fixture-a')
    assert.equal(useWorksStore.getState().drafts['fixture-a'], undefined)
    assert.equal(useWorksStore.getState().drafts['fixture-b'].text, '另一个草稿')
  } finally { useWorksStore.setState(before, true) }
})

test('D10 global works_changed refreshes persisted titles even after the chat stream ends', async () => {
  const before = useWorksStore.getState()
  const previousFetch = globalThis.fetch
  const previousWindow = globalThis.window
  try {
    globalThis.window = { electronAPI: { getHttpAuthToken: () => '' } }
    globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).endsWith('/works')
      ? [{ id: 'fixture-a', title: '公开计算任务' }] : {}), { status: 200 })
    useWorksStore.setState({ works: [{ id: 'fixture-a', title: '' }] })
    const source = read('../App.jsx')
    const start = source.indexOf('    const handleEvent = (data) => {')
    const end = source.indexOf('    const connect = () => {', start)
    const scope = vm.createContext({ useWorksStore })
    vm.runInContext(source.slice(start, end) + NL + 'globalThis.receive = handleEvent', scope)
    scope.receive(JSON.stringify({ type: 'works_changed', workId: 'fixture-a' }))
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(useWorksStore.getState().works[0].title, '公开计算任务')
    scope.receive(JSON.stringify({ type: 'title_update', workId: 'fixture-a', title: '模型生成标题' }))
    assert.equal(useWorksStore.getState().works[0].title, '模型生成标题')
  } finally {
    globalThis.fetch = previousFetch
    globalThis.window = previousWindow
    useWorksStore.setState(before, true)
  }
})

const schedule = loadFunctions(read('../components/scheduled/TaskConfigView.jsx'), ['buildCron', 'parseCron', 'getNextRuns'])
for (const [fields, expected] of [
  [{ frequency: 'daily', hour: 0, minute: 0 }, '0 0 * * *'],
  [{ frequency: 'weekly', hour: 0, minute: 0, weekday: '1' }, '0 0 * * 1'],
  [{ frequency: 'weekly', hour: 0, minute: 0, weekday: 0 }, '0 0 * * 0'],
  [{ frequency: 'daily', hour: 11, minute: 0 }, '0 11 * * *'],
  [{ frequency: 'daily', minute: 0 }, '0 9 * * *'],
]) {
  test(`D11 schedule saves and round-trips ${expected}`, () => {
    assert.equal(schedule.buildCron(fields), expected)
    assert.equal(schedule.buildCron(schedule.parseCron(expected)), expected)
    assert.equal(schedule.getNextRuns(fields, 1)[0].getHours(), fields.hour ?? 9)
    if (fields.frequency === 'weekly') assert.equal(schedule.getNextRuns(fields, 1)[0].getDay(), Number(fields.weekday))
  })
}

function renameFixture(resources, markdown, oldPath, newName) {
  const source = read('../components/welcome/ToolPackageEditor.jsx')
  const names = ['formatSkillResourcePath', 'buildResourceHint', 'normalizeResourcePath', 'existingResourcePaths', 'joinResourcePath', 'resolveRenamedResourcePath', 'renameResourceEntry']
  if (source.includes('function renameResourceHints(')) names.push('renameResourceHints')
  let patch
  const scope = loadFunctions(source, names, {
    resources, storedMarkdown: markdown, tool: { name: 'fixture-skill' }, expandedPath: oldPath,
    setRenamingPath() {}, setExpandedPath() {}, onChange(value) { patch = value },
  })
  const start = source.indexOf('  const handleRenameResource = (oldPath, newName) => {')
  const end = source.indexOf('  const handleCreateFolder = ', start)
  vm.runInContext(source.slice(start, end) + NL + 'globalThis.rename = handleRenameResource', scope)
  scope.rename(oldPath, newName)
  return patch
}

test('D12 renames the generated file reference in the same save as the resource', () => {
  const markdown = ['# 测试技能', '', '本技能所需文件 `untitled.txt` 的路径为 `{{skill.path}}/untitled.txt`。'].join(NL)
  const content = ['第一行', '第二行'].join(NL)
  const patch = renameFixture([{ name: 'untitled.txt', relativePath: 'untitled.txt', content }], markdown, 'untitled.txt', '中文资源.txt')
  assert.equal(patch.resources[0].relativePath, '中文资源.txt')
  assert.equal(patch.resources[0].content, content)
  assert.equal(patch.markdown, ['# 测试技能', '', '本技能所需文件 `中文资源.txt` 的路径为 `{{skill.path}}/中文资源.txt`。'].join(NL))
})

test('D12 folder rename updates descendant hints while preserving unrelated paths and user text', () => {
  const markdown = ['用户说明：old/data.txt', '本技能所需文件 `data.txt` 的路径为 `{{skill.path}}/old/data.txt`。', '本技能所需文件 `data.txt` 的路径为 `{{skill.path}}/other/data.txt`。'].join(NL)
  const patch = renameFixture([{ relativePath: 'old', is_directory: true }, { relativePath: 'old/data.txt' }, { relativePath: 'other/data.txt' }], markdown, 'old', '新目录')
  assert.equal(patch.markdown, ['用户说明：old/data.txt', '本技能所需文件 `data.txt` 的路径为 `{{skill.path}}/新目录/data.txt`。', '本技能所需文件 `data.txt` 的路径为 `{{skill.path}}/other/data.txt`。'].join(NL))
})
