# API 自动探索 CLI 开发设计与首版实现

更新：2026-10-17。历史分支、同步步骤与验证结果见 [交接文档](api_exploration_cli_handoff.md)。

## 需求修正

用户明确要求：只安装 WebCLI + 浏览器插件，Codex、Claude 等可执行 CLI 的 Agent 就能对话探索 API、编写和验证 Adapter，无需启动 WeWorker 客户端，不配置第二套模型 Key。此前“首版依赖客户端 Backend”的设计已撤销。

Python 网站探索agent完全排除在任务范围之外。本轮没有修改其源码、测试、运行环境或界面。API 探索界面后续再迁入公共契约，本轮保留现有界面和聊天工具行为。

## 架构

```text
Codex / Claude / 其他 CLI Agent + Skill
            ↓ webcli call exploration.<command>
     现有 WebCLI Bridge（本地后台服务）
            ↓ ExplorationService（无模型依赖）
     任务持久化 / 证据结构化 / 草稿 / 验证 / 安装
            ↓ 现有消息、预览验证器和 Adapter 安装器
       WeWorker 浏览器插件
```

外部 Agent 负责理解目标、选策略、命名工具、编写/修复代码和向用户提问。WebCLI 负责确定性操作；`generate` 是依据已观察证据生成隔离草稿，不是调用模型自主创作。Agent 用 `draft-read` / `draft-write` 完成语义改造。

借鉴 OpenCLI 的会话绑定、证据先行、渐进帮助与验证闭环。参考为本机 1.8.6 help 及本地 usage/adapter-author 技能，不宣称审计了远端最新源码。不复制其任意 eval、原始响应读取或第二套浏览器守护进程。

## 实际命令

命令以 `webcli call exploration.help` 为事实来源，所有结果为 JSON。

| 命令 | 含义 |
| --- | --- |
| capabilities / tabs | 插件状态和可探索标签页，不需要桌面 Backend |
| start | tabId、goal、requestId 创建任务；重载指定页面采集证据 |
| list / get / events / evidence | 找回任务、查看状态、游标事件和结构化接口证据 |
| collect | 用户操作页面后补采，不重载 |
| actions / probe | 复用插件安全搜索、筛选和分页候选，每任务最多三次探测 |
| cancel | 停止后续阶段，丢弃迟到结果；已经派发的浏览器操作可能完成 |
| generate | 从成功的只读 GET 证据生成隔离 v2 草稿，可接受 Agent 编写的 plan |
| draft-read / draft-write | 列文件、读取内容和 hash、按 expectedHash 修改现有文件 |
| validate | 静态检查及真实浏览器只读预览验证 |
| review / install | 展示当前权限/工具/版本差异；以当前 reviewId 和用户确认安装本地 Adapter |

复杂 plan/content 使用现有 `--args` JSON 通道，普通参数使用 `--key=value`。不增加 WebCLI 通用业务类型转换。

## Agent 使用流程

1. capabilities → tabs，确认页面与目标。start 会重载，用户有未保存输入时先处理。
2. start 返回 collecting，持续 get/events 观察；CLI 进程退出不终止 Bridge 任务。
3. evidence 分析端点、参数名和响应结构；必要时 actions/probe 或人工操作后 collect。
4. generate 生成草稿；Agent 检查和修改参数、分页、结果映射和业务错误。
5. validate，失败回到 draft-read/write 修复；不把注册成功或跳过执行当验收。
6. review 展示安装变更，用户同意后 install，再以普通 `webcli call <adapter>.<command>` 使用。

`webcli install --skills --target <目标目录>` 会安装新增的 webcli-api-exploration Skill，不限于某个模型供应商。即使 Agent 没有 Skill 机制，也能通过完整命令帮助调用。

## 协议与状态

- 固定消息 `exploration_command` / `exploration_command_result`，使用唯一 request ID。结果仅回发起连接，不广播证据。新命令只接受无浏览器 Origin 的 loopback 连接；拒绝扩展/网页与远端连接。
- 保留命名空间 exploration，CLI 在业务 Adapter 查找前处理，用户包不能覆盖此入口。不改变 Extension / Toolkit Runner 分工。
- 服务在 Bridge 中按需初始化，存储于既有 profile workspace 的 exploration 子目录；与桌面 API 探索旧任务分开，避免未经设计的数据迁移。
- 状态为 created → collecting → evidence_ready → draft → validating → review_ready → installing → installed，另有 failed/interrupted/cancelled。
- start 的 requestId 在重连和重启后保持幂等；同 key 不同参数拒绝。generate 不覆盖已存在草稿。
- Bridge 重启将进行中的任务标为 interrupted，不自动重放操作；同一 tab 的在途采集/验证互斥，取消后等待已派发请求收尾才释放。
- 修改草稿使验证和 review 失效；安装核对包摘要、基线与当前 review。安装开始后不能取消，重复查询安装结果不会再次安装。
- 不增加数据库 schema、模型 SDK 或依赖，不访问客户端设置和模型 Key。

## 证据与验证边界

持久化与输出只含请求/响应结构、字段名称、状态及端点。省略响应值和请求头，移除凭据查询字段，其余查询值变为占位；常见数字 ID、UUID 和邮箱路径段结构化为 :id。跨源流量不自动增加权限。

首版生成范围：同源、已观察成功的 GET 查询，最多两个新命令；动态 :id 路径不自动生成。POST 查询、写命令和跨源授权待后续明确设计。已有包的命令按原有增量机制保留；只执行新生成的查询验证，不运行保留的写命令。

验证复用现有 static validator、preview runtime validator 和 publisher。所有目标工具必须真实执行且通过，不能跳过。独立探索开启 `restrictToExpectedTools`，仅生成目标进入执行计数；脚手架登录检查和保留的已有工具不计入目标跳过数。共享验证器默认行为不变。任务仅保存验证计数/错误码，不保存预览结果值。安装是本地行为，不上架市场，也不等于授权执行业务写操作。

## 后续 UI 统一

本轮独立命令不经过 TypeScript Backend。后续由 Backend 的薄适配层调用相同 Bridge 命令，使 API 探索页面、内置聊天工具与外部 Agent 共用任务状态和校验。UI 不需要启动 shell；不得借此改动 Python 网站探索agent。

## 验证与未完成范围

具体命令和数量见交接日志。WebCLI 全量 97 文件、1056 项通过。真实 Chromium + 未打包插件 + 独立 CLI/Bridge + loopback 示例站点已验证完整闭环，包括搜索探测、结构证据、Agent 草稿编辑、静态/运行错误修复、审阅安装、普通关键词/分页调用、同站点增量保留、取消及重启恢复。

验收脚本为 `webcli/scripts/verify-exploration-browser.mjs`；使用临时副本改变连接端口及 CLI 配置目录，生产协议和默认端口未改。只启动/停止脚本自己创建的服务和浏览器，Adapter 安装、任务和浏览器配置均隔离。Playwright 只用于测试浏览器启动与示例页面导航，探索/生成/验证/安装和业务调用均经过真实 CLI 与插件，不 mock 扩展传输、fetch 或验证器。

待做：真实登录业务站点、Codex/Claude 各一次全新独立对话验收、各平台安装包；API 探索 UI/旧聊天入口统一；按业务需要扩展 POST、跨源和写工具能力。当前脚本提供可重复的命令契约验收，不代表任意 Agent 在任意站点上的生成质量已验证。
