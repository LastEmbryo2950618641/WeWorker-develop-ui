import React from 'react'

/**
 * 风格图标：默认（圆）、内置（文档）、自定义（调色板）。
 * 风格全部来自内置提示词或用户自定义，不再有外部模板来源。
 */
export default function StyleKindIcon({ kind = 'core', size = 18 }) {
  if (kind === 'default') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    )
  }
  // 自定义风格 = 画家调色板（碟形带拇指缺口外轮廓 + 拇指孔 + 3 个色点），
  // 与 default/core 两个分支同一套描边风格（viewBox 24、fill none、currentColor、1.8）。
  if (kind === 'custom') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67 0 1.38-1.12 2.5-2.5 2.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="8.6" cy="14.6" r="1.7" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="7.7" cy="8.5" r="1.1" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="12.3" cy="6.6" r="1.1" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="16.7" cy="9.3" r="1.1" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 6h8M6 10h12M8 14h8M6 18h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="4" y="4" width="16" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}
