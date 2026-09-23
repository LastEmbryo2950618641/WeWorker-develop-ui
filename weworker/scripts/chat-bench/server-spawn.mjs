// self 模式：独立启动 backend-ts dev 后端（无 token，http-security.ts:23 放行），
// 轮询 GET /status 直到就绪。stopBackend 在 win32 用 taskkill /T 清整棵进程树（tsx→node 孙进程）。
import { spawn } from 'node:child_process'
import path from 'node:path'

/**
 * 轮询后端就绪。
 * @param {() => Promise<any>} getStatus  返回非空即视为就绪
 * @param {{timeout?:number, interval?:number}} opts
 */
export async function waitForReady(getStatus, { timeout = 60000, interval = 500 } = {}) {
  const deadline = Date.now() + timeout
  let lastErr = null
  while (Date.now() < deadline) {
    const s = await getStatus().catch((e) => { lastErr = e; return null })
    if (s) return true
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(
    `后端未在 ${timeout / 1000}s 内就绪（${lastErr ? lastErr.message : 'GET /status 无响应'}）。` +
    `请确认 ~/.weworker/settings.json 已配置 provider，且 backend-ts 已执行 npm install。`,
  )
}

/**
 * 用当前 node 直接跑 backend-ts 内置的 tsx CLI（node_modules/tsx/dist/cli.mjs），
 * 执行 `src/server.ts`（cwd=backendDir，--experimental-sqlite 启用 node:sqlite）。
 * 直接 spawn node + .mjs 入口，规避 Windows 上 spawn `npx.cmd` 的 EINVAL。
 * 不注入 WEWORKER_HTTP_TOKEN（后端放行）/ WEWORKER_PACKAGED（走 dev 路径）。
 * @param {{backendDir: string, onLog?: (line: string, stream: 'out'|'err') => void}} opts
 *   onLog：额外日志接收器（route-bench 用于 tee 到 route-out/<ts>/backend.log）；
 *   缺省时行为不变（仅转发控制台）。
 */
export function startBackend({ backendDir, onLog }) {
  const tsxEntry = path.join(backendDir, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const child = spawn(process.execPath, [tsxEntry, '--experimental-sqlite', 'src/server.ts'], {
    cwd: backendDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  const prefix = '[backend]'
  const pipe = (stream, log, streamName) => stream?.on('data', (d) => {
    String(d).split('\n').forEach((l) => {
      if (!l.trimEnd()) return
      log(`${prefix} ${l}`)
      if (onLog) { try { onLog(l, streamName) } catch { /* tee 失败不影响后端 */ } }
    })
  })
  pipe(child.stdout, console.log, 'out')
  pipe(child.stderr, console.error, 'err')
  child.on('exit', (code) => console.log(`${prefix} exited code=${code}`))
  return child
}

/** 停止后端（win32 需 /T /F 杀整棵树）。 */
export function stopBackend(child) {
  if (!child || child.exitCode != null) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
      setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000)
    }
  } catch {}
}
