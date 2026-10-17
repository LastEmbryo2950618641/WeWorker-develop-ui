import { expect, it } from 'vitest'
import type { Settings } from '../config.js'
import { changeChannelConfiguration, createChannelMutationQueue, emptyChannel, migrateChannelConfigurations, publicChannelSettings, type ChannelType } from '../channels/channel-configurations.js'
import { applySecrets, clearSecretsOnDisk, extractSecrets } from '../settings-secrets.js'

function initial(): Settings {
  return { channels: Object.fromEntries(['qq', 'feishu', 'wecom', 'weixin'].map(type => [type, emptyChannel(type as ChannelType)])) } as unknown as Settings
}
const credentials = (type: ChannelType) => type === 'weixin' ? { token: 'fixture-token' } : type === 'wecom' ? { bot_id: 'fixture-bot', secret: 'fixture-secret' } : { app_id: 'fixture-app', app_secret: 'fixture-secret' }

it('migrates disabled legacy robots once without losing credentials or permissions', () => {
  const state = initial()
  state.channels.qq = { ...state.channels.qq, app_id: 'fixture-app', app_secret: 'fixture-secret', owner_user_id: 'fixture-owner', owner_permission_level: 'full' }
  const migrated = migrateChannelConfigurations(state)
  expect(migrated.channel_configurations!['legacy-qq']).toMatchObject({ name: 'QQ(1)', config: state.channels.qq })
  expect(migrateChannelConfigurations(migrated)).toBe(migrated)
  expect(state.channel_configurations).toBeUndefined()
})

for (const type of ['qq', 'feishu', 'wecom', 'weixin'] as ChannelType[]) {
  it(`${type}: independent drafts, exclusive activation, rename and deletion`, () => {
    let state = initial()
    const first = changeChannelConfiguration(state, type, 'add')
    state = { ...state, ...first.updates }
    state = { ...state, ...changeChannelConfiguration(state, type, 'save', first.id, { ...credentials(type), enabled: true }).updates }
    const second = changeChannelConfiguration(state, type, 'add')
    state = { ...state, ...second.updates }
    expect(state.channel_configurations![second.id].config).toEqual(emptyChannel(type))
    expect(state.active_channel_configurations![type]).toBe(first.id)
    expect(() => changeChannelConfiguration(state, type, 'activate', second.id)).toThrow('凭证')
    state = { ...state, ...changeChannelConfiguration(state, type, 'save', second.id, { ...credentials(type) }).updates }
    expect(state.active_channel_configurations![type]).toBe(first.id)
    state = { ...state, ...changeChannelConfiguration(state, type, 'activate', second.id).updates }
    expect(state.channel_configurations![first.id].config.enabled).toBe(false)
    expect(state.channel_configurations![second.id].config.enabled).toBe(true)
    state = { ...state, ...changeChannelConfiguration(state, type, 'rename', second.id, { name: '工作机器人' }).updates }
    expect(state.channel_configurations![second.id].name).toBe('工作机器人')
    const key = type === 'weixin' ? 'token' : type === 'wecom' ? 'secret' : 'app_secret'
    state = { ...state, ...changeChannelConfiguration(state, type, 'save', second.id, { [key]: '' }).updates }
    expect((state.channel_configurations![second.id].config as any)[key]).toBe(credentials(type)[key])
    const secrets = extractSecrets(state)
    expect(JSON.stringify(clearSecretsOnDisk(state))).not.toContain('fixture-secret')
    const restored = applySecrets(clearSecretsOnDisk(state), secrets)
    expect(restored.channel_configurations).toEqual(state.channel_configurations)
    const visible = JSON.stringify(publicChannelSettings(state))
    expect(visible).not.toContain('fixture-secret')
    expect(visible).not.toContain('fixture-token')
    state = { ...state, ...changeChannelConfiguration(state, type, 'delete', first.id).updates }
    expect(state.channels[type].enabled).toBe(true)
    state = { ...state, ...changeChannelConfiguration(state, type, 'delete', second.id).updates }
    expect(state.channels[type]).toEqual(emptyChannel(type))
    expect(Object.values(state.channel_configurations!)).toHaveLength(0)
    expect(state.active_channel_configurations![type]).toBeUndefined()
  })
}

it('rejects stale QR targets and cross-type edits, and defaults ownerless grants to QA', () => {
  let state = initial()
  const entry = changeChannelConfiguration(state, 'qq', 'add')
  state = { ...state, ...entry.updates }
  expect(() => changeChannelConfiguration(state, 'feishu', 'save', entry.id, credentials('feishu'))).toThrow('类型')
  expect(() => changeChannelConfiguration(state, 'qq', 'save', '__proto__', credentials('qq'))).toThrow('不存在')
  state = { ...state, ...changeChannelConfiguration(state, 'qq', 'save', entry.id, { ...credentials('qq'), owner_permission_level: 'full' }).updates }
  expect(state.channel_configurations![entry.id].config.owner_permission_level).toBe('qa_only')
  state = { ...state, ...changeChannelConfiguration(state, 'qq', 'delete', entry.id).updates }
  expect(() => changeChannelConfiguration(state, 'qq', 'save', entry.id, credentials('qq'))).toThrow('不存在')
})

it('serializes asynchronous mutations and recovers after a rejected operation', async () => {
  const queue = createChannelMutationQueue()
  const events: string[] = []
  let finish!: () => void
  const first = queue('settings', async () => { events.push('stop'); await new Promise<void>(resolve => { finish = resolve }); events.push('start') })
  const second = queue('settings', async () => { events.push('next'); throw new Error('fixture-failure') })
  const rejected = expect(second).rejects.toThrow('fixture-failure')
  const third = queue('settings', async () => events.push('recovered'))
  await new Promise(resolve => setImmediate(resolve))
  expect(events).toEqual(['stop'])
  finish()
  await first; await rejected; await third
  expect(events).toEqual(['stop', 'start', 'next', 'recovered'])
})
