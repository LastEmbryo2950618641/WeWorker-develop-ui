import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  buildSkillSlashMenuItems,
  filterSkillSlashMenuItems,
  findSkillSlashTrigger,
} from './custom-skill-builtins.js'
import { useFitTextareaHeight } from './use-fit-textarea-height.js'
import {
  CODE_EDITOR_FONT_SIZE,
  CODE_EDITOR_LINE_HEIGHT,
  codeEditorFitHeight,
  codeEditorLineNumberRowStyle,
  countEditorLines,
} from './code-editor-metrics.js'
import { getTextareaCaretRect } from './textarea-caret-rect.js'

const SLASH_MENU_MAX_HEIGHT = 280
const SLASH_MENU_GAP = 6
const SLASH_MENU_INSET_X = 10
const SLASH_MENU_SHELL_PADDING = 6
const SLASH_MENU_SCROLL_MAX_HEIGHT = SLASH_MENU_MAX_HEIGHT - SLASH_MENU_SHELL_PADDING * 2

function countLines(value) {
  return countEditorLines(value)
}

function buildSlashMenuPlacement(textarea, caretPosition) {
  const caret = getTextareaCaretRect(textarea, caretPosition)
  if (!caret) return null

  const textareaRect = textarea.getBoundingClientRect()
  const topBelow = caret.bottom + SLASH_MENU_GAP
  const fitsBelow = topBelow + SLASH_MENU_MAX_HEIGHT <= window.innerHeight - 8
  const top = fitsBelow
    ? topBelow
    : Math.max(8, caret.top - SLASH_MENU_MAX_HEIGHT - SLASH_MENU_GAP)

  return {
    left: textareaRect.left + SLASH_MENU_INSET_X,
    width: Math.max(0, textareaRect.width - SLASH_MENU_INSET_X * 2),
    top,
  }
}

export default function SkillMarkdownCodeTextarea({
  value,
  onChange,
  minHeight = 96,
  readOnly = false,
  maxHeight,
  fitContent = false,
  site,
  tool,
  officialTools = [],
  systemTools = [],
}) {
  const textareaRef = useRef(null)
  const lineNumbersRef = useRef(null)
  const menuPanelRef = useRef(null)
  const selectionRef = useRef(null)
  const [menuState, setMenuState] = useState(null)
  const [menuPlacement, setMenuPlacement] = useState(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const allItems = useMemo(
    () => buildSkillSlashMenuItems({ site, tool, officialTools, systemTools }),
    [site, tool, officialTools, systemTools],
  )

  const visibleItems = useMemo(() => {
    if (!menuState) return []
    return filterSkillSlashMenuItems(allItems, menuState.query)
  }, [allItems, menuState])

  const groupedItems = useMemo(() => {
    const groups = []
    for (const item of visibleItems) {
      const last = groups[groups.length - 1]
      if (last && last.label === item.groupLabel) {
        last.items.push(item)
      } else {
        groups.push({ label: item.groupLabel, items: [item] })
      }
    }
    return groups
  }, [visibleItems])

  const flatItems = useMemo(
    () => groupedItems.flatMap((group) => group.items),
    [groupedItems],
  )

  const syncMenuPlacement = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea || !menuState) {
      setMenuPlacement(null)
      return
    }
    setMenuPlacement(buildSlashMenuPlacement(textarea, menuState.end))
  }, [menuState])

  useEffect(() => {
    if (!menuState) return undefined
    setActiveIndex((current) => {
      if (flatItems.length === 0) return 0
      return Math.min(current, flatItems.length - 1)
    })
  }, [flatItems.length, menuState])

  useEffect(() => {
    if (!menuState || !menuPanelRef.current) return
    const active = menuPanelRef.current.querySelector('.skill-slash-menu-item.is-active')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, menuState])

  useLayoutEffect(() => {
    if (!menuState) {
      setMenuPlacement(null)
      return undefined
    }
    syncMenuPlacement()
    window.addEventListener('resize', syncMenuPlacement)
    window.addEventListener('scroll', syncMenuPlacement, true)
    return () => {
      window.removeEventListener('resize', syncMenuPlacement)
      window.removeEventListener('scroll', syncMenuPlacement, true)
    }
  }, [menuState, value, syncMenuPlacement])

  const syncMenuFromText = (text, cursor) => {
    const trigger = findSkillSlashTrigger(text, cursor)
    if (!trigger) {
      setMenuState(null)
      return
    }
    setMenuState(trigger)
    setActiveIndex(0)
  }

  const rememberSelection = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea || readOnly) return
    selectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
      direction: textarea.selectionDirection,
      scrollTop: textarea.scrollTop,
      scrollLeft: textarea.scrollLeft,
    }
  }, [readOnly])

  const syncMenuFromTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea || readOnly) {
      setMenuState(null)
      return
    }
    rememberSelection()
    syncMenuFromText(textarea.value, textarea.selectionStart)
  }, [readOnly, rememberSelection])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    const selection = selectionRef.current
    if (!textarea || !selection || document.activeElement !== textarea) return

    const start = Math.min(selection.start, value.length)
    const end = Math.min(selection.end, value.length)
    textarea.setSelectionRange(start, end, selection.direction || 'none')
    textarea.scrollTop = selection.scrollTop
    textarea.scrollLeft = selection.scrollLeft
  }, [value])

  const applyItem = (item) => {
    const textarea = textareaRef.current
    if (!textarea || !menuState || !item) return
    const nextValue = `${textarea.value.slice(0, menuState.start)}${item.insert}${textarea.value.slice(menuState.end)}`
    const nextCursor = menuState.start + item.insert.length
    onChange(nextValue)
    setMenuState(null)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(nextCursor, nextCursor)
    })
  }

  const handleChange = (event) => {
    const { value: nextValue, selectionStart } = event.target
    rememberSelection()
    onChange(nextValue)
    syncMenuFromText(nextValue, selectionStart)
  }

  const handleKeyDown = (event) => {
    if (!menuState || flatItems.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % flatItems.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + flatItems.length) % flatItems.length)
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      applyItem(flatItems[activeIndex])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setMenuState(null)
    }
  }

  const lines = countLines(value)
  const fitHeight = codeEditorFitHeight(lines, minHeight)
  const boxHeight = useFitTextareaHeight(textareaRef, value, {
    fitContent,
    minHeight,
    estimatedHeight: fitContent ? fitHeight : (maxHeight ?? minHeight),
  })
  const resolvedHeight = fitContent ? boxHeight : (maxHeight ?? minHeight)

  const syncLineNumbersScroll = (event) => {
    if (fitContent || !lineNumbersRef.current) return
    lineNumbersRef.current.scrollTop = event.target.scrollTop
    if (menuState) syncMenuPlacement()
  }

  const renderSlashMenu = () => {
    if (!menuState || !menuPlacement || typeof document === 'undefined') return null

    const panelStyle = {
      ...floatingMenuPanelStyle,
      position: 'fixed',
      top: menuPlacement.top,
      left: menuPlacement.left,
      width: menuPlacement.width,
      maxHeight: SLASH_MENU_MAX_HEIGHT,
    }

    if (flatItems.length === 0) {
      return createPortal(
        <div
          ref={menuPanelRef}
          className="skill-slash-menu skill-slash-menu--empty"
          style={{ ...panelStyle, ...menuEmptyStyle }}
        >
          没有匹配的插入项
        </div>,
        document.body,
      )
    }

    return createPortal(
      <div
        className="skill-slash-menu"
        style={panelStyle}
      >
        <div
          ref={menuPanelRef}
          className="skill-slash-menu-scroll scrollbar-hover-only"
          style={menuScrollStyle}
          role="listbox"
          aria-label="Skill 插入菜单"
        >
          {groupedItems.map((group) => (
            <div key={group.label} style={menuGroupStyle}>
              <div className="skill-slash-menu-group-title">{group.label}</div>
              <div style={menuItemsListStyle}>
                {group.items.map((item) => {
                  const index = flatItems.indexOf(item)
                  const active = index === activeIndex
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`skill-slash-menu-item${active ? ' is-active' : ''}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => applyItem(item)}
                      style={menuItemStyle}
                    >
                      <span style={menuItemIconStyle} aria-hidden="true">
                        {item.group === 'tool' || item.group === 'system' ? '⌘' : '{}'}
                      </span>
                      <span style={menuItemBodyStyle}>
                        <span style={menuItemTitleStyle}>{item.menuTitle || item.title}</span>
                        {(item.menuHint || item.description) && (
                          <span style={menuItemHintStyle}>{item.menuHint || item.description}</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>,
      document.body,
    )
  }

  return (
    <div style={{
      ...shellStyle,
      minHeight: resolvedHeight,
      ...(fitContent ? { flexShrink: 0 } : { height: resolvedHeight, maxHeight: resolvedHeight }),
    }}>
      <div style={{
        ...editorShellStyle,
        minHeight: resolvedHeight,
        ...(fitContent ? { height: resolvedHeight, flexShrink: 0 } : { maxHeight: resolvedHeight }),
      }}>
        <div ref={lineNumbersRef} style={{
          ...(fitContent ? lineNumbersStyle : lineNumbersScrollStyle),
          ...(fitContent ? { minHeight: resolvedHeight, height: resolvedHeight } : null),
        }}>
          {Array.from({ length: lines }, (_, index) => (
            <span key={index} style={codeEditorLineNumberRowStyle()}>{index + 1}</span>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          className="code-editor-textarea-scroll scrollbar-hover-only"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onClick={syncMenuFromTextarea}
          onKeyUp={syncMenuFromTextarea}
          onSelect={rememberSelection}
          onScroll={syncLineNumbersScroll}
          readOnly={readOnly}
          style={{
            ...textareaStyle,
            minHeight: fitContent ? minHeight : resolvedHeight,
            height: resolvedHeight,
            overflowY: fitContent ? 'hidden' : 'auto',
            overflowX: 'auto',
            whiteSpace: 'pre',
            resize: 'none',
          }}
        />
      </div>
      {renderSlashMenu()}
    </div>
  )
}

const shellStyle = {
  width: '100%',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
}

const editorShellStyle = {
  width: '100%',
  minWidth: 0,
  display: 'grid',
  gridTemplateColumns: '38px minmax(0, 1fr)',
  boxSizing: 'border-box',
  background: 'var(--bg-primary)',
  overflow: 'hidden',
  flexShrink: 0,
}

const lineNumbersStyle = {
  display: 'grid',
  alignContent: 'start',
  gap: 0,
  borderRight: '1px solid var(--border)',
  background: 'color-mix(in srgb, var(--bg-secondary) 70%, var(--bg-primary))',
  color: 'var(--text-muted)',
  padding: '9px 8px',
  boxSizing: 'border-box',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: CODE_EDITOR_FONT_SIZE,
  lineHeight: CODE_EDITOR_LINE_HEIGHT,
  textAlign: 'right',
  userSelect: 'none',
}

const lineNumbersScrollStyle = {
  ...lineNumbersStyle,
  overflow: 'hidden',
}

const textareaStyle = {
  width: '100%',
  minWidth: 0,
  resize: 'none',
  boxSizing: 'border-box',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: 'var(--text-primary)',
  padding: '9px 10px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: CODE_EDITOR_FONT_SIZE,
  lineHeight: CODE_EDITOR_LINE_HEIGHT,
}

const floatingMenuPanelStyle = {
  zIndex: 1300,
  overflow: 'hidden',
  overscrollBehavior: 'contain',
  boxSizing: 'border-box',
  border: '1px solid var(--border)',
  borderRadius: 12,
  background: 'var(--bg-secondary)',
  boxShadow: 'none',
  padding: SLASH_MENU_SHELL_PADDING,
}

const menuScrollStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: SLASH_MENU_SCROLL_MAX_HEIGHT,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  minWidth: 0,
}

const menuGroupStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
}

const menuItemsListStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  width: '100%',
  minWidth: 0,
}

const menuItemStyle = {
  width: '100%',
  minWidth: 0,
  minHeight: 0,
  color: 'var(--text-primary)',
  textAlign: 'left',
  padding: '7px 10px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  boxSizing: 'border-box',
}

const menuItemIconStyle = {
  width: 18,
  flexShrink: 0,
  color: 'var(--text-muted)',
  fontSize: 12,
  lineHeight: 1,
  textAlign: 'center',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}

const menuItemBodyStyle = {
  minWidth: 0,
  flex: 1,
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  overflow: 'hidden',
}

const menuItemTitleStyle = {
  flexShrink: 0,
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.35,
  color: 'var(--text-primary)',
}

const menuItemHintStyle = {
  minWidth: 0,
  flex: 1,
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 1.35,
  color: 'var(--text-secondary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const menuEmptyStyle = {
  padding: '10px 12px',
  fontSize: 12,
  color: 'var(--text-muted)',
}
