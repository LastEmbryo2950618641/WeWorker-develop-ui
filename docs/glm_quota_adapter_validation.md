# GLM 额度 Adapter 实站验证

2026-10-18 最新结果：旧页面版及其安装快照、旧任务、旧知识和作者临时目录已按用户授权删除；重新通过 WebCLI 观察网站、编写并安装后台版。**关闭全部 GLM 标签后，真实验证、普通查询、重复读取及 Bridge 重启后的查询均通过，没有隐式新开业务页。** OpenCLI 全面对齐目标继续暂停。

## 使用

浏览器保持登录，Chrome、WeWorker 扩展和 WebCLI Bridge 保持运行；日常查询不需要打开 GLM 网页。

```bash
webcli call bigmodel.cn.get-quota --period=5h
webcli call bigmodel.cn.get-quota --period=week
webcli call bigmodel.cn.get-quota
webcli adapter skill bigmodel.cn
```

自然语言示例：“使用 WebCLI 查询我当前 GLM Coding Plan 的 5 小时和每周额度，告诉我已用、剩余比例和可用的重置时间。”Agent 从 Adapter Skill 读取命令与口径后调用。

**首次登录，或切换账号、组织、项目后**，先打开目标 [用量页](https://bigmodel.cn/coding-plan/team/usage-stats)，确认上下文，再执行一次：

```bash
webcli call bigmodel.cn.prepare-context
```

准备成功后可以关闭网页。该命令缓存已观察到的组织/项目上下文，仅返回准备状态，不输出账号值或凭据；`authenticationVerified:false`，实际服务端权限由后续额度请求确认。缓存不会自动跟随页面切换，缺缓存明确提示重新准备；普通查询不偷偷补读页面。多个同路由页都非活动时，准备命令会拒绝歧义。辅助 `check-login-status` 也只是页面就绪检查，日常查询无需先调用。

## 返回口径与实现

- 返回 `scope:current-member`、`period`、`checkedAt`、`source:api` 和 `items`。每个窗口含 `window`、`label`、`usedPercent`、`remainingPercent`、`resetAt`、`resetAvailable`，以及便于核对的 `sourceType/sourceUnit/sourceNumber`。
- 口径是准备的组织/项目下当前成员的两个额度窗口，不是团队汇总或任意历史日期。百分比来自服务端，剩余为 100 减去已用；没有承诺绝对 token 数。
- 5 小时窗口对应 `TOKENS_LIMIT/unit=3/number=5`，每周对应 `TOKENS_LIMIT/unit=6/number=1`，已核对站点 `LimitBoard`。不是仅回显参数。
- 可选 `nextResetTime` 按服务端毫秒时间转换为 UTC ISO；缺失返回 `resetAt:null/resetAvailable:false`，不编造倒计时。`checkedAt` 仅代表本次查询时间，不证明服务端内部无缓存。

重新观察接口 `GET https://bigmodel.cn/api/monitor/usage/quota/limit?type=2`，并检查网站公开 JS 和页面组件，核实网站将命名 Cookie 解码后直接作为 Authorization，同时携带组织、项目请求头。仅补 Authorization 可得到业务成功响应却缺少目标窗口，因此不把 HTTP 200 或 `success:true` 单独视作成功。

后台 `get-quota` 保留 `runtime:extension`、`execution:{type:api,runtime:background}`，复用现有 Runner。使用明确名称/URL 的 `cookies_get`（关闭调试器取值）、`storage_get(cacheOnly:true)` 和 `backend_fetch(browserFallback:false,backgroundPreviewRead:true,redactBodyInTrace:true)`。每次调用一个 GET，不读取页面，不重放失败；参数、鉴权、业务错误、缺失/重复窗口和非法数值明确失败。

最终本地生成包为 `bigmodel.cn@1.0.2`，摘要 `4d066a979d9223e1260c1a9c9381ade5d2d4c0fe66ecb48b7400328b079de525`。权限为 `host:bigmodel.cn`、`runtime:extension`、`execution:background`；准备/就绪命令绑定准确用量页路径。包只在用户本地安装，没有加入开源仓库内置 Adapter 或构建 profile。代码、用例、知识与本报告不保存真实凭据、组织/项目值或实际额度。

## 验证证据

重新执行 `start → evidence/analyze → generate → draft-write → verification-write → validate → review → install → 普通 call → knowledge-save`。先完成准备命令的一组真实预览，再增量生成后台查询并完成四组真实 cases（默认 all、5h、week、显式 all）。数据曾与页面原始响应在内存逐字段比对，一致；未保存实际额度。

在用户明确允许关闭两个用量页后，任务自建页由 WebCLI 关闭，原有页通过浏览器工具精确关闭（WebCLI 对绑定用户页的 close 仅解绑，页面自身 window.close 被 Chrome 拒绝）。浏览器工具只用于该已授权关闭动作；探索、生成、验证和查询均使用 WebCLI。

- WebCLI 确认 GLM 标签为 **0**；新的 scoped repair 保留已安装后台模块、鉴权、准备命令及权限，仅重新验证目标命令，**4/4 cases 通过，0 跳过**，审阅安装为上述 1.0.2。
- 无页安装后 **4 次普通查询**通过：源码 5h、全局 week、打包 all、全局重复 5h。标签前后为 0，没有新页。
- 重启本任务拥有的 Bridge 后，再执行 **4 次查询**：全局 5h、打包 week、源码 all、全局重复 5h，全部通过。每次 trace 包含 cookies_get、storage_get、backend_fetch，无 main_world_eval/browser_fetch/导航；标签前后为 0，没有新页。
- 非法 `period=month` 在凭据 helper 和 HTTP 请求前拒绝。离线公开占位数据 **11 项通过**，覆盖窗口映射、可选重置、参数、每次新请求、缺 Cookie/缓存、401 单次失败、业务错误、缺/重复窗口、非法数值与 JSON。
- 最终包静态验证 **6 文件、0 错误、0 警告**；四组 cases 和字段含义已保存到本地知识，摘要匹配，未过期。
- 本轮核心聚焦 **6 文件/61 项**、WebCLI 全量 **130 文件/1465 项**通过。源码和打包 CLI 的真实隔离 loopback 安装/卸载/重新安装验收各 **4 项**通过。CLI/Bridge 构建与随包 Skill 4 项通过，npm pack dry-run 636 文件，47 个对应资源字节一致；详细边界及既有构建提示见交接末尾。

本机证据目录 `/tmp/weworker-glm-rebuild-VIcRcz/` 包含 `no-page-summary.json`、`no-page-restart-summary.json`、公开占位测试及 `webcli-tests.log`；汇总只保存通过状态、窗口枚举、调用入口和 trace 标识，没有额度值。隔离 CLI 报告为系统临时根 `webcli-export-acceptance-D5HY1J/report.json` 与 `webcli-export-acceptance-MPGNYN/report.json`。临时报告可能被系统清理，不作为长期分发资源。

## 流程修复、失败与限制

删除纯用户包后，旧卸载逻辑错误选择不存在的 builtin，导致再次 generate 被 `ADAPTER_NOT_SELECTED` 阻塞。本轮改为有 builtin 才恢复，否则保留 disabled 标记；目录不把该标记当错误，但调用/列表继续禁止旧 legacy 命令与别名回退。新增卸载后生成与重新安装回归。直接删除 selection 的初稿曾导致 legacy 回退测试失败，最终使用 disabled 并修复调用侧后全量通过。生成 Adapter Skill 也改为按每条命令的 execution 和 guidance 判断页面依赖。

实站首个准备草稿误用仅安装态可用的 runtime，被真实预览拒绝；改用 task-local 页面 helper 通道。用户重载插件使旧任务身份失效后重新 start，未绕过身份检查。锚定正则和 scoped repair 名称的输入校验失败均修正后重验，没有把失败/跳过计为通过。仅 Authorization 缺上下文的响应也未计查询成功。

安装后普通查询已用全局 npm 1.0.4 实测。但该发布版尚不支持本分支的探索/profile 入口；本轮生成用工作区 CLI，Bridge 已获授权重启，用户已重载最新扩展。**现场从零生成须预先准备匹配的本分支 CLI、Bridge、扩展和 Skill；不能仅凭版本号判断支持。**

仍未验证：浏览器冷启动、新机器、其他账号/套餐、真实登录过期后恢复、全新独立 Agent 对话和长期稳定性。本轮不主动使用户登录失效；401/缺 Cookie 的真实 loopback 与离线分支不替代真实账号恢复验收。站点升级后须复验鉴权和窗口契约。内部仓库同步及逐包后台回归尚未进行。

没有模型调用、购买、套餐修改、额度重置或其他业务写操作；没有修改 Python 网站探索agent。OpenCLI 其余 W/B/A/U/E 全部保留，整体目标仍暂停，未推送、未创建 PR。
