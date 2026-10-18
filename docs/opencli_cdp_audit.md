# 外部 CDP／Electron 目标审计

2026-10-18，固定对照 OpenCLI 1.8.8 官方 npm 发布包的 `runtime.js`、`execution.js`、`browser/cdp.js`、`electron-apps.js` 和 `launcher.js`。没有打开用户应用、探测用户调试端口或启动上游安装器。

上游的 `OPENCLI_CDP_ENDPOINT` 或已注册 Electron 应用使 runtime 选择独立 CDPBridge；显式端点优先。HTTP(S) 端点读取 `/json` 并按目标类型/URL/应用名排序选择 WebSocket，直接 WS 则连接给定目标。连接有超时，命令按请求 ID 分发和超时，close 解除 pending/listeners。CDPPage 实际实现导航、evaluate、截图、滚动、Cookie 和完成后网络正文读取；不是仅存在配置参数。首次连接还注入上游 stealth 脚本，这不构成本项目必须复制的业务行为。

Electron registry 有十个内置元数据及用户 apps.yaml 增补。launcher 检测应用路径/进程/调试服务，按平台启动 `--remote-debugging-port`；已运行但没有 CDP 时包含提示/重启路径。显式端点会验证可达，应用命令再由相同 page 接口执行。该能力是 CLI 控制外部目标，不是开发 OpenCLI 桌面客户端。

本项目核对 `webcli/browser-service.js`、`browser-commands.js`、`bridge.js` 与扩展：browser session 通过选定扩展 connection/tab/identity 路由，实际 CDP 由扩展 chrome.debugger 发出。没有外部 endpoint 注册/选择/连接的独立入口，也没有对应外部 Electron 目标生命周期；WeWorker 自身 Electron 主进程不是替代实现。Toolkit Runner 同样不等价。

U04 因而从待审计转为已确认实际差距，但实现与实机验收尚未完成。后续需复用既有公开页面操作、引用身份、观察和结果协议，并明确目标 ID，不凭打分静默接管未知页面。仅使用本任务启动的隔离 Chromium 或临时 Electron fixture；未知端口/日常应用不能终止、接管或复用。平台可执行文件发现与实际发布包验收分别留在 E01/E02；不操作 Python 网站探索agent或 WeWorker 生命周期。未授权修改 CI/CD、发布或删除文件时先推进独立传输和 fixture，保留具体依赖，不以 stub 替代真实 CDP 行为。
