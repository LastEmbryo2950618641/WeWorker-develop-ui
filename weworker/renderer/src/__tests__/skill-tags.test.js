import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultSkillTags, skillTagKey, skillTags, normalizeSkillTags, matchesSkillSearch, loadSkillTagOverrides } from '../utils/skill-tags.js'

const tool = { id: 'example', source: 'official-skill', siteId: 'example.org', siteName: '示例站点', name: 'Example Skill', description: '读取资料' }
test('legacy scope, source and site become optional default tags', () => {
  assert.deepEqual(defaultSkillTags(tool), ['站点', '官方', '示例站点'])
  assert.deepEqual(defaultSkillTags({ source: 'public-custom' }), ['公共', '自定义'])
  assert.deepEqual(skillTags(tool, { [skillTagKey(tool)]: [] }), [])
})
test('tags normalize safely and persist intentional deletion', () => {
  assert.deepEqual(normalizeSkillTags([' 工作 ', '工作', '', null]), ['工作'])
  const stored = { [skillTagKey(tool)]: [] }
  assert.deepEqual(loadSkillTagOverrides({ getItem: () => JSON.stringify(stored) }), stored)
  assert.deepEqual(loadSkillTagOverrides({ getItem: () => '{broken' }), {})
  assert.deepEqual(loadSkillTagOverrides({ getItem: () => '[]' }), {})
})
test('search matches names, descriptions and multiple optional tags without category gates', () => {
  assert.equal(matchesSkillSearch(tool, 'EXAMPLE 工作', ['工作']), true)
  assert.equal(matchesSkillSearch(tool, '读取', []), true)
  assert.equal(matchesSkillSearch(tool, '官方', []), false)
  assert.equal(matchesSkillSearch(tool, '示例站点', []), false)
  assert.equal(matchesSkillSearch(tool, '', []), true)
})
test('tag identity isolates same names across sources and sites', () => {
  const tagged = { [skillTagKey(tool)]: ['工作'] }
  assert.deepEqual(skillTags(tool, tagged), ['工作'])
  assert.notEqual(skillTagKey(tool), skillTagKey({ ...tool, siteId: 'example.com' }))
  assert.notEqual(skillTagKey(tool), skillTagKey({ ...tool, source: 'custom' }))
})
