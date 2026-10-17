#!/usr/bin/env node
/**
 * WebCLI Adapter — CLI entry point
 *
 * Commands:
 *   webcli service start [-d]   Start WebSocket bridge (foreground or daemon)
 *   webcli service stop         Stop background service
 *   webcli service status       Show service status
 *   webcli service logs [-f]    View service logs
 *
 *   webcli adapter <...>        Manage adapters (install / list / remove / refresh)
 *   webcli adapterhub <...>     Browse and install AdapterHub packages
 *   webcli call <tool_name>     Call an adapter tool (for debugging)
 *   webcli extension-path       Print bundled extension directory
 *
 *   webcli --version            Show version
 *   webcli --help               Show help
 */

import { spawn } from "child_process";
import { openSync, existsSync, statSync, readSync, closeSync, realpathSync } from "fs";
import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import { homedir } from "os";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { WebSocket } from "ws";
import { randomUUID } from "crypto";
import { resolveToolCallTimeout } from "./tool-timeouts.js";
import { formatCallOutput, resolveOutputFormat } from "./output-format.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// CLI 进程启动时刻：随 call_tool 一起发给 bridge，用于把「内置 shell → CLI 启动」
// 与「bridge 派发」「扩展内部执行」分开观测（bridge 侧的调用分段日志）。
const CLI_STARTED_AT = Date.now();

const WS_PORT    = 3711;
const WEBCLI_DIR = join(homedir(), ".webcli");
const WEBMCP_DIR = join(homedir(), ".webmcp"); // backward compat

function getConfigDir() {
  if (existsSync(join(homedir(), ".webcli"))) return join(homedir(), ".webcli");
  if (existsSync(join(homedir(), ".webmcp"))) return join(homedir(), ".webmcp");
  return join(homedir(), ".webcli"); // new install default
}

const PID_FILE   = join(getConfigDir(), "service.pid");
const LOG_FILE   = join(getConfigDir(), "service.log");
const TRACE_LOG_READ_BYTES = 2 * 1024 * 1024;

// ─── Help & version ──────────────────────────────────────────────────────────

const HELP = `
webcli <command> [options]

Service:
  service start [-d, --daemon]   启动 WebSocket bridge（-d 后台运行）
  service stop                   停止后台服务
  service status                 查看服务状态
  service logs [-f, --follow]    查看服务日志

API exploration (standalone, no desktop/model key required):
  call exploration.help                    探索、草稿编辑、验证与安装命令
  call browser.help                        浏览器会话、页面操作与网络检查

Adapters:
  list                                     列出已安装的 adapter（adapter list 的简写）
  help                                     已安装 adapter 摘要（渐进式 help 第一级）
  <adapter> help                           单个 adapter 的命令列表（第二级）
  <adapter> <command> help                 单个命令参数说明（第三级）
  adapter validate <dir>                   校验 v2 adapter 包（结构+禁入文件，规范 docs/adapter_package_spec.md）
  adapter list                             列出已安装的 adapter
  adapter list --json                      JSON 格式输出（含工具定义）
  adapter info <id>                        查看 adapter 的工具列表
  adapter skill <id>                       输出 SKILL.md 内容
  adapter skill <id> --generated           输出 SKILL.generated.md 内容
  adapter skill <id> --regenerate          重新生成 skill（生成式 adapter 默认写 SKILL.generated.md）
  adapter skill <id> --regenerate --overwrite 覆盖写入 SKILL.md
  adapter knowledge <id>                   输出 WEBCLI_KNOWLEDGE.md 内容
  adapter knowledge <id> --json            输出 WEBCLI_KNOWLEDGE.json 内容
  adapter skills-path                      输出 adapters 目录路径
  adapter install --url <url> [--reload]   从 URL 安装（仅 https）
  adapter install --file <path> [--reload] 从本地文件安装
  adapter remove  <id>  [--reload]         移除 adapter

AdapterHub:
  adapterhub list [--origin official|user] [--installed] [--json]   列出线上 / 本地已安装 Adapter
  adapterhub find <keyword> [--json]                   按名称、域名、用途检索
  adapterhub info <adapter> [--json]                  查看 Adapter 详情（含推荐提示词）
  adapterhub versions <adapter> [--json]              查看版本历史
  adapterhub commands <adapter> [--json]              查看命令清单与参数
  adapterhub download <adapter>[@<版本>] [-o <file>] [--json]  下载 .adapt 包
  adapterhub validate <file.adapt>                    离线校验包结构与哈希
  adapterhub pack <目录> [-o <file.adapt>] [--json]   将目录打包为 .adapt
  adapterhub install <adapter>[@<版本>] | <本地.adapt> [--force] [--reload] [--json]
                                                       安装/升级整个 Adapter
  adapterhub update [<adapter>|--all] [--force] [--dry-run] [--json]
                                                       检查并更新已安装 Adapter
  adapterhub installed [--json]                       列出本地已安装 Adapter
  adapterhub remove <adapter> [--reload] [--json]     卸载 Adapter
  adapterhub publish <目录或.adapt> [--yes] [--json]  发布/更新 Adapter（需 ADAPTERHUB_TOKEN）
  adapterhub endpoint [--json]                        打印当前 AdapterHub 端点

Tools:
  call <tool_name> [--key=value ...] [-v, --verbose] [--output-format=markdown|json]
                                  调用 Adapter 工具（Extension 自动启动 Bridge；Toolkit 直接运行）
                                  参数直接以 --key=value 形式传递：
                                    webcli call open_browser --url=http://jd.com
                                    webcli call jd.com.search_products --keyword=手机 --limit=5
                                  数组/对象用 JSON 字面量：
                                    webcli call tool --fields='{"标题":"xxx"}'
                                    webcli call tool --approvers='["zhangsan","lisi"]'
                                  同名 flag 重复出现会聚合成数组：
                                    webcli call tool --tags=web --tags=api
                                  兼容旧格式：--args '{"url":"http://jd.com"}'
                                  输出格式：终端默认 markdown（按站点列名映射渲染），管道/脚本默认 json；
                                  需要结构化数据时显式用 --output-format=json
  webcli <site> <command...> [--key=value ...] [-v, --verbose] [--output-format=markdown|json]
                                  按 WeCLI 风格调用 site.command 工具
  webcli <site> [-help] [-f json]
                                  查看某站点的全部工具（-f json 结构化输出）

Stats:
  stats                          各 domain 调用频次（本地），按次数倒序
  stats --by tool                按具体工具聚合
  stats --since 7d               近 7 天（支持 d/h/m，默认 30d）
  stats --kind adapter           只看 adapter（或 builtin）
  stats --top 10                 只展示 top N
  stats --json                   JSON 输出
  stats --remote                 查询服务端全团队汇总（需配置 WEBCLI_METRICS_ENDPOINT）

Skills:
  install --skills [adapter-id]          安装 skill 到 ~/.claude/skills/
  install --skills --target <dir>        安装 skill 到指定目录

Extension:
  extension-path                 输出扩展目录路径

Tracing:
  trace <traceID>                按 traceID 查询服务日志

Options:
  --version        显示版本（兼容：单独执行 webcli -v）
  -v, --verbose    调用工具时输出 trace 日志
  --output-format=markdown|json  调用工具输出格式（终端默认 markdown，管道/脚本默认 json）
  -h, --help       显示帮助
`.trim();

/**
 * 全局帮助：动态显示已安装站点列表 + Agent tip。
 * - 文本模式：HELP 顶部插入 Site adapters 列表
 * - JSON 模式（-f json）：输出结构化数据（agent 可解析）
 */
async function printGlobalHelp({ json = false } = {}) {
  let adapters = [];
  try {
    const { loadAdapterViews } = await import("./adapter-cli.js");
    adapters = await loadAdapterViews();
  } catch {
    adapters = [];
  }
  const sites = adapters
    .map((a) => ({ id: a.id, name: a.name || a.id }))
    .sort((x, y) => x.id.localeCompare(y.id));

  if (json) {
    const data = {
      name: "webcli",
      usage: "webcli <command> [options]",
      description: "WeWorker 网站工具 CLI：调用浏览器站点自动化工具，管理适配器与统计",
      commands: [
        { name: "call <tool>", usage: "webcli call <tool_name> [--key=value ...]", description: "调用站点工具" },
        { name: "exploration", usage: "webcli call exploration.help", description: "独立 API 探索、Agent 草稿编辑、验证与本地安装" },
        { name: "adapter", usage: "webcli adapter <command>", description: "管理网站适配器" },
        { name: "service", usage: "webcli service <start|stop|status|logs>", description: "管理 WebSocket bridge 服务" },
        { name: "stats", usage: "webcli stats", description: "调用频次统计" },
        { name: "install --skills", usage: "webcli install --skills [adapter-id]", description: "安装 adapter skills" },
        { name: "trace <id>", usage: "webcli trace <traceID>", description: "按 traceID 查日志" },
        { name: "extension-path", usage: "webcli extension-path", description: "输出扩展目录路径" },
      ],
      site_adapters: {
        count: sites.length,
        sites,
      },
      next: [
        "webcli call <tool> --key=value ...",
        "webcli adapter -help",
        "webcli adapter <id> -help -f json",
      ],
    };
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const siteText = sites.length
    ? `Site adapters (${sites.length}): ${sites.map((s) => s.id).join(", ")}`
    : "Site adapters (0): 未安装 adapter";
  const agentTip = `
Agent tip: use 'webcli call <tool> --key=value ...' to invoke a tool.
           use 'webcli adapter -help' to manage adapters.
           use 'webcli adapter <id> -help -f json' for structured tools.
`;
  // wecli 风格：站点列表紧跟 Usage 行（HELP 首行），Agent tip 在末尾
  const helpLines = HELP.split("\n");
  const usageLine = helpLines[0]; // "webcli <command> [options]"
  const rest = helpLines.slice(1).join("\n");
  console.log(`${usageLine}\n\n${siteText}\n${rest}${agentTip}`);
}

async function printVersion() {
  try {
    const pkgPath = join(__dirname, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    console.log(`webcli ${pkg.version}`);
  } catch {
    console.log("webcli (unknown version)");
  }
}

// ─── Service helpers ──────────────────────────────────────────────────────────

async function checkPortListening() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${WS_PORT}`);
    const t = setTimeout(() => { ws.terminate(); resolve(false); }, 2000);
    ws.on("open",  () => { clearTimeout(t); ws.close(); resolve(true);  });
    ws.on("error", () => { clearTimeout(t);              resolve(false); });
  });
}

async function readPid() {
  try { return parseInt(await readFile(PID_FILE, "utf8"), 10); }
  catch { return null; }
}

function isPidRunning(pid) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

function getServiceNodeArgs() {
  const args = [...process.execArgv];
  if (process.allowedNodeEnvironmentFlags?.has("--use-system-ca")
      && !args.includes("--use-system-ca")
      && !args.includes("--use-bundled-ca")
      && !args.includes("--use-openssl-ca")) {
    args.push("--use-system-ca");
  }
  args.push(__filename, "--service");
  return args;
}

// ─── Command: service start ──────────────────────────────────────────────────

async function cmdServiceStart(daemon, report = console.log) {
  if (daemon) {
    await mkdir(WEBCLI_DIR, { recursive: true });

    // Check if already running
    const existing = await readPid();
    if (existing && isPidRunning(existing)) {
      report(`WebCLI service is already running (PID: ${existing})`);
      return;
    }

    const logFd  = openSync(LOG_FILE, "a");
    const child  = spawn(process.execPath, getServiceNodeArgs(), {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
    await writeFile(PID_FILE, String(child.pid));

    report(`✓ WebCLI service started in background (PID: ${child.pid})`);
    report(`  Logs:   ${LOG_FILE}`);
    report(`  Stop:   webcli service stop`);
    report(`  Status: webcli service status`);
  } else {
    // Foreground — hand off to service mode
    await runServiceMode();
  }
}

// ─── Command: service stop ───────────────────────────────────────────────────

async function cmdServiceStop() {
  const pid = await readPid();
  if (!pid) {
    console.log("WebCLI service is not running (no PID file found)");
    return;
  }
  if (!isPidRunning(pid)) {
    console.log(`PID ${pid} is no longer running — cleaning up stale PID file`);
    await unlink(PID_FILE).catch(() => {});
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    await unlink(PID_FILE).catch(() => {});
    console.log(`✓ WebCLI service stopped (PID: ${pid})`);
  } catch (e) {
    console.error(`Failed to stop service: ${e.message}`);
  }
}

// ─── Command: service status ─────────────────────────────────────────────────

async function cmdServiceStatus() {
  const listening = await checkPortListening();
  const pid = await readPid();
  const pidRunning = pid ? isPidRunning(pid) : false;

  if (listening) {
    const pidStr = pidRunning ? ` (PID: ${pid})` : "";
    console.log(`✓ WebCLI service is running on ws://localhost:${WS_PORT}${pidStr}`);
  } else {
    console.log("✗ WebCLI service is not running");
    if (pid && !pidRunning) {
      console.log("  (stale PID file found — run 'webcli service stop' to clean up)");
    }
    console.log("  Start with: webcli service start -d");
  }
}

// ─── Command: service logs ───────────────────────────────────────────────────

async function cmdServiceLogs(follow) {
  if (!existsSync(LOG_FILE)) {
    console.log(`No log file found at ${LOG_FILE}`);
    console.log("Start the service first: webcli service start -d");
    return;
  }
  if (follow) {
    const tail = spawn("tail", ["-f", LOG_FILE], { stdio: "inherit" });
    process.on("SIGINT", () => { tail.kill(); process.exit(0); });
    await new Promise(() => {}); // keep alive
  } else {
    process.stdout.write(await readFile(LOG_FILE, "utf8"));
  }
}

// ─── Service mode (WebSocket bridge only) ────────────────────────────────────

async function runServiceMode() {
  const { WebSocketBridge } = await import("./bridge.js");

  process.stderr.write("[WebCLI] Starting WebSocket bridge...\n");
  const bridge = new WebSocketBridge();

  // 初始化埋点上报配置（whoami / clientId / 版本号）；实时上报无需定时器。
  // 仅当 WEBCLI_METRICS_UPLOAD=on 且配置了 endpoint 才启用，失败一律静默。
  let version = "unknown";
  try { version = JSON.parse(await readFile(join(__dirname, "package.json"), "utf8")).version; } catch {}
  await bridge.init({ webcliVersion: version });

  await new Promise(resolve => setTimeout(resolve, 500));
  process.stderr.write(`[WebCLI] WebSocket server listening on ws://localhost:${WS_PORT}\n`);
  process.stderr.write("[WebCLI] Waiting for Chrome extension to connect...\n");

  setInterval(() => {
    process.stderr.write(`[WebCLI] Alive — extension ${bridge.isExtensionConnected() ? 'connected' : 'disconnected'}\n`);
  }, 60_000);
}

// ─── Command: call <tool_name> ────────────────────────────────────────────────

async function ensureBridgeRunning() {
  const isRunning = await checkPortListening();
  if (isRunning) return;

  process.stderr.write("Bridge not running, starting...\n");
  await cmdServiceStart(true, message => process.stderr.write(message + '\n'));

  // Wait for Bridge to be ready (max 5s)
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await checkPortListening()) return;
  }
  console.error("Error: Bridge failed to start within 5 seconds");
  process.exit(1);
}

async function cmdCall(toolName, argsStr, options = {}) {
  const verbose = !!options.verbose;
  const flagArgs = options.flagArgs || {};
  let outputFormat;
  try {
    outputFormat = resolveOutputFormat(options.outputFormat);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
  // markdown 输出时按工具名查「站点列名映射」（字段 → 中文列名，WECLI 沉淀层）；
  // 无映射的站点/命令渲染为全字段 table；JSON 保持全量
  let columnMapping;
  if (outputFormat === "markdown") {
    columnMapping = (await import("./column-mappings.js")).lookupColumnMapping(toolName);
  }
  if (isLegacyWecliHandlerName(toolName)) {
    console.error(`Error: "${toolName}" is an internal handler name. Use the public WebCLI command name without "wecli_".`);
    process.exit(1);
  }
  let args;
  try { args = parseArgsJson(argsStr); }
  catch (error) { console.error(`Error: ${error.message}`); process.exit(1); }
  // 合并 --key=value 标志参数（优先级低于 --args 中的同名字段）
  args = { ...flagArgs, ...args };

  if (toolName.startsWith('browser.')) {
    const command = toolName.slice('browser.'.length);
    const { browserCommands, browserHelp } = await import('./browser-commands.js');
    if (command === 'help') { console.log(JSON.stringify(browserHelp(), null, 2)); return; }
    if (!Object.hasOwn(browserCommands, command)) {
      console.log(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: 'UNKNOWN_COMMAND', message: 'Use webcli call browser.help.' } }));
      process.exitCode = 1; return;
    }
    await ensureBridgeRunning();
    if (['console', 'network'].includes(command) && (args.follow === true || args.follow === 'true')) {
      const { runBrowserFollow } = await import('./browser-follow.js');
      process.exitCode = await runBrowserFollow(command, args); return;
    }
    if (['console', 'network'].includes(command) && (args.follow === false || args.follow === 'false')) delete args.follow;
    const { callLocalCommand } = await import('./exploration-client.js');
    const result = await callLocalCommand('browser', command, args, { timeoutMs: 50000 });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  // Reserved management namespace. It never resolves a website/Toolkit package.
  if (toolName.startsWith('exploration.')) {
    const command = toolName.slice('exploration.'.length);
    const { explorationCommands, explorationHelp } = await import('./exploration-commands.js');
    if (command === 'help') {
      console.log(JSON.stringify(explorationHelp(), null, 2));
      return;
    }
    if (!Object.hasOwn(explorationCommands, command)) {
      console.log(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: 'UNKNOWN_COMMAND', message: 'Use webcli call exploration.help.' } }));
      process.exitCode = 1;
      return;
    }
    await ensureBridgeRunning();
    const { callExploration } = await import('./exploration-client.js');
    const result = await callExploration(command, args);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  const { resolveToolkitTool } = await import("./adapter-registry.js");
  const { resolveAdapterCall } = await import("./adapter-host.js");
  const v2Match = resolveAdapterCall(toolName);
  if (v2Match) {
    if ((v2Match.command.requires_confirmation ?? v2Match.command.safety === "write") && args.__confirmed !== true) throw new Error("Explicit confirmation is required for this command.");
    if (v2Match.command.runtime === "wewright") {
      // v2 wewright 命令：内嵌 Runtime --internal-script，入口取 manifest module（现有合同不变）
      try {
        const { runToolkitTool } = await import("./toolkit-runner.js");
        const toolkitMatch = {
          adapter: { root: v2Match.adapter.root, entryPath: join(v2Match.adapter.root, v2Match.command.module) },
          tool: { id: v2Match.command.id, name: toolName },
        };
        const completed = await runToolkitTool(toolkitMatch, args);
        const isPlainObject = completed.result && typeof completed.result === "object" && !Array.isArray(completed.result);
        const output = isPlainObject
          ? { ...completed.result, trace_id: completed.traceID }
          : { result: completed.result, trace_id: completed.traceID };
        console.log(formatCallOutput(output, outputFormat, { mapping: columnMapping }));
        process.exit(completed.exitCode);
      } catch (error) {
        console.log(formatCallOutput({ error: error.message, trace_id: null }, outputFormat));
        process.exit(1);
      }
    }
    // v2 extension 命令：走 Bridge 转发，toolName = <name>.<command-id>（extension loader v2 负责注入）
  }
  const toolkitMatch = v2Match ? null : resolveToolkitTool(toolName);
  if (toolkitMatch) {
    const { findExtensionTool, loadExtensionAdapters } = await import("./adapter-cli.js");
    const extensionAdapters = await loadExtensionAdapters();
    if (extensionAdapters.some((adapter) => adapter.id === toolkitMatch.adapter.id)) {
      console.error(`Error: Duplicate Adapter registration: "${toolkitMatch.adapter.id}".`);
      process.exit(1);
    }
    if (await findExtensionTool(toolName)) {
      console.error(`Error: Duplicate Adapter tool registration: "${toolName}".`);
      process.exit(1);
    }
    try {
      const { runToolkitTool } = await import("./toolkit-runner.js");
      const completed = await runToolkitTool(toolkitMatch, args);
      const isPlainObject = completed.result && typeof completed.result === "object" && !Array.isArray(completed.result);
      const output = isPlainObject
        ? { ...completed.result, trace_id: completed.traceID }
        : { result: completed.result, trace_id: completed.traceID };
      console.log(formatCallOutput(output, outputFormat, { mapping: columnMapping }));
      process.exit(completed.exitCode);
    } catch (error) {
      console.log(formatCallOutput({ error: error.message, trace_id: null }, outputFormat));
      process.exit(1);
    }
  }

  await ensureBridgeRunning();

  const ws = new WebSocket(`ws://localhost:${WS_PORT}`);

  const callTimeoutMs = resolveToolCallTimeout(toolName);

  const timeout = setTimeout(() => {
    console.log(formatCallOutput({ error: "工具调用超时", trace_id: null }, outputFormat));
    ws.terminate();
    process.exit(1);
  }, callTimeoutMs);

  ws.on("open", () => {
    const id = "cli-" + Date.now();
    const traceID = randomUUID().replace(/-/g, "").slice(0, 12);
    ws.send(JSON.stringify({ type: "call_tool", toolName, args, id, traceID, adapterSnapshot: v2Match?.snapshot, clientStartedAt: CLI_STARTED_AT }));

    ws.on("message", async (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id !== id) return;
      clearTimeout(timeout);
      if (msg.type === "call_tool_result") {
        const isPlainObject = msg.result && typeof msg.result === "object" && !Array.isArray(msg.result);
        const output = isPlainObject
          ? { ...msg.result, trace_id: traceID }
          : { result: msg.result, trace_id: traceID };
        console.log(formatCallOutput(output, outputFormat, { mapping: columnMapping }));
        await printVerboseTrace(traceID, verbose);
        ws.close();
        process.exit(0);
      } else if (msg.type === "call_tool_error") {
        const output = { error: msg.error, trace_id: traceID, hint: `用 webcli trace ${traceID} 查看完整链路日志` };
        console.log(formatCallOutput(output, outputFormat));
        await printVerboseTrace(traceID, verbose);
        ws.close();
        process.exit(1);
      }
    });
  });

  ws.on("error", () => {
    clearTimeout(timeout);
    console.log(formatCallOutput({ error: "无法连接到 WebSocket bridge，请先运行 webcli service start -d", trace_id: null }, outputFormat));
    process.exit(1);
  });
}

// ─── Command: trace <traceID> ─────────────────────────────────────────────────

async function printVerboseTrace(traceID, verbose) {
  if (!verbose) return;
  process.stderr.write("\n");
  await cmdTrace(traceID, { stderr: true });
}

async function cmdTrace(traceID, options = {}) {
  const write = options.stderr
    ? (line) => process.stderr.write(`${line}\n`)
    : (line) => console.log(line);
  let foundAny = false;

  // 1. 从 service.log 读取 Bridge 日志
  if (existsSync(LOG_FILE)) {
    const logContent = readRecentLogFile(LOG_FILE, TRACE_LOG_READ_BYTES);
    const lines = logContent.split("\n").filter(line => line.includes(`[${traceID}]`));
    if (lines.length > 0) {
      write("── Bridge 日志 ──");
      for (const line of lines) {
        write(line);
      }
      foundAny = true;
    }
  }

  // 2. 从 Chrome 扩展拉取 Service Worker + Content Script 日志
  const isBridgeRunning = await checkPortListening();
  if (isBridgeRunning) {
    const extLogs = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${WS_PORT}`);
      const timeout = setTimeout(() => {
        ws.terminate();
        resolve(null);
      }, 5000);

      ws.on("open", () => {
        const id = "trace-" + Date.now();
        ws.send(JSON.stringify({ type: "get_trace_logs", traceID, id }));
        ws.on("message", (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.id !== id || msg.type !== "get_trace_logs_result") return;
          clearTimeout(timeout);
          ws.close();
          resolve(msg.logs || []);
        });
      });

      ws.on("error", () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });

    if (extLogs && extLogs.length > 0) {
      write("── Extension 日志 ──");
      for (const line of extLogs) {
        write(line);
      }
      foundAny = true;
    }
  }

  if (!foundAny) {
    write(`未找到 traceID: ${traceID} 的日志`);
  }
}

function readRecentLogFile(filePath, maxBytes) {
  const stat = statSync(filePath);
  const size = Math.min(stat.size, maxBytes);
  const start = Math.max(0, stat.size - size);
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(size);
    readSync(fd, buffer, 0, size, start);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const BUILTIN_COMMANDS = new Set([
  "--version", "-v", "--help", "-h", "-help", "--service",
  "extension-path", "adapter", "service", "call", "trace", "install",
  "list", "mcp", "mcp-logs",
]);
// 渐进式 help 不拦截的顶层命令（其 <sub> help 属于自身命令域）
const BUILTIN_HELP_EXEMPT = new Set(["adapterhub", "stats"]);

function parseArgsJson(argsStr) {
  if (!argsStr) return {};
  try {
    return JSON.parse(argsStr);
  } catch {
    // JSON 解析失败，尝试 key=value 格式
    const parsed = parseArgsKeyValue(argsStr);
    if (parsed !== null) return parsed;
    throw new Error("--args 必须是有效的 JSON 或 key=value 格式（如 url=http://example.com keyword=test）");
  }
}

/**
 * 解析 key=value 格式参数字符串。
 * 规则：
 *   - 空格分隔多个参数
 *   - 值自动推断类型：纯数字 → number，true/false → boolean，其余 → string
 *   - 值可以用单引号或双引号包裹以包含空格：name="hello world" 或 name='hello world'
 *   - 解析失败返回 null
 */
function parseArgsKeyValue(argsStr) {
  const trimmed = argsStr.trim();
  if (!trimmed) return {};

  const result = {};
  // 使用状态机解析，支持引号包裹的值
  let i = 0;
  while (i < trimmed.length) {
    // 跳过前导空白
    while (i < trimmed.length && trimmed[i] === ' ') i++;
    if (i >= trimmed.length) break;

    // 读取 key
    const keyStart = i;
    while (i < trimmed.length && trimmed[i] !== '=') i++;
    if (i >= trimmed.length) return null; // 没有 = 号，不是合法的 key=value
    const key = trimmed.slice(keyStart, i).trim();
    if (!key) return null; // 空 key
    i++; // 跳过 =

    // 读取 value
    let value;
    if (i >= trimmed.length) {
      // key= 后面没有值，视为空字符串
      value = '';
    } else if (trimmed[i] === '"' || trimmed[i] === "'") {
      // 引号包裹的值
      const quote = trimmed[i];
      i++; // 跳过开头引号
      const valueStart = i;
      while (i < trimmed.length && trimmed[i] !== quote) i++;
      if (i >= trimmed.length) return null; // 未闭合的引号
      value = trimmed.slice(valueStart, i);
      i++; // 跳过结尾引号
    } else {
      // 无引号的值，读到空白为止
      const valueStart = i;
      while (i < trimmed.length && trimmed[i] !== ' ') i++;
      value = trimmed.slice(valueStart, i);
    }

    // 类型推断（只推断布尔；数字不推断，否则 string 参数如 --floor=11 会变成 number 报错）
    if (value === 'true') {
      result[key] = true;
    } else if (value === 'false') {
      result[key] = false;
    } else {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

function isLegacyWecliHandlerName(toolName) {
  return typeof toolName === "string" && /\.wecli_/.test(toolName);
}

function extractRuntimeFlags(args) {
  const rest = [];
  let verbose = false;
  let outputFormat;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--verbose" || (arg === "-v" && !(i === 0 && args.length === 1))) {
      verbose = true;
      continue;
    }
    // 输出格式用 --output-format，避免与业务参数 --format（如发票下载 format=pdf）冲突
    if (arg === "--output-format") {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        outputFormat = next;
        i += 1;
      } else {
        outputFormat = "";
      }
      continue;
    }
    const formatMatch = arg.match(/^--output-format=(.+)$/);
    if (formatMatch) {
      outputFormat = formatMatch[1];
      continue;
    }
    rest.push(arg);
  }
  return { args: rest, verbose, outputFormat };
}

function normalizeCliExecutionPath(filePath, realpath = realpathSync) {
  if (!filePath) return "";
  try {
    return resolve(realpath(filePath)).toLowerCase();
  } catch {
    return resolve(filePath).toLowerCase();
  }
}

function isDirectCliExecution(argvPath = process.argv[1], modulePath = __filename, realpath = realpathSync) {
  return Boolean(argvPath) && normalizeCliExecutionPath(argvPath, realpath) === normalizeCliExecutionPath(modulePath, realpath);
}

function inferType(value) {
  // 方案 A：值以 { 或 [ 开头时尝试 JSON.parse，支持嵌套对象和数组字面量
  const trimmed = value.trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === "{" && last === "}") || (first === "[" && last === "]")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // 解析失败按普通字符串处理
    }
  }
  // 只推断布尔类型；数字不推断（扩展侧 normalizeToolArgsForSchema 会做 string→integer 转换，
  // 但 string 参数传数字会导致类型验证失败，如 --floor=11）
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

/**
 * 将值写入 args 对象。
 * 方案 C：同名 flag 多次出现时自动聚合成数组。
 */
function assignArg(args, key, value) {
  if (!(key in args)) {
    args[key] = value;
    return;
  }
  if (Array.isArray(args[key])) {
    args[key].push(value);
  } else {
    args[key] = [args[key], value];
  }
}

/**
 * 从 argv 数组中提取 --key=value 标志参数，返回 { args, rest }。
 * - --key=value 形式的参数被收集为 args 对象（方案 A：JSON 字面量自动解析）
 * - 同名 --key=value 多次出现时聚合成数组（方案 C）
 * - --args 'json' 形式的参数被解析合并
 * - 其他参数保留在 rest 中
 */
function extractFlagArgs(argv, startIndex = 0) {
  const args = {};
  const rest = [];
  for (let i = startIndex; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--args") {
      // 兼容旧格式：--args 'JSON'
      i++;
      if (i < argv.length) {
        const parsed = parseArgsJson(argv[i]);
        for (const [k, v] of Object.entries(parsed)) assignArg(args, k, v);
      }
      continue;
    }
    const flagMatch = arg.match(/^--([^=]+)=(.*)$/);
    if (flagMatch) {
      const [, key, value] = flagMatch;
      assignArg(args, key, inferType(value));
      continue;
    }
    rest.push(arg);
  }
  return { args, rest };
}

function resolveCliInvocation(args) {
  const cmd = args[0];
  if (cmd === "call") {
    if (['browser.console', 'browser.network'].includes(args[1])) args = args.map(arg => arg === '--follow' ? '--follow=true' : arg);
    const { args: flagArgs, rest } = extractFlagArgs(args, 2);
    const argsIdx = args.indexOf("--args");
    return {
      type: "call",
      toolName: rest[0] || args[1],
      argsJson: argsIdx !== -1 ? args[argsIdx + 1] : undefined,
      flagArgs,
    };
  }
  if (BUILTIN_COMMANDS.has(cmd)) {
    return { type: "builtin", command: cmd };
  }

  // shorthand: site command [--key=value | --args '...']
  const argsIdx = args.indexOf("--args");
  const { args: flagArgs, rest: commandTokens } = extractFlagArgs(args, 0);
  if (commandTokens.length < 2) {
    return { type: "unknown", command: cmd, flagArgs };
  }

  const [site, ...commandParts] = commandTokens;
  return {
    type: "shorthand",
    toolName: `${site}.${commandParts.join(" ")}`,
    argsJson: argsIdx !== -1 ? args[argsIdx + 1] : undefined,
    flagArgs,
  };
}

async function runProgressiveHelp(args) {
  const { runAdapterHelp } = await import('./progressive-help.js');
  console.log(await runAdapterHelp(args));
}

async function main() {
  const { args, verbose, outputFormat } = extractRuntimeFlags(process.argv.slice(2));
  const cmd  = args[0];
  const sub  = args[1];
  const invocation = resolveCliInvocation(args);

  if ((cmd === 'browser' && (sub === 'help' || args.some(arg => ['--help', '-h'].includes(arg))))
      || (cmd === 'call' && sub?.startsWith('browser.') && args.some(arg => ['--help', '-h'].includes(arg)))) {
    const { browserHelp } = await import('./browser-commands.js');
    console.log(JSON.stringify(browserHelp(), null, 2)); return;
  }

  if ((cmd === 'exploration' && (sub === 'help' || args.some(arg => ['--help', '-h'].includes(arg))))
      || (cmd === 'call' && sub?.startsWith('exploration.') && args.some(arg => ['--help', '-h'].includes(arg)))) {
    const { explorationHelp } = await import('./exploration-commands.js');
    console.log(JSON.stringify(explorationHelp(), null, 2));
    return;
  }

  // --version / -v
  if (cmd === "--version" || cmd === "-v") {
    await printVersion();
    return;
  }

  // --help / -h / -help / no command
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "-help") {
    const jsonMode = args.includes("-f") && args[args.indexOf("-f") + 1] === "json";
    await printGlobalHelp({ json: jsonMode });
    return;
  }

  // extension-path
  if (cmd === "extension-path") {
    const { resolveExtensionDir } = await import("./paths.js");
    console.log(resolveExtensionDir());
    return;
  }

  // Internal one-shot AI transport. Model SDK/TLS/native failures are isolated
  // in this subprocess so they cannot terminate the long-lived Bridge.
  if (cmd === "internal-ai-call") {
    const { runAiCallWorker } = await import("./ai-worker.js");
    await runAiCallWorker();
    return;
  }

  if (cmd === "internal-ai-session") {
    const { runAiSessionWorker } = await import("./ai-worker.js");
    await runAiSessionWorker();
    return;
  }

  // Internal one-run Harness worker. The full generation and publishing
  // lifecycle lives here so a native/V8 failure cannot terminate the Bridge.
  if (cmd === "internal-generation-worker") {
    const { runGenerationWorker } = await import("./generation-worker.js");
    await runGenerationWorker();
    return;
  }

  // adapter <...>
  if (cmd === "adapter") {
    const { runAdapterCli } = await import("./adapter-cli.js");
    await runAdapterCli(args.slice(1));
    return;
  }

  // list —— adapter list 的简写（对齐 wecli 的 `wecli list` 心智）
  if (cmd === "list") {
    const { runAdapterCli } = await import("./adapter-cli.js");
    await runAdapterCli(["list", ...args.slice(1)]);
    return;
  }

  // adapterhub <...>
  if (cmd === "adapterhub") {
    const { runAdapterHubCli } = await import("./adapterhub-cli.js");
    await runAdapterHubCli(args.slice(1));
    return;
  }

  // service <start|stop|status|logs>
  if (cmd === "service") {
    if (!sub || sub === "start") {
      const daemon = args.includes("-d") || args.includes("--daemon");
      await cmdServiceStart(daemon);
    } else if (sub === "stop") {
      await cmdServiceStop();
    } else if (sub === "status") {
      await cmdServiceStatus();
    } else if (sub === "logs") {
      const follow = args.includes("-f") || args.includes("--follow");
      await cmdServiceLogs(follow);
    } else {
      console.error(`Unknown service subcommand: ${sub}`);
      console.log('Available: start, stop, status, logs');
      process.exit(1);
    }
    return;
  }

  // call <tool_name> [--key=value ...] [--args '{}']
  if (cmd === "call") {
    const { toolName, argsJson, flagArgs } = resolveCliInvocation(args);
    if (!toolName) {
      console.error("Error: 请指定工具名称");
      console.error("Usage: webcli call <tool_name> [--key=value ...]");
      process.exit(1);
    }
    await cmdCall(toolName, argsJson, { verbose, flagArgs, outputFormat });
    return;
  }

  // stats [--by tool] [--since 7d] [--kind adapter] [--top N] [--json] [--remote]
  if (cmd === "stats") {
    const { runStats } = await import("./stats.js");
    await runStats(args.slice(1));
    return;
  }

  // trace <traceID>
  if (cmd === "trace") {    const traceID = args[1];
    if (!traceID) {
      console.error("Error: 请指定 traceID");
      console.error("Usage: webcli trace <traceID>");
      process.exit(1);
    }
    await cmdTrace(traceID);
    return;
  }

  // install --skills [adapter-id] [--target <dir>]
  if (cmd === "install" && args.includes("--skills")) {
    const { installSkills } = await import("./skill-installer.js");
    const targetIdx = args.indexOf("--target");
    const target = targetIdx !== -1 ? args[targetIdx + 1] : join(homedir(), ".claude", "skills");
    const adapterId = args.find((a, i) => i > 0 && !a.startsWith("--") && i !== targetIdx + 1) || null;
    const { installed, total, retired = 0, preserved = [] } = await installSkills({ target, adapterId });
    if (preserved.length) console.log(`Preserved user-owned or edited Skills: ${preserved.join(", ")}`);
    if (retired) console.log(`Marked ${retired} unavailable Adapter Skills inactive.`);
    if (adapterId) {
      console.log(installed ? `Installed skill for "${adapterId}" to ${target}` : `No active Skill installed for "${adapterId}".`);
    } else {
      console.log(`Installed ${installed} adapter skills (of ${total} adapters) + base webcli skill to ${target}`);
    }
    return;
  }

  // mcp — deprecated, MCP server has been removed
  if (cmd === "mcp") {
    console.error("Error: MCP 服务器已被移除。");
    console.error("请使用 WeWorker 桌面应用作为 AI 工具调用入口。");
    console.error("详情请访问: https://weworker.dev");
    process.exit(1);
  }

  // mcp-logs — deprecated, MCP logging removed
  if (cmd === "mcp-logs") {
    console.error("MCP 日志功能已随 MCP 服务器一起移除。");
    process.exit(1);
  }

  // --service (internal flag used by daemon spawn)
  if (cmd === "--service") {
    process.on("uncaughtException",  e => process.stderr.write(`[WebCLI] ${e.message}\n`));
    process.on("unhandledRejection", r => process.stderr.write(`[WebCLI] ${r}\n`));
    await runServiceMode();
    return;
  }

  // 渐进式 help：webcli help / webcli <adapter> help / webcli <adapter> <command> help
  const isHelpRequest =
    (cmd === "help" && args.length === 1) ||
    (sub === "help" && args.length === 2) ||
    (args[2] === "help" && args.length === 3);
  if (isHelpRequest && !BUILTIN_COMMANDS.has(cmd) && !BUILTIN_HELP_EXEMPT.has(cmd)) {
    await runProgressiveHelp(args);
    return;
  }

  // 站点级 help：webcli <site> [-help|--help|-h] [-f json]
  // （对齐 wecli 的 `wecli <site> --help` 心智；也拦截 `webcli <site> <cmd> --help`，
  //   避免其被当作无参工具调用）
  const SITE_HELP_FLAGS = new Set(["-help", "--help", "-h"]);
  if (!BUILTIN_COMMANDS.has(cmd) && args.slice(1).some((a) => SITE_HELP_FLAGS.has(a))) {
    const jsonMode = args.includes("-f") && args[args.indexOf("-f") + 1] === "json";
    const { runAdapterCli } = await import("./adapter-cli.js");
    await runAdapterCli([cmd, "-help", ...(jsonMode ? ["-f", "json"] : [])]);
    return;
  }

  if (invocation.type === "shorthand") {
    await cmdCall(invocation.toolName, invocation.argsJson, { verbose, flagArgs: invocation.flagArgs || {}, outputFormat });
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  console.log('Run "webcli --help" for usage.');
  process.exit(1);
}

const isDirectExecution = isDirectCliExecution();
if (isDirectExecution) {
  main().catch(e => {
    process.stderr.write(`[WebCLI] Fatal: ${e.message}\n`);
    process.exitCode = 1;
  });
}

export { getConfigDir, cmdCall, parseArgsJson, parseArgsKeyValue, inferType, assignArg, extractFlagArgs, resolveCliInvocation, extractRuntimeFlags, isDirectCliExecution };
