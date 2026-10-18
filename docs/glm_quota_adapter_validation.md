# GLM 额度 Adapter 实站验证

后续审计修正：此前 Cookie fetch 失败不足以证明必须打开业务页。通用流程已补 [后台 API 探索、运行时分流与防退化](background_api_exploration.md)。本报告及已安装 GLM 包仍只证明页面版；GLM 的实际鉴权来源、无业务页实现和真实验收尚未完成，不能以通用 loopback 验收代替。

验证日期：2026-10-18。由用户明确指定 GLM 团队用量页面，授权只读查询、生成和本地安装。本项是活动演示的独立验证；OpenCLI 全面对齐目标继续暂停。

## 使用

在已登录的 Chrome 中打开 [团队用量页面](https://bigmodel.cn/coding-plan/team/usage-stats)，保持 WebCLI Bridge 和浏览器扩展连接。

```bash
webcli call bigmodel.cn.get-quota
webcli call bigmodel.cn.get-quota --period=5h
webcli call bigmodel.cn.get-quota --period=week
webcli adapter skill bigmodel.cn
```

自然语言示例：“使用 WebCLI 查询我当前 GLM Coding Plan 的 5 小时和每周额度，告诉我已用、剩余比例和重置时间。”Agent 可通过 Adapter 的 manifest 和随包 guidance 发现参数及口径。

结果包含 `scope`、`period`、`checkedAt`、`fresh` 和 `items`。每个窗口包含 `window`、`label`、`usedPercent`、`remainingPercent`、`resetAt`、`resetText`。

- 查询口径为团队套餐页面的“我的用量”，即当前登录成员；不代表整个团队汇总，也不接受任意历史日期。
- 已用百分比来自站点响应；剩余百分比为 100 减去已用值。该响应未提供这两个窗口的绝对 token 总量。
- `resetAt` 为 UTC ISO 时间，`resetText` 保留网站格式，`checkedAt` 为本次读取时间。
- 多个相同路径标签页时，应保留唯一目标页，或让目标页成为唯一活动页。多浏览器请用支持 profile 的开发版明确选择浏览器。
- `check-login-status` 只检查页面就绪，返回 `authenticationVerified:false`；实际权限由 `get-quota` 的新请求确认。

## 实现与数据边界

安装包为用户本地生成包 `bigmodel.cn@1.0.0`，不是仓库内置 Adapter。摘要为 `c1af19327ff2ae9c71cc1da202fe151204237343dcaa3c1f763fe7e15ae0fcb8`，仅授予 `host:bigmodel.cn` 和 `runtime:extension`，命令绑定精确 `/coding-plan/team/usage-stats` 路径。未发布、未推送、未创建 PR。

先观察成功的 `GET /api/monitor/usage/quota/limit?type=2` 结构，再审计页面 `EnterpriseUsageStats.fetchQuotaLimits` 和 `LimitBoard` 的窗口映射。直接 Cookie fetch 返回业务鉴权错误（需要 Authorization）；最终作者代码通过既有 `main_world_eval` helper 调用站点只读刷新方法，不读取或导出凭据。每次等待新数组和本次开始后的额度请求完成，再以标签、unit、number 和 type 唯一匹配窗口，核对百分比与重置时间。

页面在后台时百分比动画可能停留在初始值，直接读 DOM 会误报。实现读取新响应与卡片对应的原始数值；前台动画完成后的 DOM 已另行核对一致。没有新响应、窗口缺失、非法百分比或页面身份改变均失败，不使用旧值或默认零补齐。

包、作者用例、随包 guidance 和站点知识只保存通用代码、结构、窗口枚举及公开语义；真实账户/团队标识、额度数值、重置时间和凭据未写入仓库。

## 验证证据

- 通过 `exploration.start → evidence/analyze → generate → draft-write → verification-write → validate → review → install → 普通 call → knowledge-save` 完成。代码由当前 Agent 编写，WebCLI 不调用额外模型。
- 四组真实作者 cases 全通过：默认两个窗口、5 小时、每周、再次读取两个窗口。断言窗口身份、标签、行数、数值类型和刷新标记；没有将真实用量写成 fixture。
- 安装后开发版普通调用两组、全局发布版普通调用四组成功；包含前台页面逐字段比对。确认已关闭探索标签后，原先打开的用量页也能独立调用。
- 非法 `period=month` 被拒绝，观察到额度请求数量没有增加。页面就绪辅助命令调用通过。
- 补充十项离线公开数据测试通过，覆盖窗口选择/百分比计算、重复请求、非法参数、旧数组、空/失败结果、缺窗口、异常百分比、身份变化、导航变化和无新响应；它们是错误分支补充，不替代上述真实页面验证。
- 安装包静态校验通过：5 文件、3 JavaScript 文件、2 命令，零错误、零警告。5 文件凭据/账号字面量模式检查无命中。
- 生成的 Adapter Skill 可通过全局 `webcli adapter skill bigmodel.cn` 读取；四组 cases 和字段语义已保存到本地站点知识，当前摘要匹配且未过期。

## 演示准备与限制

本次环境的 npm 最新版和全局 CLI 均显示 1.0.4。该发布版尚不识别新的 `profile.list` 探索入口，将其错误当成站点工具处理；本次创建流程实际使用当前分支的 `node webcli/index.js call exploration.*`。已有 Bridge 和扩展能够配合当前分支完成生成。**安装后的查询命令已用普通全局 `webcli call` 实测通过。** 因此，下周可演示这台机器上的自然语言调用；若要现场从零生成，应预先部署本分支 CLI 和兼容 Bridge/扩展，不能仅凭 npm 版本号判断能力。

本实现依赖网站当前 Vue 组件、方法、请求和窗口标签；网站升级需要复验。尚未证明新机器安装、其他账号/套餐、登录过期后的恢复、其他独立 Agent 新对话和长期无人值守稳定性。没有执行模型调用、购买、套餐修改、额度重置或其他业务写操作。未修改 Python 网站探索agent。

首次静态校验误把 Adapter ID 当目录传入，得到 ENOENT；使用实际安装目录后通过。无产品核心代码修改，本轮未重跑无关全仓回归。全量 OpenCLI 剩余范围仍以能力台账和交接文档为准，不因本实例通过而关闭。
