import React, { useRef, useState } from 'react'
import { EditOutlined } from '@ant-design/icons'

export default function ModelConfigurationName({ name, readOnly, disabled, onSave }) {
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const committing = useRef(false)
  const cancelled = useRef(false)
  const save = async () => {
    if (draft === null || committing.current || cancelled.current) return
    const value = draft.trim()
    if (!value || value.length > 80) { setError('配置名称请输入 1 到 80 个字符'); return }
    if (value === name) { setDraft(null); setError(''); return }
    committing.current = true
    setSaving(true)
    setError('')
    try { await onSave(value); setDraft(null) }
    catch (error) { setError(error.message || '重命名失败，请重试') }
    finally { committing.current = false; setSaving(false) }
  }
  if (readOnly) return <span className="model-settings-detail-name" title={name}>{name}</span>
  return <span className="model-config-name">
    {draft === null ? <button type="button" className="model-config-name__edit" aria-label="修改模型配置名称" title="修改配置名称" disabled={disabled}
      onClick={() => { cancelled.current = false; setError(''); setDraft(name) }}>
      <span>{name}</span><EditOutlined aria-hidden="true" />
    </button> : <input autoFocus className="model-config-name__input" aria-label="编辑模型配置名称" aria-invalid={!!error} maxLength={80}
      value={draft} disabled={saving} onFocus={event => event.target.select()} onChange={event => { setDraft(event.target.value); setError('') }} onBlur={save}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void save() }
        if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; setDraft(null); setError('') }
      }} />}
    {error && <span className="model-config-name__error" role="alert">{error}</span>}
  </span>
}
