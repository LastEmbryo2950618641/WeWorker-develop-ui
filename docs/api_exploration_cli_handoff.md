# API 自动探索 CLI 改造跟进与交接

> 更新日期：2026-10-17。当前阶段：独立 WebCLI 探索首版已实现；真实 Chromium、插件与本地示例站点的 CLI 全流程通过。真实登录站点、Claude 独立对话与安装包验收尚未完成。
> 下文第 2～3 节保留初始历史快照；以最新状态和追加日志为准。

## 最新状态

- #106、#91 已合入 develop，merge SHA 分别为 `14846149bfcb94829af767743fedcf577e595322`、`4c3d5bd784c3a4f178c45b027bc37bf672d75aca`，无需再单独合入。
- `codex/api-exploration-base` 从 develop `4c3d5bd` 建立；初始文档已保存为 `2d177bc`，本轮整合 dev-1.1.0 `dae8932`。
- 本次使用原工作目录，无新 worktree。切换时 ROADMAP.md 阻止 checkout，具名 stash 保存两份文档后切换并 apply，保留双方路线图。stash 仍保留作备份。
- 功能分支在集成提交后创建为 `codex/api-exploration-cli`，最终操作结果见文末。未推送或创建 PR，最终发布目标仍待明确。
- [开发设计](api_exploration_cli_design.md) 为本次审阅入口。
- 功能实现提交为 `821a7df`；本轮真实浏览器验收与修复见文末。上游整合 SHA 没有变化，仍从 develop `4c3d5bd` / dev-1.1.0 `dae8932` 继续同步。
> 后续每次建分支、同步上游、解决冲突、实现功能或验证后，都应更新本文和 ROADMAP.md。未验证事项不得标为完成。

## 1. 目标与范围

将现有界面入口的 API 自动探索能力开放为 WebCLI 命令，支持自然语言驱动调用，后续让界面复用同一套能力。

- 独立探索使用 `webcli call exploration.<command>`；安装后的业务工具使用 `webcli call <adapter-id>.<tool-id>`。
- 调用方 Agent 理解自然语言、选取证据并编写代码；WebCLI Bridge 负责确定性任务、验证与安装，不要求桌面 Backend 或额外模型 Key。
- 已实现启动、状态、事件、证据、补采、安全探测、取消、恢复、草稿读写、生成、验证、审阅和安装。
- 自然语言层负责理解目标、补齐必要参数及编排命令；CLI 提供稳定、可验证的结构化结果和错误。
- 后续 API 探索界面通过薄适配层复用同一 Bridge 契约，本轮未迁移 UI。Python 网站探索agent完全排除在本任务外。
- 用户不负责 `dev-1.1.0` 上其他特性；同步时保留其行为，不顺手重构或改写他人的功能。

现有参考：[API 探索可靠性计划](api_exploration_reliability_plan.md)、[本地验收](api_exploration_local_acceptance.md)。这些文档是历史设计与验证记录，不代表本次 CLI 已实现或验收。

## 2. 已核实的起点

2026-10-17 已执行 `git fetch origin` 并检查远端分支和开放 PR。以下为当时快照；接手时必须重新查询。

| 来源 | 当时 HEAD | 用途与状态 |
| --- | --- | --- |
| `origin/develop` | `05e34e9a7cc1b78b1b62c8e7aa0725ca4042f419` | 用户指定的主发布分支；已有 API 探索优化 #85 |
| `origin/dev-1.1.0` | `dae89328a9f36f4fa0014701a602101da7c4ad34` | 新版本特性，包括聊天、模型设置、记忆等 |
| `origin/fix/webcli-ci-debts` | `0bf6a0390c990bc8e168e4400f99511497de20c6` | [PR #106](https://github.com/WeWorker/WeWorker/pull/106)，目标 develop，未合入 |
| `origin/chore/remove-legacy-extension-adapters` | `f688d5f2a8cb21c43ab8fb22738f1392eb8d8ded` | [PR #91](https://github.com/WeWorker/WeWorker/pull/91)，目标 develop，未合入；是否纳入待明确 |

- 起始工作分支为 `fix/webcli-ci-debts`；写本文之前工作区干净。
- `develop...dev-1.1.0` 按提交历史统计为左侧 42、右侧 67 个独有提交；这不是独有功能数量，也不排除等价补丁。
- 两者共同祖先为 `dd0d4ad3ab6c3cdb780a8eb18489e70bb5e39547`。
- #106 不包含 #91，不能只合入 #106 就认为已纳入旧管线清理。
- 尚未试合并，冲突范围、集成测试结果均未知。

## 3. 分支与 PR 策略

拟采用以下结构，分支名均为计划值，不能当作已存在分支：

```text
origin/develop
  └─ codex/api-exploration-base       只放依赖整合、冲突修复和基线记录
       ← origin/dev-1.1.0
       ← PR #106（若届时尚未合入 develop）
       ← PR #91（仅在明确纳入后）
       └─ codex/api-exploration-cli   CLI 探索功能与测试
```

功能 PR 初期以集成基线为目标，避免将全部新版本特性混入功能审查。最终发布目标尚未确定；不能直接改目标到 develop 并默认发布全部 dev-1.1.0 特性。

仓库的 [Git 工作流](GIT_WORKFLOW.md) 描述 main/GitHub Flow；本文记录用户本次明确指定的 develop/dev-1.1.0 集成场景，不修改全仓工作流。集成分支保留 merge 历史便于追踪来源，正式 PR 的合并方式仍按维护者规则执行。

### 建分支步骤（尚未执行）

1. 阅读根 AGENTS.md、ROADMAP.md 和改动目录的 AGENTS.md；重新确认工作区、已有 worktree、分支及 PR 状态。
2. 保存本文：目前它在起始工作区中，未提交文件不会自动进入新 worktree。建分支后将本文及对应路线图条目迁入集成基线，只提交本任务文档，不夹带到 #106。
3. 使用独立 worktree 从最新 develop 建集成分支；已有同名分支时先检查，不覆盖。

```bash
git status --short --branch
git worktree list
git fetch origin
gh pr list --state open --json number,title,headRefName,baseRefName,url
git worktree add ../WeWorker-api-exploration -b codex/api-exploration-base origin/develop
cd ../WeWorker-api-exploration
git merge --no-ff origin/dev-1.1.0
```

4. 完成当前合并和核验后，再合入仍未被 develop 包含的 #106。若 PR 已 squash 合入，检查 PR 状态与实际补丁，不因原分支不是祖先而重复合入。

```bash
git merge --no-ff origin/fix/webcli-ci-debts
```

5. #91 是否纳入需先明确。它涉及删除旧管线；执行前遵循 AGENTS.md 对删除文件的单独确认要求。CI/CD、发布、数据库 schema 等受保护范围也不能因“整合”而视为已授权修改。
6. 每次合并都记录来源 SHA、合并前后 SHA、冲突处理及验证。完成集成基线验证后，从基线建立功能分支：

```bash
git switch -c codex/api-exploration-cli
```

推送、PR 创建、最终目标分支以及分支保护情况，执行后填写日志；本文不表示这些动作已完成。

## 4. 后续如何同步 dev-1.1.0

统一路径为：**上游 → 集成基线 → 功能分支**。不要有时把上游直接合入功能分支、有时只更新基线，造成基线审查范围失真。

1. 确认工作区干净，记录当前 HEAD，执行 fetch；从日志取出“上次成功纳入的 dev-1.1.0 SHA”。不能用本文件最初快照代替后续记录。
2. 检查上次 SHA 是否仍为新上游祖先；若不是，说明可能发生历史改写，先检查原因，不能直接批量 cherry-pick 或强制同步。
3. 读取新增提交与文件差异，识别和探索、CLI、任务路由、配置、构建相关的交叉影响。纯属其他负责人的功能也需确认能与当前代码共存。

以下命令的 `LAST_DEV_SHA` 需替换为日志中的实际提交，不可原样运行：

```bash
git merge-base --is-ancestor LAST_DEV_SHA origin/dev-1.1.0
git log --oneline LAST_DEV_SHA..origin/dev-1.1.0
git diff --stat LAST_DEV_SHA origin/dev-1.1.0
git diff --name-only LAST_DEV_SHA origin/dev-1.1.0
```

4. 在基线所在 worktree 切换至 `codex/api-exploration-base`，合入 `origin/dev-1.1.0`。若 develop 也有更新，单独整合并记录，不将两个来源当作一次无法区分的修改。
5. 基线验证通过后，在功能分支所在 worktree 执行 `git merge --no-ff codex/api-exploration-base`，解决 CLI 改造与新基线的冲突，并重跑受影响测试。分支已被另一个 worktree 使用时，去该 worktree 操作，不强制重复检出。
6. 将上游 SHA、两层合并 SHA、验证结果填入日志。失败时标为“已合并、验证未通过”，不要推进“最后成功验证基线”。

### 冲突处理规则

- 不整文件套用 ours/theirs；按业务含义保留双方必要行为。特别检查聊天路由、模型配置、探索入口、Adapter 清单、构建 profile 和版本信息。
- 他人特性的语义不清楚时，记录具体文件和冲突点，请对应负责人澄清；不自行降级或移除功能。
- ROADMAP.md 保留双方有效记录；lockfile 由对应包管理器按最终依赖生成并验证。
- 不为合并通过而跳过测试、放宽权限或关闭校验。涉及项目要求单独确认的文件删除、CI/CD、发布、schema、凭据与回滚操作，先取得单独确认。
- 不强推共享基线，不擅自 reset/rebase 已共享历史。每次同步保留来源信息以便追查。

### 依赖 PR 合入或目标分支变化

- 普通 merge 合入：核对祖先关系和 diff 后同步目标分支。
- squash/rebase 合入：原提交 SHA 不一定在目标历史中；同时核对 PR merged 状态、补丁和最终文件，避免再次引入同一改动。
- 最终准备向 develop 或 dev-1.1.0 提交时，先检查 `git diff <目标>...<功能分支>`。若仍包含他人的整批特性，不直接改 PR base。
- 必要时从最终目标建立新的交付分支，仅迁入本任务功能提交并重新验证；依赖冲突修复也要审查。保留原集成分支作为追踪依据，不擅自回滚或删除。

## 5. 实施与验证清单

- [x] 核对当前远端分支及开放 PR。
- [x] 建立跟进文档与路线图入口。
- [x] #91 已随 develop 纳入；最终发布目标仍待明确。
- [x] 建集成基线，迁入跟进文档，整合依赖并记录冲突。
- [ ] 完成基线测试，区分既有失败与新引入失败。
- [ ] 建功能分支，梳理现有界面探索调用链与服务边界。
- [ ] 确定命令契约、任务状态、结构化输出、错误与取消/恢复语义。
- [ ] 实现 CLI 与自然语言入口，补齐聚焦自动化测试。
- [ ] 验证 CLI 与现有界面共享能力；界面迁移范围单独记录。
- [ ] 按项目规范完成受影响模块测试、构建、类型/语法检查及本地敏感信息检查。
- [ ] 真实探索验收与最终 PR；未运行的平台和场景明确列出。

脚本、Electron、Backend 逻辑必须有聚焦自动化测试；Renderer 改动需对应单测、构建和语法检查。若涉及 Adapter 注册/权限、profile 或调用路径，还需验证配置生成、打包入口与实际调用一致。自然语言成功一次不代替状态、失败、取消及权限边界验证。

## 6. 操作日志与当前交接点

| 日期 | 操作 | 结果与验证 | 下一步 |
| --- | --- | --- | --- |
| 2026-10-17 | fetch，读取规范/路线图，核对分支历史和开放 PR | 已确认第 2 节快照；未合并、未跑代码测试 | 明确集成范围 |
| 2026-10-17 | 创建本文并更新路线图 | 仅文档变更；分支仍为 fix/webcli-ci-debts，文档尚未提交 | 建基线时迁入文档，避免提交到 #106 |

以上为初始记录。最新整合来源为 dev-1.1.0 `dae8932`；聚焦验证通过，完整基线仍有下列缺口，不能标记全量验证成功。

后续每次操作追加以下字段，不覆盖旧日志：

```text
日期与执行者：
目的 / 当前分支：
操作前 HEAD：
来源分支与 SHA / 关联 PR：
执行动作 / 操作后 HEAD：
冲突文件、处理理由、他人特性保留情况：
验证命令与结果 / 既有失败 / 未验证范围：
文档及路线图提交 SHA（提交后补记）：
最后成功验证基线 / 最后成功纳入上游 SHA：
待办、阻塞、下一步：
```

新会话或其他 agent 接手时，先读本文、AGENTS.md 和 ROADMAP.md，再核对实际 git status、worktree、远端分支与 PR。日志中的“计划”不能作为执行证据；如实际状态与日志不符，先补齐事实，再继续开发。

### 2026-10-17：建立分支与设计

- 7 文件冲突：CHANGELOG.md/ROADMAP.md 保留双方记录；Python 进程管理最初手工整合，用户随后明确排除该模块；最终该冲突文件保留 dev-1.1.0 原文件，不保留本次手工修改；官网 lockfile 的名称/版本对齐 package.json；WebCLI 保留独立 1.0.4；探索页保留 auto 入口，去除依赖已不存在 agentMode 状态的旧开关；状态栏保留告警浮层和专属 Agent 汇总，去除旧入口的失效变量。
- 自动合并保留 dev 聊天、记忆、模型、专属 Agent 能力及 develop 的 #91/#106。未另行修改 workflow、发布脚本或 schema。
- renderer/backend 按 lockfile 执行 npm ci --ignore-scripts，未新增依赖、未改变 lockfile。
- 通过：公开配置检查；Renderer 探索/告警 11 项、专属 Agent 9 项；Extension 路由 23 项、导航守卫 17 项；Electron 生命周期/关闭守卫 11 项；Backend 探索/聊天 23 项，共 94 项。Renderer 构建通过，有 chunk/动态导入提示；Bridge/扩展 JS 与 Python AST 语法通过。
- 未通过：Backend typecheck 缺 yauzl 声明及相关隐式 any；相关源码、package.json/lockfile 与 dev 无差异，未顺手修改他人模块。Python 测试因缺 uv 未运行。未跑全量、真实浏览器/模型或安装包。合并差异检查有 dev 原有 settings-theme.css 末尾空行提示。
- 首轮 Renderer 缺 vite、Backend 依赖不齐，安装后重跑；初次 Backend 测试命令重复 --run，修正后 23 项通过。
- OpenCLI 参考为本机 1.8.6 help 与本地 usage/adapter-author 技能；未操作真实浏览器或执行站点命令，不表示核实远端最新源码。
- 下一步：审阅设计，明确类型检查缺口的处理归属。Python 模块由其他负责人维护，本任务不改造、不补测；该模块整合验收交由负责人。

- 用户追加边界：Python 网站探索agent全程不属于本任务。仅保留来源分支内容，禁止为 CLI 工作调整其模型、生命周期、存储、HTTP 接口或测试。进程管理冲突选择 dev 原文件，因此不宣称保留 develop 在该文件的超时改动；后续由对应负责人判断。

### 本轮最终交接点

- 集成提交：`baf9f98`（父提交为文档提交 `2d177bc` 与 dev-1.1.0 `dae8932`），基线分支 `codex/api-exploration-base`。
- 已从该提交建立并切换到 `codex/api-exploration-cli`；功能代码尚未开始，开发设计待用户审阅。
- develop `4c3d5bd` 与 dev-1.1.0 `dae8932` 均已纳入历史；后续同步用这两个 SHA 起算，不再合入 #106/#91 分支。
- 最后成功完成聚焦验证的集成提交为 `baf9f98`；全量验证仍未完成，限制见上。最终 Python 冲突文件与 dev 原文件一致，先前手工合并版本的 AST 检查不视为最终 Python 验证。
- 未推送、未创建 PR。后续同步继续采用“上游 → api-exploration-base → api-exploration-cli”，Python 模块若再次冲突，交对应负责人处理，不在本功能开发中改造。


### 2026-10-17：独立 Agent 模式首版

- 用户明确纠正：WebCLI + 插件必须独立运行，Codex/Claude 等外部 Agent 负责推理。旧设计的桌面宿主前置条件已撤销，开发设计全文更新。
- 新增 exploration 命令服务、JSON 客户端、结构证据模块和命令帮助；集成现有 Bridge，新增 API 探索 Skill 并纳入 npm files/skills 包。无新依赖、无 lockfile 变更。
- 已实现 start/list/get/events/evidence/collect/actions/probe/cancel/generate/draft-read/draft-write/validate/review/install；独立任务保存在 profile workspace 中。默认不调用模型、不读 Backend 配置。
- 复用 v2 草稿、验证、增量包与安装器；补充 prepareGenerationRun 的可选 paths 注入和 runtime validator 两阶段间的取消检查。
- 当前只生成同源成功只读 GET，最多两个命令；POST/写操作/跨源/动态 ID 路径不自动生成。API 探索 UI 与旧聊天工具迁移属于后续，不触及 Python 网站探索agent。
- 本轮 Python 目录差异必须为零（相对本轮起点 af8e082），不执行该模块测试或环境安装。
- 上下文管理：用户授权必要时创建新会话接手；优先在当前会话持续工作并及时记录。若新建，传递本文件、设计文档、当前分支/HEAD、验证结果、未完成项；不能把新建成功当作后续开发完成。


### 首版验证与接手步骤

- 最终 WebCLI 全量：97 文件、1055 项通过（npm test --prefix webcli）。新增独立服务/协议 2 文件 14 项，覆盖真实 WebSocket 交互、独立 CLI 帮助进程和生成 JavaScript 在模拟浏览器中的执行及安装。没有调用真实模型。
- 构建：WebCLI 与 Bridge bundle 通过，打包 CLI 显示全部 18 个命令，Skill 已复制。主目录缺 esbuild 的首次构建失败，随后用已有 backend-ts/node_modules 经 NODE_PATH 提供该依赖构建成功，未改 package/lockfile 依赖。
- npm pack --dry-run（执行 prepack）通过，569 个文件；确认四个新增模块及 webcli-api-exploration Skill 在清单中。未发布 npm 包。打包仍提示已有可选列映射资源缺失。
- 公开配置、JS 语法与 git diff --check 通过。相对 af8e082，Python 目录差异为零。
- 测试波动：与构建同时运行时旧 generation-output-recovery 用例未及时进入预期状态；单文件复跑通过，再完整顺序运行全量 1055 项通过。不据此认定其根因已经解决。
- 没有验收真实 Chrome、登录站点、Codex/Claude 实际对话、各平台安装包。本轮未改 Renderer/Backend 业务源码，也未处理先前 Backend yauzl 类型问题。
- 下一位 Agent：先查看当前 HEAD 和工作区；运行 `node webcli/index.js call exploration.help`，阅读产品内 Skill。下一步优先准备独立 WebCLI + 插件的真实验收，不能重启/占用未知 Bridge 或改动用户登录数据。之后再设计 API 探索 UI 适配；不把 Python 网站探索agent纳入任务。
- 最后测试日志位于本机临时目录，不作为需提交的材料；以上验证摘要为可交接记录。代码提交 SHA 可从下一条 feat(exploration) 提交查得，未推送、未开 PR。

### 2026-10-17：自主真实浏览器全流程验收

- 操作前 HEAD：`821a7df`，功能分支 `codex/api-exploration-cli`。用户明确要求开发后自主验证全流程。本轮未合入新上游提交。
- 修复与可复跑验收脚本提交：`c56f951`。该提交为本轮最后成功验证的代码基线，后续提交仅同步本文、设计和 ROADMAP。
- 发现本机 3711 已由全局安装的 WebCLI 服务占用，保留其运行。测试临时复制本分支 WebCLI 和已准备的 public 扩展，将副本内的 Bridge/CLI/插件连接端口替换为独立端口，CLI PID/log 目录也指向临时根；生产默认端口、配置和扩展协议未改。
- 独立启动 headless Chrome for Testing 147.0.7727.15（本机 Playwright 缓存 revision 1217）、unpacked 插件、Node Bridge、loopback HTTP 示例站点。使用独立 user Adapter、data、builtin、浏览器 profile；不加载用户登录信息，不需要桌面 Backend 或模型配置，不操作 Python 网站探索agent。
- 第一轮真实验证发现：脚手架 `check-login-status` 工具被共享策略标记为跳过，导致目标查询已执行成功（attempted=1/passed=1）仍因 skipped=1 被独立流程阻止安装。此前模拟扩展的测试没有复现真实跳过计数。
- 修复：独立服务调用共享 preview validator 时启用 `restrictToExpectedTools`，只把明确的生成目标送入执行策略；保留每个目标必须实际执行、零跳过的要求。共享验证器默认关闭该选项，旧 UI/Backend 行为不变。测试同步按真实 testCases 计算 skipped，并覆盖开关两种行为。
- 新增 `webcli/scripts/verify-exploration-browser.mjs` 和仓库命令 `npm run test:exploration:browser --prefix webcli`。全部 15 个验收检查通过，命令均为实际 CLI 子进程：
  - 连接、标签选择、幂等 start、安全搜索 probe、collect、结构证据与值省略。
  - draft-read/write，陈旧 hash 拒绝；故意写入语法错误并用 CLI 修复，补充分页默认参数。
  - 真实 API 返回 503 时运行验证失败且无法 review；恢复后真实预览 attempted=1/passed=1/skipped=0/failed=0。
  - 无确认/陈旧 reviewId 拒绝；当前 review 安装到隔离根；普通 webcli call 搜索和分页返回示例数据，空结果及 HTTP 错误正确返回。
  - 同站点再次生成保留第一次 Agent 修改的代码，新增工具独立验证并升级安装，新旧普通命令都能调用。
  - cancel 后真实浏览器迟到采集结果被丢弃；重启自建 Bridge 后 installed/cancelled 状态保留，在途任务变 interrupted，相同 requestId 不重复创建，显式 collect 后恢复并能再次调用安装工具。
- Playwright 只负责启动隔离浏览器、加载插件和打开示例页面；没有模拟浏览器网络、扩展协议、预览验证或安装器。临时产物包含报告、证据、草稿、验证摘要与 Bridge 日志，均未提交；脚本退出会关闭自己创建的进程，临时目录保留供诊断。
- 全量回归：`npm test --prefix webcli -- --testTimeout=20000`，97 文件、1056 项通过。WebCLI/Bridge bundle、打包 CLI 18 命令帮助、npm pack dry-run（四个探索模块与 Skill 均在包内）、公开配置、语法和差异检查通过。两项构建继续使用现有 Backend 的 esbuild（`NODE_PATH`），没有新增依赖或变更 lockfile；仍有已有可选列映射资源缺失提示。
- 验收脚本首次启动时，外部 Playwright 默认查找的 revision 1234 不在本机；通过 `--chromium` 选用已安装的 Chromium 后成功。此环境差异不作为产品问题。没有下载浏览器或替换用户全局 WebCLI。
- Python 源码目录相对本功能起点 `af8e082` 差异为零，未运行该模块测试。未验证真实登录业务站点、各平台安装包，也没有另开 Claude/Codex 会话做生成质量验收；本次不宣称通用 Agent 的任意任务成功率。

复跑前先完成仓库 public profile prepare，确保 `weworker/build/extension-dist` 存在，并准备 Playwright 与支持 unpacked 扩展的 Chromium。依赖可由外部工具环境提供，不必加到生产依赖。示例路径是占位值：

```bash
npm run test:exploration:browser --prefix webcli -- \
  --playwright=/absolute/path/to/playwright/index.mjs \
  --chromium=/absolute/path/to/chromium
```

若本地已有可导入的 Playwright 和匹配的浏览器，上述两个参数可以省略。脚本输出临时产物路径，`report.json` 中 `passed: true` 才代表完整通过。

下一位 Agent 先核对分支和最新提交，再阅读当前设计与产品 Skill。上游同步仍按“上游 → codex/api-exploration-base → codex/api-exploration-cli”；新 dev 改动不要直接覆盖功能分支，Python 冲突交对应负责人。本轮真实浏览器缺口已补上，下一步可选真实登录站点/独立 Agent 验收或 API 探索 UI 接入。未推送、未创建 PR。
