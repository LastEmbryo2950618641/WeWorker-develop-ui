import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const VIEWPORT_PADDING = 8
const GAP = 8

function findTitleElement(target) {
  if (!(target instanceof Element)) return null
  const el = target.closest('[title]')
  if (!el || el.closest('[data-custom-tooltip-zone="true"]')) return null
  return el
}

function computePosition(anchorRect, tooltipRect) {
  const winW = window.innerWidth
  const winH = window.innerHeight
  const canShowTop = anchorRect.top >= tooltipRect.height + GAP + VIEWPORT_PADDING
  const shouldShowTop = canShowTop || anchorRect.bottom + tooltipRect.height + GAP > winH - VIEWPORT_PADDING
  const top = shouldShowTop
    ? Math.max(VIEWPORT_PADDING, anchorRect.top - tooltipRect.height - GAP)
    : Math.min(winH - tooltipRect.height - VIEWPORT_PADDING, anchorRect.bottom + GAP)
  const centerLeft = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2
  const left = Math.min(
    winW - tooltipRect.width - VIEWPORT_PADDING,
    Math.max(VIEWPORT_PADDING, centerLeft),
  )

  return { top, left }
}

export default function NativeTitleTooltipLayer() {
  const [tooltip, setTooltip] = useState(null)
  const [style, setStyle] = useState({})
  const tooltipRef = useRef(null)
  const activeElRef = useRef(null)
  const restoreTitleRef = useRef('')
  const hideTimerRef = useRef(null)

  const hide = () => {
    clearTimeout(hideTimerRef.current)
    const activeEl = activeElRef.current
    if (activeEl && restoreTitleRef.current) {
      activeEl.setAttribute('title', restoreTitleRef.current)
    }
    activeElRef.current = null
    restoreTitleRef.current = ''
    setTooltip(null)
  }

  const showForElement = (el) => {
    const title = el.getAttribute('title')
    if (!title) return

    if (activeElRef.current && activeElRef.current !== el) hide()
    activeElRef.current = el
    restoreTitleRef.current = title
    el.removeAttribute('title')
    setTooltip({ text: title, rect: el.getBoundingClientRect() })
  }

  useEffect(() => {
    const onPointerOver = (event) => {
      const el = findTitleElement(event.target)
      if (!el) return
      showForElement(el)
    }

    const onPointerOut = (event) => {
      const activeEl = activeElRef.current
      if (!activeEl) return
      const next = event.relatedTarget
      if (next instanceof Node && activeEl.contains(next)) return
      hide()
    }

    const onFocusIn = (event) => {
      const el = findTitleElement(event.target)
      if (!el) return
      showForElement(el)
    }

    const onFocusOut = () => hide()
    const onScrollOrResize = () => hide()

    document.addEventListener('pointerover', onPointerOver, true)
    document.addEventListener('pointerout', onPointerOut, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)

    return () => {
      hide()
      document.removeEventListener('pointerover', onPointerOver, true)
      document.removeEventListener('pointerout', onPointerOut, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [])

  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current) return
    const tooltipRect = tooltipRef.current.getBoundingClientRect()
    setStyle(computePosition(tooltip.rect, tooltipRect))
  }, [tooltip])

  if (!tooltip || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={tooltipRef}
      style={{
        position: 'fixed',
        zIndex: 9999,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        maxWidth: 'min(320px, calc(100vw - 16px))',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        boxShadow: 'none',
        padding: '6px 9px',
        fontSize: 12,
        fontWeight: 560,
        lineHeight: 1.35,
        ...style,
      }}
    >
      {tooltip.text}
    </div>,
    document.body,
  )
}
