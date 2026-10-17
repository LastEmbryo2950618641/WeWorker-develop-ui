# API 自动探索 CLI 改造跟进与交接

> 更新日期：2026-10-17。当前阶段：已建立集成基线并解决冲突，开发设计待审阅；尚未实现新 CLI。
> 下文第 2～3 节保留初始历史快照；以最新状态和追加日志为准。

## 最新状态

- #106、#91 已合入 develop，merge SHA 分别为 `14846149bfcb94829af767743fedcf577e595322`、`4c3d5bd784c3a4f178c45b027bc37bf672d75aca`，无需再单独合入。
- `codex/api-exploration-base` 从 develop `4c3d5bd` 建立；初始文档已保存为 `2d177bc`，本轮整合 dev-1.1.0 `dae8932`。
- 本次使用原工作目录，无新 worktree。切换时 ROADMAP.md 阻止 checkout，具名 stash 保存两份文档后切换并 apply，保留双方路线图。stash 仍保留作备份。
- 功能分支在集成提交后创建为 `codex/api-exploration-cli`，最终操作结果见文末。未推送或创建 PR，最终发布目标仍待明确。
- [开发设计](api_exploration_cli_design.md) 为本次审阅入口。
> 后续每次建分支、同步上游、解决冲突、实现功能或验证后，都应更新本文和 ROADMAP.md。未验证事项不得标为完成。

## 1. 目标与范围

将现有界面入口的 API 自动探索能力开放为 WebCLI 命令，支持自然语言驱动调用，后续让界面复用同一套能力。

- 对外遵循 `webcli call <adapter-id>.<tool-id>`；具体 Adapter ID、命令名及参数尚未设计，不视为现有接口。
- 优先提取共享探索任务服务与契约，再接 CLI、自然语言和界面。模型调用、权限检查和任务执行保留在相应服务边界内，不在 CLI 重写业务流程。
- 待设计能力包括启动探索、查询状态、读取事件与结果、取消、恢复及生成/验证产物；具体范围需根据现有实现确定。
- 自然语言层负责理解目标、补齐必要参数及编排命令；CLI 提供稳定、可验证的结构化结果和错误。
- 界面如何复用服务、是否需要启动 CLI 子进程，尚未决定。
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
