import { useState, useEffect, useCallback } from 'react'
import { fetchStats, groupByDomain, groupByUser } from '../lib/stats'
import { fetchVisits } from '../lib/visits'

const SINCE_OPTIONS = ['1d', '7d', '30d']
const KIND_OPTIONS = ['adapter', 'builtin']
const VIEW_OPTIONS = ['adapter', 'user']

// 用 officialWeb 主题 token class（bg-bg / bg-surface / text-[rgb(var(--color-text))] / border-border
// / text-accent / text-muted），自动跟随明暗主题切换，不硬编码颜色。

export default function Stats() {
  const [groups, setGroups] = useState([])
  const [totalCalls, setTotalCalls] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [since, setSince] = useState('7d')
  const [kind, setKind] = useState('adapter')
  const [view, setView] = useState('adapter')

  // 网站访问量（PV/UV）
  const [visits, setVisits] = useState(null)
  const [visitsLoading, setVisitsLoading] = useState(true)
  const [visitsError, setVisitsError] = useState(null)

  const loadVisits = useCallback(async () => {
    setVisitsLoading(true)
    setVisitsError(null)
    try {
      setVisits(await fetchVisits({ since }))
    } catch (e) {
      setVisitsError(e.message)
    } finally {
      setVisitsLoading(false)
    }
  }, [since])

  useEffect(() => {
    loadVisits()
  }, [loadVisits])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const by = view === 'user' ? 'user' : 'tool'
      const data = await fetchStats({ by, since, kind })
      const rows = data.rows || []
      setGroups(view === 'user' ? groupByUser(rows) : groupByDomain(rows))
      setTotalCalls(data.totalCalls || 0)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [view, since, kind])

  useEffect(() => {
    load()
  }, [load])

  // 切换视图时清空展开态 + groups，避免 fetch 期间用旧视图数据套新列模板渲染崩溃
  const switchView = (v) => {
    setView(v)
    setExpanded(new Set())
    setGroups([])
    setLoading(true)
  }

  const toggle = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const okColor = (rate) =>
    rate == null
      ? 'text-muted'
      : rate >= 95
        ? 'text-emerald-500'
        : rate >= 80
          ? 'text-amber-500'
          : 'text-red-500'

  const fmt = (n) => Number(n).toLocaleString()

  const isUser = view === 'user'
  const cols = isUser
    ? 'grid-cols-[1fr_100px_40px]'
    : 'grid-cols-[1fr_80px_80px_80px_80px_40px]'

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-28 pb-16">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[rgb(var(--color-text))] mb-2">Adapter 调用统计</h1>
          <p className="text-muted">全团队 adapter 调用频次、成功率与耗时分布。</p>
        </div>
        <button
          onClick={() => { load(); loadVisits(); }}
          disabled={loading}
          className="px-4 py-2.5 rounded-lg border border-accent/40 bg-accent/5 text-accent hover:bg-accent/10 text-sm font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          <svg
            className={loading ? 'animate-spin' : ''}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          {loading ? '加载中...' : '刷新'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted">视图</span>
          <div className="flex bg-surface border border-border rounded-lg overflow-hidden">
            {VIEW_OPTIONS.map((v) => (
              <button
                key={v}
                onClick={() => switchView(v)}
                className={`px-3 py-1.5 transition-colors ${
                  view === v
                    ? 'bg-accent/20 text-[rgb(var(--color-text))]'
                    : 'text-muted hover:text-[rgb(var(--color-text))]'
                }`}
              >
                {v === 'user' ? '按用户' : '按 Adapter'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted">时间窗</span>
          <div className="flex bg-surface border border-border rounded-lg overflow-hidden">
            {SINCE_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setSince(s)}
                className={`px-3 py-1.5 transition-colors ${
                  since === s
                    ? 'bg-accent/20 text-[rgb(var(--color-text))]'
                    : 'text-muted hover:text-[rgb(var(--color-text))]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted">类型</span>
          <div className="flex bg-surface border border-border rounded-lg overflow-hidden">
            {KIND_OPTIONS.map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`px-3 py-1.5 transition-colors ${
                  kind === k
                    ? 'bg-accent/20 text-[rgb(var(--color-text))]'
                    : 'text-muted hover:text-[rgb(var(--color-text))]'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        {!loading && !error && groups.length > 0 && (
          <div className="text-muted ml-auto">
            {isUser ? `${groups.length} 个用户` : `${groups.length} 个 adapter`} · {fmt(totalCalls)} 次调用
          </div>
        )}
      </div>

      {/* 网站访问量（PV/UV） */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-[rgb(var(--color-text))]">网站访问量</h2>
          {!visitsLoading && !visitsError && visits && (
            <div className="text-muted text-sm">
              总 PV {fmt(visits.totalPv)} · 总 UV {fmt(visits.totalUv)}
            </div>
          )}
        </div>

        {visitsLoading && (
          <div className="bg-surface border border-border rounded-xl p-4 animate-pulse">
            <div className="h-4 bg-subtle/40 rounded w-1/2" />
          </div>
        )}

        {visitsError && (
          <div className="bg-surface border border-border rounded-xl p-4 text-sm text-red-500">
            网站访问量加载失败：{visitsError}
          </div>
        )}

        {!visitsLoading && !visitsError && visits && visits.rows.length === 0 && (
          <div className="bg-surface border border-border rounded-xl p-4 text-muted text-sm">暂无访问数据。</div>
        )}

        {!visitsLoading && !visitsError && visits && visits.rows.length > 0 && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[1fr_100px_100px] gap-3 px-4 py-3 text-xs text-muted border-b border-border bg-bg/40">
              <div>日期</div>
              <div className="text-right">PV</div>
              <div className="text-right">UV</div>
            </div>
            {visits.rows.map((r) => {
              const maxPv = Math.max(...visits.rows.map((x) => x.pv), 1)
              return (
                <div key={r.day} className="grid grid-cols-[1fr_100px_100px] gap-3 px-4 py-2.5 text-sm border-b border-border/60 last:border-b-0 items-center">
                  <div className="flex items-center gap-3">
                    <span className="text-[rgb(var(--color-text))] font-medium shrink-0">{r.day}</span>
                    <div className="h-1.5 bg-subtle/40 rounded-full flex-1 overflow-hidden">
                      <div
                        className="h-full bg-accent/70 rounded-full"
                        style={{ width: `${(r.pv / maxPv) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right text-[rgb(var(--color-text))] tabular-nums">{fmt(r.pv)}</div>
                  <div className="text-right text-[rgb(var(--color-text-soft))] tabular-nums">{fmt(r.uv)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-lg p-4 animate-pulse">
              <div className="h-4 bg-subtle/40 rounded w-1/3" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-center py-16">
          <div className="text-red-500 mb-2">统计加载失败</div>
          <p className="text-muted text-sm">{error}</p>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && groups.length === 0 && (
        <div className="text-center py-16">
          <div className="text-[rgb(var(--color-text))] mb-2">暂无埋点数据。</div>
        </div>
      )}

      {/* Table */}
      {!loading && !error && groups.length > 0 && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {/* Header row */}
          <div className={`grid ${cols} gap-3 px-4 py-3 text-xs text-muted border-b border-border bg-bg/40`}>
            <div>{isUser ? '用户' : '域名'}</div>
            <div className="text-right">调用次数</div>
            {!isUser && <div className="text-right">成功率</div>}
            {!isUser && <div className="text-right">p50(ms)</div>}
            {!isUser && <div className="text-right">p95(ms)</div>}
            <div></div>
          </div>

          {groups.map((g) => {
            const key = isUser ? g.user : g.domain
            const isOpen = expanded.has(key)
            return (
              <div key={key} className="border-b border-border last:border-b-0">
                {/* Summary row */}
                <button
                  onClick={() => toggle(key)}
                  className={`w-full grid ${cols} gap-3 px-4 py-3 text-sm hover:bg-bg/40 transition-colors text-left`}
                >
                  <div className="text-[rgb(var(--color-text))] font-medium truncate flex items-center gap-2">
                    <svg
                      className={`text-muted transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`}
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    {key}
                  </div>
                  <div className="text-right text-[rgb(var(--color-text))] tabular-nums">{fmt(g.calls)}</div>
                  {!isUser && (
                    <div className={`text-right tabular-nums ${okColor(g.okRate)}`}>
                      {g.okRate != null ? `${g.okRate.toFixed(1)}%` : '—'}
                    </div>
                  )}
                  {!isUser && <div className="text-right text-[rgb(var(--color-text-soft))] tabular-nums">{g.p50}</div>}
                  {!isUser && <div className="text-right text-[rgb(var(--color-text-soft))] tabular-nums">{g.p95}</div>}
                  <div></div>
                </button>

                {/* Detail (expanded) */}
                {isOpen && (
                  <div className="bg-bg/40 px-4 py-2">
                    {isUser
                      ? g.domains.length === 0
                        ? <div className="text-muted text-sm py-2 pl-6">无调用。</div>
                        : g.domains.map((d) => (
                            <div
                              key={d.domain}
                              className={`grid ${cols} gap-3 py-2 text-sm border-t border-border/60 first:border-t-0`}
                            >
                              <div className="text-[rgb(var(--color-text-soft))] truncate pl-6" title={d.domain}>
                                {d.domain}
                              </div>
                              <div className="text-right text-[rgb(var(--color-text-soft))] tabular-nums">
                                {fmt(d.calls)}
                              </div>
                              <div></div>
                            </div>
                          ))
                      : g.tools.length === 0
                        ? <div className="text-muted text-sm py-2 pl-6">无工具调用。</div>
                        : g.tools.map((tool) => (
                            <div
                              key={tool.tool}
                              className={`grid ${cols} gap-3 py-2 text-sm border-t border-border/60 first:border-t-0`}
                            >
                              <div className="text-[rgb(var(--color-text-soft))] truncate pl-6" title={tool.tool}>
                                {tool.tool}
                              </div>
                              <div className="text-right text-[rgb(var(--color-text-soft))] tabular-nums">
                                {fmt(tool.calls)}
                              </div>
                              <div className={`text-right tabular-nums ${okColor(tool.okRate)}`}>
                                {tool.okRate != null ? `${tool.okRate.toFixed(1)}%` : '—'}
                              </div>
                              <div className="text-right text-[rgb(var(--color-text-faint))] tabular-nums">{tool.p50}</div>
                              <div className="text-right text-[rgb(var(--color-text-faint))] tabular-nums">{tool.p95}</div>
                              <div></div>
                            </div>
                          ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
