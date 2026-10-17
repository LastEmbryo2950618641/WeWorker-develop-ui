// Pending credentials live only in memory until the backend encrypts and saves them.
export function appBotQrState(set, get) {
  return {
    appBotQrPending: {},
    appBotQrSaving: {},
    saveAppBotQr: async (channel, credentials = get().appBotQrPending[channel]) => {
      if (!['qq', 'feishu'].includes(channel)) throw new Error('不支持的机器人类型')
      if (get().appBotQrSaving[channel]) throw new Error('机器人配置正在保存，请稍候')
      if (!credentials?.app_id || !credentials?.app_secret) throw new Error('未获取完整机器人配置')
      const pending = { app_id: credentials.app_id, app_secret: credentials.app_secret }
      set(state => ({ appBotQrPending: { ...state.appBotQrPending, [channel]: pending }, appBotQrSaving: { ...state.appBotQrSaving, [channel]: true } }))
      try {
        const isNewBot = get().channels?.[channel]?.app_id !== pending.app_id
        await get().saveChannels({ [channel]: { ...pending, enabled: true, ...(isNewBot ? { owner_user_id: '', owner_permission_level: 'qa_only' } : {}) } })
        set(state => ({ appBotQrPending: { ...state.appBotQrPending, [channel]: null } }))
      } catch {
        throw new Error('扫码已完成，但配置保存失败。请点击“重试保存”，无需重新扫码。')
      } finally {
        set(state => ({ appBotQrSaving: { ...state.appBotQrSaving, [channel]: false } }))
      }
    },
  }
}
