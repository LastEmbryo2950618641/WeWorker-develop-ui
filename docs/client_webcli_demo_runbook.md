# 客户端 GLM 简单查询演示

2026-10-18：本分支开发客户端的真实生成与查询已验证。完整证据、失败记录及边界见 [目标与验收记录](client_webcli_demo_goal.md)。这是指定本机环境的演示，不是任意网站或全部平台保证。

## 演示环境

- `codex/api-exploration-cli` 的 WeWorker 1.1.0 开发客户端；当前验收模型为 GLM-5.3。
- 同一构建的 WebCLI、Bridge、三个共享 Skill，以及 `weworker/build/extension-dist` 中的 Chrome 扩展。验收浏览器为 Chrome 155.0.8059.80，扩展为 1.1.0。版本号相同不代表能力相同。
- Chrome 保持登录。首次登录或切换账号、组织、项目后，在用量统计页确认当前上下文并执行显式准备。普通查询不需要业务页。
- 生成包在本机独立演示目录 `~/.weworker/client-demos/2026-10-18-glm/adapters/bigmodel.cn`，未覆盖默认根的备用包，也未加入仓库内置 Adapter。

## 启动

先退出验收客户端。确认 3711 上是本工作区的 Bridge 后停止该进程，再切换演示环境；不要复用不同 Adapter 目录的 Bridge，不终止未知进程。8765、5173 同样不得与另一开发客户端冲突。8766 是独立网站探索agent端口，不是本次聊天 WebCLI 链路的前置条件；本次临时占位在验收结束时释放。

在仓库根目录的终端设置同一套目录，然后启动现有开发入口：

```bash
export DEMO_ROOT="$HOME/.weworker/client-demos/2026-10-18-glm"
export WEWORKER_USER_ADAPTERS_DIR="$DEMO_ROOT/adapters"
export WEBCLI_ADAPTERS_DIR="$DEMO_ROOT/adapters"
export WEWORKER_ADAPTER_DATA_DIR="$DEMO_ROOT/host-data"
export WEWORKER_BUILTIN_ADAPTERS_DIR="$PWD/weworker/build/builtin-adapters"
export WEWORKER_BUILD_PROFILE=public
export WEBCLI_METRICS_UPLOAD=off
npm --prefix weworker run dev
```

开发入口会重建配套 WebCLI。若重建内容包含扩展修改，在 Chrome 扩展管理页手动重载匹配目录；若只是 Skill 文案变化，客户端下一轮会同步。模型需可用，验收初期曾因余额不足由用户自行切换模型。

从零生成演示时，将 `DEMO_ROOT` 改为一个**新的空目录**，保留其他变量与构建不变；不可使用保存包的目录冒充从零生成，也不需要删除旧包。不同目录之间切换前先退出客户端并核实、停止所属 Bridge。

## 从零封装

新建客户端聊天，输入：

> 请从零探索 https://bigmodel.cn/coding-plan/team/usage-stats 并自行编写、真实验证和安装当前成员 GLM 额度查询工具，只查询 5 小时和每周额度，参数值严格为 5h、week、all（默认 all 恰好返回这两个窗口），已用比例保留原始精度、剩余比例为 100 减已用且不舍入，重置时间缺失返回 null，同时提供首次登录或切换账号、组织、项目后的显式准备命令，让准备完成后的聊天查询无需打开业务页。

验收中这一单句流程耗时 **8 分 14 秒**，中间由客户端自行纠正来源计划；没有追加业务提示或外部代写代码。初包的毫秒时间戳正确，但后续聊天曾换算错误，客户端又用 repair 自行补充 ISO 时间字段并通过四组真实用例，耗时 **4 分 8 秒**。共享 Skill 已补充时间格式要求；尚未重新测量该补充后的从零耗时，不能承诺固定时间或每次零修正。

用户可能仍需正常登录、选择上下文或按既有策略确认安装。模型、网络或网站变更可能造成失败；停在 collecting/validating、跳过用例或仅 HTTP 成功都不算完成。

## 日常查询与备用演示

保存的最终包提供：

```bash
webcli call bigmodel.cn.prepare-context
webcli call bigmodel.cn.query-quota --window=5h
webcli call bigmodel.cn.query-quota --window=week
webcli call bigmodel.cn.query-quota --window=all
webcli call bigmodel.cn.query-quota
```

也可直接在聊天说：“查询我当前 GLM 的 5 小时和每周额度，包括已用、剩余比例与重置时间。”准备成功后关闭本次任务创建的用量页，再查询和重复查询。最终包返回两个窗口各自的 `usedPercentage`、`remainingPercentage`、原始毫秒 `resetTime` 和 UTC `resetTimeIso`；时间缺失时两者都是 null。不要让模型心算时间戳。

默认根的历史备用包与此包都叫 1.0.2，但内容不同：历史包命令为 `get-quota`，本次客户端生成包为 `query-quota`。以 `webcli adapter info/skill bigmodel.cn` 和摘要为准；本次最终摘要为 `f72b0799ab7d2487723cf742ba4b19e3fb5f0a13742383bec8a8930472f9faeb`。直接使用保存包只属于查询备用演示，不替代从零生成。

## 失败恢复与限制

- 模型连接/余额问题：在客户端切换可用模型，不把模型 Key 用作网站凭据。
- 扩展断线或版本不匹配：核对同分发构建与 profile，手动重载扩展；旧任务页面身份过期则创建新任务，不绕过守卫。
- 登录或缓存缺失：恢复正常登录，打开准确用量页并确认账号、组织、项目，再执行准备。准备只证明上下文刷新，真正的服务端权限由查询验证。
- 401、响应结构或窗口字段变化：保留错误，使用当前 Skill 的 repair 流程重新观察和真实验证，不能把后台查询改成页面调用来交差。

已验证本机无页查询、重复调用、新聊天发现和任务 Bridge 重启。未验证新机器、Chrome 冷启动、其他账号/套餐、真实登录过期后的恢复、长期稳定性；没有为了测试退出用户账号。原 OpenCLI 全面对齐继续暂停，完整余项保留。
