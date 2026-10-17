import React, { useMemo, useState } from 'react'
import { CheckCircleFilled, KeyOutlined, LoadingOutlined } from '@ant-design/icons'
import AppDropdownSelect from '../common/AppDropdownSelect.jsx'
import { isBuiltinProvider, PROVIDERS, useSettingsStore } from '../../store/settings.js'
import { isFixedProvider } from '../../utils/model-selection.js'
import './initial-setup.css'

const INITIAL_PROVIDER_IDS = new Set(['builtin', 'builtin_dev', 'anthropic', 'glm', 'deepseek'])

function providerOptions() {
  return PROVIDERS
    .filter(provider => INITIAL_PROVIDER_IDS.has(provider.id) && (isBuiltinProvider(provider.id) || isFixedProvider(provider.id)))
    .map(provider => ({
      value: provider.id,
      label: provider.name,
      description: provider.models?.length ? provider.models.join('、') : '',
    }))
}

export default function InitialSetup() {
  const providers = useSettingsStore(state => state.providers)
  const saveProvider = useSettingsStore(state => state.saveProvider)
  const completeOnboarding = useSettingsStore(state => state.completeOnboarding)
  const options = useMemo(providerOptions, [])
  const [provider, setProvider] = useState(() => options.find(option => option.value === 'builtin')?.value || options[0]?.value || '')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState('')

  const selectedIsBuiltin = isBuiltinProvider(provider)
  const selectedProvider = PROVIDERS.find(item => item.id === provider)
  const hasSavedKey = Boolean(providers[provider]?.has_key)
  const canContinue = selectedIsBuiltin || hasSavedKey

  const handleProviderChange = value => {
    setProvider(value)
    setApiKey('')
    setError('')
  }

  const handleSave = async event => {
    event.preventDefault()
    const key = apiKey.trim()
    if (!key) {
      setError('请先填写 API Key')
      return
    }
    setSaving(true)
    setError('')
    try {
      await saveProvider(provider, { api_key: key })
      setApiKey('')
    } catch (failure) {
      setError(failure.message || 'API Key 保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleContinue = async () => {
    if (!canContinue) {
      setError('请填写并保存 API Key 后继续')
      return
    }
    setCompleting(true)
    setError('')
    try {
      await completeOnboarding(provider)
    } catch (failure) {
      setError(failure.message || '初始化失败')
      setCompleting(false)
    }
  }

  return (
    <main className="initial-setup" aria-label="初始化模型配置">
      <section className="initial-setup__card">
        <div className="initial-setup__brand" aria-hidden="true">W</div>
        <h1>欢迎使用 WeWorker</h1>
        <p className="initial-setup__intro">先选择一个模型配置，完成后即可开始使用。</p>

        <div className="initial-setup__field">
          <label htmlFor="initial-model-provider">模型配置</label>
          <AppDropdownSelect
            className="initial-setup__select"
            menuClassName="app-dropdown-menu initial-setup__menu"
            value={provider}
            options={options}
            onChange={handleProviderChange}
            ariaLabel="选择模型配置"
            matchAnchorWidth
            minMenuWidth={320}
          />
        </div>

        {!selectedIsBuiltin && (
          <form className="initial-setup__key-form" onSubmit={handleSave}>
            <label htmlFor="initial-api-key">API Key</label>
            <div className="initial-setup__key-row">
              <div className="initial-setup__input-wrap">
                <KeyOutlined aria-hidden="true" />
                <input
                  id="initial-api-key"
                  type="password"
                  value={apiKey}
                  onChange={event => { setApiKey(event.target.value); setError('') }}
                  placeholder={`填写 ${selectedProvider?.name || '供应商'} API Key`}
                  autoComplete="off"
                  disabled={saving || completing}
                />
              </div>
              <button type="submit" className="initial-setup__save" disabled={saving || completing || !apiKey.trim()}>
                {saving ? <LoadingOutlined spin /> : hasSavedKey ? '重新保存' : '保存'}
              </button>
            </div>
            <div className={`initial-setup__key-status${hasSavedKey ? ' is-ready' : ''}`}>
              {hasSavedKey ? <><CheckCircleFilled /> API Key 已保存</> : '保存 API Key 后才能继续'}
            </div>
          </form>
        )}

        {error && <div className="initial-setup__error" role="alert">{error}</div>}
        <button type="button" className="initial-setup__continue" onClick={handleContinue} disabled={completing || !canContinue}>
          {completing ? <><LoadingOutlined spin /> 正在进入</> : '下一步'}
        </button>
      </section>
    </main>
  )
}
