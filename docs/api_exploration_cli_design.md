# API 自动探索 CLI 开发设计（待审阅）

更新：2026-10-17。分支与验证记录见 [交接文档](api_exploration_cli_handoff.md)。本文命令、协议及新增文件均为设计，尚未实现。

## 1. 本次要交付什么

用户可以对聊天助手说：“分析我打开的 example.com 列表页，生成可复用的查询命令。”助手通过 WebCLI 启动探索、观察进度、补充信息、生成验证并展示安装预览；用户确认后安装 Adapter，以后通过普通 `webcli call example.com.search` 复用。

首版支持明确参数的 CLI 和由聊天 Agent 编排的自然语言调用。CLI 的 `goal` 接收自然语言目标，由现有探索协调器处理；CLI 不再启动第二个外层模型来解释任意命令。外部 Agent 通过 Skill 使用同样的命令。

**范围只包含 TypeScript API 探索链路。Python 网站探索agent及其界面、服务、存储、生命周期和测试均不改动。** 不把两条探索链路合成一个服务，不调用 Python 探索接口。

## 2. 当前代码事实

| 现有位置 | 已有能力 | 本次工作 |
| --- | --- | --- |
| `weworker/backend-ts/src/exploration-agent.ts` | ExplorationAgentCoordinator，任务创建/保存/查询/取消、动作补采、生成/恢复/安装 | 作为业务执行核心，补齐公共命令契约 |
| `weworker/backend-ts/src/server.ts` 的 `/exploration/*` | 界面 HTTP 入口，任务、补采和生成控制 | 薄化为契约适配层，保持旧接口兼容 |
| `weworker/backend-ts/src/tools.ts` | dev 分支已有列标签页、开始探索、列任务、生成/查询/恢复/安装等聊天工具 | 逐步统一到同一命令分发，避免双份行为 |
| `weworker/renderer/src/api/exploration-api.js` | API 探索页面请求封装 | 后续改用统一契约，保持原交互 |
| `webcli/index.js`、`bridge.js` | CLI 调用入口、浏览器与生成通信 | 暴露探索命令与受限宿主通信 |
| Extension 现有探索消息与 WebCLI 生成组件 | 被动采集、安全探测、回放、生成验证与安装 | 优先复用，不增加第二套 Runner |

现有任务已有持久化和启动恢复逻辑，应沿用并补齐测试，不能假定需要新数据库。探索状态与生成状态是两套现有状态，不把“探索完成”包装成“工具已可用”。

## 3. 参考 OpenCLI 的部分

参考依据：本机 OpenCLI 1.8.6 的 `browser --help`、`browser network --help`，以及本地 opencli-usage、opencli-adapter-author 技能。未审计其远端最新源码，也未在真实站点验证。

- 明确会话与 tab 身份，避免“当前页”随焦点变化而误操作。
- 先获取证据，再选择策略，最后生成和验证；不把 HTTP 200 当业务成功。
- 命令输出机器可读结果、明确错误和可执行的下一步。
- 采集证据以结构摘要为主，验证字段含义和分页，失败保留可排查线索。
- 公开契约优先；遇到动态签名或登录阻塞，使用既有合法页面能力或请求用户处理，不猜测接口。

不照搬它的完整原始响应读取、任意 eval 或新浏览器守护进程。WeWorker 继续遵守自己的证据脱敏、确认规则和 `webcli call` 入口。旧 `opencli explore` 已在技能中标记移除，不据此设计兼容层。

## 4. 推荐架构

```text
自然语言 / 外部 Agent → Skill → webcli call exploration.<command>
                                      ↓
                           受限且鉴权的宿主命令通道
                                      ↓
界面 HTTP / 兼容聊天工具 → ExplorationCommandService（新增）
                                      ↓
                       ExplorationAgentCoordinator（现有）
                                      ↓
                  现有 Bridge → Extension / 生成与验证组件
```

`exploration` 是拟定保留命名空间，作为内置管理命令目录展示，不伪装为网站 Extension Adapter 或 Python Toolkit。在 CLI 的 call 分发和帮助系统中显式注册，防止用户包覆盖此命名空间；不改两类业务 Adapter 的 Runner。

新增服务负责参数校验、权限、状态前置条件、幂等、结果摘要及错误映射。WebCLI 不按业务 Schema 自动转换类型；服务在边界明确解析 tabId 等十进制字符串，拒绝空值/小数/溢出。旧 HTTP 与聊天入口复用服务，不复制校验。

首版依赖运行中的 WeWorker Backend、Bridge 和浏览器扩展。独立 npm WebCLI 没有宿主时返回可操作的 `HOST_UNAVAILABLE`，不悄悄启动 Python 或另一个模型运行时。纯 CLI 无桌面宿主模式暂不包含。

### 宿主通道是 P0 的前置决策

Backend HTTP 使用 `X-WeWorker-Auth`，不能假定终端 CLI 能拿到 Electron 启动 token，更不能去读设置文件取得凭据。

推荐由现有 Bridge 增加固定探索命令转发：Backend 建立认证连接并注册白名单处理器，CLI 通过现有本地调用通道发出结构化命令；Bridge 只转发固定命令/参数，不接受任意 URL、文件路径或 shell。Backend → Bridge 的业务调用继续按各自 requestId 处理，不能让等待宿主结果阻塞同一连接处理下游消息。

开发前先做协议验证：双向请求不死锁、宿主断连明确失败、超时不重新启动任务、旧版本能力检查、CLI 调用方权限与确认来源可识别。不能仅凭 loopback 或一个 `confirmed=true` 就认定获得授权。若现有通道无法提供调用身份，先实现受限本地授权握手，再开放有副作用命令；不暴露通用 HTTP token。接口安全评审通过才进入完整实现。

## 5. 建议命令清单

全部通过 `webcli call exploration.<command>`，首版输出 JSON，沿用现有 CLI 参数方式。以下命令名待审阅。

| 阶段 | 命令 | 作用 |
| --- | --- | --- |
| P1 | `capabilities` / `tabs` | 判断宿主/扩展/模型条件，列出可探索页面 |
| P1 | `start` | `tabId` + 自然语言 `goal`；快速返回 taskId |
| P1 | `list` / `get` / `events` | 找回任务、查询状态和游标增量事件 |
| P1 | `cancel` | 停止任务及其活动子阶段，幂等 |
| P1 | `generate` | 复用 auto，返回 generationRunId；不自动安装 |
| P1 | `answer` | 回答当前 questionId，按实际阶段恢复 |
| P1 | `review` / `install` | 查看工具/权限/验证差异；以当前 reviewId 确认本地安装 |
| P2 | `capture-start` / `capture-stop` | 为指定任务补采用户操作，绑定 tab 与 action |
| P2 | `capture-get` / `capture-analyze` / `capture-select` | 查询补采、仅重试分析、选择候选 |

`events` 首版使用有界轮询和 cursor，不要求长连接。`generate` 自动沿用现有保存证据逻辑，不要求用户多执行一个 save。`review` 只能查看已经生成的草稿；安装是本地动作，不是上传市场。

示例（占位参数，尚不可执行）：

```bash
webcli call exploration.tabs
webcli call exploration.start --tabId=7 --goal='分析列表查询与分页，生成只读工具' --requestId=example-request-1
webcli call exploration.get --taskId=example-task
webcli call exploration.events --taskId=example-task --cursor=0
webcli call exploration.generate --taskId=example-task --mode=auto
webcli call exploration.review --taskId=example-task
# 用户审阅并同意当前草稿后：
webcli call exploration.install --taskId=example-task --reviewId=example-review
```

不推出默认“一句话自动安装”。目标不清、多标签页匹配、需要登录或写入验证时，返回问题并等待明确输入。

## 6. 状态、输出和权限

统一结果信封拟为 `schemaVersion / ok / command / taskId / data / error`。data 中保留 `explorationStatus`、`generationStatus`，增加 `phase`、`nextActions` 和 `pendingQuestion`；事件有单调序号和 cursor。摘要不返回 Cookie、密钥、真实响应内容或用户绝对路径。

- 异步命令返回成功表示“已接受”，不是探索成功；失败任务由状态明确表达。
- 调用失败使用非零退出码和稳定 error.code，详细日志写 stderr，stdout 保持可解析 JSON。
- 错误至少覆盖 INVALID_ARGUMENT、HOST_UNAVAILABLE、CAPABILITY_UNAVAILABLE、AUTH_REQUIRED、TASK_NOT_FOUND、INVALID_STATE、TAB_CHANGED、TIMEOUT、CONFIRMATION_REQUIRED、STALE_REVIEW。
- `start` 和 `generate` 支持 requestId 幂等；相同 key 不同参数拒绝，任务存储中记录有界去重信息，避免跨重连重复创建。
- 同一任务的写入命令串行化；cancel 传播到活动采集/生成，迟到结果不覆盖 cancelled；等待命令超时只结束等待，取消必须显式请求。
- taskId/tabId/站点身份联检；页面变化后不能把原站点证据用于另一个站点。
- questionId 与当前状态匹配，旧答案拒绝；reviewId 绑定草稿摘要、权限和验证结果，草稿变化使旧确认失效。
- 安装确认不等于授权执行工具的业务写入。写工具继续使用已有 mock 与确认门禁，默认不做真实写验证。
- 进程重启后只恢复可恢复阶段，不自动重放有副作用操作；复用既有记录格式并保持旧任务可读，不在本轮引入数据库迁移。

## 7. 自然语言与 UI 如何接入

新增 API 探索 Skill：识别“把这个页面变成工具/探索接口”等意图，先检查能力和页面，再 start → get/events → generate → review。等待人处理时只问具体问题；生成完成后列出命令、参数、验证范围和安装差异。

已有聊天工具作为兼容入口先调用同一服务；新自然语言路径使用 CLI，避免在一次请求里同时走两套入口创建重复任务。将原 full 权限约束映射到新调用方能力，不能因开放 CLI 而降低限制。

UI 后续改为调用同一命令服务的 HTTP 适配层，消费同样状态和事件。UI 无需为了“接 CLI”而启动 shell 子进程；命令语义、权限与任务执行一致即可。只迁移 API 探索页面，不触及 Python 网站探索agent页面。

## 8. 分阶段交付与验收

1. **P0：契约与通信验证。** 固化参数/输出/错误，确定命令目录注册和调用身份方案；完成受限双向通道测试。验收：无任意代理、断连/超时/旧版本明确报错，业务命令执行不死锁。
2. **P1：只读探索闭环。** 实现 tabs/start/get/list/events/cancel/generate/review/install/answer、帮助及 Skill。验收：命令行发起任务、换进程找回、生成查询 Adapter、审阅安装并以普通 call 调用；模拟与真实验证分别记录。
3. **P2：补采与恢复。** 接入现有补采全流程、候选选择和分析重试。验收：补采不丢旧证据、重试分析不重新操作页面，登录/证据不足/用户中断均可解释。
4. **P3：API 探索 UI 统一。** 旧 HTTP/聊天兼容层共享契约，迁移 UI。验收：CLI 启动的任务 UI 可见，UI 启动的任务 CLI 可查可控，跨入口取消/恢复一致。

聚焦测试覆盖参数字符串解析、重复提交、跨 tab、陈旧确认、取消竞争、重启恢复、权限不足、脱敏、业务错误与真实空态。运行 Backend 类型检查、WebCLI 测试/打包入口校验；涉及 Renderer 时跑单测、构建和语法检查。真实验收至少覆盖公开查询、需登录查询、分页及生成失败恢复，写操作仅 mock/门禁验证。

首版不做通用浏览器 CLI 重写、任意自动化脚本执行、自动上架市场、Python 探索接口或无人确认安装。

## 9. 本轮审阅建议

建议接受：保留 exploration 命名空间；P1 先交付只读闭环；首版依赖 WeWorker 宿主；自然语言由 Skill/Agent 编排；UI 共享命令服务；安装保留显式审阅。实现前优先完成宿主授权通道验证，避免命令已经写完却无法安全调用现有 Backend。
