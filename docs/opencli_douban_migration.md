# OpenCLI douban 迁移记录

来源：[jackwener/OpenCLI](https://github.com/jackwener/OpenCLI/tree/24136945847afbfad266c6c46a8cd335377f9112/clis/douban)，固定 SHA `24136945847afbfad266c6c46a8cd335377f9112`，Apache-2.0，Copyright 2025 jackwener。

公开包：`adapters/douban.com` v0.1.2；来源 11 命令，本地 11 命令已接入既有 v2 Runner。**接入不等于逐项真实验收完成。** 只在公开 Profile 注册，内部仓库不包含本包。

## 数据与业务指导

电影/图书/音乐页面 DOM/SSR + 同源分页。维护知识见 [guidance](../adapters/douban.com/guidance.md)，与 manifest 确定性生成当前 Skill。已审阅来源源码及 docs/adapters/browser/douban.md；文档过时时以固定源码为准。参数解析在包内，不修改 WebCLI 全局类型转换。

完整机器可读清单见 [inventory](opencli_batch_inventory.json)，包含源文件、策略、import 依赖、参数类型/默认值/说明、读写及登录入口。迁移后不依赖 OpenCLI 运行时。

## 逐项迁移清单

### whoami

Verify current identity

- 性质：read；只读。
- 来源：clis/douban/auth.js；来源注册的认证/页面流程。
- 登录：https://accounts.douban.com/passport/login。
- 状态：已接入；测试覆盖和真实证据见下文，其余真实路径待验收。

参数（来源定义；当前 CLI 使用 --key=value）：

无业务参数。

### login

Open official login; manual interaction

- 性质：write；保留宿主确认；本轮不执行真实写操作。
- 来源：clis/douban/auth.js；来源注册的认证/页面流程。
- 登录：https://accounts.douban.com/passport/login。
- 状态：已接入；测试覆盖和真实证据见下文，其余真实路径待验收。

参数（来源定义；当前 CLI 使用 --key=value）：

- `timeout`：int，默认 300。

### book-hot

豆瓣图书热门榜单

- 性质：read；只读。
- 来源：clis/douban/book-hot.js；Strategy.COOKIE。
- 登录：复用站点浏览器会话；实际要求取决于接口/页面和账号权限。
- 状态：已接入；测试覆盖和真实证据见下文，其余真实路径待验收。

参数（来源定义；当前 CLI 使用 --key=value）：

- `limit`：int，默认 20。返回的图书数量

### download

下载电影海报/剧照图片

- 性质：read；只读。
- 来源：clis/douban/download.js；Strategy.COOKIE。
- 登录：复用站点浏览器会话；实际要求取决于接口/页面和账号权限。
- 状态：已实现本地文件导出，支持原参数；真实证据及图片Bridge重启要求见批次记录。

参数（来源定义；当前 CLI 使用 --key=value）：

- `id`：string，必填。电影 subject ID
- `type`：string，默认 "Rb"。豆瓣 photos 的 type 参数，默认 Rb（海报）
- `limit`：int，默认 120。最多下载多少张图片
- `photo-id`：string。只下载指定 photo_id 的图片
- `output`：string，默认 "./douban-downloads"。输出目录

### marks

导出个人观影标记

- 性质：read；只读。
- 来源：clis/douban/marks.js；Strategy.COOKIE。
- 登录：复用站点浏览器会话；实际要求取决于接口/页面和账号权限。
- 状态：已接入；测试覆盖和真实证据见下文，其余真实路径待验收。

参数（来源定义；当前 CLI 使用 --key=value）：

- `status`：string，默认 "collect"，枚举 ["collect","wish","do","all"]。标记类型: collect(看过), wish(想看), do(在看), all(全部)
- `limit`：int，默认 50。导出数量， 0 表示全部
- `uid`：string。用户ID，不填则使用当前登录账号

### movie-hot

豆瓣电影热门榜单

- 性质：read；只读。
- 来源：clis/douban/movie-hot.js；Strategy.COOKIE。
- 登录：复用站点浏览器会话；实际要求取决于接口/页面和账号权限。
- 状态：已接入；测试覆盖和真实证据见下文，其余真实路径待验收。

参数（来源定义；当前 CLI 使用 --key=value）：

- `limit`：int，默认 20。返回的电影数量

### photos

获取电影海报/剧照图片列表

- 性质：read；只读。
- 来源：clis/douban/photos.js；Strategy.COOKIE。
- 登录：复用站点浏览器会话；实际要求取决于接口/页面和账号权限。
- 状态：已接入；测试覆盖和真实证据见下文，其余真实路径待验收。

参数（来源定义；当前 CLI 使用 --key=value）：

- `id`：string，必填。电影 subject ID
- `type`：string，默认 "Rb"。豆瓣 photos 的 type 参数，默认 Rb（海报）
- `limit`：int，默认 120。最多返回多少张图片

### reviews

导出个人影评

- 性质：read；只读。
- 来源：clis/douban/reviews.js；Strategy.COOKIE。
- 登录：复用站点浏览器会话；实际要求取决于接口/页面和账号权限。
- 状态：已接入；测试覆盖和真实证据见下文，其余真实路径待验收。

参数（来源定义；当前 CLI 使用 --key=value）：

- `limit`：int，默认 20。导出数量
- `uid`：string。用户ID，不填则使用当前登录账号
- `full`：bool，默认 false。获取完整影评内容

### search

搜索豆瓣电影、图书或音乐

- 性质：read；只读。
- 来源：clis/douban/search.js；Strategy.COOKIE。
- 登录：复用站点浏览器会话；实际要求取决于接口/页面和账号权限。
- 状态：已接入；测试覆盖和真实证据见下文，其余真实路径待验收。

参数（来源定义；当前 CLI 使用 --key=value）：

- `type`：string，默认 "movie"，枚举 ["movie","book","music"]。搜索类型（movie=电影, book=图书, music=音乐）
- `keyword`：string，必填。搜索关键词
- `limit`：int，默认 20。返回结果数量

### subject

获取豆瓣条目详情

- 性质：read；只读。
- 来源：clis/douban/subject.js；Strategy.COOKIE。
- 登录：复用站点浏览器会话；实际要求取决于接口/页面和账号权限。
- 状态：已接入；测试覆盖和真实证据见下文，其余真实路径待验收。

参数（来源定义；当前 CLI 使用 --key=value）：

- `id`：string，必填。豆瓣条目 ID
- `type`：string，默认 "movie"，枚举 ["movie","book"]。条目类型（movie=电影, book=图书）

### top250

豆瓣电影 Top250

- 性质：read；只读。
- 来源：clis/douban/top250.js；Strategy.COOKIE。
- 登录：复用站点浏览器会话；实际要求取决于接口/页面和账号权限。
- 状态：已接入；测试覆盖和真实证据见下文，其余真实路径待验收。

参数（来源定义；当前 CLI 使用 --key=value）：

- `limit`：int，默认 250。返回结果数量

## 真实验证证据

实际链路为 CLI → Bridge → 已连接扩展；不含桌面自然语言入口。

- top250：通过，前三部名称/ID/评分真实返回。trace：`874463744c81`。
- subject：未通过：宿主导航域名拦截，实际跳转未知。trace：`98b9614984c9`。

包加载、确认门、参数和部分解析边界采用 fixture 测试，不能当站点验收。登录、账号数据、自然语言和所有写入未验收。详见 [批次验收步骤](opencli_batch_migration.md)。

登录后新增验证见 [第二轮记录](opencli_batch_migration.md#登录后第二轮证据2026-09-28)。源码版本0.1.1新增download，不再仅返回链接。

重启后文件下载样本通过，见 [批次记录](opencli_batch_migration.md)：单张WebP图片，trace `6bd96b41defc`；默认Rb页面实际标题为剧照，不算海报分类通过。

## 2026-10-19 发布回归 D13 / D14

D13：迁移后的搜索实现把分类函数 `toString()` 的结果当函数调用，遇到可解析条目时触发 TypeError。0.1.2 改为直接传递函数引用，保持电影/剧集、图书、音乐分类、数量限制和去重语义；不使用 eval。

D14：当前包已显式声明 movie/book/search/www 页面主机，正常导航白名单检查通过。验证码或登录重定向不属于可自动续执行的业务页，不能通过通配域名放开。测试机失败命令、完整错误、trace 和最终 URL 尚待提供，豆瓣导航问题未定位关闭；历史 subject 导航失败也不视为已验收。

本轮自动化覆盖搜索真实注册入口和域名边界，不代表真实浏览器、登录或验证码路径已通过。

后续仅收到电影详情目标 URL。已用源码和实际打包 manifest 验证该目标通过宿主导航校验，并新增公开占位条目的首页→详情导航→解析集成回归；相关 2 文件/126 项通过。内置浏览器直接访问被客户端阻止（ERR_BLOCKED_BY_CLIENT），不是 Adapter 导航失败的复现，也不能用于判断测试机是否发生登录/验证重定向。仍需在测试机新包中复测 `webcli call douban.com.subject --id=<条目ID> --type=movie` 并留存完整错误；当前不扩大白名单。

## 2026-10-19 后续实机复验与安全跳转诊断

测试新证据确认其中一次详情调用及新建首页均跳转到 `sec.douban.com`，其导航拒绝不属于电影业务域遗漏。不能追溯推断早先全部失败具有相同原因。

维护端使用已登录 Chrome、当前开发 Bridge 与本地 CLI（豆瓣 0.1.2）完成详情、电影搜索、热门榜单三次真实只读调用，均返回业务结果。全局 npm CLI 使用旧包 0.1.1，首轮被快照一致性保护拒绝；改用与 Bridge 一致的本地 CLI 后通过，未绕过快照校验。没有保存账号、Cookie、真实返回内容或会话日志。

宿主拒绝消息新增实际/目标页面 origin 和人工处理后重试指引，不输出路径、query 或 fragment；协议/URL 凭据拒绝仍使用固定错误。首次页面验证和导航后验证共用原校验，不扩大白名单、不注入验证页、不自动重放。新增回归验证首次/续执行拦截后零额外业务执行、敏感 URL 部分不外泄，以及回到业务页后重试恢复。维护端本次未触发豆瓣安全验证，新提示在此分支自动化验证，仍需重载新扩展后由测试机验证真实安全跳转提示。
