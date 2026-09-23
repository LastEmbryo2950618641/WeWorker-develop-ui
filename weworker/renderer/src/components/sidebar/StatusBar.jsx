import React, { useState } from 'react'
import { useStatusStore } from '../../store/status.js'
import { useSettingsStore } from '../../store/settings.js'
import ExtensionGuide from '../ExtensionGuide.jsx'
import { getWebwrightPresentation } from '../../utils/webwright-status.js'
import { useWebsiteExplorationStore } from '../../store/website-exploration.js'

export default function StatusBar() {
  const { extension, extensionVersion, channels } = useStatusStore()
  const { model, hasApiKey } = useSettingsStore()
  const [showGuide, setShowGuide] = useState(false)

  // Check version mismatch between app and extension
  const [appVersion, setAppVersion] = useState('')
  React.useEffect(() => {
    window.electronAPI?.getVersion?.().then(v => setAppVersion(v || ''))
  }, [])
  const versionMismatch = appVersion && extensionVersion && appVersion !== extensionVersion

  // Detect bridge port conflict (port 3711 held by another process at startup).
  // Polled from the Electron main process — backend does not know about this.
  const [bridgeStatus, setBridgeStatus] = useState('unknown')
  const [backendStatus, setBackendStatus] = useState('unknown')
  const [webwrightStatus, setWebwrightStatus] = useState('unknown')
  React.useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const s = await window.electronAPI?.getStatus?.()
        if (!cancelled) {
          if (s?.bridge) setBridgeStatus(s.bridge)
          if (s?.python) setBackendStatus(s.python)
          if (s?.webwright) setWebwrightStatus(s.webwright)
        }
      } catch {}
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])
  const bridgePortInUse = bridgeStatus === 'port_in_use'
  const backendPortInUse = backendStatus === 'port_in_use'
  const externalBackendRunning = backendStatus === 'external_running'
  const isWindows = navigator.userAgent.includes('Windows')
  const webwright = getWebwrightPresentation(webwrightStatus)
  const webwrightColor = webwright.tone === 'success' ? 'var(--success)'
    : webwright.tone === 'warning' ? 'var(--warning)'
      : webwright.tone === 'error' ? 'var(--error)'
        : 'var(--text-muted)'

  const dot = (status) => {
    const color = status === 'connected' ? 'var(--success)'
      : status === 'unknown' ? 'var(--warning)'
      : 'var(--error)'
    return <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color, marginRight: 4, flexShrink: 0 }} />
  }

  const channelDot = (status) => {
    const color = status === 'connected' ? 'var(--success)'
      : status === 'starting' ? 'var(--warning)'
      : status === 'error' ? 'var(--error)'
      : 'var(--text-muted)'
    return <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color, marginRight: 4, flexShrink: 0 }} />
  }

  const CHANNEL_NAMES = { qq: 'QQ', weixin: '微信', wecom: '企业微信' }
  const STATUS_TEXT = { connected: '已连接', starting: '连接中', error: '错误' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        disabled={!webwright.enabled}
        onClick={() => useWebsiteExplorationStore.setState({ open: true })}
        title={webwright.label}
        style={{
          alignSelf: 'flex-start',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          maxWidth: '100%',
          padding: 0,
          border: 'none',
          background: 'none',
          color: webwrightColor,
          cursor: webwright.enabled ? 'pointer' : 'default',
          fontSize: 11,
          fontFamily: 'inherit',
          opacity: webwrightStatus === 'stopped' || webwrightStatus === 'unknown' ? 0.75 : 1,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{webwright.label}</span>
      </button>
      {/* Current model */}
      <div style={{ fontSize: 11, color: hasApiKey ? 'var(--text-secondary)' : 'var(--warning)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <path d="M8 21h8M12 17v4"/>
        </svg>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
          {hasApiKey ? (model || '未设置模型') : '未配置 API Key'}
        </span>
      </div>
      {/* Extension status */}
      <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 2 }}>
        {dot(extension)}扩展{extension === 'connected' ? '已连接' : '未连接'}
        {extension !== 'connected' && (
          <button
            onClick={() => setShowGuide(true)}
            title="如何连接扩展？"
            style={{
              background: 'none', border: '1px solid var(--border)',
              borderRadius: '50%', width: 14, height: 14,
              cursor: 'pointer', color: 'var(--text-muted)',
              fontSize: 9, fontWeight: 700, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0, marginLeft: 2, flexShrink: 0,
            }}
          >?</button>
        )}
      </span>
      {showGuide && <ExtensionGuide onClose={() => setShowGuide(false)} />}
      {/* Extension version mismatch warning */}
      {versionMismatch && (
        <span style={{ fontSize: 10, color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 4, lineHeight: 1.3 }}>
          ⚠ 扩展版本不一致（v{extensionVersion}），请在 chrome://extensions 刷新扩展
        </span>
      )}
      {/* Bridge port 3711 occupied by external process — workflows won't work reliably */}
      {bridgePortInUse && (
        <span
          title="终端执行：kill $(lsof -ti tcp:3711) 后重启 WeWorker"
          style={{ fontSize: 10, color: 'var(--warning)', display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.3 }}
        >
          <span>⚠ 端口 3711 被其他进程占用</span>
          <code style={{ fontSize: 10, background: 'var(--bg-secondary, #f0f0f0)', padding: '1px 4px', borderRadius: 3, color: 'var(--text-secondary)', userSelect: 'all' }}>
            kill $(lsof -ti tcp:3711)
          </code>
        </span>
      )}
      {backendPortInUse && (
        <span
          title="关闭其他 WeWorker 实例或结束占用 8765 的进程后重启"
          style={{ fontSize: 10, color: 'var(--warning)', display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.3 }}
        >
          <span>⚠ 后端端口 8765 被其他进程占用</span>
          <code style={{ fontSize: 10, background: 'var(--bg-secondary, #f0f0f0)', padding: '1px 4px', borderRadius: 3, color: 'var(--text-secondary)', userSelect: 'all' }}>
            {isWindows ? 'netstat -ano | findstr :8765' : 'lsof -nP -iTCP:8765 -sTCP:LISTEN'}
          </code>
        </span>
      )}
      {externalBackendRunning && (
        <span
          title="当前使用单独启动的 backend-ts 开发服务"
          style={{ fontSize: 10, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 3, lineHeight: 1.3 }}
        >
          <span>●</span>
          <span>后端：外部开发服务</span>
        </span>
      )}
      {/* Channel statuses */}
      {Object.entries(channels).map(([name, info]) => (
        <span
          key={name}
          title={info.error ? `${CHANNEL_NAMES[name] || name}: ${info.error}` : undefined}
          style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
        >
          {channelDot(info.status)}
          {CHANNEL_NAMES[name] || name} {STATUS_TEXT[info.status] || info.status}
        </span>
      ))}
    </div>
  )
}
