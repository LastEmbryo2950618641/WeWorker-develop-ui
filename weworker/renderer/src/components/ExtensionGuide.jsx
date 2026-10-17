import React, { useEffect, useRef, useState } from 'react'
import { EXTENSION_PATH, useExtensionSteps, StepList } from './ExtensionSteps.jsx'
import { useStatusStore } from '../store/status.js'

export default function ExtensionGuide({ onClose }) {
  const [copied, setCopied] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimerRef = useRef(null)
  const steps = useExtensionSteps()
  const extension = useStatusStore((state) => state.extension)
  const connected = extension === 'connected'

  const requestClose = () => {
    if (closing) return
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => onClose?.(), 150)
  }

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  const handleCopy = () => {
    navigator.clipboard.writeText(EXTENSION_PATH).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      className={`extension-guide-overlay ${closing ? 'extension-guide-overlay--closing' : ''}`}
      onClick={requestClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div
        className={`extension-guide-panel ${closing ? 'extension-guide-panel--closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 12, padding: 28, width: 500, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>浏览器扩展</div>
          <button onClick={requestClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: '4px 8px', borderRadius: 4 }}>×</button>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: connected ? 'rgba(34,197,94,0.1)' : 'var(--bg-secondary)',
          border: `1px solid ${connected ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
          borderRadius: 8, padding: '10px 12px', marginBottom: 16,
        }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>
              {connected ? '扩展已连接，可以使用浏览器自动化能力。' : '未检测到扩展。安装完成后打开 Chrome，左侧拼图图标会显示已连接。'}
            </span>
          </div>
          {!connected && <button
            onClick={() => window.electronAPI?.openChrome()}
            style={{
              flexShrink: 0, background: 'var(--accent-soft)',
              border: '1px solid color-mix(in srgb, var(--accent) 35%, var(--border))', borderRadius: 6,
              padding: '5px 12px', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', color: 'var(--accent)', fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}
          >
            打开 Chrome
          </button>}
        </div>

        {!connected && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>按以下步骤安装扩展：</div>}

        {!connected && <StepList steps={steps} onCopy={handleCopy} copied={copied} />}

        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <button onClick={requestClose} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 24px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}
