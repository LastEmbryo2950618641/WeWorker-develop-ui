# HTTP 写命令与副作用验证

2026-10-18：独立探索新增 HTTP 写命令闭环。PUBLIC_API/AUTH_API 可在 `mode=http` 中无浏览器运行；COOKIE_API 沿用所选浏览器 profile 的凭据通道。Extension 页面写操作与多步写流程尚未接入本闭环，Python 网站探索agent不参与。

## 来源与生成

可选择已成功观察、风险明确为 write 的 POST/PUT/PATCH/DELETE 接口；也可用 `exploration.declare-write` 明确声明任务 origin 范围内的写接口。声明不会执行网络请求，保存 `declared:true`、`status:null`、`observation.executed:false`，不能作为成功执行证据。OpenAPI discover 不自动执行或转换写端点。

```json
{"taskId":"example-task","url":"https://example.com/items/example","method":"PUT","bodyKeys":["title"],"reason":"明确的公开测试条目更新接口"}
```

用 evidence 的原始索引提交 generate 计划：

```json
{"tools":[{"name":"update_item","risk":"write","sourceApiKind":"action","sourceApiIndexes":[0],"strategy":"PUBLIC_API","writeReason":"更新公开测试条目的标题","strategyNote":{"reason":"明确的 HTTP 更新接口","limitations":"一次请求并以独立 GET 回查"}}]}
```

生成器只提供带确认保护的骨架。Agent 必须编辑模块与 schema，保留 `safety:write`、`x-webcli-requires-confirmation:true`，完成语义实现后设置 `x-webcli-agent-authored:true`。原始捕获值不能作为参数默认值。模块确认前返回 `{blocked:true,requiresConfirmation:true}`，确认后才调用 `api.request`，明确解释成功与失败结果。

```js
module.exports = async (args, api) => {
  if (args.__confirmed !== true) return {blocked: true, requiresConfirmation: true};
  try {
    return await api.request({url: 'https://example.com/items/example', method: 'PUT', json: {title: args.title}});
  } catch (error) {
    return {ok: false, errorCode: error.code};
  }
};
```

## 作者 fixture

通过 `write-verification-read` 读取当前 hash，再用 `write-verification-write` 的 `tool`、`fixture`、`expectedHash` 更新。fixture 独立于安装包，只有作者提供的公开测试数据；实际响应正文和鉴权值不会保存。

```json
{
  "id": "example-first",
  "representativeArgs": {"title": "After"},
  "expectedRequest": {"url": "https://example.com/items/example", "method": "PUT", "body": {"title": "After"}},
  "successResponse": {"status": 200, "body": {"ok": true, "title": "After"}},
  "successExpectation": {"ok": true, "title": "After"},
  "failureResponse": {"status": 409, "body": {}},
  "failureExpectation": {"ok": false, "errorCode": "HTTP_STATUS"},
  "effect": {
    "readback": {"url": "https://example.com/items/example"},
    "before": {"equals": {"title": "Before"}},
    "after": {"equals": {"title": "After"}}
  }
}
```

每个写工具当前只有一个 fixture；参数不接受 `__confirmed`。request 与声明/观察的方法及结构 URL 必须一致，body 为 JSON 结构或精确字符串，headers 仅允许显式 content-type；凭据由 HTTP 契约提供。回查只接受同一 HTTP origins 契约内的明确 GET URL，不跟随重定向，经过读取语义检查。before/after 使用现有严格输出断言，必须在同一非通配标量路径声明不同的 equals 值。该断言证明所检查字段的变化，不保证服务端事务性，也不能排除其他客户端同时更新。

## 验证、执行与安装

1. 普通 `validate` 做静态检查、写命令 mock 与真实只读命令验证。mock 在 HTTP Worker 内运行作者代码，替换全部传输；没有宿主鉴权和网络回退。检查省略/false 确认均为零请求，以及确认后的请求、成功/失败解释。骨架或 mock 失败不能进入真实写审阅。
2. 通过后返回 `write_review_ready`。`write-review` 返回完整 fixture、HTTP 鉴权声明、package/cases/fixtures 的综合摘要和 reviewId，不发送请求。
3. 在用户已有授权覆盖实际目标及测试副作用时，调用 `write-verify`，传精确 `tool`、`reviewId`、`confirmed:true`；没有覆盖时应展示这份具体审阅后取得同意。安装授权不自动等于远端测试写入授权。
4. 验证整体最多 30 秒：独立 GET 检查 before，通过后才执行一次精确写请求，再独立 GET 检查 after。预检失败不发送写请求，且消耗当前 reviewId；派发前先持久化 `dispatching`，存储失败不发请求。每任务最多 100 个消耗的审阅。
5. 同一 reviewId 重复调用、并发重入、取消、Bridge 重启或 CLI 丢失响应都只返回已有记录，不重放。取消不能撤回已经派发的请求；此时结果可能是 `uncertain`。`write-readback` 在任务结束/取消/中断后仍可重查 GET，只报告当前 after 是否满足，不将失败的命令自动标为验证通过。
6. 请求不匹配、额外请求、网络/状态错误、未等待请求完成就返回、响应断言失败或回查失败均不能通过；作者代码吞掉请求错误也不能绕过。全部当前写命令通过真实效果验证、全部读命令通过后，才进入 `review_ready`，复用安装审阅与 consent。安装时 mock 会再次运行，不会再次实际写入。

HTTP write 每次普通调用也强制 `__confirmed:true`、最多一个请求、不跟随任何重定向、不自动重试；宿主不能被 `requires_confirmation:false` 放宽。普通 call 是每次新的显式调用，没有探索任务的 reviewId 去重账本，调用方遇到超时必须先检查效果，不能盲目重试。只读 HTTP 保留最多 50 请求和五跳重定向。返回前有尚未结束的请求会明确失败。

## 当前限制与证据

本阶段不支持 Extension/UI 写工具生成、批量/多步写工作流、依赖写响应新 ID 的动态回查、自动回滚、服务端幂等键协商、写工具局部 repair。单次 fixture 不能证明任意输入和任意站点的正确性。Cookie 写通道复用已有 profile/鉴权契约，但本阶段真实副作用验收使用独立 PUBLIC/AUTH loopback 服务，未对真实账户发写请求。

自动化见 `webcli/__tests__/exploration-write.test.js` 与 HTTP Runner 测试；真实 CLI/Bridge 验收见 `webcli/scripts/verify-exploration-http.mjs`（支持 `--bundled`），其中 write-acceptance 使用独立本地服务验证实际状态、响应丢失、无效果、重定向、取消和进程重启。具体本次结果见交接文档与 ROADMAP。
