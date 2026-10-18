# 独立 HTTP Adapter 与探索策略

2026-10-18 边界补充：只读页面 navigate 的 `queryParameters` / `hashNavigation` 与 workflow 的有界 `when/repeat/collect` 属于 Extension 页面读取契约（见开发设计），不改变 HTTP 鉴权/请求权限、PAGE_FETCH/UI 写 URL 或 effect.resultReadback 限制，不赋予业务写授权。

2026-10-17：v2 包运行时 `http` 支持契约版本 `http.version=1|2`。version 2 增加宿主环境鉴权与 Cookie store/分区；兼容 version 1，旧宿主明确拒绝 version 2。它由 WebCLI 的 Node Worker 执行，与 Extension、Toolkit 各自的 Runner 分开。无需 Python、桌面客户端或模型 Key。

`PUBLIC_API`、`AUTH_API` 的普通调用在 CLI 进程直接执行，不启动 Bridge、不选择浏览器。AUTH_API 使用明确声明的宿主环境凭据。`COOKIE_API` 经 Bridge 固定选定 profile，只读取明确声明的 Cookie，HTTP 请求仍由宿主发送；缺失、歧义、离线和断线均不回退。多连接使用 `--profile`，选择规则与 browser 命令一致。

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

`api.request` 支持 `url`、`method`、`headers`、`json` 或字符串 `body`、`response: "json" | "text"`。默认 GET/JSON；HEAD 和 204 返回 null。参数原样交给作者代码，不按 Schema 自动转型。只读命令可使用 GET/HEAD/POST；其他方法要求 write。POST 的只读语义由来源、作者计划和测试证明，不能仅按 HTTP 方法推断。独立探索现已支持显式 HTTP 写计划、mock、精确执行审阅与真实效果回查，见 [写命令契约](api_exploration_write.md)。

每次调用默认 30 秒；读命令最多 50 请求，write 最多一个请求且拒绝所有重定向，单个请求体/响应体 4 MiB。精确 origin 授权，禁止 URL 用户凭据、片段和命令自行提供 Cookie/Authorization/传输控制头。读命令仅跟随已声明 origin 内最多五跳标准 HTTP 重定向，每跳重新按 URL 获取凭据；301/302 POST 和 303 按标准转换 GET，307/308 保留方法和请求体。不重试失败请求，不能在请求尚未结束时返回成功。HTTP 错误返回结构化代码，不包含原始响应正文或请求地址。普通命令可以按业务需要处理这些错误。

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

扩展按每个请求的准确 URL 读取 Cookie，遵守浏览器的域、路径、Secure 和过期匹配；包含 HttpOnly。version 1 使用所选 profile 的默认 store、非分区 Cookie。version 2 可显式声明 `storeId` 和 `partitionKey`，不合并 store、不猜分区；未声明时仍取默认 store 和非分区 Cookie。每个声明名称必须唯一且非空。Cookie 只注入其声明 origin；CSRF 可 URL 解码后映射至 X- 请求头。值仅在调用内存中保留，不进入 Worker、任务证据或日志；结果中偶然回显的原始/解码值会脱敏。origin、Cookie 名称、CSRF 映射、store/分区变化都会成为安装权限变化。

```json
{
  "version": 2,
  "strategy": "COOKIE_API",
  "origins": ["https://example.com"],
  "cookies": {
    "origin": "https://example.com",
    "names": ["example_session"],
    "storeId": "0",
    "partitionKey": {"topLevelSite": "https://example.org", "hasCrossSiteAncestor": true}
  }
}
```

`partitionKey` 两个字段均必填；topLevelSite 应为浏览器实际的 schemeful site，不能用含路径的页面 URL。示例 storeId 不代表所有 profile 的默认值。扩展必须声明 `http_credentials_v2`，Bridge 在已固定连接上检查该能力；Chrome 返回的 store/分区身份也逐项复核。旧插件、浏览器不支持字段或读取失败均不退回默认 Cookie。隐身 store 是否可访问仍由扩展权限和 Chrome 决定，本轮未实测隐身窗口。

宿主鉴权仅声明环境变量名，值由实际执行 HTTP 的进程读取，不加载或改写 `.env`。普通 AUTH_API 用 CLI 环境；探索预览、COOKIE_API 及桌面 Bridge 调用用相应宿主环境，CLI 不向现有 Bridge 转发环境变量。启动前缺失/空值/非法值直接失败，零 HTTP 请求。Worker 无环境访问权，凭据、Basic 编码与 HMAC 签名回显在进入 Worker 前脱敏。

```json
{
  "version": 2,
  "strategy": "AUTH_API",
  "origins": ["https://example.com"],
  "auth": {"type": "bearer", "origin": "https://example.com", "env": "EXAMPLE_API_TOKEN"}
}
```

`auth` 可用类型：

| type | 字段 | 行为 |
| --- | --- | --- |
| bearer | env | `Authorization: Bearer <value>` |
| header | env、header | 指定非传输控制请求头，例 `x-api-key` |
| basic | usernameEnv、passwordEnv | UTF-8 用户名/密码的 Basic 编码，用户名不得含冒号 |
| hmac | env、header、algorithm、encoding、canonical、separator；可选 prefix、timestamp、nonce | 对最终请求签名，密钥按 UTF-8 读取 |

每个 auth 只授权一个已声明 origin；其他 origin 的请求及重定向不携带注入的认证头。COOKIE_API version 2 也可叠加 auth。命令不能覆盖认证、时间戳、nonce 或 CSRF 头。完整 auth 契约（包括环境名、目标、算法及签名格式）计入安装权限。

HMAC 示例：

```json
{
  "type": "hmac", "origin": "https://example.com", "env": "EXAMPLE_SIGNING_KEY",
  "header": "x-example-signature", "algorithm": "sha256", "encoding": "hex",
  "separator": "\n", "prefix": "Example ",
  "timestamp": {"header": "x-example-time", "unit": "seconds"},
  "nonce": {"header": "x-example-nonce"},
  "canonical": [
    {"field": "method"}, {"field": "origin"}, {"field": "pathQuery"},
    {"field": "bodySha256"}, {"field": "timestamp"}, {"field": "nonce"}
  ]
}
```

算法支持 sha256/sha512，编码支持 hex/base64。canonical 顺序连接这些字段、`{"header":"x-example-kind"}` 或 `{"literal":"example"}`，缺失签名头报错。pathQuery 为实际编码后的 pathname+search，不额外排序；bodySha256 是实际发送 UTF-8 正文的 SHA-256 hex，空正文同样哈希。时间戳可为 seconds/milliseconds，nonce 为宿主生成的 16 字节随机 hex。每一跳按最终方法/正文重新签名并生成时间戳/nonce，不复用重定向前签名。这是显式常见签名契约，不包含任意站点算法、AWS SigV4、OAuth 登录或自动刷新令牌。

探索计划可使用 `PUBLIC_API`、`COOKIE_API`、`AUTH_API`，继续绑定真实观察的单个 `sourceApiIndexes`，必须说明 `readReason` 和 `strategyNote`。计划另提供上述 `cookies`/`auth`，生成器自动选择所需契约版本。生成后通过 `draft-read/write/add` 编辑 `http/commands`、`http/internal`，每个 HTTP 命令必须有作者 cases；使用同一严格断言实现逐个验证最终输出，任何失败都阻止 review/install。默认返回 API JSON，作者负责业务字段映射。安装后的只读命令支持局部 repair，保留运行时、origins、鉴权契约、共享文件和其他命令。

## 无浏览器的 HTTP 探索

`exploration.start` 使用 `mode:"http"`、准确 `origin`、`goal` 和幂等 `requestId` 创建宿主任务，可选 `allowedOrigins` 与上述 `auth`。需要 WebCLI Bridge，不需要浏览器连接、插件或桌面客户端；start 不发网络请求，直接返回 evidence_ready。Cookie 探索仍使用浏览器任务。宿主任务只允许 PUBLIC_API/AUTH_API，鉴权值来自执行请求的 Bridge 环境，不从 CLI 转发。

```bash
webcli call exploration.start --args '{"mode":"http","origin":"https://example.com","goal":"读取公开条目","requestId":"example-http-task"}'
webcli call exploration.discover --args '{"taskId":"<start 返回的 http- ID>","url":"https://example.com/openapi.json","reason":"检查已知 API 文档"}'
webcli call exploration.request --args '{"taskId":"<同一任务 ID>","request":{"url":"https://example.com/api/items?limit=2"},"reason":"实际验证文档中的只读接口"}'
```

每次 discover/request 返回 collecting，使用 get/events 查看完成或失败。discover 只获取明确指定的 OpenAPI 3.0/3.1 或 Swagger 2.0 JSON：返回声明的方法、结构化 URL、路径参数段位、参数位置/类型、成功响应结构与认证声明，不执行端点、不扩大授权、不跟随外部引用。只展开本地 `$ref`，路径以前置 server/basePath 为准；不猜 server variables，不展开组合 schema，循环/未解析引用与截断均返回 warnings。最多返回 200 个操作、3000 个 schema 节点、8 层结构；不保留描述、示例或默认值。不支持 YAML、HTML 文档、自动爬取或任意 OpenAPI 版本。

文档声明不是执行证据，单独 discover 后 generate 会拒绝。request 接受同 `api.request` 的请求字段，但仅支持 JSON 响应、GET 或已识别读取语义的 JSON/form POST（包括 GraphQL query）。每次跳转前复核 origin、方法、路径和显式动作选择器；mutation、未解析 POST、凭据查询参数被拒绝。只读分类是保守启发式，调用 Agent 仍须依据目标接口契约判断业务语义。每操作最多 30 秒、4 MiB、五跳，每任务最多 100 次显式发现/请求（运行中重启也计数）；不自动重试。

实际响应只转换为结构证据，标记 `sourceKind:"host_http"`；不保存请求头、查询/正文标量值、响应标量值。URL 保留固定路径，数字 ID/UUID/邮箱式段按已有规则归一化；作者不要把凭据或私人数据放在路径、goal、reason、cases 或 notes 中。401/403 保留访问阻塞元数据，不持久化错误正文；无效 JSON 不成为成功证据。

随后显式 generate PUBLIC_API/AUTH_API 计划，绑定实际 candidates 索引，再走作者 cases → validate → review → 授权范围内 install → 普通 call → knowledge-save；宿主验证不检查标签页。草稿和已安装只读命令的 repair 复用现有验证器与安装权限审阅，保持运行时/鉴权/共享文件边界。

任务 ID 的 `http-` 前缀自动将后续命令路由到宿主存储，忽略浏览器 profile 的离线/多连接状态；显式错误 mode 会报错，不回退。没有 taskId 的 list、knowledge-read、repair-info、capabilities 使用 `mode=http`。任务、草稿、知识存于 `<Adapter workspace>/http-exploration/`，与各浏览器及 legacy 历史隔离；安装包仍由同一宿主管理。取消会中止请求并丢弃迟到结果；重启将进行中任务标记 interrupted，不重放，调用 Agent 需明确决定下一步。

站点专有签名/OAuth、UI 控件写流程和多步写效果验证仍待实现。Extension 固定同源 PAGE_FETCH 写已有独立声明式契约，明确要求服务端幂等保证，仍由 Extension 执行，不复用 HTTP Runner。HTTP 单请求写生成与验证见 [写命令契约](api_exploration_write.md)；默认 request/discover/validate 仍不会实际发送写请求。现有 PAGE_FETCH、INTERCEPT、DOM_STATE、UI_SELECTOR 按各自执行路径工作，不自动降级或替换来源。


HTTP 写命令也可定向 repair（2026-10-18）：保留完整 origins/auth/cookies/version/strategy 与权限、共享文件和其他命令，仅修改所选模块/schema/description。历史 fixture 只作待复验数据，不继承授权或执行 ID；新精确审阅、before/write/after 和安装验证必须重新完成。mode=http 仍不支持 Cookie 任务，浏览器任务固定 profile。见 [写命令契约](api_exploration_write.md)；PAGE_FETCH/UI 的新契约修复走独立 Extension 路径，详见该文顶部，不放宽本 HTTP 契约。显式 `sharedFiles` 可选择已有 http/internal 或 extension/internal 文本文件，要求全包命令进入新计划并重验；未选文件仍冻结，完整 HTTP 鉴权/权限不变。每个写命令都需要新精确审阅和真实效果，普通 validate 仍不写，详见设计文档的共享修复节。
