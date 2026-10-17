# API 自动探索 CLI 改造跟进与交接

> 更新日期：2026-10-17。当前阶段：console/network 持续 JSONL 观察、browser.events 序列游标与时间窗口已实现；WebCLI 1128 项、扩展聚焦 76 项及 Adapter helper 回归 15 项通过，隔离真实浏览器完整 32 项通过。日常 Chrome 多订阅者、子 frame、信号/关闭管道与 Bridge 重启续接通过，B 站 Excel 第一页 24 卡片回归通过。完整 OpenCLI 对齐继续进行；独立 Agent 对话、UI 统一与平台安装包验收尚未完成。
> 下文第 2～3 节保留初始历史快照；以最新状态和追加日志为准。

## 最新状态

- #106、#91 已合入 develop，merge SHA 分别为 `14846149bfcb94829af767743fedcf577e595322`、`4c3d5bd784c3a4f178c45b027bc37bf672d75aca`，无需再单独合入。
- `codex/api-exploration-base` 从 develop `4c3d5bd` 建立；初始文档已保存为 `2d177bc`，本轮整合 dev-1.1.0 `dae8932`。
- 本次使用原工作目录，无新 worktree。切换时 ROADMAP.md 阻止 checkout，具名 stash 保存两份文档后切换并 apply，保留双方路线图。stash 仍保留作备份。
- 功能分支在集成提交后创建为 `codex/api-exploration-cli`，最终操作结果见文末。未推送或创建 PR，最终发布目标仍待明确。
- [开发设计](api_exploration_cli_design.md) 为本次审阅入口。
- [OpenCLI 能力对齐台账](opencli_parity.md) 为最新范围与缺口清单；用户要求尽力对齐完整能力，不能把当前 36 个 browser 命令或单站点验收视为目标完成。
- 首版功能实现提交为 `821a7df`，本轮从原生 frame 指针检查点 `3ea604c` 继续；后续实现、真实验收与本地检查点见文末和 Git 日志。集成基线仍为 `baf9f98`，已纳入 develop `4c3d5bd` / dev-1.1.0 `dae8932`。这些是已纳入快照，后续同步前应重新 fetch，不能据此推断远端未变化。
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

### 2026-10-17：OpenCLI 对齐第一轮与真实站点验收

- 操作前 HEAD `a5e04d2`，分支仍为 `codex/api-exploration-cli`，没有新增上游合并。完整目标记录在 `docs/opencli_parity.md`；当前结果只是已完成的一批能力，目标保持进行中。
- 本轮代码与首版台账提交：`6eff37f`。提交时工作区干净；未推送。后续改动从该提交起算，不重复创建分支或重新合并已纳入上游。
- 用户已安装当前工作区 public 扩展并指定公共视频搜索页验收。本轮核实原全局 Bridge 的 PID/启动命令后切换为本分支 source Bridge；后续只重启本轮自己启动的已确认进程。扩展从 `weworker/build/extension-dist` 构建并通过既有协议重载。未访问/终止未知 8766 进程，未修改 Python 模块。
- 34 个 browser.* 命令与独立 Skill：持久命名会话、owned/bound 标签管理、doctor；CSS/role/name/text/ref 定位和陈旧/歧义错误；表单与键盘；主 frame 原生指针/拖拽、文件输入；网络摘要/过滤/有界 JSON 详情；frames、eval、完整截图、console、dialog、wait。Bridge 日志只记浏览器命令元数据，不记脚本、参数或输入值。
- 会话用 Chrome storage.session 身份防止 tabId 回收误操作；浏览器重启或扩展重载后身份可能过期，需要重新选择并绑定。用户绑定页 close 不关闭标签，open/back 不导航该页。browser 与探索采集/验证共享 tab 锁；取消不提前释放尚未完成的浏览器请求，dialog 可解除正在执行命令等待的弹窗。
- start 增加 allowedOrigins 精确授权，额外域不从流量自动取得。大响应在截断预览前生成类型结构，修复真实站点超过 4KB 响应丢失列表形状问题。
- Agent 计划支持 1–50 读取工具（默认自动计划仍最多两个 GET）；支持 JSON/form POST 和显式 GraphQL query，POST 必须有 readReason。mutation、subscription、未解析持久查询及已识别业务写信号不进入读取生成。GraphQL 文档/变量值不写入证据。
- 新增 draft-add 创作 helper/command/guidance 文件和 trace 结构诊断；现有文件仍走 expectedHash 修改。草稿改变使验证和审阅失效，同站点保留命令不重写、不执行。
- 真实站点：捕获搜索分页接口并确定 PAGE_FETCH 策略，最小 keyword/page 请求返回成功，不复制 Cookie 或捕获签名。通过 draft-write 编写参数与结果映射，新命令以 explored 前缀避开内置搜索命令；静态检查及真实预览均通过，再按用户全流程验收授权本地增量安装。两页相同关键词和一页不同关键词三次普通 CLI 调用各返回 20 条，页码正确、ID 集合变化，标题/作者/链接/播放量/时长类型检查通过；后续 source Bridge/扩展更新后普通调用复验仍通过。真实页面内容、响应样本、会话 ID 和捕获值未提交。
- 实际运行本地安装位于既有用户 profile；无内置源码改动，无业务写操作。下一次可通过 exploration.list/get/trace 找到任务，不把本地安装视为公开内置 Adapter 交付。
- 隔离真实 Chromium 147 + 插件 + CLI/Bridge 验收从 15 项扩展为 17 项：浏览器命令组、三工具 JSON/form/GraphQL 生成及真实验证/安装/调用、helper 新增/trace，以及原有错误修复、增量保留、取消/重启恢复均通过。临时完整报告保持本机，不提交。
- 验收发现并修复弹窗期间再次 Page.enable 会阻塞的问题；测试禁用 Playwright 自动关闭弹窗，由产品 CLI 处理。最终测试没有模拟 CDP、网络或验证器。
- 验证：WebCLI 全量 98 文件/1069 项通过；Extension 聚焦 5 文件/42 项通过；WebCLI/Bridge bundle、公开配置、git diff --check 通过；npm pack dry-run 577 文件，新浏览器模块、tab 锁、extension 实现和 browser Skill 均在包中。无新增依赖/lockfile 变化。已有可选列映射资源缺失提示未处理。
- 剩余工作：完整策略生成（DOM/UI/INTERCEPT 等）、动态路径、写工具语义与验证、fixtures/站点知识/安装后修复、复杂 frame/Shadow DOM/多连接、下载/持续网络流、外部 CLI/Electron/CDP、UI 统一和独立 Codex/Claude 新会话验收。不能宣称全面对齐或任意站点可靠性。
- 接手先核对 git status/HEAD、本文及能力台账。source Bridge 可用 browser.doctor 读状态，未知进程不可直接复用/终止。同步上游仍走“上游 → api-exploration-base → api-exploration-cli”，本轮没有改变同步基线。Python 相对 `af8e082` 差异为零；未推送、未创建 PR。

### 2026-10-17：精确验证与站点知识

- 操作前 HEAD `3bdc4a5`；分支及上游同步基线未变。
- 新增 verification-read/write：每工具 1–10 组显式参数和精确输出路径、类型、非空、格式、值、行数断言；旧插件缺 strict_output_contract_v1 时拒绝，避免静默忽略。参数禁止凭据字段，错误只返回 caseId/path/code，不含响应值。草稿或 cases 改动后重新验证。
- 修复扩展单次只运行前五组的限制，共享 validator 分批发送并聚合全部结果。真实六组验证中第六组故意失败能阻止安装，修正后六组全部通过。
- 新增 knowledge-read/save，保存已验证命令的 cases、选中端点的结构证据、字段含义和备注；私有文件、hash 防覆盖，按 30 天及当前安装包摘要标记过期，每条记录保留独立验证时间。字段冲突拒绝而不覆盖，修订机制待做。旧记录是历史数据，不是 Agent 指令。
- 真实验收发现 Adapter 目录刷新重载页面会打断刚安装后的普通调用（Frame removed）。刷新与 managed page 调用改为同一 per-tab 队列，不重放业务 handler；增加顺序、失败释放、跨页独立回归。
- 验证：WebCLI 全量 100 文件/1077 项通过；后续能力守卫与日志修改聚焦 3 文件/20 项通过；扩展两组共 60 项通过；隔离真实 Chromium 全流程 19 项通过。CLI/Bridge 构建、公开配置、差异检查通过。npm pack dry-run 580 文件，含两个新增模块和探索 Skill；无新依赖或 lockfile 变化。
- Python 相对 `af8e082` 差异为零。真实用户 Chrome 仍运行上一阶段 source Bridge/插件，当前新 cases/knowledge 能力已在隔离真实浏览器验证；使用用户页前需核实自建服务身份并更新扩展。不可把隔离验收写成用户 Chrome 新能力已验证。
- 下一步：已安装命令的定向修复，确保未选中的命令与共享文件保持原样，再补其他策略。完整 OpenCLI 对齐仍进行中；未推送、未开 PR。

### 2026-10-17：已安装命令修复与真实站点精确验收

- 上一阶段提交 `6ebf7f9`，包含精确验证、站点知识及刷新队列；本轮从该提交继续。上游整合 SHA 与同步流程未变。
- 新增 repair-info/repair，先读取当前包摘要，再用当前采集的成功只读证据绑定已有命令 ID，复制到隔离草稿。服务保存修复 scope，任务证据不能自行扩大范围；静态、运行、发布检查都核对当前基线。
- 允许修改所选命令的独占模块、schema/description；其他文件、共享代码、命令元数据、路由、权限、命令次序保持原样。不能新增 helper，不能删除命令；写命令与混合 Toolkit 包暂不支持。默认增量生成仍保留全部原文件，无修复 scope 时不会放宽。
- 从站点知识带入作者 cases，显示过期原因。每个目标至少一组，重新实际执行；草稿/用例变化后重新验证和审阅。Agent 根据 Skill 最多修复三轮，仍由调用 Agent 理解和编辑，没有额外模型调用。
- 自动化：WebCLI 全量 100 文件/1080 项通过；后续 nextActions/状态赋值调整及 Skill 更新聚焦 2 文件/20 项通过。CLI/Bridge 构建、公开配置、JS 语法和差异检查通过；npm pack dry-run 581 文件，含 exploration-repair.js 和新版 Skill。首次 pack 在仓库根运行未找到 package.json，切到 webcli 后成功；无依赖/lockfile 变化。
- 隔离真实 Chromium 全流程 20 项通过：实际将示例接口 name 字段改成 title，导入的六组旧 cases 全部失败并阻止安装；通过 draft-write 修复映射后六组全部通过，审阅安装后普通命令及四个已有查询均通过；其他模块字节一致。还包含原有取消/Bridge 重启、POST/GraphQL、页面操作、知识与精确断言验收。
- 用户 Chrome：确认先前自建 source Bridge 身份后重启为当前源码，通过既有协议重载工作区扩展，strict_output_contract_v1 已就绪；仅重新绑定本任务的公共搜索页。新建维护任务，采集当前搜索请求并建立 repair 草稿。
- 真实站点精确验证发现：第一页接口混入课程类型，bvid 为空，旧“只检查 string 类型”验收没有识别。三组 cases 中第一页 BV 格式失败，其他两组通过。局部修复本地生成命令为只返回 type=video，课程等类型计入 excludedTypes；视频缺有效 BV 时明确报错，total/pages 的接口总量语义写入命令说明。
- 修复后静态和真实三组 cases 全通过；按已有全流程授权审阅本地安装，无新增权限，其他内置命令和共享文件未改。普通调用第一页 17 个视频/排除 3 个课程，第二页和另一关键词各 20 个视频；ID 有效、分页/关键词结果不同。站点知识保存三组 cases、字段含义和混排说明，读取 stale=false。仅保存于本地用户 profile，未将生成包、响应、账号或会话信息加入仓库。
- 本轮 source Bridge 和工作区扩展已更新；下次先用 browser.doctor / exploration.list 查询当前状态，不在文档固定 PID、taskId 或 tabId。维护页面绑定会话为本任务所有；重载扩展后仍应验证身份并重新选择页面。不要关闭用户标签页。
- Python 相对 `af8e082` 差异为零；没有触及 Python 环境、测试、生命周期或用户持久目录。未推送、未开 PR。
- 接手下一步：纯 DOM/UI/INTERCEPT 策略、动态路径与请求签名、知识冲突修订，之后完善 UI 共用服务及跨 Agent 独立对话验收。完整 OpenCLI 对齐目标仍 active；本轮只完成安装后只读命令维护这一项，不代表全部对齐。
- 本轮功能及验收提交 `411fe85`，工作区提交时干净；该提交是当前最近成功验证的代码基线。打包 CLI 帮助确认 26 个探索命令，包含两个修复入口；后续 checkpoint 提交仅更新此记录。未推送、未创建 PR。

### 2026-10-17：页面来源策略、准确路由与定向修复

- 操作前 HEAD `a722880`，分支仍为 `codex/api-exploration-cli`。develop/dev-1.1.0 集成基线未变；本轮没有同步上游，不要重复合并历史 PR。
- 新增 exploration.observe，支持 UI_SELECTOR 的行/字段/属性/空态与 DOM_STATE 的 window 自有属性或 JSON script。固定 MAIN world 读取函数，观察只返回结构，生成普通命令通过 page_read helper 读取；不把页面来源伪装成 API。页面来源使用独立指纹绑定计划，每个工具必须写作者 cases。纯页面/混合 API 计划、增量保留、修复与知识都接入同一服务。
- helper 检查 origin/pathname、必需字段的唯一性/可见性；输入/脚本/样式不能当普通文本字段，文本优先使用渲染结果。DOM 缺行时要求可见空态标记，截断显式返回；状态 getter/原型/存储/凭据字段拒绝，超限报错。没有新依赖或 manifest 权限。
- 真实测试首次发现网络记录器也记录 HTML document，“零网络候选”假设不成立，验收调整为“无 JSON API 候选”。随后预览 3/3 通过但普通命令失败，捕获错误 PAGE_SOURCE_ROUTE_CHANGED，确认旧路由只按 host 选中了首页。新增可选 pageRoute，包校验、生成与实际调度统一检查准确 origin/pathname；唯一匹配页优先，多页时只选唯一活动页，缺失/歧义不自动新开或导航。Bridge 增加 page_sources_v1 协商守卫，避免旧扩展忽略新路由。
- 隔离真实 Chromium 全流程现 22 项通过：无 JSON API 示例页的 DOM、页面状态、JSON script 观察→生成→严格验证→安装→普通调用；缺字段失败、明确空态成功；服务器实际更换 DOM 类名后，历史 case 失败，定向修复选择器再验证/安装成功，其他页面命令仍可执行；关闭本任务页面后普通调用返回路由缺失。还覆盖既有 API/POST/GraphQL、六组断言、字段漂移修复、取消和 Bridge 重启恢复。
- 此轮新增保存页面知识后，原测试“重启应标记安装包已变”断言过时；按最后已验证并保存的新摘要修正为 stale=false，同时检查四条页面来源跨重启保留。测试未绕过实际 CLI、插件、网络或验证器。
- 用户 Chrome：核实自建 source Bridge 身份后更新进程、重载已安装的工作区扩展，page_sources_v1 可用。重选指定公共搜索页并重新绑定，不关闭用户页。观察可见普通视频卡片，生成本地 `bilibili.com.explored-visible-videos`，写标题/链接/数量/未截断断言；真实预览通过、审阅无新增权限后本地增量安装。普通调用返回 27 张已渲染卡片，标题/原始链接与当前 DOM 逐项一致。它读取当前页面，不能解释为完整搜索结果或唯一视频数；查询串与页码不由此命令控制。
- 已有 `bilibili.com.explored-search-videos` 回归三组：excel 第一页 17 个视频并排除 3 个课程，第二页及 spreadsheet 第一页各 20 个视频，BV 格式和结果变化检查通过。新页面来源/case/语义说明保存于本地知识，stale=false。生成包、标题、响应与会话标识没有写入仓库。
- 最终自动化：WebCLI 101 文件/1086 项通过；Extension page-source/tool-route/output-validator/refresh-queue 共 40 项通过。构建 prepare 与全量测试曾同时执行导致既有 generation-orchestrator 两例失败；停止并行修改构建资产，构建完成后顺序重跑全部通过。后续必须将 prepare/build/pack 与依赖其资产的测试串行执行。
- CLI/Bridge bundle、打包 CLI 的 observe 帮助、公开配置、21 个修改/新增 JS 文件语法、git diff --check 通过。npm pack dry-run 583 文件，含 exploration-page.js、扩展 page-source.js 和新 Skill；预打包日志写在 JSON 前，解析报告时需跳过 prepare 日志。公开配置脚本位于仓库根 scripts/check-public-config.mjs，不在 weworker/scripts。已有可选列映射资源缺失提示未改。
- source Bridge/用户扩展已具备本轮页面能力；后续仍先用 doctor、tabs、list 查询当前状态，不假定旧 PID/tabId。Chrome 重载后身份可能失效，应重新选择绑定；不要终止未知进程。Python 相对功能起点 `af8e082` 差异为零，未碰其环境、测试、生命周期或持久数据。未推送、未开 PR。
- 下一步仍是完整 OpenCLI 对齐：INTERCEPT/策略回退、动态路径/CSRF/签名、写命令语义与验证、多步 UI/复杂 frame/Shadow DOM、多连接、下载/网络流、知识修订、UI 共用服务及独立 Codex/Claude 新对话验收。当前页面策略是阶段成果，目标保持 active；不要把这一批测试通过当作全部目标完成。

### 2026-10-17：API 动态路径参数

- 上一阶段代码与记录已提交为 `7e1e899`，本轮从该干净检查点继续。上轮属于有效进展；本轮目标保留完整 OpenCLI 对齐，优先补 API 详情地址中的动态路径。分支和上游整合基线未变。
- 新增 generation-harness/path-parameters.js，plan.pathParameters 使用 segmentIndex/name/description，索引按 pathname 去掉开头 `/` 后分段计数。每个脱敏 :id 必须绑定，也允许显式参数化已观察的 slug；名称与 query/body 键不能冲突，须填写 readReason。只有动态端点又未提供 plan 时返回 PATH_PLAN_REQUIRED，默认自动计划不猜路径参数。
- shared plan binding 将元数据附在所选 candidate 副本上，生成命令内联解析函数，不修改共享 runtime 文件。schema 将路径参数声明为必填字符串，无捕获值默认参数；保留前导零、按单段编码，拒绝斜杠、百分号、控制字符和 dot traversal。路径参数不会进入 query/body；已观察 query 键回到 URL，其余参数继续作为查询或请求体。静态路径、已有包及其他命令保留机制不变。
- 每个动态命令至少两组不同路径参数组合；不要求每个参数都变化，避免只有一个授权父对象时无法测试两个子对象。作者应通过返回 ID/字段精确 equals 确认效果，不能只检查非空。知识中的命令新增 pathParameters，trace 也提供映射。repair 计划和验证使用相同约束；不把历史用例当当前成功证据。
- 自动化：新增完整/重复/冲突路径绑定、编码/前导零、路径与 query/body 分离、非法值拦截回归；服务验证生成 schema、无捕获 ID、缺失/重复验证组合拒绝及知识保存。全量 102 文件/1090 项通过；8 个修改/新增 JS 文件语法与 git diff --check 通过。
- 隔离真实 Chromium 全流程 23 项通过。在既有实例上用实际 browser.eval 触发 GET 和 JSON POST 详情请求，collect 得到两个动态结构端点，显式计划生成两个命令；四组不同 ID、前导零、中文及 ?/# 的精确输出断言通过。安装后四次普通 CLI 调用返回对应 ID/query/body；检查实际服务器请求，路径参数没有被重复发送。`../delete` 返回 INVALID_PATH_PARAMETER，服务器请求计数不变。
- 首次新增验收复用了已由生命周期测试释放的 browser session，按实际状态重新 bind 后继续。随后非法参数虽然阻止了请求，但抛错经旧调用链缺少统一 ok 字段；生成命令改为返回 `{ok:false,error:{code,message}}`，完整重跑通过。没有把错误改成空结果或忽略断言。
- CLI/Bridge 构建、公开配置通过；npm pack dry-run 584 文件，包含新的 generation-harness/path-parameters.js 和更新 Skill。构建/pack 与依赖生成资产的测试顺序执行；已有可选列映射资源警告不变，无依赖/lockfile 变化。
- 真实用户 Chrome 的 B 站 API/DOM 验收仍以上一阶段为证据；本轮动态路径使用隔离 loopback 公开占位站点，没有在 B 站虚构不存在的动态详情接口。用户 source Bridge 仍运行上一阶段已确认进程，新能力在隔离实例和构建产物验证；下一次需要新功能时先核实进程身份再更新。扩展代码本轮无变化，不需用户重装。
- Python 相对 `af8e082` 差异为零，未碰其环境/生命周期/测试/数据；未推送、未创建 PR。下一步仍包括 INTERCEPT、CSRF/签名、写命令、动态页面路由/多步 UI、知识修订、多连接/复杂浏览器能力、UI 共用服务及独立 Agent 验收；完整目标继续 active。


### 2026-10-17：INTERCEPT 与真实 Chrome 原生输入修复

- 从 `a75fec3` 接续未提交实现；分支仍 `codex/api-exploration-cli`，develop `4c3d5bd` / dev-1.1.0 `dae8932` 集成基线未变。本轮没有同步上游，不重复合并 #106/#91。完整 OpenCLI 对齐目标保持 active。
- 新增 exploration.intercept：选取实际观察到的成功只读 JSON GET/POST，声明搜索、原生 select 筛选或下一页 CSS 控件；搜索/筛选声明一个字符串参数，通过已观察 query/body 字段关联。后台监听在操作前注册，只接受本次开始的新 Fetch/XHR，准确 origin/pathname/method/参数；旧请求、不相关响应不能充当成功。单次最多两个匹配请求后报歧义，响应 JSON 有大小/复杂度上限，凭据字段脱敏，业务行不静默截断。借用 CDP 后只清理自己的 listener，支持超时/HTTP/非 JSON/路由/文档变化等明确错误。
- 观察不保存 values；页面证据、计划、草稿、知识共用已有流程。生成命令 pageStrategy=INTERCEPT，pageRoute 精确匹配现有页面；有参数时至少两组不同参数的作者 cases。插件能力不满足时拒绝调用，避免旧版本忽略 helper。
- 解决草稿跨域权限：预览 scoped chrome.runtime.sendMessage 添加临时 token，SW 只为 intercept_read 解析此 token 的草稿 manifest 授权；绑定 tab、主 frame、origin/pathname、5 分钟有效期，finally 清理。预览仅在明确 INTERCEPT manifest 下容许同一 document 更新查询串，完整文档替换不受支持。普通调用按声明的 match 找唯一已安装包，支持包名与页面子域名不同，多个包不合并权限。
- 自动化新增源归一化/禁止写候选与凭据关联、参数不落观察记录、不同 cases 必填、旧插件拒绝、临时授权隔离与过期、旧响应忽略/多响应/错误/清理测试。共享 Extension 测试 loader 缺少早前 browser observation/body evidence 导入，本次补齐真实函数后原网络捕获测试恢复通过；未屏蔽断言。
- WebCLI 全量 103 文件/1094 项通过；Extension 聚焦共 63 项通过。CLI/Bridge 构建、公开配置、npm pack dry-run 586 文件通过，包含两个 intercept 模块。首次测试命令错误重复 --run，修正后执行成功；服务单测 mock 原仅报告 1 项，新增 2 组 cases 后按真实期望改为 2 项。无新增依赖，构建与依赖资产的测试顺序执行。
- 隔离真实 Chromium 24 项：页面闭包生成一次性示例请求头，直接重放 403；跨源（127.0.0.1 页面→localhost API）GET/JSON POST 四组不同参数预览成功，增量安装后两命令普通调用成功；超时/重复/503/非法空参数明确失败。既有 API、路径参数、DOM、修复、知识、取消和 Bridge 重启流程保持通过。真实请求、插件、CLI 和验证器均参与，未替换为 mock。整页导航守卫追加验证结果见本节最后记录。
- 用户 Chrome：先核实既有自建 source Bridge 命令后重启为本分支，重载用户已安装的工作区 extension-dist，能力 intercept_read_v1 就绪。重选并重新绑定 B 站搜索页，没有关闭用户标签。浏览器技能按工作区开发目标使用源码，未安装 npm 替代源码。
- 真实问题：后台标签页 `Input.dispatchMouseEvent` 返回成功但事件未到按钮；增加 Page.bringToFront 到原生 click/dblclick/hover/drag/keys 与 INTERCEPT，真实页确认事件开始执行。聚焦测试断言先激活再发原生输入，激活失败不继续；隔离完整验收重新通过。
- B 站现场确认首页综合查询用 search/all/v2、翻页用 search/type。第一次错误选择首页端点导致 INTERCEPT_TIMEOUT，未复用旧响应；重新选择实际翻页端点后成功。关键词搜索会整页导航，所以本轮只生成当前页面“下一页”命令，未宣称已支持整页导航搜索。
- 新本地命令 `bilibili.com.explored-next-videos`：结构观察→Agent 编写普通视频过滤/BV格式/业务错误判断→作者 case→真实预览页 3→4→审阅无新增权限→本地增量安装→普通调用页 4→5。最后返回 35 视频、排除 7 非视频，返回页码与 URL 一致。该命令不接受任意页码，语义依赖当前关键词和页码；历史验证 case 重跑前需恢复约定页码。页面恢复为 excel 第一页。
- 已有 API 三组回归通过：excel 第 1 页 17 视频，第 2 页 20，spreadsheet 第 1 页 20；已有 DOM 命令读取当时 25 张已渲染卡片。新来源/作者 cases/字段说明/导航限制写入本地站点知识，stale=false。首次 knowledge-save 的 notes 误传数组被正常拒绝，改为文档规定字符串后成功。真实响应、生成包与用户会话标识均未加入仓库。
- 当前 source Bridge/用户插件具备 INTERCEPT；下次仍先 doctor/tabs/list 检查，不使用历史 PID/tabId。完整导航错误守卫最终已重载到用户插件。Python 相对 `af8e082` 差异为零，未运行其测试或触及环境/生命周期/数据；未推送或开 PR。
- 下一步：策略选择/回退与支持整页导航的 UI 查询，多步 UI、动态页面路径、写命令、知识冲突修订、复杂 frame/Shadow、多连接/下载、UI 共用服务、独立 Agent 对话和 OpenCLI 最新版本对照。当前只完成单步 INTERCEPT，不应将这批测试通过标为完整目标完成。

- 最终验证：新增整页导航（pathname 相同）真实 fixture，任务必须返回 INTERCEPT_DOCUMENT_CHANGED；最终隔离 Chromium 24 项全部通过，报告位于系统临时目录 `webcli-browser-acceptance-mDwIZ7/report.json`（不提交）。最终 Extension 核心 13 项再次通过；完整聚焦集合此前 63 项通过。用户插件重载最新代码后，普通下一页调用再次验证第 1→2 页，返回 38 视频/排除 4 非视频，随后恢复 excel 第一页。WebCLI 全量 1094 项结果仍对应当前 WebCLI 逻辑；最终变更仅扩展导航守卫及文档/测试，相关测试已覆盖。19 个修改/新增 JS 文件语法、git diff --check 通过；最终 npm pack dry-run 586 文件。此阶段将提交为一个本地检查点，未推送、未开 PR。

### 2026-10-17：跨文档页面查询与探索刷新竞争修复

- 从已提交检查点 `123cd43` 接续，仍在 `codex/api-exploration-cli`。develop `4c3d5bd`、dev-1.1.0 `dae8932` 和集成基线 `baf9f98` 未变，本轮没有同步上游；后续仍按本文“上游→集成基线→功能分支”处理，不重复合并已纳入 #106/#91。完整 OpenCLI 对齐目标继续 active。
- 新增 exploration.query，独立模块 exploration-query.js / extension/background/page-query.js，能力 page_query_v1。来源为 UI_SELECTOR mode=query，复用搜索/原生筛选/下一页触发语义，声明 result UI_SELECTOR/DOM_STATE、同源固定 resultPathname 和公开 URL 参数关联；观察只保存结构，不保存输入值。参数命令必须有两组不同值作者 cases。
- 后台监听主 frame 导航，单次触发后等待 URL、加载完成、数据稳定。整页导航允许同样结果；SPA 必须有数据变化，不能把旧列表当新证据。子 frame history 不算主页面变化；输入/select 同步导航导致上下文消失时仅在已观察到导航后继续，不重放动作。超时/跨源/缺字段明确失败。
- 生成 handler 首次返回声明式 __webcli_page_query，后台执行后重新注入，再经独立第二参数续接 page_query_result；不把续接放进业务参数。普通调用和预览都限定读命令及一次续接，写命令/重复标记拒绝。manifest pageWorkflow=true、pageRoute.additionalPaths 允许起始页和固定结果页；临时预览 registry/grant 在导航后重建并更新路由，finally 清理。
- 整体真实回归最初在原 INTERCEPT 首次观察失败，单独抽取却通过。初始 loaderId 假设不足以解释，保留失败记录继续定位。为隔离副本临时记录 chrome.tabs.reload 调用栈与导航时间，确认 refreshAdapterTabs 在查询响应返回后、静默完成前重载该页；源自异步 Adapter 目录刷新。最终修复将探索观察/INTERCEPT/query/采集/探测/回放、预览验证、已有页 browser 操作纳入 managed runtime 页面队列；dialog 绕过等待以解除弹窗。没有降低文档变化守卫、重试业务动作或增加固定延时掩盖问题。临时 reload 插桩已从验收脚本移除，只保留失败时的隔离 fixture 导航诊断。
- 自动化：WebCLI 全量 104 文件/1100 项；Extension page-query/intercept/page-source/refresh/preview/route/helper/browser 聚焦 58 项通过。涵盖路由拒绝、续接不重放、两个不同 cases、参数不落持久记录、旧插件拒绝、SPA 旧数据/子 frame 导航拒绝，以及探索/刷新队列与弹窗解锁。
- 隔离真实 Chromium 25 项通过。新增无 JSON API 的 GET 表单从 /query-start 跳转 /query-results：观察、两组精确标题 cases、安装与两次普通调用通过；fixture 的 sessionStorage 提交记录精确等于五个作者关键词，证明没有重复执行查询。其余 API/路径参数/DOM/INTERCEPT/修复/知识/取消/重启恢复继续通过。第一轮成功报告为系统临时目录 webcli-browser-acceptance-hGKtGS/report.json；去掉诊断插桩后的复验结果追加于本节末尾。
- 用户 Chrome：核实本任务 source Bridge 进程完整命令后更新为当前源码；重载已经安装的工作区 extension-dist，doctor 确认 page_query_v1。重新选择并绑定用户指定搜索页；没有关闭用户标签页。当前 source Bridge/插件已包含本轮功能，下次先 doctor/tabs/list 查询，不能假定历史 PID/tabId。
- B 站生成本地 bilibili.com.explored-ui-search-videos：观察实际 input.search-input-el、button.search-button 和普通视频卡片来源；新增实际 URL/输入框关键词校验与规范化链接。excel/spreadsheet 两组真实预览通过，审阅无新增权限后增量安装。普通调用分别返回 24/27 张卡片，标题/链接与当前页面逐项完全一致，结果随关键词变化。它仅返回当前已渲染普通视频卡片，不代表站点总量。
- 真实回归：原 API 三组返回 17/20/20 个视频，DOM 24 张，下一页从 1→2 返回 38 视频；新旧命令均能使用。发现 B 站点击相同关键词搜索不会发起新导航，第 2 页同词调用返回 PAGE_QUERY_TIMEOUT，未误报成功；这是本次查询对新导航/数据的明确要求，不能把同词调用解释为重置页码。随后切换 spreadsheet 再 excel，核实已恢复 excel 第 1 页。新来源、cases、字段与该限制存入本地知识，stale=false；未提交真实返回内容或本地生成包。
- CLI/Bridge 构建、公开配置和 npm pack dry-run 588 文件通过，含两个 query 模块和更新 Skill；无依赖/lockfile 变化。构建/prepare/pack 与依赖资产的测试顺序执行。已有可选列映射资源缺失警告未改。Python 相对 af8e082 无差异，未触碰其环境、测试、生命周期或持久数据；未推送、未开 PR。
- 接手下一步：策略选择/失败后明确回退；通用 CSRF/签名、动态页面路由和多步 UI；写命令语义与验证；知识冲突修订和共享文件修复；复杂 frame/Shadow/profile/连接/下载；UI 和内部聊天共享服务；独立 Codex/Claude 对话及平台分发验收；OpenCLI 1.8.8 实际差异审计。不要把当前单次查询闭环当成全部 OpenCLI 能力完成。

- 最终复验：去掉 reload 诊断插桩后，隔离 Chromium 25 项再次全部通过，报告在系统临时目录 webcli-browser-acceptance-fQAFMd/report.json。最终 WebCLI 104 文件/1100 项、Extension 聚焦 58 项通过；23 个修改/新增 JS 文件语法与 git diff --check 通过。当前代码和交接记录将作为本地检查点提交，完整对齐目标仍进行中。

### 2026-10-17：来源分析、显式重做计划与 OpenCLI 1.8.8 核查

- 从 `b2b7a32` 继续，分支仍为 `codex/api-exploration-cli`。本轮未 fetch/合并上游，已纳入的 develop/dev-1.1.0/集成基线 SHA 不变；后续仍按“上游→集成基线→功能分支”同步。完整 OpenCLI 对齐目标保持 active。
- 新增 exploration.analyze：根据已存响应字段结构、HTTP 状态、读取语义和路径提示分类，给出选中策略、来源契约、理由缺失与失败后建议。仅分析不请求、不自动切换，不从浏览器流量推断公开 API。API 生成明确 PAGE_FETCH；PUBLIC_API/COOKIE_API 标签拒绝，独立 host HTTP runner 未实现。成功但无 JSON 结构的候选不生成 JSON 工具；仅模糊 JSON/已有页面替代来源时要求显式 plan。
- strategyNote 包含 reason/alternatives/limitations，PAGE_FETCH/INTERCEPT 若提供 note 必须解释替代来源；旧计划可省略以兼容，但 analyze 标记 needsRationale，Skill 要求 Agent 提供判断。策略理由进入 trace 与站点知识。鉴权错误先恢复访问；字段/HTTP 错误先诊断。活动、终结和 scoped repair 任务不会被建议执行不可用的 replan。
- 新增 replan/revisions/revision-read。按当前 draftHash 保留原目录、计划、结构证据、作者 cases 和验证失败，再清空当前草稿/验证/review/cases。摘要包含原始文件字节、计划和 cases，支持损坏 manifest 留档、拒绝并发旧 hash；外部改写旧文件返回 REVISION_CHANGED。每任务最多 20 份，达到上限不破坏当前草稿；Agent 最多三轮尝试规则不变。禁止活动、已安装、取消及 scoped repair 任务重做计划。原安装包不被修改，重新生成/验证/审阅后才可安装。
- 独立 passive capture/collect 增加 includeTelemetry 显式选项，将非静态 JSON 噪声交给 analyze 分类；默认业务过滤及 UI 行为不变。增加 source analysis、历史文件/20 次边界、cases hash、旧 review 撤销、错误策略标签、模糊/非 JSON 数据、终结/活动建议等测试。旧协议测试的文本断言同步此前页面队列实现，没有更改协议以适配测试。
- 最终 WebCLI 全量 105 文件/1116 项、Extension 聚焦 53 项通过；CLI/Bridge 构建、公开配置、10 个修改/新增 JS 文件语法、git diff --check 通过。npm pack dry-run 590 文件，含 analysis/revisions 模块与 Skill；打包后的 CLI 帮助含四个新命令。无新增依赖/lockfile 变化，已有可选列映射资源警告未改。构建/pack 与依赖生成资源的测试顺序执行。
- 隔离真实 Chromium 26 项通过，报告在系统临时目录 `webcli-browser-acceptance-O0TETr/report.json`。新流程：采集业务 JSON/telemetry→analyze→API 草稿→实际服务器 503→验证失败→分析且请求计数不变→replan 留档→观察 DOM→新草稿与作者精确断言→验证/安装/普通调用→知识保存。Bridge 重启后旧 manifest 字节、失败结果仍可读；既有流程全部继续通过。
- 首次完整验收失败于缺少新 API 证据。独立诊断确认示例页未消费 no-store fetch 响应体，没有完成的 CDP 正文记录；fixture 改为消费 JSON 后捕获成功。随后发现旧采集过滤器提前排除 telemetry，增加上述显式开关才可验收分类。没有把失败当成功、删除断言或对生产请求增加自动重放。
- 用户 Chrome：先核实本任务自建 source Bridge 完整命令，再更新源码进程并重载用户已装的工作区 extension-dist；doctor 就绪，重选并绑定 B 站搜索页。首次捕获是导航/推荐/广告等八个请求，没有搜索列表；调用既有 API 搜索 excel 后 collect 补采第九个搜索端点。分析的 likely_data 仅说明字段结构，不能据此把广告等来源当目标。
- 真实站点策略切换是目标选择，不是虚构 API 失效：API 普通调用正常返回 17 视频，先生成比较草稿留档，再为“当前已渲染普通视频卡片”观察 DOM。生成新本地 `bilibili.com.explored-current-video-links`，作者补齐规范化 URL/关键词、精确字段和格式断言；预览通过，审阅无新增权限后增量安装。原工具/共享代码通过保留机制继续存在；未执行任何业务写操作。
- 普通调用返回 24 张可见卡片，标题/链接逐项等于当前页面。首次核对脚本读到另外 12 张隐藏卡片，现场检查它们 getClientRects 为零；按命令既定的可见范围修正核对脚本后通过，生产读取未修改。旧 DOM 命令同样返回 24 张；页面保持 excel 第一页。新来源、cases、选择理由和限制已保存本地知识，stale=false。真实响应和生成包只在本地，不提交仓库。
- 最终 source Bridge 已重启加载最后的分析建议修正，doctor 就绪；已安装任务 analyze 返回只读 trace 建议，API 旧 revision/源码与 DOM 当前策略均可读取，普通新命令再调用仍返回 24 张卡片。下次先 doctor/tabs/sessions 重新确认，不能复用历史 PID/tabId；只管理明确属于本任务的进程。扩展无需用户重新安装。
- 新增 `docs/opencli_1_8_8_audit.md`，读取官方 npm tarball 的 manifest/help/技能/分析代码，没有全局升级用户 OpenCLI，也没有复制上游业务代码。发布包有 1366 个命令、179 个 site 分组（包含桌面应用），这些静态数量不代表本项目覆盖或上游实机验证。详细差距已更新能力台账。
- Python 网站探索agent相对功能起点 `af8e082` 差异为零，未触碰其环境、测试、生命周期和数据。未推送、未开 PR；本阶段作为本地检查点提交，提交 SHA 以 Git 日志为准。
- 接手下一步：优先补浏览器 frame eval/观测、下载与流式输出/profile 等差距；设计符合 Extension/Toolkit 边界的 PUBLIC_API/COOKIE_API 执行及凭据契约。仍需动态页面路由/多步 UI/写命令、知识冲突修订和共享文件修复、UI/内置聊天复用、独立 Codex/Claude 新对话与各平台分发验收。当前明确 replan 不等于自动运行时回退，不应关闭完整对齐目标。

### 2026-10-17：跨 frame 执行、文档身份与超时

- 上轮 `9d5a5f0` 是有效进展，本轮从干净工作区继续；分支仍 `codex/api-exploration-cli`，未 fetch/合并/推送，上游已纳入快照与集成基线不变。完整 OpenCLI 对齐目标继续 active。
- 核对 OpenCLI 1.8.8 的 browser.frames / eval --frame 契约后补齐相应能力，但保留 WebCLI 的 Chrome frameId，不改为数组索引。新增 browser_frames_v1；frames 返回 documentId，eval 支持 frameId/documentId，state/find/get/输入/等待支持文档校验。旧插件拒绝新参数，不允许静默落到主页面。
- 新模块 browser-frames.js 维护按 tab+调试子会话区分的执行上下文，递归启用 iframe 子目标，不暂停新页面；主页面既有网络/预览缓存忽略子会话事件，防止数值 context/request ID 冲突。子目标 detach 清理其后代，根 detach 清理全表；不修改扩展 manifest/权限或引入依赖。
- 选择 frame/document 先执行无副作用身份探测，配对不符时用户脚本/页面操作不会派发。临时标记放在扩展隔离环境，用 Chrome 提供的 frame 身份选择唯一 MAIN 上下文，执行前清除，finally 按原 documentId 清理；用户代码绑定 uniqueContextId，只执行一次，不按 URL 猜测、不使用可能复用的数值 contextId。相同 URL 的多个 frame 能分别返回各自 window.name。收尾审查将初版 MAIN 探测改为隔离探测，最终测试页故意重写 Object.getOwnPropertyDescriptor，确认不会调用该页面钩子来选择目标。
- 显式错误包括 FRAME_UNAVAILABLE、FRAME_DOCUMENT_CHANGED、FRAME_CONTEXT_UNAVAILABLE、EVALUATION_FAILED、FRAME_EVALUATION_INTERRUPTED 和不可序列化结果。30 秒截止既约束 CDP 同步执行，也覆盖 awaitPromise 永不结束；不终止共享页面，超时表示结果不确定，不能自动重放。旧的不带 frame 参数主页面 eval 保持原路径。页面读取结果附 frameId/documentId，原生输入仅传坐标，避免将身份元数据误送 CDP 指针方法。
- 自动化：WebCLI 全量 105 文件/1117 项通过，Extension 最终聚焦 52 项通过；额外新增 null/数组等非法 frame 参数断言后，相关 8 项再次通过。覆盖主/子 session 相同 context ID、错误文档配对零用户代码执行、导航中断一次派发、递归子会话清理、超时释放、旧插件拒绝及原生输入。共享 SW 测试 loader 注册新增模块，未降低既有断言。
- 隔离真实 Chromium 完整 27 项通过，报告为系统临时目录 `webcli-browser-acceptance-3xI6nH/report.json`。新增两个同 URL 的跨源 frame，各有返回另一 origin 的嵌套 frame；严格 CSP 下执行 Promise、分别读取/填写/点击、主页面未误执行、错误配对和导航后旧文档拒绝。原 API/POST/路径参数/DOM/INTERCEPT/页面导航/修复安装/历史/重启流程全通过。
- 完整通过后补了页面结果身份字段和 Promise 截止分支；最终 `--browser-only` 聚焦复验通过，报告为 `webcli-browser-acceptance-8P8Ep4/report.json`，包含 Promise.reject、真实永不结束 Promise 等待 30 秒后明确错误且后续主页面调用可用。该参数只在通用浏览器验证后提前结束，默认仍执行全部流程。最初测试脚本因局部变量 stale 与后文重复声明未启动，改名后执行；未把语法失败当实测。
- 日常 Chrome：核实本任务 source Bridge 完整命令后更新并重载工作区 extension-dist；doctor 声明新能力，重新绑定 B 站搜索页。明确 frameId/documentId 的 Promise 执行返回 excel 第一页；已有 current-video-links 普通调用仍返回 24 张卡片。只对用户目标的主文档执行，没有检查无关嵌入页面的数据。
- 日常 Chrome 另开本任务拥有的 loopback 公开示例页，五个 frame（主页面、两个同 URL 跨源子页面、两个嵌套跨源页面）逐一 eval 返回正确名字，均带当前 documentId，严格 CSP 生效。完成后通过 browser.close 关闭自建标签。临时服务器已停止监听但一个 Chrome 预连接使进程未退出，检查本任务会话与连接后用原 exec 句柄 Ctrl-C 清理；未停止其他服务，用户 B 站标签保留。
- 当前源码 Bridge/用户插件已加载本轮能力；最后非法参数加固只需扩展重载，已执行。下次仍先 doctor/tabs/sessions 选择页面，不复用历史 PID、tabId 或 documentId。真实运行结果仅在本机临时文件，不进入仓库。
- 子 frame click/hover 仍使用 DOM 事件；原生子 frame 指针、Shadow DOM、AX/state 比较、截图标注/尺寸、download 等待与流式输出、多 profile/连接仍待补。exploration 的生成页面来源仍只支持主 frame，不能由通用 eval 可用推断已支持 frame 内生成。后续还包括 PUBLIC_API/COOKIE_API runner、动态页面/多步 UI/写命令、UI 共享与独立 Agent 验收。
- Python 网站探索agent相对 `af8e082` 差异为零，未触碰其源码、环境、测试、生命周期或数据。未推送、未创建 PR，本轮保存本地检查点；最终构建/pack 记录追加如下。

- 最终复验：隔离标记加固后，8 项相关单测、52 项扩展聚焦及 WebCLI 105 文件/1117 项通过；浏览器聚焦通过后再次跑完整 27 项，报告 `webcli-browser-acceptance-pVDWcQ/report.json`，包括全部旧流程、30 秒不结束 Promise、页面重写内置函数和 frame 导航拒绝。日常 Chrome 同样重载最终代码，以五 frame CSP 示例再次确认页面 hook 未被调用，随后 B 站恢复绑定，主文档检查为 excel 第一页，原命令返回 24 卡片。最终临时服务器用 closeAllConnections 正常退出，无遗留测试服务或标签。
- CLI/Bridge 构建与公开配置通过；最终 npm pack dry-run 591 文件，包含 extension/background/browser-frames.js 和更新 Skill。10 个修改/新增 JS 文件语法、差异格式、增量凭据/私网地址检查通过；打包帮助中 eval 声明 frameId/documentId。原有可选列映射资源警告保留，无新依赖。检查点 SHA 以 Git 日志为准；下一步优先补 download 生命周期等待及浏览器流式观测，同时保留全部能力台账的未完成范围。


### 2026-10-17：下载生命周期、可续等观察与真实验收

- 从干净的跨 frame 检查点 `51e7906` 继续。分支仍为 `codex/api-exploration-cli`，未 fetch/合并/推送；develop/dev-1.1.0 已纳入快照和集成基线不变，后续仍按本文“上游→集成基线→功能分支”流程同步。完整对齐目标保持 active。
- 新增 browser.downloads 与 wait kind=download，插件能力 browser_downloads_v1。主/子页面 Page 下载事件限定 tab 归属，GUID 只用于观察，不混同 Chrome downloads 数字 ID。下载记录不来自全局历史搜索；可选落盘元数据只查询准确 URL 与 ±2 秒开始时间范围，唯一匹配才返回文件路径，并声明 fileResolution，歧义不猜测。
- 内存每标签最多 100 条；cursor 记录下载开始序号，after 用于下一动作，downloadId 用于已有传输。默认最近 browser 动作边界在等待开始时冻结，防止另一 CLI 的触发动作推进游标。Bridge busy/tab 锁与扩展 managed 队列均为被动下载观察放行；等待可先于点击，不重试/取消/再次发起下载。单次最多 30 秒；DOWNLOAD_TIMEOUT 区分 not_seen/in_progress，后者保留续等 ID；中断、重复匹配、失效/淘汰游标均明确报错。
- Chrome/扩展/调试断开、标签关闭清理内存；Bridge 重启不清观察状态。bind 时启用递归 frame 观察，子目标增加 Page.enable，根网络缓存仍忽略子会话，GUID 去重防重复事件。无 manifest 权限、新依赖或下载目录/浏览器安全设置变更。URL 常见凭据参数脱敏，data URL 正文不返回；CLI 不读取下载正文，验收脚本只对自己创建的公开示例文件核对字节。
- 验收先发现慢速 fixture 发送 7 字节 text/plain 时，服务端已有请求，但 Chrome 下载历史与 Page 事件均未创建记录。改为明确 application/octet-stream + nosniff 后同样分段响应能观察到 in_progress，没有延长生产等待掩盖问题。随后跨源 frame 验收暴露子目标未订阅 Page 事件，已修复递归订阅；单测覆盖该命令序列。
- 自动化最终：WebCLI 105 文件/1118 项通过；扩展下载、frame、原生输入、网络、路由、消息安全和探索协议聚焦 64 项通过。新增覆盖旧游标/其他标签隔离、并行点击、默认边界、进度/中断/歧义、回收失效、限定路径匹配及旧插件拒绝。
- 隔离真实 Chromium 完整 28 项通过，报告 `webcli-browser-acceptance-Jz491B/report.json`（系统临时目录）。包含等待先于点击、准确文件字节、历史排除、其他 tab 隔离、慢速超时→重启 Bridge→同 ID 继续且请求恰好一次、外部取消、跨源 frame、重复同名歧义。原有 frame 30 秒 Promise、探索、生成、修复、安装、普通调用、历史与重启恢复均通过。新增 --downloads-only 聚焦入口；默认仍跑全部。
- 日常 Chrome 155：核实旧 PID 的完整 source Bridge 命令属于本任务后重启，重载已安装的工作区 extension-dist，doctor 确认 browser_downloads_v1；未动无关服务。主页面下载/进度/续等/准确文件字节通过。首次子 frame DOM click 虽到达服务端，却没有形成下载记录或文件，CLI 如实超时，未将点击成功误报下载成功；未确定 Chrome 阻止的具体策略。改用现有 focus(frameId/documentId) + 原生 keys Enter 后跨源下载完成且字节准确。最终报告 `weworker-download-live-qBiIBH/report.json`；测试仅创建公开示例 .txt，保留在本机下载目录；自建标签与临时服务正常关闭。
- 用户 B 站重新明确绑定，页面仍为 excel 第一页，已安装 current-video-links 返回 24 卡片；标题/规范化绝对链接逐项匹配，下载观察没有混入另一个 tab 的示例文件。人工期望初次误用原始 // href，与命令规范化 https 链接不一致；改为 DOM anchor.href 后精确对比通过，未改生产命令。验证摘要 `/tmp/weworker-download-bili-regression.json`，真实页面数据未进入仓库。
- 当前本任务 source Bridge PID 为 16371，日志 `/tmp/weworker-download-live-bridge.log`；这只是当时快照，下次重启前必须核实身份。插件已载本轮代码，B 站绑定保留；下次从 doctor/tabs/sessions 重新检查。
- Python 网站探索agent相对功能起点 `af8e082` 差异为零，源码/环境/测试/生命周期/数据未触碰。未推送或创建 PR，本阶段保存本地检查点；最终构建/打包见下条。
- 接手下一步：优先原生子 frame 指针（本次日常 Chrome 暴露实际限制）、console/network 持续观察、AX/截图扩展；随后 profile/多连接、PUBLIC_API/COOKIE_API runner 与显式凭据契约。多步 UI/动态页面/写命令、知识修订/共享修复、UI/内置聊天复用、独立 Codex/Claude 对话、平台分发与业务覆盖仍在能力台账内，不关闭全目标。

- 最终分发检查：CLI/Bridge 构建、公开配置、12 个 JS 文件语法、Git 差异格式和新增内容凭据/私网地址检查通过；npm pack dry-run 592 文件，包含 browser-downloads.js 与最新 browser Skill，构建 CLI 帮助声明 downloads/downloadId。原有可选列映射资源缺失警告仍在，无新增依赖。完整 28 项后再为跨源链接补原生 focus + Enter 自动验收，--downloads-only 最终通过，报告 `webcli-browser-acceptance-TN43t5/report.json`；生产代码未再变更。检查点提交 SHA 以 Git 日志为准，完整目标保持进行中。


### 2026-10-17：子 frame 原生指针与跨源下载修复

- 从下载检查点 `948795b` 的干净工作区继续；上一轮是已提交并实测的进展。分支、已纳入上游快照、集成基线不变；本轮未 fetch/合并/推送，完整目标保持 active。
- 新增 browser-pointer.js 与 browser_frame_pointer_v1。子 frame click/dblclick/hover 不再合成 DOM 事件，drag 支持同一指定 frame 的 selector/toSelector；旧插件拒绝新行为。主 frame 既有原生路径保持，普通输入和页面生成策略未扩范围。
- 抽取 withBrowserFrameContext 供 eval/指针共用隔离文档身份匹配。指针将选中节点暂存扩展隔离环境，绑定远程对象与 unique context，在最终派发前核对文档；不依据 URL 或数组索引找目标。临时标记与远程对象在 finally 清理，导航后的新文档不会收到旧清理或自动重试。
- 独立 Chrome 调试探针确认直接对子 target 发送本地原生输入能产生 isTrusted，但可能绕开父层命中检查，因此正式实现统一派发主视口坐标。DOM 内容四边形属于该调试目标根视口；同进程子 frame 需先逆变换到本地视口，沿每层 iframe owner 内容四边形投影到父视口。使用投影变换处理边框、缩放、旋转和透视；滚动保留的节点后，在每个文档的隔离世界 elementFromPoint 检查目标/owner。
- 首次多 frame 测试中，直接用 DOM.getNodeForLocation 检查同进程子 frame 返回父 iframe owner，导致明确 ELEMENT_OBSCURED（未点击）。据真实几何与 frame 记录改为逐文档逆变换和命中检查后通过，没有放宽遮挡条件。frame tree 缓存也按调试 session 区分。
- 悬停后重新测量，超过半个 CSS 像素的布局移动拒绝点击；父层/目标遮挡、离屏、文档变化均明确失败。30 秒准备截止阻止迟到指针派发，拖拽出错尝试在最后已发送坐标释放按钮（按下出错也执行释放）；不会自动重试。悬停、双击第一下或部分拖拽可能已产生业务副作用，错误不证明“未操作”，Skill 已说明。
- 单测：WebCLI 105 文件/1119 项通过；扩展最终聚焦 69 项通过，含投影/逆变换与退化坐标、准备截止后零 Input 事件和标记清理、旧插件能力守卫。既有 frame 8 项先通过，最终总集包含这些回归。
- 隔离真实 Chromium 完整 29 项通过，报告 `webcli-browser-acceptance-MBAZLR/report.json`。新增六个子 frame（两个同 URL 跨源、各自同源和跨源嵌套），检查缩放/旋转/边框下原生 click/hover/dblclick/drag 的 isTrusted；根/中间父层遮挡拒绝，悬停移位拒绝且点击计数不变，hover 导航拒绝，错配文档拒绝。原有 30 秒 Promise、下载、API/DOM/INTERCEPT/跨文档查询、修复、安装、知识历史和重启全部通过。
- 完整通过后收尾加入准备截止和拖拽异常释放位置加固；新增截止单测通过，最终 --browser-only 5 项通过，报告 `webcli-browser-acceptance-PYOvFP/report.json`。最终版包含原生输入和下载等全部浏览器场景，未把该聚焦报告当作又一次完整探索流程。
- 日常 Chrome：核实本任务 source Bridge 后更新并重载工作区插件，doctor 声明新能力。自建公开 loopback fixture 的六个同/跨源子 frame 在缩放/旋转/透视/边框下 click/hover/dblclick/drag 均 isTrusted=true，点击计数准确，父层遮挡拒绝。跨源下载链接直接原生 click 即成功，下载内容逐字节一致，修复上一轮须用 focus+Enter 的限制。报告 `weworker-pointer-live-ubq99z/report.json`；临时服务与自建标签已关闭，示例 txt 留在本机下载目录。
- B 站重新明确绑定，excel 第一页、原 current-video-links 命令 24 张可见卡片标题/规范化链接逐项一致，下载记录未混入本轮其他标签。只将摘要记入本文，真实响应、页面和包内容未提交。
- 当前 source Bridge 为 PID 19049、日志 `/tmp/weworker-pointer-live-bridge.log`，仅是快照，下次操作前核对完整命令归属。用户安装位置仍为工作区 extension-dist，B 站会话 bilibili-maintenance 保留；重载后重新选择 tab/document，不复用旧身份。
- Python 网站探索agent相对 `af8e082` 差异为零，源码/环境/测试/生命周期/数据全程排除；无新权限、依赖、CI/发布改动。未推送、未建 PR，本阶段保存本地检查点。最终分发/代码复验补充如下。
- 接手下一步：console/network 持续观察、AX 与截图标注/尺寸、Shadow DOM/复杂控件，以及 profile/多连接、PUBLIC_API/COOKIE_API 执行和显式凭据契约；多步 UI/动态页面/写命令、知识修订/共享修复、UI/内置聊天复用、独立 Codex/Claude 对话、平台分发与 Adapter 业务覆盖仍在台账。拖拽当前限同 frame 的指针流程，不构造 DataTransfer 或跨 frame 拖拽；exploration 页面来源仍限主 frame。不能将本轮浏览器进展视作完整 OpenCLI 对齐。

- 最终检查：CLI/Bridge 构建、公开配置、10 个 JS 文件语法、Git 差异格式与新增内容凭据/私网地址检查通过；npm pack dry-run 593 文件，包含 browser-pointer.js 和最新 Skill，构建 CLI 的 drag 帮助包含 frameId/documentId。原有可选列映射资源警告保留，无新依赖。最终插件重载后再次跑日常 Chrome 六 frame/遮挡/直接点击下载，报告 `weworker-pointer-live-1bOX7q/report.json` 通过；B 站重新绑定并再次核对 24 卡片成功。所有自建服务/标签已清理，用户页面保留。检查点 SHA 以 Git 日志为准，全能力目标保持进行中。

### 2026-10-17：console/network 持续观察、游标与真实验收

- 从干净检查点 `3ea604c` 继续；分支 `codex/api-exploration-cli`，集成基线与已纳入上游快照未变，本轮未 fetch/合并/推送。完整 OpenCLI 对齐目标保持 active。更新已有跟进文档，不新建用户会话或子 Agent。
- 新增 extension/background/browser-events.js、webcli/browser-follow.js 与能力 browser_events_v1。console/network 的 CLI --follow 输出 JSONL，browser.events 供任意 Agent 和未来 UI 非锁定轮询；绕过 Bridge session/tab 锁和扩展 managed 页面队列，观察可与触发操作并行。命令帮助为 36 个 browser 命令，包文件清单已包含新模块。
- 每 tab/channel 保留 200 条内存事件，epoch/channel/sequence 游标区分同毫秒日志、标签、通道与新一轮观察。ready/entry/checkpoint/end/error 保存可续接位置；筛选时推进 checkpoint，until 以内的年轻事件延后消费，maxEvents 精确终止，stdout 写回调提供背压。SIGINT/SIGTERM 为 130/143，EPIPE 安静退出；断线停止，不重试或自动换游标。
- console/网络覆盖根与已订阅的递归子 target；子 target 新增 Network.enable，requestId 按 source session 区分。网络仅输出完成/失败/重定向元数据，pending 超过 1000 条输出 gap；按 key 读取详情才返回有界脱敏 JSON。redirect、重用 ID、详情读取期间变化及 pending 淘汰不能让旧 key 读取后继请求正文。source 描述调试 target，同进程子 frame 可能标为 main-target。一次性 console/network 保持旧主 target 缓存，不把 Worker 或绑定前流量纳入承诺。
- since/until 支持 ms/s/m/h、0–24h，裸数字沿用秒，与 OpenCLI 毫秒不同，Skill 建议显式单位；旧插件遇到新时间单位/参数明确拒绝。JSONL 专用于 follow；直接 Bridge 客户端不得传 follow 等 CLI 标志，应调用 events。follow=false 保持一次性结果。没有新增依赖或 manifest 权限，Extension/Toolkit Runner 边界未变。
- 首次真实验收发现主 CLI call 分支没有使用已单测的参数解析辅助函数，导致裸 --follow 不生效；已统一入口并真实子进程回归。第二个实际失败是扩展直接 chrome.debugger.detach 不保证触发 onDetach，旧内存仍可读；已用无页面执行的 Runtime.getIsolateId 在观察前核对所属连接，失败清理状态且不自动重附，已有自有临时调试连接也统一清理。重连新观察拒绝旧 cursor。测试 loader 同步导入事件/frame/download 清理，Adapter helper 15 项回归通过。
- 自动化最终：WebCLI 全量 106 文件/1128 项；扩展事件、原生指针、下载、frame、输入、网络、路由、消息安全和探索协议聚焦 76 项通过；Adapter 注册/常见失败/写确认/helper 额外 15 项通过。单测含同时间戳、分页/过滤/丢失、root/child 重名 requestId、详情读取竞态、pending 容量、输出背压、信号与 WebSocket 取消。
- 隔离真实 Chromium 完整 32 项通过，系统临时报告 `webcli-browser-acceptance-1MctRg/report.json`。新增双 console 订阅和 network 订阅同时运行，主/子 frame 原生点击、redirect/失败、详情脱敏、精确条数、信号/管道关闭、Bridge 断线→显式原 cursor 续接、until 延后、200 条淘汰以及调试 detach 失效；旧 frame 30 秒 Promise、下载、API/DOM/INTERCEPT/跨文档查询、修复、安装、知识与历史全通过。新增 --events-only 和共享 browser-events-acceptance.mjs，默认仍跑完整流程。
- 完整通过后收尾加固重用 ID 在 pending 淘汰后的正文阻断，新增单测并重跑全量；最终隔离 events 聚焦通过 `webcli-browser-acceptance-3rtvaa/report.json`，另覆盖一次性 follow=false 和新时间单位。其后核对初次启动输出，发现自动启动 Bridge 的诊断会污染 stdout，已移至 stderr，服务显式 start 输出不变；增加真实无 Bridge 起始的 CLI 验收，最终结果追加于后。
- 日常 Chrome：核实本任务 source Bridge 完整命令后重启、重载已安装工作区 extension-dist，无需用户再次安装。首轮 `weworker-events-live-a8cWfY/report.json` 中最后一条标签误带“debug detach”，实际 detachTested=false；最终复测标签已修正，报告 `weworker-events-live-JwMgxZ/report.json`。该环境验证双订阅、主/子 target console/network、脱敏详情、信号/关闭管道、Bridge 重启续接、时间窗口与淘汰；主动 detach 在隔离 Chromium 验收，不把日常报告误记为也覆盖它。所有自建页面/临时服务器正常关闭。
- B 站重新从 tabs 选择并绑定 bilibili-maintenance，excel 第一页、原 current-video-links 24 张可见视频卡片标题/规范化绝对 URL 逐项一致，下载观察未混入其他标签。此次不持续观察真实站点的无关账号流量；压力/断线/溢出使用自建公开 loopback fixture。真实页面结果只留本机，没有提交到仓库。
- 当前 source Bridge 快照 PID 23777，日志 `/tmp/weworker-events-live-bridge.log`；下次操作前必须重新核对完整命令，不复用历史 PID/tab/document。用户安装目录仍为工作区 extension-dist，B 站页面保留。最终 npm pack dry-run 595 文件含 events/follow/最新 Skill；CLI/Bridge 构建与公开配置通过，原有可选列映射资源警告保留。
- Python 网站探索agent相对功能起点 `af8e082` 差异为零，源码/环境/测试/生命周期/数据全程排除。无发布、CI、数据库或 .env 改动；未推送、未开 PR。保存本地检查点，SHA 以 Git 日志为准。
- 下一步：AX/state 对比、截图标注/尺寸、Shadow DOM/复杂控件、profile/多连接；随后按 Runner 边界实现 PUBLIC_API/COOKIE_API 与显式鉴权契约。多步 UI/动态页面/写命令、知识修订/共享修复、UI/内置聊天共用、独立 Codex/Claude 新对话、平台分发和业务覆盖继续保留在能力台账，不能将本阶段完成当作全目标完成。

- 最终分发复验：首用自动启动 Bridge 的真实 CLI 子进程只输出一行 JSONL error，启动诊断均在 stderr；隔离浏览器最终 5 项聚焦通过，报告 `webcli-browser-acceptance-TRWQmK/report.json`，包含一次性 follow=false、时间单位、双订阅、重启、溢出与主动 detach。WebCLI 106 文件/1128 项在该启动修正后再次通过；CLI/Bridge 构建、595 文件 npm pack dry-run、20 个 JS/MJS 语法、公开配置、Git 差异格式与增量凭据/私网地址检查通过。构建后的 browser.help 正确包含 36 个命令及 follow 参数。完整 32 项报告在启动诊断修正之前，最终聚焦不冒充又一次完整探索验收。用户插件生产源码与最后日常 Chrome 验收版本一致，后来仅 CLI 启动诊断和测试/文档更新；源 Bridge 与用户页保留，本轮检查点 SHA 见 Git 日志。
