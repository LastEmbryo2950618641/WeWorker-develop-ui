# 独立 HTTP Adapter 与探索策略

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

当前探索证据采集及任务仍绑定浏览器；安装后的 PUBLIC_API/AUTH_API 调用不依赖浏览器。无需页面的接口发现、站点专有签名/OAuth、写命令生成与验证仍待实现。现有 PAGE_FETCH、INTERCEPT、DOM_STATE、UI_SELECTOR 按各自执行路径工作，不自动降级或替换来源。
