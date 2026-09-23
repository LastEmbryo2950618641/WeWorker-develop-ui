import {
  getRegisteredCommandCompletions,
  getRegisteredRootCommandCompletions,
  shouldUsePathCompletionForRegisteredCommand,
} from './terminal-completions/registry.js'

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '')
}

function flattenFiles(files, acc = []) {
  for (const item of files || []) {
    if (!item?.path) continue
    acc.push(item)
    if (item.children?.length) flattenFiles(item.children, acc)
  }
  return acc
}

function findTokenBounds(command, cursor) {
  const end = Math.max(0, Math.min(Number(cursor) || 0, command.length))
  let start = 0
  let quote = ''
  for (let index = 0; index < end; index += 1) {
    const character = command[index]
    if (quote) {
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (/\s/.test(character)) start = index + 1
  }
  return { start, end, token: command.slice(start, end) }
}

function parsePathToken(token) {
  const raw = String(token || '')
  const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : ''
  let value = quote ? raw.slice(1) : raw
  if (quote && value.endsWith(quote)) value = value.slice(0, -1)
  return { quote, value }
}

function formatPathCompletionValue(value, { quote = '', isDirectory = false, complete = true } = {}) {
  const pathValue = String(value || '')
  const wrapper = quote || (/\s/.test(pathValue) ? '"' : '')
  if (!wrapper) return pathValue
  return `${wrapper}${pathValue}${complete && !isDirectory ? wrapper : ''}`
}

function isCommandToken(command, cursor) {
  const value = String(command || '')
  const position = Math.max(0, Math.min(Number(cursor) || 0, value.length))
  const before = value.slice(0, position)
  return before.trimStart() === before && !/\s/.test(before)
}

function commonPrefix(values) {
  if (!values.length) return ''
  let prefix = values[0]
  for (const value of values.slice(1)) {
    let index = 0
    while (index < prefix.length && index < value.length && prefix[index].toLowerCase() === value[index].toLowerCase()) {
      index += 1
    }
    prefix = prefix.slice(0, index)
  }
  return prefix
}

function splitPathToken(token) {
  const normalized = String(token || '').replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  if (index < 0) return { dirPart: '', basePart: normalized }
  return {
    dirPart: normalized.slice(0, index + 1),
    basePart: normalized.slice(index + 1),
  }
}

function resolveSearchDirectory(cwd, root, dirPart) {
  const normalizedCwd = normalizePath(cwd || root)
  const dir = String(dirPart || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (!dir) return normalizedCwd
  if (/^[a-zA-Z]:\//.test(dir) || dir.startsWith('/')) return normalizePath(dir)
  return normalizePath(`${normalizedCwd}/${dir}`)
}

function parseLsLine(line) {
  const text = String(line || '').trim()
  if (!text || text.startsWith('total ')) return null

  const unixMatch = text.match(/^([\-dl])\S*\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/)
  if (unixMatch) {
    return {
      name: unixMatch[2],
      isDirectory: unixMatch[1] === 'd',
    }
  }

  const powershellMatch = text.match(/^(d|-)----\s+\S+\s+\S+\s+(?:(?:\S+)\s+)?(.+)$/i)
  if (powershellMatch && powershellMatch[2] !== 'Name') {
    return {
      name: powershellMatch[2],
      isDirectory: powershellMatch[1].toLowerCase() === 'd',
    }
  }

  return null
}

const COMMON_COMMANDS = [
  { name: 'webcli', description: 'WeWorker 网站工具命令' },
  { name: 'ls', description: '列出目录内容' },
  { name: 'cd', description: '切换目录' },
  { name: 'pwd', description: '显示当前目录' },
  { name: 'cat', description: '查看文件内容' },
  { name: 'grep', description: '搜索文本' },
  { name: 'find', description: '查找文件' },
  { name: 'mkdir', description: '创建目录' },
  { name: 'rm', description: '删除文件或目录' },
  { name: 'cp', description: '复制文件或目录' },
  { name: 'mv', description: '移动或重命名' },
  { name: 'git', description: 'Git 版本控制' },
  { name: 'npm', description: 'Node 包管理' },
  { name: 'pnpm', description: 'PNPM 包管理' },
  { name: 'yarn', description: 'Yarn 包管理' },
  { name: 'node', description: '运行 Node.js' },
  { name: 'python', description: '运行 Python' },
  { name: 'py', description: 'Windows Python launcher' },
  { name: 'pip', description: 'Python 包管理' },
  { name: 'where', description: '查找 Windows 命令路径' },
  { name: 'which', description: '查找命令路径' },
  { name: 'whoami', description: '显示当前用户' },
  { name: 'date', description: '显示日期时间' },
  { name: 'curl', description: '发送 HTTP 请求' },
  { name: 'ssh', description: '连接远程主机' },
  { name: 'docker', description: 'Docker 容器管理' },
  { name: 'kubectl', description: 'Kubernetes 管理' },
  { name: 'bash', description: '启动 Bash' },
  { name: 'powershell', description: '启动 PowerShell' },
  { name: 'pwsh', description: '启动 PowerShell Core' },
  { name: 'cmd', description: '启动 Windows cmd' },
  { name: 'tasklist', description: '查看进程列表' },
  { name: 'ps', description: '查看进程' },
]

const WEBCLI_ROOT_COMPLETIONS = [
  { name: 'call', value: 'call ', kind: 'webcli', description: '调用网站工具' },
  { name: 'adapter', value: 'adapter ', kind: 'webcli', description: '管理站点 adapter' },
  { name: 'service', value: 'service ', kind: 'webcli', description: '管理本地 webcli 服务' },
  { name: 'install --skills', value: 'install --skills ', kind: 'webcli', description: '安装 adapter skills' },
  { name: 'extension-path', value: 'extension-path ', kind: 'webcli', description: '显示扩展目录' },
  { name: 'trace', value: 'trace ', kind: 'webcli', description: '查看 trace 详情' },
  { name: '--help', value: '--help ', kind: 'option', description: '显示帮助' },
  { name: '--version', value: '--version ', kind: 'option', description: '显示版本' },
]

const WEBCLI_SERVICE_COMPLETIONS = [
  { name: 'start', value: 'start ', kind: 'webcli', description: '启动服务' },
  { name: 'stop', value: 'stop ', kind: 'webcli', description: '停止服务' },
  { name: 'status', value: 'status ', kind: 'webcli', description: '查看服务状态' },
  { name: 'logs', value: 'logs ', kind: 'webcli', description: '查看服务日志' },
]

const WEBCLI_ADAPTER_COMPLETIONS = [
  { name: 'list', value: 'list ', kind: 'webcli', description: '列出 adapter' },
  { name: 'info', value: 'info ', kind: 'webcli', description: '查看 adapter 信息' },
  { name: 'skill', value: 'skill ', kind: 'webcli', description: '查看 adapter skill' },
  { name: 'knowledge', value: 'knowledge ', kind: 'webcli', description: '查看 adapter knowledge' },
  { name: 'skills-path', value: 'skills-path ', kind: 'webcli', description: '显示 skills 目录' },
  { name: 'install', value: 'install ', kind: 'webcli', description: '安装 adapter' },
  { name: 'remove', value: 'remove ', kind: 'webcli', description: '移除 adapter' },
]

const WEBCLI_TOOL_COMPLETIONS = [
  { name: 'open_browser', value: 'open_browser ', kind: 'tool', description: '打开网站页面' },
  { name: 'click', value: 'click ', kind: 'tool', description: '点击页面元素' },
  { name: 'input_text', value: 'input_text ', kind: 'tool', description: '输入文本' },
  { name: '--args', value: '--args ', kind: 'option', description: '传入 JSON 参数' },
]

const WEBCLI_PATH_OPTIONS = new Set(['--file', '--target'])
const WEBCLI_VALUE_OPTIONS = new Set(['--url', '--args'])
const WEBCLI_ADAPTER_ID_SUBCOMMANDS = new Set(['info', 'skill', 'knowledge', 'remove'])

function filterCompletionCandidates(candidates, query) {
  const normalizedQuery = String(query || '').toLowerCase()
  if (!normalizedQuery) return candidates
  return candidates.filter((item) => (
    item.name.toLowerCase().startsWith(normalizedQuery)
    || String(item.value || '').toLowerCase().startsWith(normalizedQuery)
  ))
}

function getSiteIdCompletionCandidates(sites = []) {
  const seen = new Set()
  return (Array.isArray(sites) ? sites : [])
    .map((site) => ({
      id: String(site?.id || '').trim(),
      name: String(site?.name || site?.id || '').trim(),
      enabled: site?.enabled !== false,
    }))
    .filter((site) => {
      if (!site.id || seen.has(site.id)) return false
      seen.add(site.id)
      return true
    })
    .map((site) => ({
      name: site.id,
      value: `${site.id} `,
      kind: 'site',
      description: site.name && site.name !== site.id ? site.name : '站点 adapter',
      enabled: site.enabled,
    }))
}

function getSiteToolCompletionCandidates(sites = []) {
  const seen = new Set()
  const candidates = []
  for (const site of Array.isArray(sites) ? sites : []) {
    const siteName = site?.name || site?.id || '站点工具'
    for (const tool of site?.tools || []) {
      const name = String(tool?.name || '').trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      candidates.push({
        name,
        value: `${name} `,
        kind: 'tool',
        description: `${siteName} · ${tool?.description || '站点工具'}`,
      })
    }
  }
  return candidates
}

function getWebcliTokens(command, cursor) {
  const value = String(command || '')
  const position = Math.max(0, Math.min(Number(cursor) || 0, value.length))
  const before = value.slice(0, position)
  const trimmed = before.trim()
  if (!trimmed) return null

  const parts = trimmed.split(/\s+/)
  if (parts[0] !== 'webcli') return null

  const endsWithSpace = position > 0 && /\s/.test(value[position - 1])
  const current = endsWithSpace ? '' : (parts[parts.length - 1] || '')
  const args = endsWithSpace ? parts.slice(1) : parts.slice(1, -1)
  return { args, current }
}

function webcliCandidatesForArgs(args, sites = []) {
  const [command, subcommand] = args

  if (!command) return WEBCLI_ROOT_COMPLETIONS

  if (command === 'service') {
    if (!subcommand) return WEBCLI_SERVICE_COMPLETIONS
    if (subcommand === 'start') return [
      { name: '--daemon', value: '--daemon ', kind: 'option', description: '后台启动服务' },
      { name: '-d', value: '-d ', kind: 'option', description: '后台启动服务' },
    ]
    if (subcommand === 'logs') return [
      { name: '--follow', value: '--follow ', kind: 'option', description: '持续输出日志' },
      { name: '-f', value: '-f ', kind: 'option', description: '持续输出日志' },
    ]
    return []
  }

  if (command === 'adapter') {
    if (!subcommand) return WEBCLI_ADAPTER_COMPLETIONS
    if (WEBCLI_ADAPTER_ID_SUBCOMMANDS.has(subcommand) && args.length === 2) return getSiteIdCompletionCandidates(sites)
    if (subcommand === 'list') return [
      { name: '--json', value: '--json ', kind: 'option', description: '输出 JSON' },
    ]
    if (subcommand === 'skill') return [
      { name: '--generated', value: '--generated ', kind: 'option', description: '查看生成版本' },
      { name: '--regenerate', value: '--regenerate ', kind: 'option', description: '重新生成 skill' },
      { name: '--overwrite', value: '--overwrite ', kind: 'option', description: '覆盖已有文件' },
    ]
    if (subcommand === 'knowledge') return [
      { name: '--json', value: '--json ', kind: 'option', description: '输出 JSON' },
    ]
    if (subcommand === 'install') return [
      { name: '--url', value: '--url ', kind: 'option', description: '从 URL 安装 adapter' },
      { name: '--file', value: '--file ', kind: 'option', description: '从本地文件安装 adapter' },
      { name: '--reload', value: '--reload ', kind: 'option', description: '安装后重载' },
    ]
    if (subcommand === 'remove') return [
      { name: '--reload', value: '--reload ', kind: 'option', description: '移除后重载' },
    ]
    return []
  }

  if (command === 'call') {
    if (!subcommand) return [...getSiteToolCompletionCandidates(sites), ...WEBCLI_TOOL_COMPLETIONS]
    return [
      { name: '--args', value: '--args ', kind: 'option', description: '传入 JSON 参数' },
    ]
  }

  if (command === 'install' && subcommand === '--skills') return getSiteIdCompletionCandidates(sites)

  if (command === 'install') return [
    { name: '--skills', value: '--skills ', kind: 'option', description: '安装 skills' },
    { name: '--target', value: '--target ', kind: 'option', description: '指定安装目录' },
  ]

  return []
}

export function getTerminalCommandCompletionCandidates({ command, cursor, includeEmpty = false }) {
  const value = String(command || '')
  const position = Math.max(0, Math.min(Number(cursor) || 0, value.length))
  if (!isCommandToken(value, position)) return []
  const { token } = findTokenBounds(value, position)
  const query = String(token || '').toLowerCase()
  if (!query && !includeEmpty) return []

  const registered = getRegisteredRootCommandCompletions(query)
  const seen = new Set(registered.map((item) => item.name.toLowerCase()))
  const common = COMMON_COMMANDS
    .filter((item) => item.name.toLowerCase().startsWith(query))
    .filter((item) => !seen.has(item.name.toLowerCase()))
    .slice(0, 12)
    .map((item) => ({
      name: item.name,
      value: `${item.name} `,
      isDirectory: false,
      kind: 'cmd',
      description: item.description,
    }))

  return [...registered, ...common].slice(0, 12)
}

export function getWebcliCompletionCandidates({ command, cursor, sites, shell }) {
  return getRegisteredCommandCompletions({
    command,
    cursor,
    context: { sites, shell },
  })
}

export function shouldUsePathCompletionForCommand({ command, cursor }) {
  return shouldUsePathCompletionForRegisteredCommand({ command, cursor })
}

export function getTerminalCompletionCandidates({ command, cursor, cwd, root, files }) {
  const value = String(command || '')
  const position = Math.max(0, Math.min(Number(cursor) || 0, value.length))
  if (isCommandToken(value, position) && value.trim()) return []
  const { token } = findTokenBounds(value, position)
  const parsedToken = parsePathToken(token)
  const { dirPart, basePart } = splitPathToken(parsedToken.value)
  const searchDir = resolveSearchDirectory(cwd, root, dirPart)
  const normalizedRoot = normalizePath(root)

  if (!normalizedRoot || !searchDir) return []

  return flattenFiles(files)
    .filter((item) => normalizePath(item.path).startsWith(normalizedRoot))
    .filter((item) => normalizePath(item.path).split('/').slice(0, -1).join('/') === searchDir)
    .filter((item) => item.name.toLowerCase().startsWith(basePart.toLowerCase()))
    .sort((a, b) => {
      if (a.is_directory !== b.is_directory) return a.is_directory ? -1 : 1
      return String(a.name).localeCompare(String(b.name), 'zh-CN', { sensitivity: 'base', numeric: true })
    })
    .map((item) => ({
      name: String(item.name),
      value: formatPathCompletionValue(`${dirPart}${item.name}${item.is_directory ? '/' : ''}`, {
        quote: parsedToken.quote,
        isDirectory: Boolean(item.is_directory),
      }),
      isDirectory: Boolean(item.is_directory),
    }))
}

export function getTerminalHistoryCompletionCandidates({ command, cursor, sessions }) {
  const value = String(command || '')
  const position = Math.max(0, Math.min(Number(cursor) || 0, value.length))
  if (isCommandToken(value, position)) return []
  const { token } = findTokenBounds(value, position)
  const parsedToken = parsePathToken(token)
  const { dirPart, basePart } = splitPathToken(parsedToken.value)
  if (dirPart) return []

  const seen = new Set()
  return (sessions || [])
    .flatMap((session) => String(session?.output || '').split(/\r?\n/))
    .map(parseLsLine)
    .filter(Boolean)
    .filter((item) => item.name.toLowerCase().startsWith(basePart.toLowerCase()))
    .filter((item) => {
      const key = item.name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return String(a.name).localeCompare(String(b.name), 'zh-CN', { sensitivity: 'base', numeric: true })
    })
    .map((item) => ({
      name: item.name,
      value: formatPathCompletionValue(`${item.name}${item.isDirectory ? '/' : ''}`, {
        quote: parsedToken.quote,
        isDirectory: item.isDirectory,
      }),
      isDirectory: item.isDirectory,
    }))
}

export function getChatBangCompletionCandidates({
  command,
  cursor,
  sites,
  shell,
  cwd,
  root,
  files,
  sessions,
  source = 'auto',
  includeEmpty = true,
}) {
  if (source !== 'files') {
    const commandCandidates = getTerminalCommandCompletionCandidates({ command, cursor, includeEmpty })
    if (commandCandidates.length) return commandCandidates
    const registeredCandidates = getWebcliCompletionCandidates({ command, cursor, sites, shell })
    if (registeredCandidates.length || source === 'commands') return registeredCandidates
  }

  if (source !== 'files' && !shouldUsePathCompletionForCommand({ command, cursor })) return []
  const pathCandidates = getTerminalCompletionCandidates({ command, cursor, cwd, root, files })
  if (pathCandidates.length) return pathCandidates
  return getTerminalHistoryCompletionCandidates({ command, cursor, sessions })
}

export function completeTerminalCommand({ command, cursor, cwd, root, files }) {
  const value = String(command || '')
  const position = Math.max(0, Math.min(Number(cursor) || 0, value.length))
  const { start, end, token } = findTokenBounds(value, position)
  const parsedToken = parsePathToken(token)
  const { dirPart, basePart } = splitPathToken(parsedToken.value)
  const candidates = getTerminalCompletionCandidates({ command: value, cursor: position, cwd, root, files })

  if (!candidates.length) return { command: value, cursor: position, completed: false }

  const names = candidates.map((item) => item.name)
  const prefix = commonPrefix(names)
  const replacementName = candidates.length === 1 ? names[0] : prefix
  if (!replacementName) return { command: value, cursor: position, completed: false }

  const replacement = candidates.length === 1
    ? candidates[0].value
    : formatPathCompletionValue(`${dirPart}${replacementName}`, { quote: parsedToken.quote, complete: false })
  if (replacement === token) return { command: value, cursor: position, completed: false }
  const nextCommand = `${value.slice(0, start)}${replacement}${value.slice(end)}`
  const nextCursor = start + replacement.length
  return { command: nextCommand, cursor: nextCursor, completed: true }
}

export function acceptTerminalCompletion({ command, cursor, candidate }) {
  const value = String(command || '')
  const position = Math.max(0, Math.min(Number(cursor) || 0, value.length))
  const { start, end } = findTokenBounds(value, position)
  const replacement = String(candidate?.value || '')
  if (!replacement) return { command: value, cursor: position, completed: false }

  const nextCommand = `${value.slice(0, start)}${replacement}${value.slice(end)}`
  const nextCursor = start + replacement.length
  return { command: nextCommand, cursor: nextCursor, completed: true }
}
