import { app, BrowserWindow, Menu, nativeImage, protocol } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'
import { randomBytes, randomUUID } from 'crypto'
import {
  BridgeManager,
  NodeManager,
  WebwrightManager,
  readConfiguredUserFilesDir,
  resolveWebwrightHome,
} from './managers.js'
import { registerIpcHandlers } from './ipc-handlers.js'
import { UpdateManager } from './update-manager.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged
const devRendererUrl = process.env.WEWORKER_RENDERER_DEV_URL || process.env.WEWORKER_DEV_SERVER_URL || 'http://localhost:5173'

// ── Load metrics env (~/.webcli/metrics.env) ─────────────────────────────────
// 从固定路径读取埋点上报配置（KEY=VALUE），注入 process.env。
// Bridge 子进程（utilityProcess.fork）继承主进程 env，从而拿到三件套：
//   WEBCLI_METRICS_UPLOAD=on / WEBCLI_METRICS_ENDPOINT / WEBCLI_METRICS_TOKEN
// 文件不存在或读取失败则静默跳过（不上报，不影响主流程）。
function loadMetricsEnv() {
  try {
    const envFile = path.join(os.homedir(), '.webcli', 'metrics.env')
    const content = fs.readFileSync(envFile, 'utf8')
    for (const raw of content.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (key.startsWith('WEBCLI_METRICS')) process.env[key] = val
    }
  } catch { /* 文件不存在或不可读：静默，不上报 */ }
}
loadMetricsEnv()

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'weworker-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

const LOCAL_FILE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
}

function registerLocalFileProtocol() {
  protocol.handle('weworker-file', async (request) => {
    try {
      const url = new URL(request.url)
      const filePath = url.searchParams.get('path')
      if (!filePath) return new Response('missing path', { status: 400 })
      const resolved = path.resolve(filePath)
      const stat = await fs.promises.stat(resolved)
      if (!stat.isFile()) return new Response('not found', { status: 404 })
      const ext = path.extname(resolved).toLowerCase()
      const body = await fs.promises.readFile(resolved)
      return new Response(body, {
        headers: {
          'Content-Type': LOCAL_FILE_MIME[ext] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

// ── Logging setup ────────────────────────────────────────────────────────────
const logDir = process.platform === 'darwin'
  ? path.join(app.getPath('home'), 'Library', 'Logs', 'WeWorker')
  : path.join(app.getPath('userData'), 'logs')
fs.mkdirSync(logDir, { recursive: true })
export const logFile = path.join(logDir, 'main.log')
// Overwrite on each launch — keeps the log fresh and bounded
const logStream = fs.createWriteStream(logFile, { flags: 'w' })
let stdoutWritable = true
let logFileWritable = true

process.stdout.on('error', (err) => {
  if (err?.code === 'EPIPE') {
    stdoutWritable = false
    return
  }
  stdoutWritable = false
})

logStream.on('error', () => {
  logFileWritable = false
})

function safeWrite(stream, msg, onError) {
  try {
    stream.write(msg)
  } catch {
    onError?.()
  }
}

function log(line) {
  // If the line already starts with our logger timestamp format (YYYY-MM-DD HH:MM:SS),
  // write it directly without adding another timestamp (avoids double-timestamp from backend logger)
  const hasTimestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(line)
  if (hasTimestamp) {
    const msg = line + '\n'
    if (stdoutWritable) safeWrite(process.stdout, msg, () => { stdoutWritable = false })
    if (logFileWritable) safeWrite(logStream, msg, () => { logFileWritable = false })
    return
  }
  const d = new Date()
  const pad2 = (n) => String(n).padStart(2, '0')
  const pad3 = (n) => String(n).padStart(3, '0')
  const ts = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`
  const msg = `${ts} ${line}\n`
  if (stdoutWritable) safeWrite(process.stdout, msg, () => { stdoutWritable = false })
  if (logFileWritable) safeWrite(logStream, msg, () => { logFileWritable = false })
}

// Capture uncaught errors in main process
process.on('uncaughtException', (err) => log(`[main] uncaughtException: ${err.stack || err}`))
process.on('unhandledRejection', (reason) => log(`[main] unhandledRejection: ${reason}`))

let mainWindow
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}
const httpAuthToken = randomBytes(32).toString('base64url')
const webwrightModelToken = randomBytes(32).toString('base64url')
const explorationInstanceId = randomUUID()
const webwrightHome = resolveWebwrightHome()
const userFilesDir = readConfiguredUserFilesDir()
const bridgeManager = new BridgeManager(log, path.dirname(logFile))
const pythonManager = new NodeManager(log, logFile, httpAuthToken, webwrightHome, webwrightModelToken, explorationInstanceId)
const webwrightManager = new WebwrightManager({
  log,
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  repoRoot: path.resolve(__dirname, '../..'),
  webwrightHome,
  userFilesDir,
  modelConfigToken: webwrightModelToken,
  explorationInstanceId,
})
let isInstallingUpdate = false
const updateManager = new UpdateManager({
  log,
  getWindow: () => mainWindow,
  beforeInstall: async () => {
    isInstallingUpdate = true
    await Promise.allSettled([webwrightManager.stop(), pythonManager.stop(), bridgeManager.stop()])
  },
})

async function createWindow() {
  // Hide the default menu bar on Windows/Linux (macOS uses system menu bar)
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  }

  const iconPath = path.join(__dirname, '../asset/logo.png')
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 400,
    title: isDev ? 'WeWorker (开发版)' : 'WeWorker',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    titleBarStyle: 'hiddenInset',
    ...(process.platform !== 'darwin' ? { titleBarOverlay: { color: '#00000000', symbolColor: '#666666', height: 38 } } : {}),
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL(devRendererUrl)
    // UI E2E attaches over CDP; auto DevTools steals the only page handle puppeteer sees.
    if (!process.env.WEWORKER_E2E) {
      mainWindow.webContents.openDevTools()
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'))
  }
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  log('[main] app ready')

  // Set app icon from logo.png (dev + production fallback)
  const logoPath = path.join(__dirname, '../asset/logo.png')
  if (fs.existsSync(logoPath)) {
    const icon = nativeImage.createFromPath(logoPath)
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(icon)
    }
    // mainWindow icon set below after creation
  }

  registerIpcHandlers(bridgeManager, pythonManager, webwrightManager, httpAuthToken, updateManager)
  registerLocalFileProtocol()

  // Webwright health checks must not delay the main window. Its status remains
  // independently observable through IPC while the existing services start.
  void webwrightManager.start().catch((error) => log(`[webwright] startup failed: ${error.message}`))

  // Start bridge and backend in parallel.
  await Promise.allSettled([bridgeManager.start(), pythonManager.start()])

  await createWindow()
  updateManager.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Electron's `before-quit` does NOT await the async handler — the app proceeds to
// quit while cleanup is still pending, leaving utilityProcess children (bridge,
// backend-ts) orphaned and the port 3711 still bound. Pattern: on the first
// before-quit, prevent the default quit, await cleanup, then call app.exit() to
// actually terminate after subprocesses are reaped.
let isCleaningUp = false
app.on('before-quit', async (event) => {
  if (isInstallingUpdate) return
  if (isCleaningUp) return
  isCleaningUp = true
  event.preventDefault()
  log('[main] before-quit — stopping subprocesses')
  try {
    await Promise.allSettled([webwrightManager.stop(), pythonManager.stop(), bridgeManager.stop()])
  } catch (err) {
    log(`[main] cleanup error: ${err?.message || err}`)
  }
  log('[main] cleanup done — exiting')
  app.exit(0)
})
