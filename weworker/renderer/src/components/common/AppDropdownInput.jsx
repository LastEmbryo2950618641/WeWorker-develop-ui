import React, { useRef, useState } from 'react'
import { DownOutlined } from '@ant-design/icons'
import { DropdownMenuCheck } from './AppDropdownSelect.jsx'
import { DropdownMenuPortal, useDropdownDismiss } from './DropdownMenuPortal.jsx'
import { dropdownMenuItemClassName } from './dropdown-menu-styles.js'

// Editable presets share the same menu as fixed-choice selectors.
export default function AppDropdownInput({ options, value, onChange, ariaLabel, className = '', ...inputProps }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const inputRef = useRef(null)
  const menuRef = useRef(null)
  useDropdownDismiss(open, () => setOpen(false), anchorRef, menuRef)
  return (
    <div ref={anchorRef} className="app-dropdown-input">
      <input {...inputProps} ref={inputRef} className={className} value={value} onChange={onChange}
        aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
        onFocus={() => setOpen(true)} onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) }
          if (event.key === 'Tab') setOpen(false)
          if (event.key === 'ArrowDown') {
            event.preventDefault(); setOpen(true)
            requestAnimationFrame(() => menuRef.current?.querySelector('[role="option"]')?.focus())
          }
        }} />
      <button type="button" disabled={inputProps.disabled} aria-label={`选择${ariaLabel}`} aria-expanded={open}
        onMouseDown={event => event.preventDefault()} onClick={() => setOpen(current => !current)}>
        <DownOutlined aria-hidden="true" />
      </button>
      <DropdownMenuPortal ref={menuRef} open={open && !inputProps.disabled} anchorRef={anchorRef} minWidth={160} matchAnchorWidth>
        <div role="listbox" aria-label={`${ariaLabel}候选`} onKeyDown={event => {
          if (event.key === 'Escape' || event.key === 'Tab') {
            event.preventDefault(); event.stopPropagation(); inputRef.current?.focus(); setOpen(false)
          }
          if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            const items = [...event.currentTarget.querySelectorAll('[role="option"]')]
            const index = items.indexOf(document.activeElement)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
            items[next]?.focus()
          }
        }}>
          {options.map(option => <button key={option.value} type="button" role="option"
            aria-selected={String(value).toLowerCase() === String(option.value).toLowerCase()}
            className={dropdownMenuItemClassName({ selected: String(value).toLowerCase() === String(option.value).toLowerCase() })}
            onMouseDown={event => event.preventDefault()}
            onClick={() => { onChange({ target: { value: option.value } }); inputRef.current?.focus(); setOpen(false) }}>
            <span className="app-dropdown-menu-item__label">{option.label}</span>
            <DropdownMenuCheck selected={String(value).toLowerCase() === String(option.value).toLowerCase()} />
          </button>)}
        </div>
      </DropdownMenuPortal>
    </div>
  )
}
