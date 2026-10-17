# WebCLI 与 OpenCLI 能力对齐台账

更新：2026-10-17。用户要求尽力实现与 OpenCLI 完全相同的能力；本文件保留完整目标，不把当前首版或单个测试站点视为完成标准。分支历史与同步约束见 [CLI 跟进文档](api_exploration_cli_handoff.md)。Python 网站探索agent全程排除。

对照基线包括本机 OpenCLI 1.8.6 的实际命令帮助、本地技能与 npm 官方 1.8.8 发布包静态接口审计，见 [1.8.8 核查](opencli_1_8_8_audit.md)。静态接口不等于上游实机验收。按能力实现，保留本项目统一 `webcli call <namespace>.<command>` 入口和 Extension / Toolkit 分离边界，不复制上游业务实现。

| 能力族 | 目标与验收证据 | 当前状态 |
| --- | --- | --- |
| 任意 Agent 与发现 | 不依赖桌面或第二模型 Key；结构化帮助、Skill；Codex/Claude 独立对话 | 核心架构已实现；跨 Agent 独立验收待做 |
| 浏览器会话 | open/bind/unbind/close/tab、profile、多连接管理、doctor；用户页不误关闭、跨 CLI/重启恢复 | 命名会话、owned/bound 关闭规则、doctor、持久绑定、Chrome 会话身份守卫已实现；真实 owned/bound 验收通过；多 profile/连接待做 |
| 页面操作 | state/find/get/extract、click/dblclick/fill/type/select/check/uncheck/focus/hover/scroll/keys/drag/upload/dialog；过期引用和模糊定位报错 | 主 frame 原生指针、拖拽、文件输入、弹窗及表单命令已实现并真实验收；嵌套同源/跨源 frame 原生 click/dblclick/hover/同 frame drag 已验收，含缩放/旋转/透视与祖先遮挡拒绝；Shadow DOM/复杂控件和跨 frame/DataTransfer 拖拽待补 |
| 页面观察 | frames/screenshot/console/eval/wait、网络摘要/detail/filter/follow、有界响应读取、失效错误 | 主 frame 及嵌套跨源 frame eval、frame/document 身份校验、frames 列表、完整截图、console 游标、网络摘要/JSON 详情/子串/失败/时间筛选已真实验收；下载生命周期/游标/续等及跨源 frame 下载已验收；AX、截图标注/尺寸和网络流待做 |
| 探索策略 | PUBLIC/COOKIE/PAGE_FETCH/INTERCEPT/DOM_STATE/UI_SELECTOR；接口/页面状态/脚本发现与策略理由 | PAGE_FETCH、声明式 UI_SELECTOR/DOM_STATE、单步 INTERCEPT 与跨文档页面查询已真实验收。analyze 提供结构分类/契约/错误建议，strategyNote 保存理由；Agent 可 replan 保留旧方案再换来源，API 失败→DOM 全流程通过。PUBLIC_API/COOKIE_API 独立 host HTTP runner、多步 UI 未实现；无运行时静默回退 |
| 请求和鉴权 | POST 只读查询、GraphQL、动态路径、跨源、Cookie/CSRF/runtime 签名、写操作语义与确认 | 显式 API origin 授权、Agent 计划的 JSON/form POST 与 GraphQL query、API 路径参数已实现；动态 GET/POST 四组真实用例及安装后调用通过，固定域名/路径其余段，ID 不转数字；真实 B 站 PAGE_FETCH 关键词/分页完整闭环通过；INTERCEPT 可由页面生成临时请求头/签名；通用 CSRF/签名算法、动态页面路由和写命令待补 |
| 生成与验证 | 任意目标数量、草稿文件编辑、字段映射、语义/样例验证、同站增量保留、审阅安装 | Agent 计划支持 1–50 工具，draft-add 支持新文件；每工具 1–10 组作者参数和精确路径/类型/非空/格式/值/数量断言，超过五组分批执行；六组真实用例含最后一组故意失败与修复已验收；更大计划需分任务 |
| 维护与知识 | 站点 endpoints/field-map/notes/fixtures、有效期、trace、安装后自动修复、重试界限 | 已有任务历史、结构 trace、站点知识/过期标记；repair-info/repair 支持 Agent 定向修复已安装的只读命令，带入历史 cases 并重新验证、审阅安装；真实字段漂移后六组失败→修复通过已验收。知识冲突修订、共享文件/写命令修复待做；Agent 依 Skill 最多三轮修复 |
| 分发与工具生态 | 对应 plugin / adapter 管理能力、输出格式、补全、现有 Adapter 能力对照 | 复用已有 v2/AdapterHub；逐项差异和覆盖率待核对 |
| 扩展运行目标 | Electron/CDP 接入、外部 CLI passthrough 等 OpenCLI 能力 | 尚未实现/核对，不据当前浏览器验收宣称完成 |
| 产品复用 | API 探索 UI 和内置对话复用同一命令服务 | 待接入；不涉及 Python 模块 |

验收记录要求：每项提供代码位置、自动化用例、真实运行证据和剩余限制。没有证据的项保持未完成。真实站点使用用户指定的 B 站 `https://search.bilibili.com/all?keyword=excel`；仓库内只保存公开占位示例与验证摘要，不保存用户页面、登录信息或网络原始响应。

2026-10-17 本轮证据：`webcli/browser-service.js`、`extension/background/browser-*.js`、`webcli/exploration-service.js` 及共享 plan/scaffold；WebCLI 98 文件/1069 项，Extension 聚焦 42 项；`webcli/scripts/verify-exploration-browser.mjs` 17 项真实检查通过。外部搜索页三次普通 CLI 调用（两页及不同关键词）各返回 20 条、页码正确、ID 集合发生变化、标题/链接等字段有效。API 为内部接口，仍需维护，不能据此推断长期稳定性。

后续验证/知识增量：`exploration-verification.js`、`exploration-knowledge.js`、`strict-output-contract.js` 和共享 preview batching。发现并修复扩展每次只执行前五组导致大计划无法完成的限制；另修复安装后目录刷新重载页面与普通调用竞争。WebCLI 全量当前 100 文件/1077 项，真实浏览器新增六组断言与知识持久化检查。安装后自动修复还未实现，不能把草稿修复视为该项完成。

安装后修复增量：`exploration-repair.js` 与共享 retention/static/runtime/publisher 的显式 scope 支持。WebCLI 全量 100 文件/1080 项通过，隔离真实浏览器 20 项通过；实际改变示例站点响应字段，旧六组 cases 全部失败，Agent 通过 draft-write 修复映射后六组全部通过，安装后普通调用及其他已有命令通过。共享文件与其他命令保持原字节，安装基线变更拒绝覆盖；npm pack dry-run 581 文件含新模块。该能力依赖调用 Agent 分析和编辑，没有后台第二模型。

真实站点维护：新精确断言发现接口混入无 BV 标识的课程类型，局部修复生成命令的筛选/说明并重新验证、安装。三组真实查询通过：第一页 17 个视频并报告排除 3 个课程，第二页及另一关键词各 20 个视频；结果随页码和关键词变化。cases/字段含义保存为本地站点知识。此前“20 条且类型有效”记录是历史证据，不代表那一版的全部条目都是普通视频。

页面策略增量：`exploration-page.js` 与扩展 `page-source.js` 提供声明式 DOM/状态读取，page-source-v1 不伪造 API 证据。真实无 JSON API 示例页验证三个来源、安装后普通调用、空态与选择器漂移修复。普通调用增加精确 origin/pathname 路由，缺失/多页歧义报错；页面命令必须有作者 cases，知识逐条记录过期。WebCLI 101 文件/1086 项、扩展聚焦 40 项、隔离真实浏览器 22 项通过，npm pack dry-run 583 文件含新模块和 Skill。用户 Chrome 的新增 DOM 命令安装后读取 27 张已渲染视频卡片，标题/链接逐项匹配当前页面；已有 API 三组查询再次通过。该命令读取当前页面已有卡片，未实现参数驱动的多步 UI 工作流或完整列表采集。

API 动态路径增量：`generation-harness/path-parameters.js`、plan binding 和 scaffold 将 Agent 指定的路径段映射为必填字符串参数，保持固定域名/路径其余段，query/body 分开处理；至少两组不同路径组合实际验证。WebCLI 102 文件/1090 项、隔离真实浏览器 23 项通过，动态 GET/JSON POST 四组精确 ID/query/body 断言与安装后普通调用成功，非法路径没有发请求。CLI/Bridge 构建与 npm pack dry-run（584 文件）通过。该项验收使用 loopback 公共示例；动态页面路由、运行时 CSRF/签名仍待做。

INTERCEPT 增量：`exploration-intercept.js`、扩展 `intercept-read.js` 与临时 preview grants 支持已观察查询控件触发新响应；GET query / POST body 必须关联输入参数，参数命令至少两组不同值 cases。跨域授权来自草稿/已安装 manifest，观察仅存结构，预览 token 绑定 tab/route/有效期并清理。WebCLI 103 文件/1094 项、Extension 聚焦 63 项通过；隔离 Chromium 24 项检查覆盖页面一次性请求头、无请求头重放 403、跨域 GET/POST 两组参数、预览/安装/普通调用和超时/多响应/HTTP 错误。最终 24 项还包含同 pathname 整页导航失败断言，返回 INTERCEPT_DOCUMENT_CHANGED；最新插件实机复验第 1→2 页成功，38 视频/排除 4 非视频，已恢复第一页。

真实 Chrome 的后台标签页暴露原生点击未送达问题，已在原生鼠标/按键和 INTERCEPT 执行前调用 Page.bringToFront。B 站新增 `bilibili.com.explored-next-videos` 本地生成→严格预览（页 3→4）→增量安装→普通调用（页 4→5）通过，后者返回 35 视频/排除 7 非视频，页码与 URL 一致；旧 API 三组回归 17/20/20 视频，DOM 当前卡片 25 张。关键词搜索发生整页导航，不作为当前单步 INTERCEPT 成功证据；页面驱动翻页返回本次页，不是任意页查询。用户页已回到 excel 第一页，来源/断言与限制记录在本地站点知识。

跨文档查询增量：新增 exploration.query / page_query_v1，使用 UI_SELECTOR mode=query，声明固定同源结果路径、URL 参数关联和 DOM/状态读取。后台触发一次，重注入后通过独立 continuation 返回结果；pageWorkflow/additionalPaths 支持从结果页重复调用。WebCLI 104 文件/1100 项、Extension 聚焦 58 项、隔离 Chromium 25 项通过；本地 fixture 精确检查观察、两组预览、两次普通调用合计五次提交，没有重放。真实 B 站两关键词预览和普通调用通过，24/27 张卡片与当前 DOM 逐项一致；同词无新导航会明确超时。旧 API/DOM/下一页回归通过，已恢复 excel 第一页，知识 stale=false。CLI/Bridge 构建、配置及 npm pack dry-run 588 文件通过。目录刷新曾重载正在捕获的页面，调用栈确认后将探索/预览/browser 与 managed 调用纳入同一页面队列，弹窗处理例外以解除等待。动态路由、跨源查询导航、无 URL 关联筛选与多步 UI 仍未实现。

来源分析/方案历史增量：新增 `exploration-analysis.js` / `exploration-revisions.js`，analyze 仅处理结构与失败摘要，不发请求；字段启发式不证明业务目标或公开契约，广告/推荐 JSON 也可能被标为 likely_data，必须由调用 Agent 再判断。replan 按文件/计划/cases 摘要保留旧方案，允许重新观察来源；旧 review 失效、cases 必须重写。最多 20 次历史存储，Agent 修复仍最多三轮，不适用于 scoped repair 或已安装任务。

WebCLI 105 文件/1116 项、Extension 聚焦 53 项、隔离 Chromium 26 项通过。实际 loopback API 503 后分析没有重放请求，旧源码/失败结果保留，改用 DOM 后严格验证、安装与普通调用通过，Bridge 重启能读历史。首次 fixture 未消费 fetch 响应体，修正后可采到完成响应；独立采集显式保留 JSON 噪声用于分类，默认过滤不变。真实 Chrome 先保留正常 API 草稿，再按“当前卡片”目标改选 DOM；新普通命令返回 24 张可见卡片，与页面逐项一致。初次人工验收脚本误将 12 张隐藏卡片算入预期，修正可见性范围后通过，未修改生产读取或放宽断言。已保存来源理由与知识，stale=false；重启后历史读取与命令再调用通过。CLI/Bridge 构建、配置及 npm pack dry-run 590 文件通过。

跨 frame 增量：新增 `extension/background/browser-frames.js`，frames 提供 Chrome frameId/documentId，eval 可执行嵌套跨源 MAIN 上下文，页面定位/输入也可校验文档。相同 URL、多进程重复 context ID、导航、脚本异常和永不结束 Promise 均有覆盖；旧插件缺 browser_frames_v1 时明确拒绝。WebCLI 105 文件/1117 项、Extension 聚焦 52 项通过，隔离 Chromium 最终完整 27 项通过，包含超时与身份输出、页面重写内置函数时的隔离匹配。日常 Chrome 五 frame 公开临时 fixture 及 B 站主文档/24 卡片回归通过。子 frame click/hover 仍是 DOM 事件，生成的 exploration 页面来源仍限主 frame；本轮不代表 AX、Shadow DOM 或完整浏览器能力完成。

下载生命周期增量：新增 browser-downloads.js / browser_downloads_v1，35 个 browser 命令。Page 事件限定标签归属，递归子会话启用 Page 事件；最多 100 条内存记录，游标/ID、重复歧义、进度超时与取消均明确处理。等待绕过页面操作锁，支持先等待后点击；落盘路径只做限定 URL/时间的唯一匹配。WebCLI 105 文件/1118 项、扩展聚焦 64 项、隔离 Chromium 完整 28 项通过，含传输中重启 Bridge 后同 ID 继续、一次请求和准确文件字节。日常 Chrome 155 的主页面下载、慢速续等、跨源 frame focus + Enter 及落盘内容通过；DOM click 在该环境没有创建下载记录，未改变下载策略绕过。B 站 Excel 第一页原命令 24 卡片标题/规范化链接逐项一致，未混入示例下载。

原生 frame 指针增量：browser-pointer.js 与 browser_frame_pointer_v1 复用隔离文档身份，按调试目标根视口处理同进程逆变换与跨进程投影，逐层命中检查。悬停布局变化/文档导航失败，不回退 DOM click；保留原生 input 副作用的不确定性。WebCLI 1119 项、扩展聚焦 69 项，隔离完整 29 项及最终浏览器聚焦通过；日常 Chrome 六个同/跨源嵌套 frame 在缩放、旋转、透视与边框下 click/hover/dblclick/drag 均 isTrusted=true，祖先遮挡拒绝，原生子 frame click 下载成功并核对文件字节，修复上一阶段必须用 Enter 的限制。B 站 Excel 第一页 24 卡片回归通过。仍不代表 Shadow DOM、自定义 DataTransfer、跨 frame 拖拽或 exploration frame 来源生成已实现。
