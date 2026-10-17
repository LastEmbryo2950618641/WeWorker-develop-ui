import React, { useState } from 'react'
import { CloseOutlined, PlusOutlined } from '@ant-design/icons'
import './skill-tags.css'

export default function SkillTags({ tags, onChange }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const save = () => {
    const name = draft.trim()
    if (!name) { setAdding(false); return }
    if (onChange([...tags, name]) !== false) { setDraft(''); setAdding(false) }
  }
  return <div className="skill-tags" aria-label="Skill 标签">
    {tags.map(tag => <span className="skill-tag" key={tag}>{tag}<button type="button" aria-label={`移除标签 ${tag}`} title="移除标签" onClick={() => onChange(tags.filter(item => item !== tag))}><CloseOutlined /></button></span>)}
    {adding ? <input autoFocus aria-label="新标签" placeholder="标签名称" maxLength={40} value={draft} onChange={event => setDraft(event.target.value)} onBlur={save}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur() }
        if (event.key === 'Escape') { event.preventDefault(); setDraft(''); setAdding(false) }
      }} /> : <button type="button" className="skill-tag-add" aria-label="添加标签" onClick={() => setAdding(true)}><PlusOutlined aria-hidden="true" />添加标签</button>}
  </div>
}
