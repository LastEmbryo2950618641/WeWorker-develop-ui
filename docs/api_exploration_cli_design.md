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

借鉴 OpenCLI 的会话绑定、证据先行、渐进帮助与验证闭环。参考包括本机 1.8.6 help、本地技能与 npm 官方 1.8.8 发布包静态审计，见 [版本核查](opencli_1_8_8_audit.md)。当前增加 browser.* 页面操作、eval 和有界网络 JSON 读取，复用既有 Bridge；探索任务仍只持久化结构。完整对照见 [能力台账](opencli_parity.md)。

## 实际命令

命令以 `webcli call exploration.help` 为事实来源，所有结果为 JSON。

| 命令 | 含义 |
| --- | --- |
| capabilities / tabs | 插件状态和可探索标签页，不需要桌面 Backend |
| start | tabId、goal、requestId 创建任务；可用 allowedOrigins 显式增加精确 API origin；重载指定页面采集证据 |
| list / get / events / evidence / trace | 找回任务、查看状态、游标事件、结构化接口证据和修复诊断 |
| analyze | 按结构分析 API/页面来源、噪声、访问阻塞与验证错误，给出下一步提示；不执行请求或自动切换来源 |
| replan / revisions / revision-read | 按当前 draftHash 留存未安装草稿、计划、cases 和验证记录；重做计划后可读取旧方案及源码 |
| collect | 用户操作页面后补采，不重载 |
| actions / probe | 复用插件安全搜索、筛选和分页候选，每任务最多三次探测 |
| intercept | 触发已观察的搜索/筛选/下一页控件，按参数关联本次 JSON 响应；结构证据与页面路由绑定 |
| observe | 观察声明式 UI_SELECTOR / DOM_STATE 来源，只保存路由、字段类型结构和选择理由 |
| query | 单次只读控件触发后跨文档等待，以同源结果路径和 URL 参数关联 DOM/状态；观察仅存结构 |
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
3. evidence/analyze 检查端点、参数名和响应结构；必要时 actions/probe、页面观察或人工操作后 collect。
4. 明确来源与理由后 generate；Agent 检查和修改参数、分页、结果映射和业务错误。
5. validate，失败先 analyze 与诊断，再修复代码；确需换来源时 replan 保留旧方案并重新采集/生成/验证。不把注册成功或跳过执行当验收。
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

## 来源分析与方案历史

analyze 只读取已保存结构，区分 likely_data、maybe_data、noise、blocked、unavailable、not_json、excluded。字段名只能提示可能含业务数据，不能证明与用户目标相关，也不能证明官方接口或长期稳定性。独立 start/collect 显式保留非静态 JSON 噪声用于分类，其他入口默认过滤保持原样。成功响应但缺 JSON 结构不能生成 JSON 查询；仅有模糊 JSON 或已经观察到页面替代来源时必须提供显式 plan。

API 草稿的执行策略明确为 PAGE_FETCH，不允许将其标成尚未实现的 PUBLIC_API/COOKIE_API。strategyNote 包括 reason 和可选 alternatives/limitations；PAGE_FETCH/INTERCEPT 若提供 note，必须说明替代来源。旧计划为兼容可省略，但 analyze 会返回 needsRationale，Skill 要求 Agent 主动补充。策略与说明进入 trace 和验证后的站点知识。已识别的鉴权错误先提示恢复访问；未知 HTTP/字段错误先诊断，不自动换来源。

replan 只允许非活动、未终结的新工具草稿，不适用于定向 repair。draftHash 覆盖文件原始字节、计划和作者 cases，即使 manifest 损坏也可留存；旧目录原样保留，每任务最多 20 次。读取时重新核对摘要，外部修改返回 REVISION_CHANGED。新方案清空验证、review、cases 与当前草稿，但保留采集结构和已消耗的探测次数；重新观察、生成后必须重新编写 cases、验证及审阅。已安装包不会随 replan 修改，历史成功不能当作当前审批。存储上限不是 Agent 自动尝试次数，Skill 仍限制最多三轮修复。

## 页面触发查询与响应捕获

INTERCEPT 由显式只读 API 候选、单步搜索/原生筛选/下一页控件及请求字段关联组成。背景监听器在触发前注册，仅接收开始后的 Fetch/XHR，准确匹配 origin/pathname/method 与传入的 query/body 参数；旧响应、不相关参数不算证据。复用已有 CDP，会话结束移除本监听器，不断开其他调试用户。返回完整 JSON，限制大小/复杂度并脱敏凭据字段；超时、多响应、HTTP、非 JSON、目标/路由变化明确失败，不回退旧结果。

观察不保存参数值，页面来源绑定 plan 和生成包 pageStrategy=INTERCEPT；参数命令至少两组不同值与作者输出断言。临时预览令牌绑定 tab/route/有效期和草稿 manifest 的主机授权，只用于 intercept_read，finally 清理；普通调用从匹配页面主机的唯一安装包解析授权，拒绝合并多个包的权限。页面可在同一 document 内更新查询串，整页导航触发 INTERCEPT_DOCUMENT_CHANGED。原生输入前将明确选择的页面带到前台，避免后台标签页吞掉 CDP 点击。

整页导航使用独立 exploration.query：来源仍为 UI_SELECTOR，mode=query，声明一个读控件、result（UI_SELECTOR/DOM_STATE）、同源固定 resultPathname 和公开 URL 参数关联。后台执行一次，跟踪主 frame 导航，等待路径/参数/加载完成与数据稳定；SPA 必须有不同于操作前的数据，不把旧 DOM 当新结果。观察只保存结构，参数命令至少两组不同作者 cases。

生成 handler 首次返回声明式 __webcli_page_query，后台执行后重新注入包，再以独立第二参数传入 page_query_result。只允许一次续接，错误/写操作/重复请求不重放；CLI 业务参数不能伪造续接。pageWorkflow 和 pageRoute.additionalPaths 允许普通调用从固定起始/结果页执行。预览使用同样流程，重建临时 registry/grant，结束清理。协议能力 page_query_v1 防止旧插件忽略。动态路径、跨源导航、无 URL 关联的筛选和多步流程仍未支持。

Adapter 目录刷新、普通调用、探索读取/捕获/探测、预览验证及已有标签页的 browser 操作共用扩展页面执行队列，避免异步刷新重载打断查询；dialog 独立执行以解除等待。不依赖固定延时解决竞争，也不重试业务动作。

这允许页面自行生成签名/临时请求头，未提供通用签名算法、凭据提取或自动策略回退。当前不支持多步 UI、复杂自定义筛选、子 frame 或动态 API pathname。

## 页面来源策略

observe 接受 UI_SELECTOR（行 selector、字段 selector/attribute/optional、emptySelector 和 limit）或 DOM_STATE（window 自有属性 path，或 JSON script selector + path）。扩展在 MAIN world 执行固定读取函数，观察阶段只返回类型结构；独立 page-source-v1 证据通过 fingerprint 与任务中的页面来源及 plan 绑定，不借用无关 API。支持纯页面或 API/页面混合草稿；纯页面生成不引入 API shared runtime，增量保留已有包。

生成命令经 page_read helper 读取当前页面。UI_SELECTOR 返回 items/matchedCount/truncated；必需字段缺失、隐藏、歧义或无已观察空态均报错。DOM_STATE 不调用 getter、不读 prototype/存储/凭据字段；只接受有限 JSON，最多 1000 数组项、100 对象字段、10 层、20000 节点和 500000 字符，超限报错。页面观察省略标量值，作者必须另写精确 cases，真实验证全通过才可安装。插件能力标记为 page_sources_v1。

manifest 增加可选 pageRoute `{origin, pathname}`，仅允许已声明页面主机的准确 HTTP(S) origin/pathname 和 Extension 前台只读命令。普通调用匹配已有页面；多个匹配页时只选唯一活动页，否则 PAGE_SOURCE_AMBIGUOUS；无匹配页返回 PAGE_SOURCE_ROUTE_MISSING，不导航其他页面。helper 再检查 origin/pathname，防止调用前页面变化。查询串/hash 不作为绑定条件，初始命令无参数，只读取当前结果；动态页面路径与多步页面流程仍待实现。

知识增加 pages 与逐条 stalePages，修复可引用新的页面来源，仍保留原路由和其他命令。隔离真实浏览器覆盖无 JSON API 的三个来源、安装后普通调用、空态、缺字段、选择器漂移后的定向修复以及重启恢复。精确测试证据和真实站点复验见跟进文档。

## 通用浏览器层

`webcli call browser.help` 列出 36 个命令，覆盖命名会话、页面定位/输入、原生主/子 frame 指针与同 frame 拖拽、文件输入、网络、eval、截图、控制台、弹窗、下载和持续观察。session 的 tabId 与 Chrome storage.session 身份共同校验，浏览器重启后必须重新绑定，避免 ID 复用。用户绑定页面 close 只释放绑定；独立 open 页面才会被关闭。

browser 命令返回任务需要的页面数据，不保存到探索记录；网络详情只返回有界 JSON 并按凭据字段脱敏，非 JSON/截断正文省略。Bridge 不记录浏览器参数、脚本或输入值。完整页面截图上限 4000 万像素，支持编号、临时尺寸与本地新文件保存。AX 引用已支持开放/关闭/嵌套 Shadow DOM，DOM 查询可显式包含开放根；通用复杂控件、多连接/profile 待补。

frames 返回可访问页面的 frameId/documentId。eval 支持显式 frame/document，在 MAIN world 执行并等待 Promise；定位、读取、填写和等待也可绑定 documentId。需要 browser_frames_v1，旧插件会被 Bridge 拒绝，避免忽略参数后执行到主页面。frameId 是 Chrome ID，不是 frame 数组索引；同 URL 页面不被合并。指定 documentId 时先校验它与 frameId 配对，再向该文档注入，导航或移除后明确失败。

跨源独立渲染 frame 使用递归 iframe 调试子会话，上下文按 session 分开存储，已有主页面网络/预览缓存不接收子会话的同名 ID。临时文档标记只放在扩展隔离环境；匹配后用 Chrome 的 frame 身份定位唯一 MAIN 上下文，不执行页面定义的 getter 或重写函数。标记在执行前清除，finally 仅按原 documentId 清理；用户表达式只派发一次，并绑定 uniqueContextId，不能落入导航后复用的 contextId。脚本异常、文档失效与中断分开报告；30 秒截止同时覆盖同步运行和不结束的 Promise，不终止共享渲染器，不自动重放。超时不证明副作用没有发生，Agent 应先检查状态。子 frame 的 click/dblclick/hover/drag 现由 browser_frame_pointer_v1 提供原生指针，生成的 exploration 页面来源仍限主 frame。

验证复用现有 static validator、preview runtime validator 和 publisher。所有目标工具必须真实执行且通过，不能跳过。独立探索开启 `restrictToExpectedTools`，仅生成目标进入执行计数；脚手架登录检查和保留的已有工具不计入目标跳过数。共享验证器默认行为不变。任务仅保存验证计数/错误码，不保存预览结果值。安装是本地行为，不上架市场，也不等于授权执行业务写操作。

Agent 可以为最终命令输出声明 requiredPaths、types、notEmpty、patterns、equals 和带明确路径的 rowCount。断言从输出根开始，按每一行精确检查，不回退到相似字段；空列表的行级类型检查为空集，存在性和非空需求单独声明。测试输入必须由作者明确提供，不从流量复制凭据或用户值。修改 cases 同样使验证/审阅失效。扩展须声明 strict_output_contract_v1，旧插件明确拒绝；超过五组用例分批执行并汇总，某批失败不能被其他批掩盖。

站点知识存于当前 profile 的 exploration/knowledge 中，与旧 UI 的记忆分开。只提升该计划选中的结构证据和作者 cases，附可选字段解释及备注，不保存捕获正文。记录使用内容 hash 防止覆盖并发更新，同字段的不同含义拒绝覆盖。30 天有效期按每条记录检查，安装包摘要变化另行标记 stale；知识只作线索，复用前仍要检查当前页面。验证过但未安装的包会显示当前安装摘要不匹配，这不表示验证失败。

目录变化触发的页面刷新与 managed page 调用共用扩展侧队列，等待在途调用完成后才清除注册和重载，后续调用等待刷新结束。它不重试已经执行的业务 handler。

下载由 `browser.downloads` / `browser.wait kind=download` 提供，插件能力为 browser_downloads_v1。绑定时订阅主页面及递归跨源子页面的 Page 下载事件，以事件证明 tab 归属，最多保留每标签 100 条；不从全局下载历史猜标签。cursor 标记开始序号，默认等待最近 browser 动作后的下载，等待开始时冻结边界；显式 after 或 downloadId 用于跨动作、Bridge 重启和长下载续等。被动观察绕过 Bridge 会话/tab 锁和扩展页面队列，不阻塞触发动作。

完成事件返回 complete，取消/中断为 DOWNLOAD_INTERRUPTED；超时区分 not_seen/in_progress，后者附可续等 ID；多个匹配、过期游标和失效上下文明确报错。单次最多 30 秒，不重放下载。落盘路径仅在已观察 URL 和 ±2 秒开始时间范围的唯一 Chrome 元数据匹配中返回，并声明 fileResolution；无法匹配不猜路径。URL 常见凭据参数脱敏，data URL 正文省略；不读文件内容，不修改 Chrome 下载设置。扩展/调试断开或标签关闭清理内存，Bridge 重启可继续；重新绑定后使用新 cursor。子 frame 原生 click 与 focus + 原生 keys Enter 均已在日常 Chrome 完成示例下载，但浏览器仍可能要求站点/下载权限，不把所有网站的自动下载策略视为已解决。

原生子 frame 指针复用文档身份解析，在隔离环境保留选中 DOM 节点和远程对象。DOM.getContentQuads 的坐标属于当前调试目标根视口：同进程子 frame 先逆变换到其本地视口，跨进程边界再通过 iframe 内容四边形逐层投影到主视口，处理边框、滚动、缩放、旋转和透视。逐层使用隔离环境 elementFromPoint 检查目标和 iframe owner，不能越过父层遮挡；不按 URL 或 frame 数组位置选择页面。悬停后重新测量，移动超过半个 CSS 像素、文档改变、遮挡等情况停止，不自动点击重试。30 秒准备截止防止延迟派发，异常拖拽尝试在最后已发送位置释放按钮，finally 清理隔离标记与远程对象。返回 trusted 与 frame/document 身份只表示原生输入已发送，不保证业务动作完成。拖拽限同 frame 的可见元素，不构造 HTML5 DataTransfer。

console/network 的 CLI follow 通过同一 browser.events 轮询接口输出 JSON Lines，不另建 Agent 或 UI 专用服务。events 不占 Bridge 会话/tab 锁或扩展页面队列；扩展每 tab/channel 保留 200 条内存记录，epoch/channel/sequence 游标区分同毫秒事件与不同观察。筛选后也推进 checkpoint，until 年轻事件保留至未来轮询；过期/淘汰游标明确失败，多订阅者互不消费对方数据。

捕获主/子调试会话的 console 与网络终态，pending 以 sessionId/requestId 区分，最多 1000 条，超限明确 gap；子 target 启用 Network。流式网络仅输出有界元数据，详情才请求对应 target 的 JSON 正文并脱敏。redirect、重用 request ID、详情读取期间变化及 pending 淘汰均不能读到后继请求正文。一次性 console/network 保留旧主 target 输出；新 events/follow 覆盖已订阅子 target，不声称捕获绑定前流量或 Worker 流量。

follow 处理 ready/entry/checkpoint/end/error、输出背压、durationMs/maxEvents、SIGINT/SIGTERM 和关闭管道；断线不自动重试。Bridge 重启可显式按 cursor 续接，插件/调试状态失效则重新选择页面并开始新观察。Chrome 主动 detach 不保证触发 onDetach，因此观察轮询用不执行页面代码的 Runtime.getIsolateId 检查所属调试连接，失败清理状态且不自动重附；自有临时调试连接释放也统一清理。since/until 支持 ms/s/m/h，裸数字沿用本项目秒数，区别于 OpenCLI 的毫秒。能力标记 browser_events_v1 阻止旧插件静默忽略新参数。

state 默认保留 DOM 读取；source=ax 通过 Chrome Accessibility.getFullAXTree 取得计算后的 role/name、状态属性与语义树，省略输入 value。默认按可访问 frame 逐一绑定 Chrome frameId/documentId，重复 URL 不合并；显式 frame/document 参数限制到一个文档。refs 总量 1–200（默认 100）、语义节点 1000、文本 12000 字符，最多 50 frame，整体准备期限 30 秒；不能读取的子 frame、达到上限、未映射节点均标明 partial/truncated 与明细，不视作完整页面。

每个 ref 带不可猜测快照 ID 和 frame/document，真实 DOM 节点仅保存在扩展隔离世界 Map。CDP backendNodeId 按所属 target 解析，并验证 ownerDocument，不能把数字 ID 在另一个进程重用。使用时核对当前 Map、URL、连接状态及新 AX role/name；不按相似名称寻找替代节点。AX 原生指针在悬停后/按下前再检查名称与禁用状态；同名节点替换、名称漂移、文档错配和禁用均明确失败。ShadowRoot 与 iframe 祖先逐层检查命中，开放、关闭与嵌套 shadow 控件可通过 ref 读取/输入/原生点击；普通深层 selector 查询和所有自定义控件语义尚未补齐。

compareSources 是 DOM/AX 控件数、命名覆盖、角色分布与耗时的来源比较，按同一文档顺序测量，不是网页历史差异，也不自动决定哪种来源更好。比较不会替换当前引用；来源失败给出错误，不静默回退。快照和引用验证有独立截止，超时不派发后续输入；远程对象按 group 在 finally 释放，页面 Map 只保留该文档当前可用引用。新能力 browser_accessibility_v1 防止旧插件忽略来源或 AX ref。真实证明与边界见跟进记录。

截图高级选项由 browser_screenshot_v1 提供。width/height 是 1–8192 CSS 像素，使用真实桌面视口模拟触发响应式布局，fullPage 忽略 height；按 Chrome zoom/DPR 计算像素边界，预检查和 PNG 尺寸检查均限制为 4000 万像素。annotate 刷新主文档 DOM refs，测量截图前后几何，在 OffscreenCanvas 中合成编号/框线，不向页面插入节点；返回 label/ref、角色/名称、frame/document 与 CSS bounds。限 200 refs，超限显式声明，尚不标注 AX/Shadow DOM/子 frame 节点。

截图必须与测量视口和元素几何一致。Chrome 若在截图时重置其他 CDP 客户端的尺寸 override，首张图片丢弃，固定当前测量尺寸后只重拍一次；不拉伸错误图片掩盖位置偏差。再次不一致、布局变化或文档导航明确失败。完整页面临时回到顶部，finally 恢复视口和原文档滚动；导航后只恢复视口，不把旧滚动应用到新文档。恢复失败优先返回 SCREENSHOT_RESTORE_FAILED，包含原错误码。

restoration.mode 区分 unchanged/native/observed_desktop_override，最后一种表示清除 override 后原观测尺寸未恢复，重新设置了明确的桌面 override；verified 只证明原观测 width/height/DPR/scale 及原文档滚动恢复。CDP 无法读取另一客户端完整 emulation 配置，任意手机/方向模拟配置不在恢复保证内。resize 引起的网站业务副作用也不能撤销。临时尺寸和截图按桌面 Chrome 验收，不能把该结果推广到所有模拟模式。

path 只在 Bridge 解析，须为已有目录下的绝对新文件路径；截图结果验证 PNG 后以 wx、0600 排他写入，绝不覆盖，路径不发送给扩展。保存时返回路径、字节数与元数据，不再返回 base64；失败不改变既有文件。截图及网页数据由调用 Agent 按任务范围留在本地，不进入探索持久证据。

DOM 定位可传 shadow=true，在所选文档及开放 shadow roots 内分别执行 CSS/role/name/text 查询。CSS 组合关系不跨树，重复目标保留并拒绝模糊动作；结果附外到内 shadowHosts 元数据和不透明 shadow refs。树内 aria-labelledby 不误读主文档同 ID，角色/名称/节点/URL 变化使引用失效；主文档 shadow 指针也走已有 frame 指针路径，保留节点并逐层命中测试，悬停后复核 ref。input/change 以 composed 事件通知宿主组件，行为与验证责任写入 Skill。

shadow 查询上限为 20000 元素、100 个开放根、32 层边界，超过即 SHADOW_QUERY_LIMIT，不把不完整候选集当作唯一匹配。输出最多 200 refs，总数和截断明确声明；state 文本仍为 light_dom，深层文本需目标 get/extract。关闭根使用 AX，不支持 shadow 与 AX/compareSources 混用。支持 selector 等待、同 frame drag 与显式 frame/document 操作；子 frame DOM refs 不自动附带路由，调用方继续传身份。upload 与截图编号尚未扩展，通用复合控件协议仍待实现。新能力 browser_shadow_query_v1 防止旧插件忽略选项或引用。

## 已安装命令修复

已安装命令维护使用 repair-info/repair：先读取当前包摘要并采集新证据，再将已有只读命令复制到隔离草稿，绑定当前任务的修复范围。只允许改所选模块、schema 和 description，其他文件/命令、身份、路由、权限不变，禁止新增共享代码。静态检查、运行验证及发布三处均核对当前包摘要和服务保存的修复范围；草稿文件内的声明不能扩大范围。历史 cases 会带入并标记过期信息，每个目标至少一组，全部重新运行通过才能安装。当前支持 Extension-only 包；写命令、共享文件重构仍待后续。

## 后续 UI 统一

本轮独立命令不经过 TypeScript Backend。后续由 Backend 的薄适配层调用相同 Bridge 命令，使 API 探索页面、内置聊天工具与外部 Agent 共用任务状态和校验。UI 不需要启动 shell；不得借此改动 Python 网站探索agent。

## 验证与未完成范围

具体命令和数量见交接日志。WebCLI 全量 106 文件、1131 项通过；扩展相关 109 项通过。真实 Chromium + 未打包插件 + 独立 CLI/Bridge + loopback 示例站点完整 36 项通过，包含开放 Shadow DOM 定位/输入/等待、截图编号/尺寸/恢复、AX/DOM 对比与跨 frame/Shadow DOM 引用、首次自动启动 JSONL、持续观察/游标/信号/断线续接、浏览器操作、下载生命周期与续等、同 URL/嵌套跨源 frame、POST/GraphQL 工具、六组精确断言、知识持久化、API/DOM 定向修复、三个页面来源、动态 GET/POST 路径参数、跨域 INTERCEPT、跨文档页面查询，以及 API 503 后保留历史并切换 DOM 的闭环。frame 的 Promise 超时、输出身份及页面重写内置函数时的隔离匹配仍通过。用户指定的真实公共视频搜索页已完成采集、生成、修复、验证、增量安装和普通 CLI 搜索/分页，DOM 命令也与当前页面逐项核对；原始页面/响应未进入仓库。动态路径使用公开占位 loopback 示例站点验收，不代表已在该外部搜索站点验证动态详情接口。

验收脚本为 `webcli/scripts/verify-exploration-browser.mjs`；使用临时副本改变连接端口及 CLI 配置目录，生产协议和默认端口未改。只启动/停止脚本自己创建的服务和浏览器，Adapter 安装、任务和浏览器配置均隔离。Playwright 用于测试浏览器启动、示例导航及下载取消刺激/诊断；下载观察、探索/生成/验证/安装和业务调用均经过真实 CLI 与插件，不 mock 扩展传输、fetch 或验证器。隔离浏览器显式允许下载并使用临时目录；日常 Chrome 另行验收，不把该测试设置当成用户浏览器的默认策略。

待做：独立 PUBLIC_API/COOKIE_API 执行、动态页面路由/多步 UI、通用 CSRF/签名、写命令、知识冲突修订与共享文件/写命令修复；Codex/Claude 各一次全新独立对话验收、各平台安装包；API 探索 UI/旧聊天入口统一，以及能力台账中的其他差距。当前由调用 Agent 通过 analyze/replan 明确切换策略，没有运行时静默回退。当前证据不代表任意 Agent 在任意站点上的生成质量已验证。

跨文档查询真实增量：用户 Chrome 的新页面搜索命令以 excel/spreadsheet 两组严格预览通过；安装后普通调用分别读取 24/27 张视频卡片，标题与链接逐项等于当前页面，结果随关键词变化。旧 API 三组返回 17/20/20 视频、DOM 24 张、INTERCEPT 下一页返回 38 视频，均通过。B 站相同关键词不会触发新查询，命令明确 PAGE_QUERY_TIMEOUT，不能用同词搜索重置页码；已通过切换词恢复 excel 第一页。该限制写入本地知识，不作通用多步流程完成结论。
