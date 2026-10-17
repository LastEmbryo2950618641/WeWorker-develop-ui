# WebCLI 与 OpenCLI 能力对齐台账

更新：2026-10-17。用户要求尽力实现与 OpenCLI 完全相同的能力；本文件保留完整目标，不把当前首版或单个测试站点视为完成标准。分支历史与同步约束见 [CLI 跟进文档](api_exploration_cli_handoff.md)。Python 网站探索agent全程排除。

对照基线是本机 OpenCLI 1.8.6 的实际命令帮助和本地 usage / adapter-author / browser / autofix 技能；命令提示存在 1.8.8 更新，尚未核对其变更。按能力实现，保留本项目统一 `webcli call <namespace>.<command>` 入口和 Extension / Toolkit 分离边界，不复制上游实现。

| 能力族 | 目标与验收证据 | 当前状态 |
| --- | --- | --- |
| 任意 Agent 与发现 | 不依赖桌面或第二模型 Key；结构化帮助、Skill；Codex/Claude 独立对话 | 核心架构已实现；跨 Agent 独立验收待做 |
| 浏览器会话 | open/bind/unbind/close/tab、profile、多连接管理、doctor；用户页不误关闭、跨 CLI/重启恢复 | 命名会话、owned/bound 关闭规则、doctor、持久绑定、Chrome 会话身份守卫已实现；真实 owned/bound 验收通过；多 profile/连接待做 |
| 页面操作 | state/find/get/extract、click/dblclick/fill/type/select/check/uncheck/focus/hover/scroll/keys/drag/upload/dialog；过期引用和模糊定位报错 | 主 frame 原生指针、拖拽、文件输入、弹窗及表单命令已实现并真实验收；子 frame 指针仍为 DOM 事件，Shadow DOM/复杂控件待补 |
| 页面观察 | frames/screenshot/console/eval/wait、网络摘要/detail/filter/follow、有界响应读取、失效错误 | 主 frame eval、frames 列表、完整截图、console 游标、网络摘要/JSON 详情/子串/失败/时间筛选已真实验收；复杂 frame、下载等待和网络流待做 |
| 探索策略 | PUBLIC/COOKIE/PAGE_FETCH/INTERCEPT/DOM_STATE/UI_SELECTOR；接口/页面状态/脚本发现与策略理由 | GET/POST 查询及声明式 UI_SELECTOR/DOM_STATE 已实现；页面列表、公开状态、JSON 脚本可单独或与 API 混合生成，精确路由、作者 cases、安装后调用及页面命令修复已真实验收；单步 INTERCEPT 已实现并通过本地跨域签名查询及真实翻页验收；自动选择/回退、多步 UI 工作流待做 |
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
