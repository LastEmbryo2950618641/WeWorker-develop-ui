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

借鉴 OpenCLI 的会话绑定、证据先行、渐进帮助与验证闭环。参考为本机 1.8.6 help 及本地 usage/adapter-author 技能，尚未审计 1.8.8 更新。当前增加 browser.* 页面操作、eval 和有界网络 JSON 读取，复用既有 Bridge；探索任务仍只持久化结构。完整对照见 [能力台账](opencli_parity.md)。

## 实际命令

命令以 `webcli call exploration.help` 为事实来源，所有结果为 JSON。

| 命令 | 含义 |
| --- | --- |
| capabilities / tabs | 插件状态和可探索标签页，不需要桌面 Backend |
| start | tabId、goal、requestId 创建任务；可用 allowedOrigins 显式增加精确 API origin；重载指定页面采集证据 |
| list / get / events / evidence / trace | 找回任务、查看状态、游标事件、结构化接口证据和修复诊断 |
| collect | 用户操作页面后补采，不重载 |
| actions / probe | 复用插件安全搜索、筛选和分页候选，每任务最多三次探测 |
| cancel | 停止后续阶段，丢弃迟到结果；已经派发的浏览器操作可能完成 |
| generate | 默认最多两个 GET；Agent plan 支持 1–50 个读取工具及 JSON/form POST、GraphQL query，POST 必须有 readReason |
| draft-read / draft-write / draft-add | 列文件、读取内容和 hash、按 expectedHash 修改现有文件，或新增 helper/command/guidance 文件 |
| verification-read / verification-write | 按工具读写带 hash 的 1–10 组真实参数及精确输出断言；修改后重新验证 |
| knowledge-read / knowledge-save | 按 Adapter 名读取历史知识；从验证成功的任务保存选中端点、字段含义、作者测试用例和备注 |
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
- Bridge 重启将进行中的任务标为 interrupted，不自动重放操作；同一 tab 的 browser 操作与采集/验证共用锁，取消后等待已派发请求收尾才释放。dialog 回复可在点击等待弹窗时单独执行。
- 修改草稿使验证和 review 失效；安装核对包摘要、基线与当前 review。安装开始后不能取消，重复查询安装结果不会再次安装。
- 不增加数据库 schema、模型 SDK 或依赖，不访问客户端设置和模型 Key。

## 证据与验证边界

持久化与输出只含请求/响应结构、字段名称、状态及端点。省略响应值和请求头，移除凭据查询字段，其余查询值变为占位；常见数字 ID、UUID 和邮箱路径段结构化为 :id。跨源流量不自动增加权限。

当前生成范围：已观察成功且被判定为读取的 GET 与 Agent 明确编写读取理由的 POST（JSON/form/GraphQL query），每个计划最多 50 个新命令。未知/持久 GraphQL 操作、mutation、subscription 和动态 :id 路径不自动生成；写命令尚未开放。额外 API origin 在 start 显式授权，生成包只从选中证据派生 runtime_allowed_hosts，安装前审阅权限差异。已有包的命令按原有增量机制保留；只执行新生成的查询验证，不运行保留的写命令。

## 通用浏览器层

`webcli call browser.help` 列出 34 个命令，覆盖命名会话、页面定位/输入、原生主 frame 指针/拖拽、文件输入、网络、eval、截图、控制台和弹窗。session 的 tabId 与 Chrome storage.session 身份共同校验，浏览器重启后必须重新绑定，避免 ID 复用。用户绑定页面 close 只释放绑定；独立 open 页面才会被关闭。

browser 命令返回任务需要的页面数据，不保存到探索记录；网络详情只返回有界 JSON 并按凭据字段脱敏，非 JSON/截断正文省略。Bridge 不记录浏览器参数、脚本或输入值。完整页面截图上限 4000 万像素。子 frame 指针目前仍使用 DOM 事件，嵌套跨源 frame、Shadow DOM、多连接/profile、下载等待、持续网络流待补。

验证复用现有 static validator、preview runtime validator 和 publisher。所有目标工具必须真实执行且通过，不能跳过。独立探索开启 `restrictToExpectedTools`，仅生成目标进入执行计数；脚手架登录检查和保留的已有工具不计入目标跳过数。共享验证器默认行为不变。任务仅保存验证计数/错误码，不保存预览结果值。安装是本地行为，不上架市场，也不等于授权执行业务写操作。

Agent 可以为最终命令输出声明 requiredPaths、types、notEmpty、patterns、equals 和带明确路径的 rowCount。断言从输出根开始，按每一行精确检查，不回退到相似字段；空列表的行级类型检查为空集，存在性和非空需求单独声明。测试输入必须由作者明确提供，不从流量复制凭据或用户值。修改 cases 同样使验证/审阅失效。扩展须声明 strict_output_contract_v1，旧插件明确拒绝；超过五组用例分批执行并汇总，某批失败不能被其他批掩盖。

站点知识存于当前 profile 的 exploration/knowledge 中，与旧 UI 的记忆分开。只提升该计划选中的结构证据和作者 cases，附可选字段解释及备注，不保存捕获正文。记录使用内容 hash 防止覆盖并发更新，同字段的不同含义拒绝覆盖。30 天有效期按每条记录检查，安装包摘要变化另行标记 stale；知识只作线索，复用前仍要检查当前页面。验证过但未安装的包会显示当前安装摘要不匹配，这不表示验证失败。

目录变化触发的页面刷新与 managed page 调用共用扩展侧队列，等待在途调用完成后才清除注册和重载，后续调用等待刷新结束。它不重试已经执行的业务 handler。

## 后续 UI 统一

本轮独立命令不经过 TypeScript Backend。后续由 Backend 的薄适配层调用相同 Bridge 命令，使 API 探索页面、内置聊天工具与外部 Agent 共用任务状态和校验。UI 不需要启动 shell；不得借此改动 Python 网站探索agent。

## 验证与未完成范围

具体命令和数量见交接日志。当前 WebCLI 全量 100 文件、1077 项通过。真实 Chromium + 未打包插件 + 独立 CLI/Bridge + loopback 示例站点 19 项通过，包含浏览器操作、三个 POST/GraphQL 工具闭环、六组精确断言以及知识持久化。用户指定的真实公共视频搜索页已完成采集、生成、修复、验证、增量安装和普通 CLI 搜索/分页，结果结构和页面变化通过；原始页面/响应未进入仓库。

验收脚本为 `webcli/scripts/verify-exploration-browser.mjs`；使用临时副本改变连接端口及 CLI 配置目录，生产协议和默认端口未改。只启动/停止脚本自己创建的服务和浏览器，Adapter 安装、任务和浏览器配置均隔离。Playwright 只用于测试浏览器启动与示例页面导航，探索/生成/验证/安装和业务调用均经过真实 CLI 与插件，不 mock 扩展传输、fetch 或验证器。

待做：纯 DOM/拦截等策略生成、动态路径、写命令、知识冲突修订与安装后修复；Codex/Claude 各一次全新独立对话验收、各平台安装包；API 探索 UI/旧聊天入口统一，以及能力台账中的其他差距。当前证据不代表任意 Agent 在任意站点上的生成质量已验证。
