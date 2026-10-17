import React, { useLayoutEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

const VIEWPORT_PADDING = 8
const GAP = 8

function computeTooltipPosition(rect, tooltipRect, placement = 'top') {
  const winW = window.innerWidth
  const winH = window.innerHeight
  const preferTop = placement !== 'bottom'
  const canShowTop = rect.top >= tooltipRect.height + GAP + VIEWPORT_PADDING
  const showTop = preferTop ? canShowTop || rect.bottom + tooltipRect.height + GAP > winH - VIEWPORT_PADDING : false
  const top = showTop
    ? Math.max(VIEWPORT_PADDING, rect.top - tooltipRect.height - GAP)
    : Math.min(winH - tooltipRect.height - VIEWPORT_PADDING, rect.bottom + GAP)
  const centerLeft = rect.left + rect.width / 2 - tooltipRect.width / 2
  const left = Math.min(
    winW - tooltipRect.width - VIEWPORT_PADDING,
    Math.max(VIEWPORT_PADDING, centerLeft),
  )

  return { top, left }
}

export default function Tooltip({ text, children, delay = 420, light = true, placement = 'top' }) {
  const [visible, setVisible] = useState(false)
  const [style, setStyle] = useState({})
  const [triggerRect, setTriggerRect] = useState(null)
  const timerRef = useRef(null)
  const tooltipRef = useRef(null)

  const show = useCallback((e) => {
    clearTimeout(timerRef.current)
    const rect = e.currentTarget.getBoundingClientRect()
    setTriggerRect(rect)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setVisible(true)
    }, delay)
  }, [delay, placement])

  const hide = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = null
    setVisible(false)
    setTriggerRect(null)
  }, [])

  useLayoutEffect(() => () => clearTimeout(timerRef.current), [])

  useLayoutEffect(() => {
    if (!visible || !triggerRect || !tooltipRef.current) return
    const tooltipRect = tooltipRef.current.getBoundingClientRect()
    const next = computeTooltipPosition(triggerRect, tooltipRect, placement)
    setStyle(next)
  }, [visible, triggerRect, placement, text])

  return (
    <>
      <span
        data-custom-tooltip-zone="true"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClickCapture={hide}
        style={{ display: 'inline-flex', WebkitAppRegion: 'no-drag' }}
      >
        {children}
      </span>
      {visible && typeof document !== 'undefined' && createPortal(
        <div ref={tooltipRef} style={{
          position: 'fixed',
          zIndex: 9999,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          maxWidth: 'min(320px, calc(100vw - 16px))',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          ...style,
          background: light ? 'var(--bg-secondary)' : '#1a1a1a',
          color: light ? 'var(--text-primary)' : '#fff',
          border: light ? '1px solid var(--border)' : 'none',
          fontSize: 12,
          fontWeight: light ? 560 : 400,
          lineHeight: 1.35,
          padding: '6px 9px',
          borderRadius: light ? 8 : 6,
          boxShadow: light ? '0 8px 18px rgba(0, 0, 0, 0.12)' : '0 2px 8px rgba(0,0,0,0.2)',
        }}>
          {text}
        </div>,
        document.body,
      )}
    </>
  )
}
