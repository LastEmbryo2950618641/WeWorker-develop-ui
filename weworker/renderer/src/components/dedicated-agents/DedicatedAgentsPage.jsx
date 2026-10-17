import React, { useEffect, useState } from 'react'
import { Alert, Button } from 'antd'
import { PlusOutlined, RobotOutlined } from '@ant-design/icons'
import { useDedicatedAgentsStore } from '../../store/dedicated-agents.js'
import { useSitesStore } from '../../store/sites.js'
import SiteIcon from '../icons/SiteIcon.jsx'
import { agentStatusPresentation, TONE_COLORS } from '../../utils/dedicated-agents.js'
import AgentCreateWizard from './AgentCreateWizard.jsx'
import AgentDetail from './AgentDetail.jsx'
import AgentNameEditor from './AgentNameEditor.jsx'
import { contentStyle, hintStyle, listColumnStyle, pageStyle, sectionStyle, titleStyle } from './styles.js'

const LIST_REFRESH_MS = 8000

const listNameInputStyle = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  padding: '1px 6px',
  border: '1px solid var(--border)',
  borderRadius: 5,
  background: 'var(--bg-primary)',
  width: 140,
  maxWidth: '100%',
}

function AgentListItem({ agent, site, active, onSelect, onRenamed }) {
  const status = agentStatusPresentation(agent)
  const [hovered, setHovered] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      className={`work-list-item${active ? ' is-active' : ''}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect() }
      }}
      aria-current={active ? 'true' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 'calc(100% - 12px)', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 12px', margin: '1px 6px', borderRadius: 6,
        border: 'none', cursor: 'pointer', background: active ? 'var(--bg-active)' : hovered ? 'var(--bg-hover)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)', fontFamily: 'inherit', textAlign: 'left',
        transition: 'background 0.16s ease, color 0.16s ease',
      }}
    >
      <SiteIcon site={site || { id: agent.site_id, name: agent.site_id }} size={18} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <AgentNameEditor
          agentId={agent.id}
          name={agent.name}
          onSaved={onRenamed}
          disabled={agent.draft}
          iconSize={11}
          textStyle={{ fontSize: 12, fontWeight: active ? 600 : 500 }}
          inputStyle={listNameInputStyle}
        />
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: TONE_COLORS[status.tone] }}>
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: TONE_COLORS[status.tone] }} />
          {status.label}
        </span>
      </span>
    </div>
  )
}

function Intro({ onCreate, hasAgents }) {
  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={titleStyle}>专属 Agent</h2>
      <div style={{ ...hintStyle, fontSize: 13, margin: '8px 0 20px' }}>
        为某个网站打造一个小而专注的 Agent：它掌握你的专属知识，连接一个企业微信或微信机器人。你在手机上直接和它对话，它独立运行，不影响 WeWorker 的主对话。
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          ['1. 选网站', '选一个 WeWorker 已经能操作的网站'],
          ['2. 写专属知识', '用大白话描述，AI 帮你整理成 Skill'],
          ['3. 扫码绑定', '企业微信或微信扫码，一键获得机器人'],
          ['4. 发绑定码', '给机器人发一句话完成配对'],
        ].map(([title, text]) => (
          <div key={title} style={{ ...sectionStyle, marginBottom: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{title}</div>
            <div style={hintStyle}>{text}</div>
          </div>
        ))}
      </div>
      <Button type="primary" size="large" icon={<PlusOutlined />} onClick={onCreate}>新建专属 Agent</Button>
      {hasAgents && <div style={{ ...hintStyle, marginTop: 12 }}>也可以在左侧选择一个已有的 Agent 查看和管理。</div>}
    </div>
  )
}

export default function DedicatedAgentsPage({ sidebarWidth }) {
  const agents = useDedicatedAgentsStore((s) => s.agents)
  const view = useDedicatedAgentsStore((s) => s.view)
  const selectedId = useDedicatedAgentsStore((s) => s.selectedId)
  const loaded = useDedicatedAgentsStore((s) => s.loaded)
  const loadError = useDedicatedAgentsStore((s) => s.loadError)
  const loadAgents = useDedicatedAgentsStore((s) => s.loadAgents)
  const startCreate = useDedicatedAgentsStore((s) => s.startCreate)
  const selectAgent = useDedicatedAgentsStore((s) => s.selectAgent)
  const upsertAgent = useDedicatedAgentsStore((s) => s.upsertAgent)
  const sites = useSitesStore((s) => s.sites)
  const loadSites = useSitesStore((s) => s.load)

  useEffect(() => {
    loadAgents()
    if (!sites.length) loadSites()
    const timer = setInterval(loadAgents, LIST_REFRESH_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const siteById = new Map(sites.map((site) => [site.id, site]))
  const showDetail = view === 'detail' && selectedId && agents.some((agent) => agent.id === selectedId)

  return (
    <div style={pageStyle}>
      <div style={{ ...listColumnStyle, width: sidebarWidth, minWidth: sidebarWidth }}>
        <div className="sidebar-conversation-header" style={{ padding: '10px 12px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 11, fontWeight: 600 }}>
            <RobotOutlined aria-hidden="true" />
            <span>专属 Agent</span>
          </div>
          <Button size="small" type="text" icon={<PlusOutlined />} onClick={startCreate} aria-label="新建专属 Agent" />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px 10px' }}>
          {loadError && <Alert type="error" showIcon message={loadError} style={{ margin: 4 }} />}
          {loaded && !agents.length && !loadError && <div style={{ ...hintStyle, padding: '8px 12px' }}>还没有专属 Agent</div>}
          {agents.map((agent) => (
            <AgentListItem
              key={agent.id}
              agent={agent}
              site={siteById.get(agent.site_id)}
              active={agent.id === selectedId}
              onSelect={() => selectAgent(agent.id)}
              onRenamed={upsertAgent}
            />
          ))}
        </div>
      </div>
      {showDetail ? (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <AgentDetail key={selectedId} agentId={selectedId} />
        </div>
      ) : (
        <div style={contentStyle}>
          {view === 'create' && <AgentCreateWizard />}
          {view !== 'create' && <Intro onCreate={startCreate} hasAgents={agents.length > 0} />}
        </div>
      )}
    </div>
  )
}
