# 独立 HTTP Adapter 与探索策略

2026-10-17：新增 v2 包运行时 `http`，契约版本 `http.version=1`。它由 WebCLI 的 Node Worker 执行，与 Extension、Toolkit 各自的 Runner 分开。旧宿主会在包校验阶段拒绝未知 runtime；升级宿主后再安装此类包。无需 Python、桌面客户端或模型 Key。

`PUBLIC_API` 的普通调用在 CLI 进程直接执行，不启动 Bridge、不选择浏览器。`COOKIE_API` 经 Bridge 固定选定 profile，只读取明确声明的 Cookie，HTTP 请求仍由宿主发送；缺失、歧义、离线和断线均不回退。多连接使用 `--profile`，选择规则与 browser 命令一致。

```json
{
  "schema_version": 2,
  "name": "example-api",
  "version": "1.0.0",
  "description": "Read public example items",
  "commands": [{
    "id": "list",
    "runtime": "http",
    "module": "http/commands/list.js",
    "description": "Read example items",
    "safety": "read",
    "schema": {"type": "object", "properties": {"query": {"type": "string"}}},
    "http": {"version": 1, "strategy": "PUBLIC_API", "origins": ["https://example.com"]}
  }]
}
```

命令为 CommonJS 函数模块，返回有限 JSON 数据。相对 `require` 仅加载同包 `http/internal/*.js`，包括子目录；没有 Node 模块、环境变量、磁盘、原生 fetch 或浏览器对象。URL/URLSearchParams 提供生成器使用的 URL、查询参数操作。Worker 与 realm 隔离用于约束执行和终止失控代码，不把 Node VM 声称为可执行任意恶意软件的操作系统安全沙箱；安装仍需审阅来源、代码和权限。

```js
module.exports = async (args, api) => {
  const url = new URL('https://example.com/api/items');
  url.searchParams.set('query', args.query);
  const result = await api.request({url: url.href});
  return {items: result.items};
};
```

`api.request` 支持 `url`、`method`、`headers`、`json` 或字符串 `body`、`response: "json" | "text"`。默认 GET/JSON；HEAD 和 204 返回 null。参数原样交给作者代码，不按 Schema 自动转型。只读命令可使用 GET/HEAD/POST；其他方法要求 write。POST 的只读语义由来源、作者计划和测试证明，不能仅按 HTTP 方法推断。写命令沿用统一确认门，但探索生成流程当前仍限只读。

每次调用默认 30 秒、50 次请求，单个请求体/响应体 4 MiB。精确 origin 授权，禁止 URL 用户凭据、片段和命令自行提供 Cookie/Authorization/传输控制头。仅跟随已声明 origin 内最多五跳标准 HTTP 重定向，每跳重新按 URL 获取凭据；301/302 POST 和 303 按标准转换 GET，307/308 保留方法和请求体。不重试失败请求。HTTP 错误返回结构化代码，不包含原始响应正文或请求地址。普通命令可以按业务需要处理这些错误。

Cookie 策略示例（只声明名称，不保存值）：

```json
{
  "version": 1,
  "strategy": "COOKIE_API",
  "origins": ["https://example.com"],
  "cookies": {
    "origin": "https://example.com",
    "names": ["example_session", "example_csrf"],
    "csrf": {"cookie": "example_csrf", "header": "x-csrf-token", "decode": true}
  }
}
```

扩展按每个请求的准确 URL 读取 Cookie，遵守浏览器的域、路径、Secure 和过期匹配；包含 HttpOnly。使用所选 profile 的默认 Cookie store，不合并隐身 store，也不猜分区 Cookie 的 top-level site。每个声明名称必须唯一且非空。Cookie 只注入其声明 origin；CSRF 可 URL 解码后映射至 X- 请求头。值仅在调用内存中保留，不进入 Worker、任务证据或日志；结果中偶然回显的原始/解码值会脱敏。origin、Cookie 名称、CSRF 映射变化都会成为安装权限变化。

探索计划可使用 `PUBLIC_API` 或 `COOKIE_API`，继续绑定真实观察的 `sourceApiIndexes`，必须说明 `readReason` 和 `strategyNote`。Cookie 计划另提供上述 `cookies`。生成后通过 `draft-read/write/add` 编辑 `http/commands`、`http/internal`，每个 HTTP 命令必须有作者 cases；使用同一严格断言实现逐个验证最终输出，任何失败都阻止 review/install。默认返回 API JSON，作者负责业务字段映射。安装后的只读命令支持局部 repair，保留运行时、origins、Cookie 契约、共享文件和其他命令。

当前探索证据采集及任务仍绑定浏览器；安装后的 PUBLIC_API 调用不依赖浏览器。无需页面的公开接口发现、环境凭据/Bearer/HMAC/站点签名、分区 Cookie、写命令生成与验证仍待实现。现有 PAGE_FETCH、INTERCEPT、DOM_STATE、UI_SELECTOR 按各自执行路径工作，不自动降级或替换来源。
