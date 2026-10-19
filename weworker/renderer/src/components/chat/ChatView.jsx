import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useWorksStore } from '../../store/works.js'
import { useScheduledTasksStore } from '../../store/scheduled-tasks.js'
import { useSitesStore } from '../../store/sites.js'
import MessageList from './MessageList.jsx'
import ChatBottomDock from './ChatBottomDock.jsx'
import WelcomeScreen from '../welcome/WelcomeScreen.jsx'
import HealthCheckPanel from './HealthCheckPanel.jsx'
import { requestChatWarmup, setContextCompactionLifecycleHandler, streamChat, submitUserChoice } from '../../api/backend.js'
import { backendFetch } from '../../api/http.js'
import { displayToolName } from '../../utils/tool-name.js'
import { formatDuration } from '../../utils/format-duration.js'
import { useSettingsStore } from '../../store/settings.js'
import { useZcfStore, normalizeZcfModeId } from '../../store/zcf.js'
import { useChatInputFillStore } from '../../store/chat-input-fill.js'
import { buildResumePrompt, isPlanChangeIntent, isResumeIntent } from '../../utils/chat-generation-stop.js'
import { applyAssistantStreamEvent } from '../../utils/chat-stream-events.js'
import { applyTerminalEventToMessages } from '../../utils/terminal-chat-output.js'
import { buildTodoWriteContextPrompt, buildTodoWriteState } from '../../utils/todowrite-state.js'
import { cleanUserChoiceText, normalizeUserChoiceOptions } from '../../utils/user-choice.js'

export default function ChatView({ workId }) {
  const messages = useWorksStore((s) => s.messages[workId] ?? [])
  const contextSnapshot = useWorksStore((s) => s.contextSnapshots[workId] ?? null)
  const contextCompactionStatus = useWorksStore((s) => s.contextCompactionStatuses[workId] ?? null)
  const memoryStatus = useWorksStore((s) => s.memoryStatuses[workId] ?? null)
  const appendMessage = useWorksStore((s) => s.appendMessage)
  const updateLastMessage = useWorksStore((s) => s.updateLastMessage)
  const selectWork = useWorksStore((s) => s.selectWork)
  const healthCheckMeta = useWorksStore((s) => s.healthCheckMeta)
  // Streaming state from store — survives component remount on work switch
  const streaming = useWorksStore((s) => s.streamingWorkIds.has(workId))
  const [error, setError] = useState(null)
  const handleSendRef = useRef(null)
  const [inputText, setInputText] = useState('')
  const [attachments, setAttachments] = useState([])
  const fillSeq = useChatInputFillStore((s) => s.seq)
  const fillText = useChatInputFillStore((s) => s.text)
  const handledFillSeqRef = useRef(fillSeq)
  const [messageSelectMode, setMessageSelectMode] = useState(false)
  const maxChatAttachments = useSettingsStore((s) => s.maxChatAttachments)
  const zcfDefaultRole = useSettingsStore((s) => s.zcfDefaultRole)
  const zcfDefaultMode = useSettingsStore((s) => s.zcfDefaultMode)
  const work = useWorksStore((s) => s.works.find((item) => item.id === workId))
  const updateWorkZcfPrefs = useWorksStore((s) => s.updateWorkZcfPrefs)
  const zcfRoles = useZcfStore((s) => s.roles)
  const zcfModes = useZcfStore((s) => s.modes)
  const resolvePickerRole = useZcfStore((s) => s.resolvePickerRole)
  const zcfRole = useMemo(
    () => resolvePickerRole(work?.zcf_role || zcfDefaultRole, zcfDefaultRole),
    [resolvePickerRole, work?.zcf_role, zcfDefaultRole],
  )
  const zcfMode = normalizeZcfModeId(work?.zcf_mode || zcfDefaultMode)
  const roleLabel = useZcfStore((s) => s.roleLabel)
  const modeLabel = useZcfStore((s) => s.modeLabel)
  const [zcfNotice, setZcfNotice] = useState('')
  const [slowWarning, setSlowWarning] = useState(false)
  const slowTimerRef = useRef(null)
  const gotFirstEventRef = useRef(false)
  const compactionNoticeTimerRef = useRef(null)

  useEffect(() => {
    setContextCompactionLifecycleHandler((targetWorkId, status) => {
      useWorksStore.getState().setContextCompactionStatus(targetWorkId, status)
    })
    return () => setContextCompactionLifecycleHandler(null)
  }, [])

  const handleFillInput = (text) => {
    setInputText(text)
  }

  useEffect(() => {
    if (fillSeq <= 0 || fillSeq <= handledFillSeqRef.current) return
    handledFillSeqRef.current = fillSeq
    if (streaming) return
    const nextText = String(fillText || '').trim()
    if (!nextText) return
    setInputText(nextText)
    setAttachments([])
  }, [fillSeq, fillText, streaming])

  // Pre-start on opening a work; later input changes can retry after expiry.
  useEffect(() => {
    if (!workId || streaming || String(inputText || '').trim().startsWith('!')) return
    void requestChatWarmup(workId)
  }, [inputText, workId, streaming])

  const handleZcfRoleChange = async (roleId) => {
    try {
      await updateWorkZcfPrefs(workId, { zcf_role: roleId })
      setZcfNotice(`已切换风格为「${roleLabel(roleId)}」，将从下一条消息开始生效`)
      window.setTimeout(() => setZcfNotice(''), 4000)
    } catch (e) {
      console.error('[chat] update zcf role failed:', e)
      setError('风格切换失败，请稍后重试')
    }
  }

  const handleZcfModeChange = async (modeId) => {
    try {
      await updateWorkZcfPrefs(workId, { zcf_mode: modeId })
      setZcfNotice(`已切换模式为「${modeLabel(modeId)}」，将从下一条消息开始生效`)
      window.setTimeout(() => setZcfNotice(''), 4000)
    } catch (e) {
      console.error('[chat] update zcf mode failed:', e)
      setError('模式切换失败，请稍后重试')
    }
  }

  const handleStop = () => {
    useWorksStore.getState().abortControllers[workId]?.abort()
    useWorksStore.getState().stopGeneration(workId)
  }

  const handleChoice = async (choiceId, answer) => {
    const cleanAnswer = cleanUserChoiceText(answer)
    try {
      await submitUserChoice(workId, cleanAnswer)
      // Update the choice block status to 'answered'
      updateLastMessage(workId, (msg) => ({
        ...msg,
        content: msg.content.map((b) =>
          b.type === 'user_choice' && b.id === choiceId
            ? { ...b, status: 'answered', answer: cleanAnswer }
            : b
        ),
      }))
    } catch (e) {
      console.error('[chat] submitUserChoice error:', e)
    }
  }

  const handleSend = async (text, files = []) => {
    if ((!text.trim() && !files.length) || streaming || useWorksStore.getState().contextCompactionStatuses[workId] === 'compacting') return
    if (files.length > maxChatAttachments) {
      setError(`已选 ${files.length}/${maxChatAttachments} 个文件，请删减后再发送`)
      return
    }
    setError(null)
    setInputText('')
    setAttachments([])
    setSlowWarning(false)
    gotFirstEventRef.current = false
    useWorksStore.getState().clearMemoryStatus(workId)

    const controller = new AbortController()
    const currentPlan = buildTodoWriteState(messages, { streaming: false })?.plan ?? null
    const modelText = (() => {
      const plan = currentPlan
      if (!plan) return text
      if (isPlanChangeIntent(text)) return text
      if (isResumeIntent(text)) {
        return buildResumePrompt(plan)
      }
      return buildTodoWriteContextPrompt(text, plan)
    })()

    // Start slow-response timer — warn user if no event received within 30s
    slowTimerRef.current = setTimeout(() => {
      if (!gotFirstEventRef.current) setSlowWarning(true)
    }, 30000)

    // Store abort controller and mark as streaming — survives component remount
    useWorksStore.setState((s) => ({
      streamingWorkIds: new Set([...s.streamingWorkIds, workId]),
      abortControllers: { ...s.abortControllers, [workId]: controller },
    }))

    appendMessage(workId, {
      id: Date.now() + '-u',
      role: 'user',
      content: [
        ...files.map((file) => ({ type: 'file_attachment', name: file.name, path: file.path })),
        ...(text ? [{ type: 'text', text }] : []),
      ],
      created_at: new Date().toISOString(),
    })
    appendMessage(workId, { id: Date.now() + '-a', role: 'assistant', content: [], created_at: new Date().toISOString() })

    try {
      await streamChat(workId, text, (event) => {
        if (!gotFirstEventRef.current) {
          gotFirstEventRef.current = true
          setSlowWarning(false)
          clearTimeout(slowTimerRef.current)
        }
        if (event.type === 'title_update') {
          useWorksStore.getState().updateTitleLocal(event.workId, event.title)
          return
        }
        if (event.type === 'user_message_saved') {
          useWorksStore.setState((s) => {
            const msgs = s.messages[workId] ?? []
            const withoutPlaceholders = msgs.filter((m, i) => {
              const isLastAssistantPlaceholder = i === msgs.length - 1 && m.role === 'assistant' && (m.content?.length ?? 0) === 0
              const isPreviousUserPlaceholder = i === msgs.length - 2 && m.role === 'user'
              return !isLastAssistantPlaceholder && !isPreviousUserPlaceholder
            })
            return {
              messages: {
                ...s.messages,
                [workId]: [
                  ...withoutPlaceholders,
                  event.message,
                  { id: Date.now() + '-a', role: 'assistant', content: [], created_at: new Date().toISOString() },
                ],
              },
            }
          })
          return
        }
        // turn_start: only used for logging
        if (event.type === 'turn_start') {
          return
        }
        if (event.type === 'context_snapshot') {
          useWorksStore.getState().setContextSnapshot(workId, event.context)
          return
        }
        if (event.type === 'context_compaction_start' || event.type === 'context_compaction_end') {
          if (compactionNoticeTimerRef.current) {
            window.clearTimeout(compactionNoticeTimerRef.current)
            compactionNoticeTimerRef.current = null
          }
          const status = event.type === 'context_compaction_start'
            ? 'compacting'
            : event.compaction?.status === 'failed'
              ? 'failed'
              : event.compaction?.status === 'skipped' ? 'skipped' : 'completed'
          useWorksStore.getState().setContextCompactionStatus(workId, status)
          if (status !== 'compacting') {
            compactionNoticeTimerRef.current = window.setTimeout(() => {
              useWorksStore.getState().setContextCompactionStatus(workId, null)
              compactionNoticeTimerRef.current = null
            }, 5000)
          }
          return
        }
        if (event.type === 'usage') {
          useWorksStore.getState().setContextUsage(workId, event.usage)
          return
        }
        if (event.type === 'memory_status') {
          useWorksStore.getState().setMemoryStatus(workId, event)
          return
        }
        // turn_end: append a timing summary block to the assistant message being streamed
        if (event.type === 'turn_end') {
          updateLastMessage(workId, (msg) => {
            if (!msg || msg.role !== 'assistant') return msg
            if ((msg.content ?? []).some((b) => b.type === 'timing')) return msg
            return {
              ...msg,
              content: [...(msg.content ?? []), { type: 'timing', totalMs: event.totalMs, llmMs: event.llmMs, execMs: event.execMs, steps: event.steps }],
            }
          })
          return
        }
        if (event.type === 'terminal_event') {
          useWorksStore.setState((s) => {
            const msgs = s.messages[workId] ?? []
            const nextMessages = applyTerminalEventToMessages(msgs, event)
            if (nextMessages === msgs) return s
            return {
              messages: {
                ...s.messages,
                [workId]: nextMessages,
              },
            }
          })
          return
        }
        updateLastMessage(workId, (msg) => {
          const content = [...msg.content]

          if (event.type === 'text_delta') {
            const last = content[content.length - 1]
            if (last?.type === 'text') {
              return { ...msg, content: [...content.slice(0, -1), { type: 'text', text: last.text + event.content }] }
            }
            return { ...msg, content: [...content, { type: 'text', text: event.content }] }
          }

          if (event.type === 'replace_assistant_text' || event.type === 'replace_assistant_content') {
            return applyAssistantStreamEvent(msg, event)
          }

          if (event.type === 'user_choice') {
            return {
              ...msg,
              content: [...content, {
                type: 'user_choice',
                id: event.id,
                question: cleanUserChoiceText(event.question),
                options: normalizeUserChoiceOptions(event.options),
                status: 'pending',
              }],
            }
          }

          if (event.type === 'tool_call_start') {
            const cleanName = displayToolName(event.name || '')
            // If a tool block with this id already exists, update its args (streaming mode sends args later)
            const existingIdx = content.findIndex((b) => b.type === 'tool_use' && b.id === event.id)
            if (existingIdx >= 0) {
              return {
                ...msg,
                content: content.map((b) =>
                  b.type === 'tool_use' && b.id === event.id
                    ? { ...b, args: event.args || b.args, name: cleanName || b.name }
                    : b
                ),
              }
            }
            return { ...msg, content: [...content, { type: 'tool_use', id: event.id, name: cleanName, args: event.args, status: 'running', thinkMs: event.thinkMs }] }
          }

          if (event.type === 'tool_call_result') {
            // Refresh scheduled tasks list if a scheduled task tool was called
            const toolBlock = content.find((b) => b.type === 'tool_use' && b.id === event.id)
            if (toolBlock?.name && /scheduled.task/i.test(toolBlock.name)) {
              useScheduledTasksStore.getState().loadTasks()
            }
            const existing = content.find((b) => b.type === 'tool_use' && b.id === event.id)
            if (existing) {
              return {
                ...msg,
                content: content.map((b) =>
                  b.type === 'tool_use' && b.id === event.id
                    ? { ...b, result: event.result ?? '(no result)', status: 'done', execMs: event.execMs }
                    : b
                ),
              }
            }
            return { ...msg, content: [...content, { type: 'tool_use', id: event.id, name: '', result: event.result ?? '(no result)', status: 'done', execMs: event.execMs }] }
          }

          if (event.type === 'tool_call_image') {
            const existing = content.find((b) => b.type === 'tool_use' && b.id === event.id)
            if (existing) {
              return {
                ...msg,
                content: content.map((b) =>
                  b.type === 'tool_use' && b.id === event.id
                    ? { ...b, image: event.data, status: 'done' }
                    : b
                ),
              }
            }
            return { ...msg, content: [...content, { type: 'tool_use', id: event.id, name: 'capture_screenshot', image: event.data, status: 'done' }] }
          }

          if (event.type === 'error') {
            setError(event.content)
            return { ...msg, content: [...content, { type: 'error', text: event.content }] }
          }

          return msg
        })
      }, controller.signal, files, maxChatAttachments, modelText)
    } catch (e) {
      if (e.name === 'AbortError') {
        const store = useWorksStore.getState()
        if (store.streamingWorkIds.has(workId)) {
          store.stopGeneration(workId)
        }
      } else {
        setError(e.message)
        updateLastMessage(workId, (msg) => ({
          ...msg,
          content: [...msg.content, { type: 'error', text: e.message }],
        }))
      }
    } finally {
      clearTimeout(slowTimerRef.current)
      setSlowWarning(false)
      // Clean up store-level streaming state
      useWorksStore.setState((s) => {
        const next = new Set(s.streamingWorkIds)
        next.delete(workId)
        const controllers = { ...s.abortControllers }
        delete controllers[workId]
        return { streamingWorkIds: next, abortControllers: controllers }
      })
    }
  }

  const handleShellCommand = async (command, originalText = '') => {
    const trimmed = String(command || '').trim()
    if (!trimmed || streaming || useWorksStore.getState().contextCompactionStatuses[workId] === 'compacting') return
    setError(null)
    setInputText('')
    setAttachments([])
    setSlowWarning(false)
    gotFirstEventRef.current = false

    const startedAt = Date.now()
    const userMessageId = `${startedAt}-u`
    const assistantMessageId = `${startedAt}-shell`
    const toolId = `chat-bang-${startedAt.toString(36)}`

    useWorksStore.setState((s) => ({
      streamingWorkIds: new Set([...s.streamingWorkIds, workId]),
    }))

    appendMessage(workId, {
      id: userMessageId,
      role: 'user',
      content: [{ type: 'text', text: originalText || `!${trimmed}` }],
      created_at: new Date().toISOString(),
    })
    appendMessage(workId, {
      id: assistantMessageId,
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: toolId,
        name: 'weworker_powershell',
        args: { command: trimmed },
        status: 'running',
        chatBang: true,
      }],
      created_at: new Date().toISOString(),
    })

    try {
      const res = await backendFetch('/terminal/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: trimmed,
          workId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Shell command failed')
      const execMs = Date.now() - startedAt
      useWorksStore.setState((s) => {
        const msgs = s.messages[workId] ?? []
        return {
          messages: {
            ...s.messages,
            [workId]: msgs.map((msg) => {
              if (msg.id !== assistantMessageId) return msg
              return {
                ...msg,
                content: (msg.content ?? []).map((block) => (
                  block.type === 'tool_use' && block.id === toolId
                    ? {
                        ...block,
                        status: Number(data.exitCode) === 0 ? 'done' : 'failed',
                        args: { ...(block.args || {}), shell: data.shell || block.args?.shell },
                        result: JSON.stringify({ output: data.output || '', exitCode: data.exitCode ?? null }),
                        execMs,
                      }
                    : block
                )),
              }
            }),
          },
        }
      })
    } catch (e) {
      const message = e.message || 'Shell command failed'
      setError(message)
      useWorksStore.setState((s) => {
        const msgs = s.messages[workId] ?? []
        return {
          messages: {
            ...s.messages,
            [workId]: msgs.map((msg) => {
              if (msg.id !== assistantMessageId) return msg
              return {
                ...msg,
                content: (msg.content ?? []).map((block) => (
                  block.type === 'tool_use' && block.id === toolId
                    ? { ...block, status: 'failed', result: message }
                    : block
                )),
              }
            }),
          },
        }
      })
    } finally {
      useWorksStore.setState((s) => {
        const next = new Set(s.streamingWorkIds)
        next.delete(workId)
        return { streamingWorkIds: next }
      })
    }
  }

  handleSendRef.current = handleSend
  const handleShellCommandRef = useRef(null)
  handleShellCommandRef.current = handleShellCommand

  useEffect(() => {
    const init = async () => {
      setMessageSelectMode(false)
      await selectWork(workId)
      const pending = useWorksStore.getState().pendingMessage
      const pendingAttachments = useWorksStore.getState().pendingAttachments || []
      const pendingShellCommand = useWorksStore.getState().pendingShellCommand
      if (pending || pendingAttachments.length) {
        useWorksStore.setState({ pendingMessage: null, pendingAttachments: [] })
        handleSendRef.current(pending || '', pendingAttachments)
        return
      }
      if (pendingShellCommand?.command) {
        useWorksStore.setState({ pendingShellCommand: null })
        handleShellCommandRef.current?.(
          pendingShellCommand.command,
          pendingShellCommand.originalText || `!${pendingShellCommand.command}`,
        )
      }
    }
    init()
  }, [workId])

  useEffect(() => {
    return () => {
      if (slowTimerRef.current) window.clearTimeout(slowTimerRef.current)
      if (compactionNoticeTimerRef.current) window.clearTimeout(compactionNoticeTimerRef.current)
    }
  }, [])

  const shortId = workId?.slice(0, 8) || ''
  // Sum of all turn durations in this work (each assistant turn ends with a timing block)
  const taskTotalMs = messages.reduce(
    (s, m) => s + (m.content ?? []).filter((b) => b.type === 'timing').reduce((a, b) => a + (b.totalMs || 0), 0),
    0,
  )
  const sites = useSitesStore((s) => s.sites)

  // Detect health check — from in-memory meta (active session) or from title prefix (restored session)
  const liveHealthCheck = healthCheckMeta && healthCheckMeta.workId === workId ? healthCheckMeta : null
  const isHealthCheck = !!(liveHealthCheck || work?.title?.startsWith('[健康检查]'))

  // Resolve health check metadata — live or from title + sites store
  let hcSiteId = liveHealthCheck?.siteId || ''
  let hcSiteName = liveHealthCheck?.siteName || ''
  let hcToolNames = liveHealthCheck?.toolNames || []
  if (!liveHealthCheck && isHealthCheck && work?.title) {
    const titleSiteName = work.title.replace('[健康检查] ', '')
    const matchedSite = sites.find(s => s.name === titleSiteName)
    if (matchedSite) {
      hcSiteId = matchedSite.id
      hcSiteName = matchedSite.name
      hcToolNames = matchedSite.tools?.map(t => t.name) || []
    }
  }
  // Only show streaming UI (cursor, disabled input) if THIS workId is the one streaming
  const isStreamingHere = streaming

  return (
    <div className="chat-view motion-view-enter" style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', minWidth: 0 }}>
      {/* Health check banner OR normal info bar */}
      {isHealthCheck ? (
        <div style={{
          padding: '6px 20px', fontSize: 12, fontWeight: 600,
          background: isStreamingHere ? 'rgba(99,102,241,0.1)' : 'rgba(34,197,94,0.1)',
          borderBottom: `1px solid ${isStreamingHere ? 'rgba(99,102,241,0.3)' : 'rgba(34,197,94,0.3)'}`,
          color: isStreamingHere ? 'var(--accent)' : '#22c55e',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          <span>{isStreamingHere ? '🔍' : '✅'}</span>
          <span>{isStreamingHere ? `正在检测 ${hcSiteName} 的工具可用性...` : `${hcSiteName} 检测完成`}</span>
        </div>
      ) : messages.length > 0 ? (
        <div style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ width: '100%', maxWidth: 1184, margin: '0 auto', padding: '4px 20px', boxSizing: 'border-box', fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ opacity: 0.6 }}>ID: {shortId}</span>
          {work?.title && <span style={{ opacity: 0.6 }}>·</span>}
          {work?.title && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{work.title}</span>}
          {taskTotalMs > 0 && <span style={{ opacity: 0.6 }}>·</span>}
          {taskTotalMs > 0 && <span style={{ flexShrink: 0 }}>累计 {formatDuration(taskTotalMs)}</span>}
          <LabelDot workId={workId} label={work?.label} />
          </div>
        </div>
      ) : null}

      {messages.length === 0 ? <WelcomeScreen onFillInput={handleFillInput} /> : <MessageList messages={messages} streaming={isStreamingHere} workId={workId} onChoice={handleChoice} onSelectModeChange={setMessageSelectMode} onShellCommand={handleShellCommand} />}

      {/* Health check panel — between messages and input */}
      {isHealthCheck && messages.length > 0 && (
        <HealthCheckPanel
          toolNames={hcToolNames}
          messages={messages}
          streaming={isStreamingHere}
          workId={workId}
          siteId={hcSiteId}
        />
      )}

      {slowWarning && (
        <div style={{ padding: '8px 20px', color: '#f59e0b', fontSize: 12, background: 'rgba(245,158,11,0.1)', borderTop: '1px solid rgba(245,158,11,0.3)' }}>
          ⚠️ 响应较慢，可能是网络问题或 API 连接超时。可查看后端日志排查，或点击停止后重试。
        </div>
      )}
      {error && (
        <div style={{ padding: '8px 20px', color: 'var(--error)', fontSize: 12, background: 'rgba(248,113,113,0.1)' }}>
          {error}
        </div>
      )}
      {zcfNotice && (
        <div style={{ padding: '8px 20px', color: 'var(--accent)', fontSize: 12, background: 'color-mix(in srgb, var(--accent) 10%, transparent)' }}>
          {zcfNotice}
        </div>
      )}
      {contextCompactionStatus && (
        <div
          data-conversation-compaction-status={contextCompactionStatus}
          style={{
            padding: '8px 20px',
            color: contextCompactionStatus === 'failed' ? 'var(--error)' : contextCompactionStatus === 'completed' ? '#22c55e' : contextCompactionStatus === 'skipped' ? 'var(--text-secondary)' : 'var(--accent)',
            fontSize: 12,
            background: contextCompactionStatus === 'failed' ? 'rgba(248,113,113,0.1)' : contextCompactionStatus === 'completed' ? 'rgba(34,197,94,0.1)' : contextCompactionStatus === 'skipped' ? 'rgba(148,163,184,0.12)' : 'rgba(99,102,241,0.1)',
            borderTop: '1px solid var(--border)',
          }}
        >
          {contextCompactionStatus === 'compacting' && '⏳ 正在压缩对话上下文…'}
          {contextCompactionStatus === 'completed' && '✅ 对话上下文压缩完成'}
          {contextCompactionStatus === 'skipped' && 'ℹ️ 当前没有足够的历史对话可压缩，继续使用原对话'}
          {contextCompactionStatus === 'failed' && '⚠️ 对话上下文压缩失败，已继续使用原对话'}
        </div>
      )}
      {memoryStatus && memoryStatus.status !== 'not_applicable' && (
        <div style={{ padding: '6px 20px', color: memoryStatus.status === 'failed' ? 'var(--error)' : 'var(--text-secondary)', fontSize: 12, background: 'var(--bg-secondary)' }}>
          {memoryStatus.status === 'processing' && '正在整理长期记忆'}
          {memoryStatus.status === 'saved' && '长期记忆已更新'}
          {memoryStatus.status === 'ignored' && '本次内容无需保存为长期记忆'}
          {memoryStatus.status === 'duplicate' && '长期记忆已处理'}
          {memoryStatus.status === 'failed' && `长期记忆整理失败${memoryStatus.error ? `：${memoryStatus.error}` : ''}`}
        </div>
      )}
      {isHealthCheck && !isStreamingHere ? null : (
        <ChatBottomDock
          showInput
          onSend={handleSend}
          onShellCommand={handleShellCommand}
          onStop={handleStop}
          disabled={isStreamingHere || contextCompactionStatus === 'compacting' || messageSelectMode}
          streaming={isStreamingHere}
          text={inputText}
          onTextChange={setInputText}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          maxAttachments={maxChatAttachments}
          attachmentTarget={`work:${workId}`}
          zcfRole={zcfRole}
          zcfMode={zcfMode}
          zcfRoles={zcfRoles}
          zcfModes={zcfModes}
          contextSnapshot={contextSnapshot}
          onZcfRoleChange={handleZcfRoleChange}
          onZcfModeChange={handleZcfModeChange}
        />
      )}
    </div>
  )
}

const LABEL_COLORS = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#339CFF',
  purple: '#a855f7',
}

const LABEL_OPTIONS = [
  { value: 'red', label: '红色' },
  { value: 'orange', label: '橙色' },
  { value: 'yellow', label: '黄色' },
  { value: 'green', label: '绿色' },
  { value: 'blue', label: '蓝色' },
  { value: 'purple', label: '紫色' },
]

function LabelDot({ workId, label }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const updateLabel = useWorksStore((s) => s.updateLabel)
  const labelNames = useWorksStore((s) => s.labelNames)

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', marginLeft: 'auto', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(!open)}
        title={label ? (labelNames[label] || label) : '标记颜色'}
        style={{
          width: 16, height: 16, borderRadius: '50%', border: '1px dashed var(--border, #d1d5db)',
          cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: label ? LABEL_COLORS[label] : 'transparent',
        }}
      >
        {!label && <span style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1 }}>●</span>}
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 100,
          background: 'var(--bg-primary, #fff)', border: '1px solid var(--border, #e5e7eb)',
          borderRadius: 8, padding: '8px', display: 'flex', gap: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}>
          {LABEL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              title={labelNames[opt.value] || opt.label}
              onClick={() => {
                updateLabel(workId, label === opt.value ? null : opt.value)
                setOpen(false)
              }}
              style={{
                width: 18, height: 18, borderRadius: '50%', border: 'none',
                cursor: 'pointer', padding: 0,
                background: LABEL_COLORS[opt.value],
                outline: label === opt.value ? '2px solid var(--text-primary, #333)' : 'none',
                outlineOffset: 1,
              }}
            />
          ))}
          {label && (
            <button
              title="清除"
              onClick={() => { updateLabel(workId, null); setOpen(false) }}
              style={{
                width: 18, height: 18, borderRadius: '50%',
                border: '1px dashed var(--border, #d1d5db)',
                cursor: 'pointer', padding: 0, background: 'transparent',
                fontSize: 10, color: 'var(--text-muted)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  )
}
