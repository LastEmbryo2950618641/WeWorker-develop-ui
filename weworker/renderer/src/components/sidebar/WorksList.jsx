import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useWorksStore } from '../../store/works.js'
import { useToolPackagePageStore } from '../../store/tool-package-page.js'
import { useExplorationPageStore } from '../../store/exploration-page.js'
import { leaveWebsiteExploration } from '../../store/website-exploration.js'

const LABEL_COLORS = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#339CFF',
  purple: '#a855f7',
}

const LABEL_OPTIONS = [
  { value: 'red', label: '红色' },
  { value: 'orange', label: '橙色' },
  { value: 'yellow', label: '黄色' },
  { value: 'green', label: '绿色' },
  { value: 'blue', label: '蓝色' },
  { value: 'purple', label: '紫色' },
]

export { LABEL_COLORS, LABEL_OPTIONS }

export default function WorksList({ searchQuery = '' }) {
  const works = useWorksStore((s) => Array.isArray(s.works) ? s.works : [])
  const activeWorkId = useWorksStore((s) => s.activeWorkId)
  const selectWork = useWorksStore((s) => s.selectWork)
  const deleteWork = useWorksStore((s) => s.deleteWork)
  const labelFilter = useWorksStore((s) => s.labelFilter)
  const closeToolPackagePage = useToolPackagePageStore((s) => s.closePage)
  const closeExplorationPage = useExplorationPageStore((s) => s.closePage)

  const filtered = works.filter((w) => {
    if (labelFilter && w.label !== labelFilter) return false
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      const title = (w.title || '').toLowerCase()
      const shortId = w.id.slice(0, 8).toLowerCase()
      return title.includes(q) || shortId.includes(q)
    }
    return true
  })

  if (!works.length) {
    return (
      <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: 12 }}>
        No works yet. Click + to start.
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: 12 }}>
        未找到匹配的任务
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 0' }}>
      {filtered.map((w) => (
        <WorkItem
          key={w.id}
          work={w}
          active={w.id === activeWorkId}
          onSelect={async () => {
            if (!await leaveWebsiteExploration()) return
            closeToolPackagePage()
            closeExplorationPage()
            selectWork(w.id)
          }}
          onDelete={() => deleteWork(w.id)}
        />
      ))}
    </div>
  )
}

function WorkItem({ work, active, onSelect, onDelete }) {
  const [hovered, setHovered] = useState(false)
  const [menuPos, setMenuPos] = useState(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [isSavingRename, setIsSavingRename] = useState(false)
  const updateLabel = useWorksStore((s) => s.updateLabel)
  const updateTitle = useWorksStore((s) => s.updateTitle)
  const menuRef = useRef(null)
  const renameInputRef = useRef(null)
  const skipRenameCommitRef = useRef(false)

  const handleContextMenu = useCallback((e) => {
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
  }, [])

  useEffect(() => {
    if (!menuPos) return
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuPos(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuPos])

  useEffect(() => {
    if (!isRenaming || !renameInputRef.current) return
    renameInputRef.current.focus()
    renameInputRef.current.select()
  }, [isRenaming])

  const startRename = useCallback(() => {
    skipRenameCommitRef.current = false
    setRenameValue(work.title || '')
    setIsRenaming(true)
    setMenuPos(null)
  }, [work.title])

  const cancelRename = useCallback((skipBlurCommit = false) => {
    skipRenameCommitRef.current = skipBlurCommit
    setIsRenaming(false)
    setRenameValue('')
  }, [])

  const commitRename = useCallback(async () => {
    if (skipRenameCommitRef.current) {
      skipRenameCommitRef.current = false
      return
    }
    if (isSavingRename) return
    const nextTitle = renameValue.trim()
    if (!nextTitle || nextTitle === work.title) {
      cancelRename()
      return
    }
    try {
      setIsSavingRename(true)
      await updateTitle(work.id, nextTitle)
      cancelRename()
    } catch (e) {
      console.error('[works] rename failed:', e)
      window.alert('重命名失败，请稍后重试')
    } finally {
      setIsSavingRename(false)
    }
  }, [cancelRename, isSavingRename, renameValue, updateTitle, work.id, work.title])

  return (
    <>
      <div
        className={`work-list-item${active ? ' is-active' : ''}`}
        role="button"
        tabIndex={isRenaming ? -1 : 0}
        onClick={() => { if (!isRenaming) onSelect() }}
        onKeyDown={(e) => {
          if (isRenaming) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect()
          }
        }}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: '7px 12px',
          cursor: isRenaming ? 'default' : 'pointer',
          background: active ? 'var(--bg-active)' : hovered ? 'var(--bg-hover)' : 'transparent',
          borderRadius: 6,
          margin: '1px 6px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          transition: 'background 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease, color 0.16s ease',
        }}
      >
        {work.label && (
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: LABEL_COLORS[work.label] || 'transparent',
          }} />
        )}
        <span style={{
          fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}>
          {isRenaming ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              disabled={isSavingRename}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitRename()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelRename(true)
                }
                e.stopPropagation()
              }}
              onBlur={commitRename}
              style={{
                width: '100%',
                minWidth: 0,
                fontSize: 12,
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '1px 4px',
                outline: 'none',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
              }}
            />
          ) : (
            work.title || '新任务'
          )}
        </span>
        {!isRenaming && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              flexShrink: 0,
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? 'auto' : 'none',
              transition: 'opacity 0.1s',
            }}
          >
            <button
              type="button"
              title="重命名"
              aria-label={`重命名 ${work.title || '新任务'}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); startRename() }}
              style={workActionButtonStyle}
            >
              <RenameIcon size={13} />
            </button>
            <button
              type="button"
              title="删除"
              aria-label={`删除 ${work.title || '新任务'}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              style={{ ...workActionButtonStyle, fontSize: 12 }}
            >
              ✕
            </button>
          </span>
        )}
      </div>

      {menuPos && (
        <WorkContextMenu
          ref={menuRef}
          x={menuPos.x}
          y={menuPos.y}
          currentLabel={work.label}
          onRename={startRename}
          onSelect={(label) => {
            updateLabel(work.id, label)
            setMenuPos(null)
          }}
          onClose={() => setMenuPos(null)}
        />
      )}
    </>
  )
}

const WorkContextMenu = React.forwardRef(({ x, y, currentLabel, onRename, onSelect, onClose }, ref) => {
  const labelNames = useWorksStore((s) => s.labelNames)
  const saveLabelName = useWorksStore((s) => s.saveLabelName)
  const [editingColor, setEditingColor] = useState(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editingColor && inputRef.current) inputRef.current.focus()
  }, [editingColor])

  return (
    <div
      ref={ref}
      className="work-context-menu motion-popover-enter"
      style={{
        position: 'fixed', left: x, top: y, zIndex: 9999,
        background: 'var(--bg-primary, #fff)', border: '1px solid var(--border, #e5e7eb)',
        borderRadius: 8, padding: '6px 0', minWidth: 160,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      }}
    >
      <button
        onClick={() => {
          onRename()
          onClose()
        }}
        style={{
          display: 'block', width: '100%', textAlign: 'left',
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '5px 12px', fontSize: 12, color: 'var(--text-secondary)',
        }}
        onMouseEnter={(e) => e.target.style.background = 'var(--bg-hover, #f3f4f6)'}
        onMouseLeave={(e) => e.target.style.background = 'none'}
      >
        重命名
      </button>
      <div style={{ borderTop: '1px solid var(--border, #e5e7eb)', margin: '4px 0' }} />
      <div style={{ padding: '4px 12px 6px', fontSize: 11, color: 'var(--text-muted)' }}>
        标记颜色
      </div>
      {LABEL_OPTIONS.map((opt) => {
        const isEditing = editingColor === opt.value
        const customName = labelNames[opt.value]
        return (
          <div
            key={opt.value}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 12px', cursor: 'pointer',
              background: currentLabel === opt.value ? 'var(--bg-hover, #f3f4f6)' : 'transparent',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover, #f3f4f6)'}
            onMouseLeave={(e) => e.currentTarget.style.background = currentLabel === opt.value ? 'var(--bg-hover, #f3f4f6)' : 'transparent'}
            onClick={() => {
              if (!isEditing) onSelect(currentLabel === opt.value ? null : opt.value)
            }}
          >
            <span style={{
              width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
              background: LABEL_COLORS[opt.value],
              outline: currentLabel === opt.value ? '2px solid var(--text-primary, #333)' : 'none',
              outlineOffset: 1,
            }} />
            {isEditing ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    saveLabelName(opt.value, editValue)
                    setEditingColor(null)
                  }
                  if (e.key === 'Escape') setEditingColor(null)
                  e.stopPropagation()
                }}
                onBlur={() => {
                  saveLabelName(opt.value, editValue)
                  setEditingColor(null)
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder={opt.label}
                style={{
                  flex: 1, fontSize: 12, border: '1px solid var(--border)',
                  borderRadius: 4, padding: '1px 4px', outline: 'none',
                  background: 'var(--bg-primary)', color: 'var(--text-primary)',
                  fontFamily: 'inherit', minWidth: 0,
                }}
              />
            ) : (
              <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>
                {customName || opt.label}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setEditingColor(opt.value)
                setEditValue(customName || '')
              }}
              title="重命名"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: 10, padding: '0 2px',
                opacity: 0.5, flexShrink: 0,
              }}
              onMouseEnter={(e) => e.target.style.opacity = '1'}
              onMouseLeave={(e) => e.target.style.opacity = '0.5'}
            >
              ✎
            </button>
          </div>
        )
      })}
      {currentLabel && (
        <>
          <div style={{ borderTop: '1px solid var(--border, #e5e7eb)', margin: '4px 0' }} />
          <button
            onClick={() => onSelect(null)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '5px 12px', fontSize: 12, color: 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => e.target.style.background = 'var(--bg-hover, #f3f4f6)'}
            onMouseLeave={(e) => e.target.style.background = 'none'}
          >
            清除标记
          </button>
        </>
      )}
    </div>
  )
})

function RenameIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

const workActionButtonStyle = {
  width: 18,
  height: 18,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
  lineHeight: 1,
  WebkitAppRegion: 'no-drag',
}
