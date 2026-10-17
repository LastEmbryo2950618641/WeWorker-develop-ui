import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DROPDOWN_MENU_CLASS } from './dropdown-menu-styles.js'

export const DropdownMenuPortal = forwardRef(function DropdownMenuPortal({
  open,
  anchorRef,
  children,
  minWidth = 0,
  matchAnchorWidth = false,
  align = 'start',
  offsetY = 4,
  placement = 'bottom',
  zIndex = 1200,
  className = DROPDOWN_MENU_CLASS,
  style,
}, ref) {
  const menuRef = useRef(null)
  const [position, setPosition] = useState(null)
  const [rendered, setRendered] = useState(open)
  const [closing, setClosing] = useState(false)

  useImperativeHandle(ref, () => menuRef.current)

  useLayoutEffect(() => {
    if (open) {
      setRendered(true)
      setClosing(false)
      return undefined
    }

    if (!rendered) return undefined
    setClosing(true)
    const timer = window.setTimeout(() => {
      setRendered(false)
      setPosition(null)
      setClosing(false)
    }, 140)
    return () => window.clearTimeout(timer)
  }, [open, rendered])

  useLayoutEffect(() => {
    if (!rendered) {
      setPosition(null)
      return undefined
    }

    const sync = () => {
      const anchor = anchorRef?.current
      if (!anchor) {
        setPosition(null)
        return
      }
      const rect = anchor.getBoundingClientRect()
      const width = Math.min(matchAnchorWidth ? rect.width : Math.max(rect.width, minWidth), window.innerWidth - 16)
      const left = Math.max(8, Math.min(align === 'end' ? rect.right - width : rect.left, window.innerWidth - width - 8))
      const menuHeight = menuRef.current?.offsetHeight ?? 0
      const above = Math.max(0, rect.top - offsetY - 8)
      const below = Math.max(0, window.innerHeight - rect.bottom - offsetY - 8)
      const showAbove = placement === 'top' ? above >= Math.min(menuHeight, below) : below < menuHeight && above > below
      const maxHeight = showAbove ? above : below
      const top = showAbove ? rect.top - Math.min(menuHeight, maxHeight) - offsetY : rect.bottom + offsetY
      setPosition({
        top,
        left,
        width,
        minWidth: width,
        maxWidth: width,
        maxHeight,
      })
    }

    sync()
    const raf = requestAnimationFrame(sync)
    const observer = new ResizeObserver(sync)
    if (menuRef.current) observer.observe(menuRef.current)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [rendered, anchorRef, align, matchAnchorWidth, minWidth, offsetY, placement, children])

  if (!rendered || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={menuRef}
      className={`${DROPDOWN_MENU_CLASS} ${className}${closing ? ' app-dropdown-menu--closing' : ''}`}
      style={{
        position: 'fixed',
        ...position,
        visibility: position ? undefined : 'hidden',
        zIndex,
        pointerEvents: closing ? 'none' : undefined,
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  )
})

export function useDropdownDismiss(open, onClose, triggerRef, menuRef) {
  useLayoutEffect(() => {
    if (!open) return undefined

    const handlePointerDown = (event) => {
      const target = event.target
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      onClose()
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [open, onClose, triggerRef, menuRef])
}
