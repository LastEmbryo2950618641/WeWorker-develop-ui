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
| intercept | 触发已观察的搜索/筛选/下一页控件，按参数关联本次 JSON 响应；结构证据与页面路由绑定 |
| observe | 观察声明式 UI_SELECTOR / DOM_STATE 来源，只保存路由、字段类型结构和选择理由 |
| cancel | 停止后续阶段，丢弃迟到结果；已经派发的浏览器操作可能完成 |
| generate | 默认最多两个 GET；Agent plan 支持 1–50 个读取工具、JSON/form POST、GraphQL query、动态路径绑定与页面来源；POST/动态路径必须有 readReason |
| repair-info / repair | 查看当前安装包摘要/历史 cases，从新证据建立所选已有只读命令的修复草稿；其他文件与命令保留 |
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

当前生成范围：已观察成功且被判定为读取的 GET 与 Agent 明确编写读取理由的 POST（JSON/form/GraphQL query），每个计划最多 50 个新命令。未知/持久 GraphQL 操作、mutation、subscription 不自动生成；写命令尚未开放。额外 API origin 在 start 显式授权，生成包只从选中证据派生 runtime_allowed_hosts，安装前审阅权限差异。已有包的命令按原有增量机制保留；只执行新生成的查询验证，不运行保留的写命令。

API 动态路径由显式 plan.pathParameters 绑定，包含 segmentIndex/name/description；索引是 pathname 去掉开头 `/` 后按 `/` 切分的零基位置。必须覆盖每个脱敏 :id，也可由作者参数化已观察的 slug 段。名称不能与 query/body 或其他路径参数冲突，必须说明读取理由；自动计划不猜测这些参数。生成 schema 使用必填 string，保留前导零，无捕获值默认参数。每个命令内联路径解析函数，按单段编码，保持固定 origin/其余路径；拒绝斜杠、百分号、控制字符和 dot traversal。已观察 query 键从参数提取到 URL，其余留给 GET query/POST body，路径键不会重复进入请求体。

动态命令至少两组不同路径参数组合的作者 cases，仍要求真实执行、零失败/跳过；Agent 用精确返回字段确认参数生效。知识保存命令的路径映射，定向 repair 使用相同要求。当前不从页面自动提取鉴权参数或签名，也不为尚未观察的 URL 建立证据；动态页面 pageRoute 另行设计。

## 页面触发查询与响应捕获

INTERCEPT 由显式只读 API 候选、单步搜索/原生筛选/下一页控件及请求字段关联组成。背景监听器在触发前注册，仅接收开始后的 Fetch/XHR，准确匹配 origin/pathname/method 与传入的 query/body 参数；旧响应、不相关参数不算证据。复用已有 CDP，会话结束移除本监听器，不断开其他调试用户。返回完整 JSON，限制大小/复杂度并脱敏凭据字段；超时、多响应、HTTP、非 JSON、目标/路由变化明确失败，不回退旧结果。

观察不保存参数值，页面来源绑定 plan 和生成包 pageStrategy=INTERCEPT；参数命令至少两组不同值与作者输出断言。临时预览令牌绑定 tab/route/有效期和草稿 manifest 的主机授权，只用于 intercept_read，finally 清理；普通调用从匹配页面主机的唯一安装包解析授权，拒绝合并多个包的权限。页面可在同一 document 内更新查询串，整页导航触发 INTERCEPT_DOCUMENT_CHANGED；路径变化和多步导航不在本阶段范围。原生输入前将明确选择的页面带到前台，避免后台标签页吞掉 CDP 点击。

这允许页面自行生成签名/临时请求头，未提供通用签名算法、凭据提取或自动策略回退。当前不支持多步 UI、复杂自定义筛选、子 frame 或动态 API pathname。

## 页面来源策略

observe 接受 UI_SELECTOR（行 selector、字段 selector/attribute/optional、emptySelector 和 limit）或 DOM_STATE（window 自有属性 path，或 JSON script selector + path）。扩展在 MAIN world 执行固定读取函数，观察阶段只返回类型结构；独立 page-source-v1 证据通过 fingerprint 与任务中的页面来源及 plan 绑定，不借用无关 API。支持纯页面或 API/页面混合草稿；纯页面生成不引入 API shared runtime，增量保留已有包。

生成命令经 page_read helper 读取当前页面。UI_SELECTOR 返回 items/matchedCount/truncated；必需字段缺失、隐藏、歧义或无已观察空态均报错。DOM_STATE 不调用 getter、不读 prototype/存储/凭据字段；只接受有限 JSON，最多 1000 数组项、100 对象字段、10 层、20000 节点和 500000 字符，超限报错。页面观察省略标量值，作者必须另写精确 cases，真实验证全通过才可安装。插件能力标记为 page_sources_v1。

manifest 增加可选 pageRoute `{origin, pathname}`，仅允许已声明页面主机的准确 HTTP(S) origin/pathname 和 Extension 前台只读命令。普通调用匹配已有页面；多个匹配页时只选唯一活动页，否则 PAGE_SOURCE_AMBIGUOUS；无匹配页返回 PAGE_SOURCE_ROUTE_MISSING，不导航其他页面。helper 再检查 origin/pathname，防止调用前页面变化。查询串/hash 不作为绑定条件，初始命令无参数，只读取当前结果；动态页面路径与多步页面流程仍待实现。

知识增加 pages 与逐条 stalePages，修复可引用新的页面来源，仍保留原路由和其他命令。隔离真实浏览器覆盖无 JSON API 的三个来源、安装后普通调用、空态、缺字段、选择器漂移后的定向修复以及重启恢复。精确测试证据和真实站点复验见跟进文档。

## 通用浏览器层

`webcli call browser.help` 列出 34 个命令，覆盖命名会话、页面定位/输入、原生主 frame 指针/拖拽、文件输入、网络、eval、截图、控制台和弹窗。session 的 tabId 与 Chrome storage.session 身份共同校验，浏览器重启后必须重新绑定，避免 ID 复用。用户绑定页面 close 只释放绑定；独立 open 页面才会被关闭。

browser 命令返回任务需要的页面数据，不保存到探索记录；网络详情只返回有界 JSON 并按凭据字段脱敏，非 JSON/截断正文省略。Bridge 不记录浏览器参数、脚本或输入值。完整页面截图上限 4000 万像素。子 frame 指针目前仍使用 DOM 事件，嵌套跨源 frame、Shadow DOM、多连接/profile、下载等待、持续网络流待补。

验证复用现有 static validator、preview runtime validator 和 publisher。所有目标工具必须真实执行且通过，不能跳过。独立探索开启 `restrictToExpectedTools`，仅生成目标进入执行计数；脚手架登录检查和保留的已有工具不计入目标跳过数。共享验证器默认行为不变。任务仅保存验证计数/错误码，不保存预览结果值。安装是本地行为，不上架市场，也不等于授权执行业务写操作。

Agent 可以为最终命令输出声明 requiredPaths、types、notEmpty、patterns、equals 和带明确路径的 rowCount。断言从输出根开始，按每一行精确检查，不回退到相似字段；空列表的行级类型检查为空集，存在性和非空需求单独声明。测试输入必须由作者明确提供，不从流量复制凭据或用户值。修改 cases 同样使验证/审阅失效。扩展须声明 strict_output_contract_v1，旧插件明确拒绝；超过五组用例分批执行并汇总，某批失败不能被其他批掩盖。

站点知识存于当前 profile 的 exploration/knowledge 中，与旧 UI 的记忆分开。只提升该计划选中的结构证据和作者 cases，附可选字段解释及备注，不保存捕获正文。记录使用内容 hash 防止覆盖并发更新，同字段的不同含义拒绝覆盖。30 天有效期按每条记录检查，安装包摘要变化另行标记 stale；知识只作线索，复用前仍要检查当前页面。验证过但未安装的包会显示当前安装摘要不匹配，这不表示验证失败。

目录变化触发的页面刷新与 managed page 调用共用扩展侧队列，等待在途调用完成后才清除注册和重载，后续调用等待刷新结束。它不重试已经执行的业务 handler。

## 已安装命令修复

已安装命令维护使用 repair-info/repair：先读取当前包摘要并采集新证据，再将已有只读命令复制到隔离草稿，绑定当前任务的修复范围。只允许改所选模块、schema 和 description，其他文件/命令、身份、路由、权限不变，禁止新增共享代码。静态检查、运行验证及发布三处均核对当前包摘要和服务保存的修复范围；草稿文件内的声明不能扩大范围。历史 cases 会带入并标记过期信息，每个目标至少一组，全部重新运行通过才能安装。当前支持 Extension-only 包；写命令、共享文件重构仍待后续。

## 后续 UI 统一

本轮独立命令不经过 TypeScript Backend。后续由 Backend 的薄适配层调用相同 Bridge 命令，使 API 探索页面、内置聊天工具与外部 Agent 共用任务状态和校验。UI 不需要启动 shell；不得借此改动 Python 网站探索agent。

## 验证与未完成范围

具体命令和数量见交接日志。当前 WebCLI 全量 103 文件、1094 项通过。真实 Chromium + 未打包插件 + 独立 CLI/Bridge + loopback 示例站点 24 项通过，包含浏览器操作、POST/GraphQL 工具、六组精确断言、知识持久化、API/DOM 定向修复、三个页面来源、动态 GET/POST 路径参数及跨域 INTERCEPT 闭环。用户指定的真实公共视频搜索页已完成采集、生成、修复、验证、增量安装和普通 CLI 搜索/分页，DOM 命令也与当前页面逐项核对；原始页面/响应未进入仓库。动态路径本轮使用公开占位 loopback 示例站点验收，不代表已在该外部搜索站点验证动态详情接口。

验收脚本为 `webcli/scripts/verify-exploration-browser.mjs`；使用临时副本改变连接端口及 CLI 配置目录，生产协议和默认端口未改。只启动/停止脚本自己创建的服务和浏览器，Adapter 安装、任务和浏览器配置均隔离。Playwright 只用于测试浏览器启动与示例页面导航，探索/生成/验证/安装和业务调用均经过真实 CLI 与插件，不 mock 扩展传输、fetch 或验证器。

待做：自动策略选择/回退、动态页面路由/整页导航/多步 UI、通用 CSRF/签名、写命令、知识冲突修订与共享文件/写命令修复；Codex/Claude 各一次全新独立对话验收、各平台安装包；API 探索 UI/旧聊天入口统一，以及能力台账中的其他差距。当前证据不代表任意 Agent 在任意站点上的生成质量已验证。
