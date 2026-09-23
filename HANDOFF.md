# Adapter 架构改造交接

最后更新：2026-09-23。状态：共享源码基线已合并，内部安装包已生成，本机代码与测试收尾，CI 对齐待单独确认；不得沿用此前“本机事项已收口”的结论。

## 共享源码对齐补充

- 2026-09-23：双向合并通用 API 探索、Agent、Renderer、CLI/Hub、网站探索agent与打包能力；527 个共享源文件检查一致。Backend 公开 498/内部 867 通过，各跳过 4 项；内部 WebCLI 748 通过。访问统计经确认同步并用临时数据库验证。内部旧扩展业务测试已完成适配，312 项全量通过（含新增登录回退与预演保护回归）；内部 Windows 安装包已构建并核验包内新界面/原生程序，真实客户端验收尚未完成，不宣称全仓验收通过。详见 `docs/shared_source_baseline.md`。


## 任务目标

按 `docs/adapter_architecture_unification.md` 同步改造公开版与内部版。共用包契约、内置/用户/开发目录、注册表、安装管理、Extension/Toolkit 接入、CLI/Skill/UI、客户端 API 自动探索和打包。差异仅由资产、配置和 Profile/Overlay 承载；内部资料不得进入公开仓库。

当前分支：`codex/unify-adapter-architecture`。本仓库最新功能提交：`bc0331b`；公开 v2 资产、跨包历史名、完整状态事件链与运行时跨主机/重定向边界批次均已提交。未推送或合并。内部细节见内部仓库的 `internal/docs/HANDOFF.md`。

## 安装验收修复补充

用户报告聊天 `spawn UNKNOWN`，已确认并修复内部包中 Claude Code 原生入口为占位脚本的问题；两版增加 afterPack 原生格式/架构校验，打包原生程序的隔离 `--version` 启动通过。之前的桌面启动验收不代表聊天链路通过，用户须安装修复包后重试查询。详情见 `docs/adapter_migration_acceptance.md`。

## 扩展响应分发修复

- 2026-09-22：修复扩展 Service Worker 漏分发 `adapter_catalog_result`/`adapter_bundle_result` 的问题；此前宿主目录响应超时后被误报为 Adapter 快照变化，刷新无法修复。新增真实消息处理函数回归 3 项通过，两仓 Chrome for Testing 各 38 项通过；浏览器 fixture 现在经产品请求/响应分发获取目录和包，不再绕过此层。正式过期摘要检查保持生效。两版 prepare 已更新扩展产物；真实业务查询待用户重载扩展后复验。

## 最新验收入口

见 `docs/adapter_migration_acceptance.md`。真实浏览器 37 项、真实 Toolkit Runtime、Windows 打包与隔离桌面实测已推进；以下旧批次记录须结合最新证据阅读。

## 已完成

- 2026-09-22：内部含空格历史调用名已按用户确认规范化，并接入现有 v2 命令与确认门；聚焦 5 文件 40/40、官方内部 prepare/sync/prepack 与隔离 CLI 帮助验证通过。内部实现仅保留在内部仓库，未执行真实业务操作或最终安装包验收。

- 已提交共用 v2 包校验、路径 API、有效注册表、安装快照和安装管理器，以及 CLI 列表/帮助/调用、本地包管理、Skill 派生、Backend 目录和设置页接入。
- 已提交页面及后台托管执行、同包命令别名、生成草稿/验证/安装评审、任务专属预览隔离。预览绑定任务、站点、token 和包摘要，不覆盖正式注册表。
- 已有真实独立浏览器验证，详细批次证据见 `ROADMAP.md` 和架构方案；不等于真实业务站点或完整客户端验收。
- 2026-09-22：公开 Profile 的 7 个内置 Adapter 已迁入根 `adapters/` v2 包；新增 revision 状态 watcher 并打通 Bridge → Backend/Extension 最小刷新链。
- 2026-09-22：共用 `legacyNames` 契约落地，可显式保留跨包完整历史调用名并解析到同一规范命令、权限与包摘要；冲突时诊断并拒绝回退。内部 38 个同名 v2 包同步补齐旧 Schema 基线。
- 2026-09-22：运行时跨主机权限改为来自宿主托管/扩展打包 manifest 的 `runtime_allowed_hosts`，v2 校验拒绝非法 host 列表；`browser_fetch` 对初始 URL 和 redirected 后的最终 URL 均执行同一允许域检查。
- 2026-09-22：内部跨包历史命令恢复批次补回 27 个旧后台执行命令的 v2 包装、Schema、执行声明与 `legacyNames`，并修复官方 内部选中包 命令模块注册名；当时剩余的含空格历史名已在后续用户确认批次完成规范化。
- 2026-09-22：内部 Backend 恢复 API 探索 Agent 的 system/MCP 覆盖、内置工具限制、智能路由 timing 投影与场景标题注册扩展；内部 TypeScript 和官方 Backend build 通过。
- 2026-09-22：内部 effective Profile 预检改为逐项校验根 v2 包 manifest；旧扩展目录仅作兼容输入，配置预检与官方 prepare 通过。
- 2026-09-22：内部 Backend 全量恢复至 87 个文件、857 通过、4 项跳过、0 项失败；TypeScript 与官方 Backend build 保持通过。

## 进行中

当前已提交批次是公开 v2 内置资产与完整状态事件链：

- 新增 `webcli/builtin-adapter-build.js`，按 Profile 选择根目录 v2 包，兼容尚未迁移的旧资产，输出版本/摘要元数据并检查生成资源。
- `prepare-build.cjs` 分开生成 `build/builtin-adapters` 与扩展旧资产；Electron、Backend 和 Bridge 使用宿主注入的资源根/Profile。
- 桌面 WebCLI bundle 和 npm 资产准备/检查接入同一输出；桌面资源计划安装到 `resources/adapters`。
- 路径测试已改为显式临时内置目录，避免读取真实 checkout；Profile 元数据类型、保留名和 `.profile.json` 链接边界也已补强。
- 最新边界补丁：checkout 禁止回退 stale npm 本地资源，必须使用 prepare 输出；运行时校验 Profile 元数据、内置包摘要/版本与资源集合；显式用户根检查 Profile 所有权；打包/复制拒绝 symbolic link。
- 新增 `webcli/adapter-state-watch.js`：Bridge 按 Profile 监听 registry revision，广播 `adapter_state_changed`；Backend 清理目录缓存并同步托管 Skill；Extension 刷新宿主目录和匹配 Tab。重连客户端会收到 `sync: true` 的当前 revision 快照，Extension 全量刷新托管目录与匹配 Tab。Backend 在托管 Skill 刷新成功后通过既有 SSE 推送安全事件字段，Renderer 主动刷新站点/工具目录；Backend 刷新串行排队，刷新期间的新提交合并为最新 revision，临时 Skill 失败按 100/500ms 重试两次。
- 公开 7 个 v2 包通过包装保留旧执行逻辑，声明同包旧命令别名、写操作安全标记和 JD 结算页命令路由。

## 验证状态

- 公开 WebCLI 当前树全量通过：81 个文件、556/556；本批 Extension runtime helper 聚焦 8/8。
- 内部同步仓库当前全量通过：102 个文件、709/709；官方 prepare/build/sync/prepack 通过，npm 输出 524 文件、35 v2/0 旧包，实际 tarball 隔离 help/list/info 与代表性新旧命令 help 通过。内部代码级跨主机例外已迁入 manifest 授权。内部 38 个同名 v2 包已补齐旧 Schema 基线，56 个业务变更命令补齐 write 安全标记并锁定有效路由，官方 内部选中包 已切换为 v2-only。
- 较早打包/路径聚焦两边各 31/31；公开 Electron/环境/Profile/打包聚焦 12/12。
- 最新打包/路径三文件聚焦通过：3 个文件、36/36；v2 兼容路径专项 23/23。新增覆盖 checkout/npm 资源优先级、显式根所有权、运行时内置包摘要校验和链接拒绝；不是全量回归。
- Renderer 状态事件聚焦 2/2，Backend 状态刷新重试/合并聚焦 4/4；公开 Renderer 生产构建和 Backend 类型检查通过。内部 Backend TypeScript 与官方 Backend build 当前通过，相关聚焦 7 文件、57/57；内部 Backend 全量为 87 个文件、857 通过、4 项跳过、0 项失败。
- 公开 Electron Adapter 环境聚焦通过：1 个文件、6/6。
- 跨包历史名契约聚焦通过：alias/loader 3 个文件 39/39，覆盖 CLI、Backend、Bridge、Extension help/info/call 与同一快照。
- 本批 runtime helper 聚焦覆盖 manifest 授权、同域/跨域凭据 helper、浏览器 fetch、临时后台 Tab、未授权 redirected 最终主机拒绝与恢复；真实浏览器重定向行为仍待专项验收。
- 本批公开 WebCLI bundle 重跑通过；prepack 与无 lifecycle npm dry-run 为 163 个文件、7 个 v2 Adapter、0 个旧 Adapter，并包含 `adapter-state-watch.js`。
- 公开 npm 包清单已用无 lifecycle 的 dry-run 验证：163 个文件，包含 `adapters/.profile.json`、7 个 v2 内置包和 0 个旧 Extension 包；Profile 为 public。
- 最新公开 WebCLI bundle 已重跑通过，生成 public Profile 元数据、7 个 v2 内置包和 0 个旧 Extension 包。
- 实际 npm tarball 已安装到隔离临时目录并脱离源码 checkout 运行：`--help` 和 7 个 v2 Adapter 列表均通过。独立 Edge MV3 fixture 回归通过外部包加载、更新、确认门与后台执行；未执行真实业务站点调用。
- 未完成最终桌面安装包、Windows/macOS 全流程、真实业务账号验证。

## 待办

1. Windows 独立测试机执行安装、升级、卸载/重装；macOS 构建与客户端生命周期验收。
2. 配置测试模型及浏览器测试账号，完成客户端 API 探索真实页面捕获→生成→预览→确认安装→调用。
3. 内部未选中草稿包已按用户确认删除，此项已关闭。
4. 审阅并授权推送/合并后交付同事可拉取的基线；Toolkit 自动探索和业务适配由同事负责。

## Toolkit 职责与交接边界（2026-09-22）

用户确认：Toolkit 属于 DOM 类 Adapter，并有独立的自动探索能力，由另一位同事负责。DOM/API 描述能力实现方式，Extension/Toolkit 描述执行体系；统一管理不合并 Runner，也不把客户端 API 自动探索等同于 Toolkit 自动探索。

本次架构迁移负责：稳定 v2 包与 manifest 契约、Profile 隔离、安装/注册表/启停/更新、CLI/Backend/Skill/UI 共用发现与调用，以及 Toolkit Runner 的独立路由、参数原样转发、结果/错误处理和 embedded Runtime 资源定位。使用公开占位的最小 Toolkit 测试包验证安装到执行的公共链路，并检查打包后脱离源码的资源边界；相关未验证项仍须明确记录。

同事接手负责：Toolkit 自动探索、DOM 探索策略、生成器输出适配、具体 Toolkit 命令与站点行为，以及这些能力在新架构下的完整业务验收。其新生成产物应遵守统一 v2 包与安装管理契约，不另建注册表或绕过确认门；是否需要任务式草稿等接入改动，由同事依据探索实现评估。

交付时提供：可拉取的明确提交基线、包格式与 Runtime 接口说明、最小测试包及复现命令、已验证矩阵和待办清单。提交基线须在获准推送/合并后才能供同事拉取；目前不因此自动执行推送、合并或发版。

本次完成标准：公共 Toolkit 接入契约和最小执行链路有验证证据，未迁移的探索入口与限制明确交接。Toolkit 自动探索改造及具体业务全流程不作为本次架构迁移的完成前提，也不得被记为已经完成。Windows/macOS 公共安装资源验收仍在本次范围内，不能用源码单测替代。

## 关键决定

- 内置源码在根 `adapters/`，打包资源只读；用户包、快照、状态、草稿按 Profile 隔离；Hub 和生成器不能改写内置包。
- Extension 与 Toolkit 保持独立 Runner；WebCLI 不按业务 Schema 转换参数。
- 用户明确缩小范围：扩展内自动探索可能下线，仅做必要兼容，不大改旧 UI/文件编辑器；客户端 API 自动探索仍完整接入新架构。
- 保留旧目录作为迁移兼容输入。删除源文件、CI/CD、发布、数据库 schema、凭据与 Git 回滚须单独确认。

## 坑与接手规则

- 先读两仓库 AGENTS、ROADMAP 和架构方案，按实际 git 状态继续，不回滚未知改动。
- 构建准备会重建生成目录；不要与读取真实输出的测试并发运行。单元测试应使用临时目录。
- 内部仓库已存在根 v2 资产，不能误判为零迁移；具体清点仅记在内部交接文档。
- 预览/离屏隔离不是 JavaScript 安全沙箱；摘要是完整性证据，不是发布者身份认证。
- npm lifecycle 日志会污染 `npm pack --json` 标准输出；先独立验证 prepack，再用 `--ignore-scripts --dry-run --json` 检查文件清单。
- Windows 解包验证避免使用被当前实现误解析的短参数组合；失败时先确认 tarball 与目标目录，不要把工具调用失败写成产品缺陷。
- 不读取真实用户状态/账号；测试使用临时根和 loopback mock。依赖安装成功不代表桌面启动成功。
- `docs/api_auto_exploration_technical_article.md` 是已有未跟踪用户文件，不修改、不暂存。
- 每完成一个批次或发现新阻塞，同步更新本文件、内部交接文档和 ROADMAP；严格区分已实现、已验证和未验收。
