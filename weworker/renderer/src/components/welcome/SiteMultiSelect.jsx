import { DropdownMenuCheck } from '../common/AppDropdownSelect.jsx'
import React, { useMemo, useRef, useState } from 'react'
import {
  DROPDOWN_MENU_LIST_CLASS,
  dropdownMenuCheckItemClassName,
} from '../common/dropdown-menu-styles.js'
import { DropdownMenuPortal, useDropdownDismiss } from '../common/DropdownMenuPortal.jsx'

function summarizeSelection(sites, selectedIds) {
  const selected = sites.filter((site) => selectedIds.includes(site.id))
  if (selected.length === 0) return '选择站点'
  if (selected.length === 1) return selected[0].name
  return `${selected[0].name} 等 ${selected.length} 个站点`
}

export default function SiteMultiSelect({ sites, selectedIds, onToggle, disabled = false, fullWidth = false }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  const label = useMemo(
    () => summarizeSelection(sites, selectedIds),
    [sites, selectedIds],
  )

  const closeMenu = () => setOpen(false)
  useDropdownDismiss(open, closeMenu, triggerRef, menuRef)

  const toggleOpen = () => {
    if (disabled || sites.length === 0) return
    setOpen((current) => !current)
  }

  return (
    <div style={{ ...rootStyle, ...(fullWidth ? fullWidthRootStyle : null) }}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || sites.length === 0}
        onClick={toggleOpen}
        style={{
          ...triggerStyle,
          ...(fullWidth ? fullWidthTriggerStyle : null),
          display: 'flex',
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={triggerLabelStyle}>{label}</span>
        <span style={triggerCaretStyle} aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      <DropdownMenuPortal
        ref={menuRef}
        open={open}
        anchorRef={triggerRef}
        minWidth={fullWidth ? 0 : 180}
        matchAnchorWidth={fullWidth}
      >
        <div role="listbox" aria-label="站点多选" className={`${DROPDOWN_MENU_LIST_CLASS} scrollbar-hover-only`}>
          {sites.map((site) => {
            const checked = selectedIds.includes(site.id)
            const onlyOne = checked && selectedIds.length <= 1
            return (
              <button
                key={site.id}
                type="button"
                role="option"
                aria-selected={checked}
                disabled={onlyOne}
                onClick={() => onToggle(site.id)}
                className={dropdownMenuCheckItemClassName({ selected: checked })}
              >
                <span style={optionTextStyle}>{site.name}</span>
                <DropdownMenuCheck selected={checked} />
              </button>
            )
          })}
        </div>
      </DropdownMenuPortal>
    </div>
  )
}

const rootStyle = {
  position: 'relative',
  minWidth: 180,
}

const fullWidthRootStyle = {
  width: '100%',
  minWidth: 0,
  maxWidth: 'none',
  alignSelf: 'stretch',
  flexShrink: 0,
}

const triggerStyle = {
  width: '100%',
  minWidth: 180,
  maxWidth: 320,
  height: 30,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  padding: '0 10px',
  fontFamily: 'inherit',
  fontSize: 13,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  cursor: 'pointer',
  boxSizing: 'border-box',
}

const fullWidthTriggerStyle = {
  width: '100%',
  minWidth: '100%',
  maxWidth: 'none',
}

const triggerLabelStyle = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left',
}

const triggerCaretStyle = {
  flexShrink: 0,
  color: 'var(--text-muted)',
  fontSize: 11,
}

const optionTextStyle = {
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  lineHeight: 1.35,
  color: 'var(--text-primary)',
  textAlign: 'left',
}
