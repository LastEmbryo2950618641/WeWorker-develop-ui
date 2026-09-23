import React from 'react'
import { useScheduledTasksStore } from '../../store/scheduled-tasks.js'
import { useToolPackagePageStore } from '../../store/tool-package-page.js'
import { useExplorationPageStore } from '../../store/exploration-page.js'
import { leaveWebsiteExploration } from '../../store/website-exploration.js'

/**
 * Simple frontend cron-to-summary conversion.
 * Covers common patterns; falls back to raw expression.
 */
function cronToSummary(expr) {
  if (!expr) return ''
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr

  const [minute, hour, dom, mon, dow] = parts

  // "0 * * * *" → 每小时
  if (minute === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return '每小时'
  }

  // "*/N * * * *" → 每 N 分钟
  const everyNMin = minute.match(/^\*\/(\d+)$/)
  if (everyNMin && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `每 ${everyNMin[1]} 分钟`
  }

  // "M H * * *" → 每天 HH:MM
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
    return `每天 ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  }

  // "M H * * D" → 每周X HH:MM
  const weekdays = { '0': '日', '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六' }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && /^\d$/.test(dow) && weekdays[dow]) {
    return `每周${weekdays[dow]} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  }

  return expr
}

export default function ScheduledTasksList() {
  const tasks = useScheduledTasksStore((s) => Array.isArray(s.tasks) ? s.tasks : [])
  const activeTaskId = useScheduledTasksStore((s) => s.activeTaskId)
  const selectTask = useScheduledTasksStore((s) => s.selectTask)
  const closeToolPackagePage = useToolPackagePageStore((s) => s.closePage)
  const closeExplorationPage = useExplorationPageStore((s) => s.closePage)

  if (!tasks.length) {
    return (
      <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: 12 }}>
        暂无定时任务
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 0' }}>
      {tasks.map((t) => (
        <ScheduledTaskItem
          key={t.id}
          task={t}
          active={t.id === activeTaskId}
          onSelect={async () => {
            if (!await leaveWebsiteExploration()) return
            closeToolPackagePage()
            closeExplorationPage()
            selectTask(t.id)
          }}
        />
      ))}
    </div>
  )
}

function ScheduledTaskItem({ task, active, onSelect }) {
  const [hovered, setHovered] = React.useState(false)

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '7px 12px',
        cursor: 'pointer',
        background: active ? 'var(--bg-active)' : hovered ? 'var(--bg-hover)' : 'transparent',
        borderRadius: 6,
        margin: '1px 6px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        transition: 'background 0.1s',
      }}
    >
      {/* Enabled/disabled status dot */}
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: task.enabled ? '#22c55e' : '#9ca3af',
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
        <span
          style={{
            fontSize: 12,
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
          }}
        >
          {task.title || '未命名任务'}
        </span>
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {cronToSummary(task.cron_expression)}
        </span>
      </div>
    </div>
  )
}
