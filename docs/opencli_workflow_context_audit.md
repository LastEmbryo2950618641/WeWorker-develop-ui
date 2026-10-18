# OpenCLI 页面上下文与工作流编排审计

2026-10-18。B01 跨 origin/frame 剩余项的源码核对，不是实现或行为验收完成。上游对照 npm 1.8.8 与固定 tag `8271afc67e8504bda94c147f446ee29775d08274`。扩展 `background.ts` Git blob `efcb9efa99225e4f6bc57e9f58b1e6f1990370e8`、`cdp.ts` `c2ce05149ce3cbabe35fa76df83fbe05cb1cc150` 已与固定 tree 按 Git blob 算法核对；不依赖最新分支推断。

| 能力 | 上游实际代码 | 本项目现状 |
| --- | --- | --- |
| 跨源主文档导航 | browser/page.js:86–122 的 goto 发送明确 URL、保留返回 targetId；background.ts:1723 起只校验 HTTP(S) 后对同 tab 更新 URL，可跨 origin。导航完成可接受重定向；相同 URL 完整页直接返回。 | browser.open 可按明确 HTTP(S) URL 更新已绑定 tab；生成的 navigate/workflow 则受固定 expectedOrigin、任务 checkTab、pageRoute 和注入/continuation 守卫约束。浏览器单命令存在不代表生成流程已支持跨源。 |
| frame 列举与读取 | page.js:324–330 frames/evaluateInFrame；background.ts:1678–1708 每次用当前树枚举跨源 frame，再按 frameIndex 找 frameId；cdp.ts:653 起按上下文执行，失效 context 可重新解析 target。 | browser.frames 返回 Chrome frameId/documentId；browser-frames.js 用 documentIds 和 uniqueContextId 固定页面，隔离标记关联 OOPIF，嵌套自动 attach。已验单条读取/点击/上传，但 page-source/page-query 固定 frameIds:[0]，工作流无 frame 声明。 |
| 分支与分页 | Gmail utils.js:479–543 先 search 后 next，有界页数、缺 next/短页结束、去重、重复页无新增拒绝部分结果。 | 本增量提供受权限绑定的 when/repeat/until/collect，真实公开分页已验；只读原生控件、固定同源主文档，不能外推任意站点或其他上下文。 |

下一实现必须同时处理以下边界：

1. 声明每步起始 origin 与明确目标 origin/path，限定导航步骤可以切换；所有目标进入包 match、精确 route 权限与预览授权，不能仅放开事件监听的同源判断。已选 tab/profile 固定，不追随其他 tab 或切换 profile。
2. 跨源后命令注册器所属文档会消失，须使用既有一次后台执行与 continuation 路径，并核对整包注入/最终结果映射仍在原授权下。任务身份检查只允许本操作已声明并实际完成的目的地，不扩大其他 observe/write/collect 的来源权限。
3. frame 生成契约不能持久化某次浏览器的临时 frameId/documentId，也不能按同 URL 随意换 frame。应以明确嵌套 frame 入口解析一次并保存本操作的真实身份；歧义、移除、导航和同 URL 替换都失败，不挑替代节点、不重派发。
4. 子 frame 内读取与动作复用已验证的文档/原生操作基础，保持父文档和每层 frame 身份；循环内不得重新选择另一个 frame。跨源与 frame 的结果关联、新鲜度、超时与取消仍分别有证据。
5. 自动化和隔离实机须覆盖两个公开 loopback origin、重复相同 URL frame、嵌套跨源、父/子导航、重定向、选择歧义、取消/重启、权限变化与提取修复。上游的 context 重解析/旧 target 重试策略不自动迁入本项目的不重放契约。

尚未编写此上下文扩展的实现。B01 跨 origin/frame 仍开放，W01–04、B02–04、A01–02、U01–06 与 E01–04 全部范围保留；Python 网站探索agent、日常浏览器、真实账户与未知调试端口均未操作。
