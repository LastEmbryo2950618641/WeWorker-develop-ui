# WebCLI 与 OpenCLI 能力对齐台账

更新：2026-10-17。用户要求尽力实现与 OpenCLI 完全相同的能力；本文件保留完整目标，不把当前首版或单个测试站点视为完成标准。分支历史与同步约束见 [CLI 跟进文档](api_exploration_cli_handoff.md)。Python 网站探索agent全程排除。

对照基线是本机 OpenCLI 1.8.6 的实际命令帮助和本地 usage / adapter-author / browser / autofix 技能；命令提示存在 1.8.8 更新，尚未核对其变更。按能力实现，保留本项目统一 `webcli call <namespace>.<command>` 入口和 Extension / Toolkit 分离边界，不复制上游实现。

| 能力族 | 目标与验收证据 | 当前状态 |
| --- | --- | --- |
| 任意 Agent 与发现 | 不依赖桌面或第二模型 Key；结构化帮助、Skill；Codex/Claude 独立对话 | 核心架构已实现；跨 Agent 独立验收待做 |
| 浏览器会话 | open/bind/unbind/close/tab、profile、多连接管理、doctor；用户页不误关闭、跨 CLI/重启恢复 | 命名会话、owned/bound 关闭规则、doctor、持久绑定、Chrome 会话身份守卫已实现；真实 owned/bound 验收通过；多 profile/连接待做 |
| 页面操作 | state/find/get/extract、click/dblclick/fill/type/select/check/uncheck/focus/hover/scroll/keys/drag/upload/dialog；过期引用和模糊定位报错 | 主 frame 原生指针、拖拽、文件输入、弹窗及表单命令已实现并真实验收；子 frame 指针仍为 DOM 事件，Shadow DOM/复杂控件待补 |
| 页面观察 | frames/screenshot/console/eval/wait、网络摘要/detail/filter/follow、有界响应读取、失效错误 | 主 frame eval、frames 列表、完整截图、console 游标、网络摘要/JSON 详情/子串/失败/时间筛选已真实验收；复杂 frame、下载等待和网络流待做 |
| 探索策略 | PUBLIC/COOKIE/PAGE_FETCH/INTERCEPT/DOM_STATE/UI_SELECTOR；接口/页面状态/脚本发现与策略理由 | 既有同源 GET 闭环已验收；完整策略选择与回退待做 |
| 请求和鉴权 | POST 只读查询、GraphQL、动态路径、跨源、Cookie/CSRF/runtime 签名、写操作语义与确认 | 显式 API origin 授权、Agent 计划的 JSON/form POST 与 GraphQL query 已实现；真实 B 站 PAGE_FETCH 关键词/分页完整闭环通过；动态路径、CSRF/签名通用策略和写命令待补 |
| 生成与验证 | 任意目标数量、草稿文件编辑、字段映射、语义/样例验证、同站增量保留、审阅安装 | Agent 计划支持 1–50 工具，draft-add 支持新 helper/command/guidance；三个 POST 查询实际生成/验证/安装/调用通过；更大计划需分任务；语义 fixtures 待补 |
| 维护与知识 | 站点 endpoints/field-map/notes/fixtures、有效期、trace、安装后自动修复、重试界限 | 任务历史、草稿修复及结构 trace 已有，完整站点知识/安装后修复待做 |
| 分发与工具生态 | 对应 plugin / adapter 管理能力、输出格式、补全、现有 Adapter 能力对照 | 复用已有 v2/AdapterHub；逐项差异和覆盖率待核对 |
| 扩展运行目标 | Electron/CDP 接入、外部 CLI passthrough 等 OpenCLI 能力 | 尚未实现/核对，不据当前浏览器验收宣称完成 |
| 产品复用 | API 探索 UI 和内置对话复用同一命令服务 | 待接入；不涉及 Python 模块 |

验收记录要求：每项提供代码位置、自动化用例、真实运行证据和剩余限制。没有证据的项保持未完成。真实站点使用用户指定的 B 站 `https://search.bilibili.com/all?keyword=excel`；仓库内只保存公开占位示例与验证摘要，不保存用户页面、登录信息或网络原始响应。

2026-10-17 本轮证据：`webcli/browser-service.js`、`extension/background/browser-*.js`、`webcli/exploration-service.js` 及共享 plan/scaffold；WebCLI 98 文件/1069 项，Extension 聚焦 42 项；`webcli/scripts/verify-exploration-browser.mjs` 17 项真实检查通过。外部搜索页三次普通 CLI 调用（两页及不同关键词）各返回 20 条、页码正确、ID 集合发生变化、标题/链接等字段有效。API 为内部接口，仍需维护，不能据此推断长期稳定性。
