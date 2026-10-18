# OpenCLI 页面上下文与工作流编排审计

2026-10-18。B01 跨 origin/frame 的源码核对与后续实现记录；源码审计本身不代表行为验收。跨源主文档最终完整双打包 109 项 9ccf6Q、连续 102 次调用与组合 12 项通过；frame 仅保存未接入基础且探针有失败。按用户要求在此暂停，完整证据见交接末尾。上游对照 npm 1.8.8 与固定 tag `8271afc67e8504bda94c147f446ee29775d08274`。扩展 `background.ts` Git blob `efcb9efa99225e4f6bc57e9f58b1e6f1990370e8`、`cdp.ts` `c2ce05149ce3cbabe35fa76df83fbe05cb1cc150` 已与固定 tree 按 Git blob 算法核对；不依赖最新分支推断。

| 能力 | 上游实际代码 | 本项目现状 |
| --- | --- | --- |
| 跨源主文档导航 | browser/page.js:86–122 的 goto 发送明确 URL、保留返回 targetId；background.ts:1723 起只校验 HTTP(S) 后对同 tab 更新 URL，可跨 origin。导航完成可接受重定向；相同 URL 完整页直接返回。 | browser.open 已有明确 URL 能力；生成的 navigate/workflow 现由 resultOrigin/step.origin、任务 allowedOrigins、完整 pageRoute 权限和 continuation 接通。不同来源不能交叉使用路径，保持新文档/完整 URL 与固定 tab；不沿用上游同 URL 直接返回旧结果的行为。 |
| frame 列举与读取 | page.js:324–330 frames/evaluateInFrame；background.ts:1678–1708 每次用当前树枚举跨源 frame，再按 frameIndex 找 frameId；cdp.ts:653 起按上下文执行，失效 context 可重新解析 target。 | browser.frames 返回 Chrome frameId/documentId；browser-frames.js 用 documentIds 和 uniqueContextId 固定页面，隔离标记关联 OOPIF，嵌套自动 attach。已验单条读取/点击/上传，但 page-source/page-query 固定 frameIds:[0]，工作流无 frame 声明。 |
| 分支与分页 | Gmail utils.js:479–543 先 search 后 next，有界页数、缺 next/短页结束、去重、重复页无新增拒绝部分结果。 | 本增量提供受权限绑定的 when/repeat/until/collect，真实公开分页已验；只读原生控件、固定同源主文档，不能外推任意站点或其他上下文。 |

下一实现必须同时处理以下边界：

1. 声明每步起始 origin 与明确目标 origin/path，限定导航步骤可以切换；所有目标进入包 match、精确 route 权限与预览授权，不能仅放开事件监听的同源判断。已选 tab/profile 固定，不追随其他 tab 或切换 profile。
2. 跨源后命令注册器所属文档会消失，须使用既有一次后台执行与 continuation 路径，并核对整包注入/最终结果映射仍在原授权下。任务身份检查只允许本操作已声明并实际完成的目的地，不扩大其他 observe/write/collect 的来源权限。
3. frame 生成契约不能持久化某次浏览器的临时 frameId/documentId，也不能按同 URL 随意换 frame。应以明确嵌套 frame 入口解析一次并保存本操作的真实身份；歧义、移除、导航和同 URL 替换都失败，不挑替代节点、不重派发。
4. 子 frame 内读取与动作复用已验证的文档/原生操作基础，保持父文档和每层 frame 身份；循环内不得重新选择另一个 frame。跨源与 frame 的结果关联、新鲜度、超时与取消仍分别有证据。
5. 自动化和隔离实机须覆盖两个公开 loopback origin、重复相同 URL frame、嵌套跨源、父/子导航、重定向、选择歧义、取消/重启、权限变化与提取修复。上游的 context 重解析/旧 target 重试策略不自动迁入本项目的不重放契约。

以上为源码审计时的起点。后续跨 origin 实现及 frame 基础状态见下文；B01 frame 仍开放，W01–04、B02–04、A01–02、U01–06 与 E01–04 全部范围保留；Python 网站探索agent、日常浏览器、真实账户与未知调试端口均未操作。

## 跨源主文档实现进展（2026-10-18）

已增加固定 navigate.resultOrigin、workflow step.origin 链、start.allowedOrigins 门禁、完整 manifest match/pageRoute 权限、精确源与路径组合选择、固定任务 tab 预览和 page_navigation_origin_v1 派发前检查。单步 query 和多步 A→B 的源码 Chromium 首轮通过（5GCrtt），包括生成/作者验证/安装/重复调用/知识/提取 repair/重定向拒绝/取消/重启不重放。跨源 hash、A→B→A、重启后验证和作者取消的源码/双打包专项各 11 项已通过（2zWcqF/r9KzgD），实现检查点 841a412。完整双打包 cmPIYq 暴露下述 tabs 快照竞态，修复后的最终完整双打包 9ccf6Q 109 项已通过。frame 工作流暂无接入。

## frame 身份方案探针（不是工作流验收）

隔离 Chromium 1217 的临时扩展副本，以本项目 ensureCdpAttached / withBrowserFrameContext 真实事件链运行：父文档中的唯一 iframe 节点通过 DOM.describeNode 得到 CDP frameId，再与扩展隔离上下文及 Chrome frameId/documentId 对应。5 个主/子/嵌套文档，包含两个完整 URL 相同的跨源 iframe，均唯一匹配，未用 URL 或树序号挑选。报告 `weworker-frame-identity-DAKfnA/report.json`，日志 `/tmp/weworker-frame-identity-probe-host.log`；临时浏览器/服务全部关闭。

首次探针在 ServiceWorker 内使用动态 import，被规范拒绝；改为仅临时副本静态导入。第二次直接 attach 没有进入本项目事件状态，因此找不到上下文；改为复用 ensureCdpAttached 后通过。没有修改生产文件绕过身份检查。这验证选择器到真实 owner/document 的可行性，不证明生成、动作、导航、新鲜度、权限或取消链路已完成。

后续声明按嵌套 owner 选择器逐层固定 origin/path，不保存临时 frameId/documentId。每次调用只解析一次，之后按真实 documentId/uniqueContextId 与 owner 身份复核；相同 URL 替换或歧义失败。主文档及所有祖先须保持，子文档显式导航采用独立身份迁移，不以重新选中 frame 冒充连续动作。frame 仍开放。


## 跨源导航事件与 tabs 快照竞态

完整双打包 `webcli-browser-acceptance-cmPIYq` 在 workflow 第 6 次普通调用的首步返回 `PAGE_QUERY_ORIGIN_CHANGED`，当时从目的源返回入口；失败日志 `/tmp/weworker-origins-bundled-full.log`。随后仅在隔离扩展副本中使用 841a412 旧导航代码增加失败诊断，连续调用在第 38 次复现（`webcli-browser-acceptance-Zl8HbX`，`/tmp/weworker-origins-race-proof-fixed.log`）：`navigated:true`、`oldSnapshot:true`，当前 origin 等于初始 origin 而不同于目的 origin。这直接证明 CDP 文档提交已先发生、tabs URL 仍是完整旧快照的时序；不依靠从错误码猜根因。早期 BcTHOC 没有保留实际 error，不能追溯证明该次也是同因。

普通与 hash 导航只等待精确初始 href 在既有预算内更新；等待时不提取数据。完整目的 href、新文档/loader、300ms 稳定结果、hash 关联/刷新、CDP 重定向拒绝和一次派发保持。单测覆盖滞后两次轮询、永久旧快照超时、旧快照期间错误 origin 事件立即拒绝，均零重放。最终完整/连续调用结果见交接末尾。

修复后 tBXyDE 已越过跨源并通过前 108 项，但最终共享修复夹具复用 localhost 被已有跨源包吸纳，严格三命令断言失败。包的 hostname/父子域归属不按端口分离；只改验收环境，使用精确映射到本地 loopback 的独立公开占位 host，保留完整影响范围与全部重验断言。不能把子域或不同端口的孤立通过当作组合验证；新 `--origins-shared-only` 先建立跨源包再验证共享修复，最终结果见交接。

## frame 基础保存点与已知失败（未接入）

暂停前已有 `webcli/page-workflow-frames.js`、`extension/background/page-workflow-frames.js`、`extension/background/page-frame-context.js`、对应 3 项主机单测和 `webcli/scripts/verify-page-frame-context.mjs`。两端声明规范化字节一致；没有生产导入、生成 schema、capability、权限、workflow 执行或修复接入。扩展的两个文件随目录复制进入构建资源，但没有加载它们的生产入口；主机 helper 不在 npm files 白名单中。不能把这些文件或基础探针当作 B01 frame 支持。

初期 `weworker-frame-identity-0L9shG` 的真实探针验证选定叶节点读取、歧义拒绝、无关 frame 替换保持、所选同 URL frame 替换拒绝；该报告只保存 rows，checks 属性未被数组 JSON 序列化，不能宣称报告包含检查细节。后续仓库探针 `1jewHF` 挂起，由核实 PID/PPID 和独立 profile 后只停止本任务 Chromium，Node 随 finally 退出。加宿主 45 秒截止、失败报告和阶段标记后的 `LufBqx/report.json` 明确 `passed:false`，停在 `resolve after selected replacement`；正常关闭自身浏览器和 loopback 服务。换用 tabs.reload 并未解决该阶段，父文档替换/取消新增断言尚未到达。

resolver 的 30 秒 active 检查尚未约束每个正在等待的 sendCommand/executeScript，不能把它当作可靠总超时。恢复后先定位替换后的上下文解析/释放挂起，并对等待与清理建立有界保证，再接入声明、读取、动作、导航、循环、权限、修复与隔离实机验收。本次依用户要求在跨源阶段收尾后暂停，不继续 frame 集成。
