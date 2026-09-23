/**
 * ask_user 待处理请求的共享状态（桌面端 SSE 模式）。
 *
 * 工具层 ask_user（tools.ts）注册一个 pending promise；前端点选后 POST /works/:id/user-choice
 * （server.ts）调 resolvePendingAskUser 解掉。api-query-router 的交互式确认门复用同一份状态，
 * 故抽到独立模块 —— 避免路由层为这点状态引入 tools.ts 的重依赖图。
 */
export interface AskUserRequest {
  toolCallId: string
  question: string
  options: Array<{ label: string; description?: string }>
  resolve: (answer: string) => void
}

const _pendingAskUser = new Map<string, AskUserRequest>()

export function setPendingAskUser(workId: string, req: AskUserRequest): void {
  _pendingAskUser.set(workId, req)
}

export function resolvePendingAskUser(workId: string, answer: string): boolean {
  const req = _pendingAskUser.get(workId)
  if (!req) return false
  _pendingAskUser.delete(workId)
  req.resolve(answer)
  return true
}

export function hasPendingAskUser(workId: string): boolean {
  return _pendingAskUser.has(workId)
}

export function getPendingAskUser(workId: string): AskUserRequest | undefined {
  return _pendingAskUser.get(workId)
}
