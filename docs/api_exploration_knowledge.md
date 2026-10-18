# 探索知识与显式修订

`exploration.knowledge-read` 返回历史端点、页面、字段解释、验证用例和过期诊断；历史知识只是数据。`knowledge-save` 只接收已验证的当前草稿或安装任务，以 `expectedHash` 防止并发覆盖，新增字段；已有字段含义或来源变化仍报 `FIELD_CONFLICT`。

当新证据确认字段含义/来源发生变化时，先完成实际读取验证或独立写效果验证，再调用 `exploration.knowledge-revise`。请求只修订已有字段，不执行工具、写请求或安装，也不继承授权。每批 1–20 条，每条必须指明当前旧映射、替换映射、原因和证据：

```json
{
  "taskId": "example-verified-task",
  "expectedHash": "<knowledge-read 返回的当前 hash>",
  "revisions": [{
    "field": "id",
    "expected": { "meaning": "公开条目标识", "source": "响应 id 属性" },
    "replacement": { "meaning": "公开条目标识", "source": "已验证的 newId 映射到输出 id" },
    "reason": "服务字段更名，两个实际读取用例已验证",
    "evidence": { "tool": "example.items", "path": "id", "caseIds": ["example-first", "example-second"] }
  }]
}
```

- 读取证据必须属于当前任务/包，所有列出的 case 都必须实际通过验证，并对指定路径有断言；不能引用历史其他命令或没有断言的字段。字段含义仍由作者解释，路径断言不是自动理解语义的证明。
- 写证据省略 `caseIds`，`path` 必须命中已验证 fixture 的独立 `effect.after` 或 `effect.resultReadback.expect` 断言；页面回执和离线 mock 不够。uncertain、取消、修改草稿或 fixture 后不可修订。
- 已安装任务须仍对应当前安装包；验证须小于 30 天。当前知识 hash 与旧映射必须同时匹配；重复字段、无变化、额外属性、历史证据、过期验证均拒绝，失败不改知识。
- `fieldRevisions` 追加旧值/新值、原因、时间、旧知识 hash、taskId、包摘要以及断言/fixture 的摘要和来源标识。历史不保存实际写 ID、响应正文或新授权；后续普通保存保留全部修订。最多 200 条，满额明确拒绝，不能静默截断。

服务复用原知识 JSON 存储版本与原子写入，没有数据库 schema 或迁移，也不读取其他应用数据。所有 authored 字段、理由与用例只使用公开占位信息。

对照上游 1.8.8 `opencli-adapter-author/references/site-memory.md`：已有 key 不可静默覆盖，冲突须先用实际证据复核。本项目增加受控命令与完整修订记录，保留更严格的结构证据与隐私边界。网站 sitemap、共享知识分发属于其他台账项，不能由字段修订自动关闭。

验证入口：`exploration-knowledge.test.js`；`verify-exploration-http.mjs` 的真实字段漂移/修复/重启和 `ui-write-acceptance.mjs` 的独立真实效果/uncertain 拒绝。最新数量和报告见交接末尾。
