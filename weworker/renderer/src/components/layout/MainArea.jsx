import React from 'react'
import { useWorksStore } from '../../store/works.js'
import { useScheduledTasksStore } from '../../store/scheduled-tasks.js'
import ChatView from '../chat/ChatView.jsx'
import WelcomeScreen from '../welcome/WelcomeScreen.jsx'
import ChatBottomDock from '../chat/ChatBottomDock.jsx'
import MainWorkspaceShell from './MainWorkspaceShell.jsx'
import TaskConfigView from '../scheduled/TaskConfigView.jsx'
import ToolPackagePage from '../welcome/ToolPackagePage.jsx'
import { useSettingsStore } from '../../store/settings.js'
import { resolveStyleId } from '../../store/styles.js'
import { useChatInputFillStore } from '../../store/chat-input-fill.js'
import { useToolPackagePageStore } from '../../store/tool-package-page.js'
import { useExplorationPageStore } from '../../store/exploration-page.js'
import ExplorationPage from '../exploration/ExplorationPage.jsx'
import WebsiteExplorationPage from '../website-exploration/WebsiteExplorationPage.jsx'
import { useWebsiteExplorationStore } from '../../store/website-exploration.js'
import DedicatedAgentsPage from '../dedicated-agents/DedicatedAgentsPage.jsx'
import { useDedicatedAgentsStore } from '../../store/dedicated-agents.js'
import { requestChatWarmup } from '../../api/backend.js'

export default function MainArea({ onOpenSettings, sidebarWidth }) {
  const activeWorkId = useWorksStore((s) => s.activeWorkId)
  const createWork = useWorksStore((s) => s.createWork)
  const activeTaskId = useScheduledTasksStore((s) => s.activeTaskId)
  const toolPackageOpen = useToolPackagePageStore((s) => s.open)
  const explorationOpen = useExplorationPageStore((s) => s.open)
  const websiteOpen = useWebsiteExplorationStore((s) => s.open)
  const dedicatedAgentsOpen = useDedicatedAgentsStore((s) => s.open)
  const closeExplorationPage = useExplorationPageStore((s) => s.closePage)
  const closeToolPackagePage = useToolPackagePageStore((s) => s.closePage)
  const [inputText, setInputText] = React.useState('')
  const [attachments, setAttachments] = React.useState([])
  const maxChatAttachments = useSettingsStore((s) => s.maxChatAttachments)
  const zcfDefaultRole = useSettingsStore((s) => s.zcfDefaultRole)
  const zcfCustomRoles = useSettingsStore((s) => s.zcfCustomRoles)
  const fillSeq = useChatInputFillStore((s) => s.seq)
  const fillText = useChatInputFillStore((s) => s.text)

  // 已删除风格的残留 id（历史 auto-plan 等）在这里回落到仍可选的风格。
  const styleId = React.useMemo(
    () => resolveStyleId(zcfDefaultRole, zcfCustomRoles),
    [zcfDefaultRole, zcfCustomRoles],
  )

  React.useEffect(() => {
    if (fillSeq > 0 && !activeWorkId && !activeTaskId) {
      setInputText(fillText)
    }
  }, [activeTaskId, activeWorkId, fillSeq, fillText])

  const handleSendFromWelcome = async (text, files = [], thinkingEffort = 'off') => {
    setInputText('')
    setAttachments([])
    closeToolPackagePage()
    useWorksStore.setState({ pendingMessage: text, pendingAttachments: files, pendingThinkingEffort: thinkingEffort })
    await createWork({ styleId })
  }

  const handleShellCommandFromWelcome = async (command, originalText = '') => {
    const trimmed = String(command || '').trim()
    if (!trimmed) return
    setInputText('')
    setAttachments([])
    closeToolPackagePage()
    useWorksStore.setState({
      pendingShellCommand: {
        command: trimmed,
        originalText: originalText || `!${trimmed}`,
      },
    })
    await createWork({ styleId })
  }

  const handleFillInput = (text) => {
    setInputText(text)
  }

  if (websiteOpen) {
    return <MainWorkspaceShell><WebsiteExplorationPage onOpenSettings={onOpenSettings} /></MainWorkspaceShell>
  }

  if (dedicatedAgentsOpen) {
    return (
      <MainWorkspaceShell>
        <DedicatedAgentsPage sidebarWidth={sidebarWidth} />
      </MainWorkspaceShell>
    )
  }

  if (activeWorkId) {
    return (
      <MainWorkspaceShell>
        <ChatView key={activeWorkId} workId={activeWorkId} />
      </MainWorkspaceShell>
    )
  }

  if (activeTaskId) {
    return (
      <MainWorkspaceShell>
        <TaskConfigView taskId={activeTaskId} />
      </MainWorkspaceShell>
    )
  }

  if (toolPackageOpen) {
    return (
      <MainWorkspaceShell>
        <ToolPackagePage onClose={closeToolPackagePage} />
      </MainWorkspaceShell>
    )
  }

  if (explorationOpen) {
    return (
      <MainWorkspaceShell>
        <ExplorationPage onClose={closeExplorationPage} />
      </MainWorkspaceShell>
    )
  }

  return (
    <MainWorkspaceShell>
      <WelcomeScreen onFillInput={handleFillInput} />
      <ChatBottomDock
        onSend={handleSendFromWelcome}
        onShellCommand={handleShellCommandFromWelcome}
        text={inputText}
        onTextChange={setInputText}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        maxAttachments={maxChatAttachments}
        // Welcome screen has no work yet; the Backend pre-warms with the same
        // style handleSendFromWelcome will persist into the new work.
        onWarmup={(thinkingEffort) => requestChatWarmup(null, { thinkingEffort, styleId })}
      />
    </MainWorkspaceShell>
  )
}
