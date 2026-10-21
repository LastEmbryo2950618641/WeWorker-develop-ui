# OpenCLI 携程迁移与验收记录

## 来源与许可

来源固定为 `jackwener/OpenCLI` 提交 `8271afc67e8504bda94c147f446ee29775d08274` 的 `clis/ctrip/`；本批只处理携程，不代表整个 `clis/` 已迁移。来源仓库根 `LICENSE` 与 `package.json` 均标示 Apache-2.0；携程源码没有额外文件级许可证声明，也没有引用图片、原始捕获样本或其他第三方资源。

实现按 WeWorker v2 契约重新适配请求、页面生命周期和结果投影，没有复制 OpenCLI 运行依赖。来源归属及完整许可证保存在 `docs/third_party/OpenCLI-LICENSE.txt`，桌面包复制为 `licenses/OpenCLI-LICENSE.txt`。没有新增 npm 依赖，没有带入凭据、Cookie 值、本机路径、用户数据或真实网络响应。

## 当前架构（0.3.6）

16 个命令（15 read、1 write）：原来源 15 项及新增 destination-search。自然语言任务由 Agent 结合 manifest/help 与包内 guidance.md 拆解，宿主确定性派生 Skill，不由模型临时编写说明。

- 后台 API：search、hotel-suggest、destination-search；Cookie：whoami；终止导航：login；SSR：hotel-search、hotel；DOM：train、bus、ferry、attraction、cruise、tour、package；网络响应与验证码检查：flight、flight-round。
- 页面命令自动开页，并通过宿主导航续执行协议在一次调用内完成等待、重新注入和读取。同一 tab 全流程串行；最多 4 次导航，执行预算 105 秒；重定向校验声明域名，继续前核对包摘要；业务错误不自动重放，写操作仅可终止导航，不能导航后重放。
- 使用既有 Extension Runner，后台查询仍需连接扩展和 Bridge，但无需预先打开业务页面。未增加 Toolkit Runner 或改变同事负责的自动探索。
- destination-search 使用携程景点站公开联想接口，返回 destinationId 和独立的 hotelCityId。实测贵阳分别为 33/38，而景点站的 38 是香港；不能照搬来源说明，把酒店城市编号当景点目的地编号。search 保持酒店业务联想兼容，移除据此拼造的景点链接。
- guidance.md 维护任务拆分、实体消歧、日期、上下文指代、IATA 与城市 ID 区别、人数/筛选限制、价格口径和错误处理；命令定义保持唯一参数与安全契约。单程航班补充完整日期时间、中转标记及航段。

## 最新实际验证

2026-09-28，通过本地 WebCLI → 已连接扩展执行：

- destination-search 贵阳：返回 destinationId=33、hotelCityId=38，trace ba9c5543bf1c。
- attraction city=33：一次调用返回贵阳 4 个景点，包含贵州省博物馆、天河潭、花溪夜郎谷，trace 490ed3c5e485；limit=5 是上限，未承诺一定 5 条。
- hotel-search city=38，2026-10-16 至 17：一次调用返回 3 家贵阳酒店，trace 5d809853214e。
- hotel id=65822792：一次调用完成内部导航并返回详情，trace 596ea19ba215。
- flight BJS → KWE，2026-09-29：一次调用返回 3 条航班、完整日期时间及航段，trace 9af5eb32dab4。实测修复了接口已有数据却被旧 `.flight-item` DOM 就绪判断阻断的问题，改以捕获响应为准；保留验证码检查。
- search/hotel-suggest 数字 flag、whoami 本地登录标记此前已实际通过；用户反馈 train/bus 已通过，但当时仍需手工重试。其余页面命令尚无本轮真实验收证据。

这些是 CLI/扩展链路验证，不等于客户端聊天中的自然语言规划、全部携程产品、验证码、macOS 或安装包验收完成。未执行预订、购票或支付。

## 客户端自然语言验收反馈（2026-09-28）

用户已验证：缺出发地时询问、北京至贵阳航班查询、贵阳明天入住住两晚的日期推导、上一轮第二家酒店的 ID 引用及详情读取、房型条件无法确认时说明工具边界。尚不能将本轮整体标为通过：航班首轮捕获为空仍由模型重试，回答还出现未经字段支持的直飞、全天总数、每晚价格及房型价格推测。

0.3.1 补齐空捕获会话的导航续执行：关闭空会话后重新开始捕获，以宿主已有导航次数和总期限限制恢复，不重放写操作，不掩盖鉴权/畸形响应错误。测试覆盖空捕获到完整结果在一次宿主 execute 内完成。guidance 收紧 limit、经停证据、计价单位和房型推断规则。模型是否遵守新说明仍需新聊天复验。

## 往返航班修复（0.3.2）

用户原 trace 6b5564478659 显示旧 .flight-item 卡片等待 18 秒超时。实际页面 batchSearch 已返回两程及组合报价；0.3.2 改用该响应，校验 segmentNo、出发/到达城市或机场与两程日期，拒绝缺少返程或日期不符的结果。输出 priceScope=round_trip_one_adult，去返程分别展示实际机场、日期时间、经停次数及地点，不把组合价复制为每段价格。税费包含情况仍为未知。

实测 BJS→KWE，2026-09-29 去、2026-10-02 回、limit=3，一次调用成功（trace c7f48ec6a60e）。三组组合报价为 1200/1405/1450 元，仅记录查询时证据；NS8077/NS8078 的经停地点为陇南成县机场。携程与宿主聚焦 65 项通过；完整客户端需新聊天复验，不把之前的两个单程降级结果计为往返验收通过。

## 当前命令清单

| 来源命令 | 参数、输出与分页行为 | 分类 / 安全 | 本地处理结果与证据 | 真实环境剩余项 |
| --- | --- | --- | --- | --- |
| `search` | `query`、`limit=15`（1–50）；酒店业务城市/地标/车站联想，cityId 不能用于景点；首批截取，无游标 | 后台 API；read | 后台直连 POST、禁重定向、无凭据；mock 覆盖输入、响应和上游错误；公开查询一次返回 HTTP 200/15 条 | 最新客户端端到端复验 |
| `destination-search` | `query/limit`；景点目的地 `destinationId`、独立 `hotelCityId` 及地区 | 后台 API；read | 官方景点站联想接口，贵阳映射实测通过 | 更多同名地区与境外目的地抽查 |
| `hotel-suggest` | `query`、`limit=15`（1–50）；城市/商圈/酒店联想；首批截取 | 后台 API；read | 与 `search` 共用实现并保留 `searchType=H`；无需标签页；公开查询一次返回 HTTP 200/15 条 | 最新客户端端到端复验 |
| `whoami` | 无参数；仅返回 `logged_in/name/vip_grade` | 后台 Cookie；read | 已迁移；无需携程标签页，不返回 `login_uid` 或任何 Cookie 值；mock 验证脱敏 | 已登录账号只读复验 |
| `login` | 无业务参数；打开官方登录页 | 导航，非 DOM；write | 已迁移；确认门生效；未登录时导航，已登录时最小化返回 | 人工登录、验证码及随后 `whoami` 复验 |
| `hotel-search` | `city/checkin/checkout/limit=10`（1–30）；SSR 首屏通常约 13 条，无后续页 | SSR 页面状态，非 DOM；read | 已迁移；日期关系、列表映射和空结果有 fixture | 真实 `__NEXT_DATA__` 结构与首屏数量 |
| `hotel` | `id`；单酒店详情、评分、设施、政策和位置 | SSR 页面状态，非 DOM；read | 已迁移；详情状态和字段投影有 fixture | 真实详情页 SSR 结构 |
| `train` | `from/to/date/limit=20`（1–50）；滚动后截取 | DOM；read | 已迁移；深链接、验证码、滚动和卡片解析有 fixture | 真实选择器和懒加载 |
| `bus` | `from/to/date/limit=20`（1–50）；滚动后截取 | DOM；read | 已迁移；保留携程 `param` 深链接形状和字段解析 | 真实选择器和验证码 |
| `ferry` | `from/to/date/limit=20`（1–50）；滚动后截取 | DOM；read | 已迁移；船名、港口、时间、票价和状态有 fixture | 真实选择器和验证码 |
| `flight` | `from/to/date/limit=20`（1–50）；合并批次至上游 `finished=true`，再排序截取 | 网络响应 + DOM 就绪；read | 已迁移；32 MiB/20 条受限捕获、同域/声明域过滤、脱敏日志、截断/状态/JSON/恢复测试 | 真实 `batchSearch` 响应体大小、批次数和风控 |
| `flight-round` | `from/to/depart/return/limit`；返回 outbound/return 双程与 1 成人往返组合价 | 网络响应；read | 0.3.2 替换失效 DOM 卡片；校验两程路由/日期，实际一次返回 3 组报价 | 客户端自然语言复验、境外与跨日路线 |
| `attraction` | `city/limit=20`（1–50）；当前城市景点链接去重截取 | DOM；read | 已迁移；城市范围、评分和万级点评数有 fixture | 真实城市页和重定向行为 |
| `cruise` | `port/limit=20`（1–50）；先解析港口代码，可能两次导航 | DOM；read | 已迁移；港口索引、二次导航和线路卡片有 fixture | 真实港口索引及空结果文案 |
| `tour` | `destination/limit=20`（1–50）；当前列表截取，无游标 | DOM；read | 已迁移；标题、标签、评分、销量、点评和价格有 fixture | 真实列表选择器 |
| `package` | `destination/limit=20`（1–50）；自由行当前列表截取，无游标 | DOM；read | 已迁移；复用度假列表解析，保持独立命令和路由 | 真实列表选择器 |

聚焦回归：公开 WebCLI 7 文件 120 项通过；内部 WebCLI 6 文件 71 项通过；公开扩展路由/捕获 33 项、内部 32 项通过。两边 Profile prepare 通过。未运行全仓库全量测试。

## 整合、安全与历史验证（版本与数字按当时状态记录）

- 2026-09-28：修复携程 whoami 已登录误判：保留旧 login_uid 兼容，同时接受 cticket、DUID 与 IsNonUser=F 完整组合；游客标记和不完整组合拒绝，个人资料 Cookie 不能单独证明登录。继续使用受限 chrome.cookies 后台读取，无需标签页或 debugger，不返回会话凭据。包升级 0.2.2，携程聚焦 47 项、包校验和公开 prepare 通过；已连接扩展实际 whoami 返回 logged_in=true。该结果表示本地浏览器登录标记识别成功，不等于服务器会话有效性验证。

- 2026-09-28：修复携程数字参数拒绝 CLI 字符串的问题，包升级为 0.2.1。包内共用整数解析接受十进制数字字符串，拒绝小数、空值、布尔值、数组和不安全整数；联想 limit 与页面 limit/数字 ID 共用此逻辑，WebCLI 不新增类型转换。携程聚焦 39 项、包校验和公开 Profile prepare 通过。通过本地 CLI 与已连接扩展实际执行 search、hotel-suggest（limit=5），均成功返回 5 条；这不代表客户端聊天入口和其余页面命令已全部验收。

- 2026-09-24：用户实测发现 `search` 被要求先打开携程页面，而 `open_browser` 白名单只读旧 Extension 清单，未包含根 v2 包。现将 `search` 与 `hotel-suggest` 声明为后台 API 命令，通过受限 `backend_fetch` 调用固定 URL，禁浏览器回退及跨站重定向，查询和响应体不写入 trace；`whoami` 改为后台 Cookie 检查；`open_browser` 对仍需页面的命令同时读取有效 v2 包域名。WebCLI 相关 5 文件 69 项、扩展路由 17 项及包校验通过；两种联想查询经同一 Node 请求路径匿名只读实测各返回 HTTP 200/15 条。未在最新客户端与扩展中复验完整 `webcli call`，其余页面命令仍待真实站点验收。

- manifest 仅声明 10 个实际命令路由域名。`login` 是唯一 write 命令，继续使用 v2 确认门；其余 15 项均为 read。
- `network_capture_start/read` 复用现有 CDP 附着设施，只捕获匹配 pattern 且属于当前页或 manifest 许可域名的响应；最多保留 20 条、单体返回最多 32 MiB（Chrome 单响应缓存 32 MiB、总缓存 64 MiB），日志只记录元数据。helper 只释放自己建立的 debugger 附着，并在 detach/tab removal 时清理会话。
- v2 校验确认 `ctrip.com` 版本 `0.2.0`、15 个 Extension 命令，manifest、模块注册、路由域名和 safety 一致。
- Ctrip/mock 与包聚焦 61 项、WebCLI 全量 83 文件/597 项、Extension 加载器/运行时 16 项、Profile/打包 6 项全部通过。
- `prepare-build.cjs` 成功，公开 Profile 生成 8 个 host-managed 包；内建携程包为 `0.2.0`/15 命令，CLI 结构化帮助可见全部 15 个规范命令。
- 没有执行真实点赞、发帖、删除、预订、购买或支付。上述证据不等于真实携程、真实登录、验证码、完整安装包或 macOS 验收通过。`certify-api-adapters` 不用于本批 DOM/SSR/混合命令，也没有把两项联想 mock 写成 live API 认证。

## 需要人工参与

1. 在测试账号环境完成人工登录或验证码，然后调用 `webcli call ctrip.com.whoami`，确认只返回最小化字段。
2. 对尚未验证的只读查询使用公开测试参数逐项复验页面导航、真实选择器、输出和空结果；不进行下单、预订或支付。
3. 特别观察单程航班是否完整捕获多个 `batchSearch` 响应、是否触发 32 MiB 上限，以及验证码后的重试行为。
4. 后续再继续此前暂缓的真实 API 生成、Windows 最新修复包和 macOS 验收；本记录不把这些事项标为完成。

## 第一批历史记录

以下表格和数字是仅完成两个联想命令时的历史快照，其中“待迁移”状态已由上方当前清单取代。

| 来源文件 / 命令 | 参数与结果、分页 | 执行依赖 / 处理结果 | 证据或待办 |
| --- | --- | --- | --- |
| `search.js` / `search` | query、limit=15 (1–50)；目的地/景点/车站等联想行；首批截取，无分页游标 | **已迁移** `ctrip.com.search`；m.ctrip.com 页面同源 POST，read，无凭据 | `webcli/__tests__/ctrip-adapter.test.js` mock；真实站点待测 |
| `hotel-suggest.js` / `hotel-suggest` | query、limit=15 (1–50)；城市/商圈/酒店联想行；首批截取 | **已迁移** `ctrip.com.hotel-suggest`；同一 API，searchType=H | 同上；真实站点待测 |
| `auth.js` / `whoami` | 无参数；用户 ID、姓名、会员等级 | **待迁移**；Cookie login_uid/AHeadUserInfo + 个人信息页；属于敏感个人数据 | 需设计最小化输出和已登录页面/权限 mock，禁止记录 Cookie |
| `auth.js` / `login` | timeout；登录交互状态；来源 access=write | **待迁移**；浏览器导航及人工登录、轮询 Cookie；迁移时必须标记 write 并经确认门 | 需要人工交互，不在 mock 中宣称登录成功 |
| `attraction.js` / `attraction` | city 数字 ID、limit=20 (1–50)；景点/评分/点评/URL，渲染列表截取 | **待迁移**；you.ctrip.com 页面导航、等待验证码、DOM 提取 | 需页面生命周期与 DOM fixture |
| `bus.js` / `bus` | from、to、date、limit=20；汽车班次，滚动列表截取 | **待迁移**；bus.ctrip.com 深链接、验证码/DOM/滚动 | 需页面生命周期与 DOM fixture |
| `cruise.js` / `cruise` | port、limit=20；邮轮线路，列表截取 | **待迁移**；cruise.ctrip.com 端口查找、导航和 DOM | 需跨导航恢复及 DOM fixture |
| `ferry.js` / `ferry` | from、to、date、limit=20；船班，滚动列表截取 | **待迁移**；ship.ctrip.com 深链接、验证码/DOM/滚动 | 需页面生命周期与 DOM fixture |
| `flight-round.js` / `flight-round` | from、to IATA、depart、return、limit=20；往返航班，滚动列表截取 | **待迁移**；flights.ctrip.com 导航和 DOM | 需日期校验、双程输出/DOM fixture |
| `flight.js` / `flight` | from、to IATA、date、limit=20；单程航班，批量响应截取 | **待迁移**；INTERCEPT 策略/CDP 网络捕获，不可改成静态 DOM 占位 | 需受限网络捕获能力与脱敏 fixture，不记录真实响应 |
| `hotel-search.js` / `hotel-search` | city、checkin、checkout、limit=20；酒店/报价，SSR 首屏约 13 条 | **待迁移**；hotels.ctrip.com SSR 页面、日期校验；限制并非真实分页 | 需首屏边界与 DOM fixture |
| `hotel.js` / `hotel` | id；酒店详情/评分设施政策，单行 | **待迁移**；hotels.ctrip.com SSR 详情页 | 需页面/DOM fixture |
| `package.js` / `package` | destination、limit=20；机酒套餐列表截取 | **待迁移**；vacations.ctrip.com DOM | 需页面/DOM fixture |
| `tour.js` / `tour` | destination、limit=20；跟团线路列表截取 | **待迁移**；vacations.ctrip.com DOM | 需页面/DOM fixture |
| `train.js` / `train` | from、to、date、limit=20；列车班次列表截取 | **待迁移**；trains.ctrip.com 深链接和 DOM | 需页面/DOM fixture |

实现顺序：公开 API 两项 → 其余页面只读命令按酒店、交通、景点/度假分组 → 网络捕获单程航班 → 登录与个人信息。页面导航会销毁当前注入脚本，不能把 OpenCLI 的 `page.goto/evaluate` 原样移入 v2 命令；后续须遵守既有 Extension Runner 和宿主目录/授权边界，必要时采用显式两步页面导航/重调用约定，而不是新建旁路 Runner。Toolkit 自动探索不在此任务范围。

验证：包校验 `node webcli/index.js adapter validate adapters/ctrip.com`，mock 页面请求/响应测试 5/5，WebCLI 全量 83 文件 566/566，扩展加载/运行时 14/14，Profile/打包聚焦 6/6；公开 `prepare-build.cjs` 成功并将两个命令复制到内建包，CLI JSON 帮助报告两个命令。旧 API 认证清单排除不在其旧目录的 v2 页面包，没有把 DOM 包冒充 API 认证。许可文本同时在源码仓库和桌面资源 `licenses/OpenCLI-LICENSE.txt` 中保留。上述测试不等于真实携程 API、登录、验证码或浏览器页面验收；尚未生成最终安装包。无实际网站写操作。公开 Profile 添加新包；其他站点包、旧目录和内部仓库未改。

## 旧失败经验干扰验收（0.3.3）

用户新会话仍跳过 flight-round。排查确认本地长期记忆保留了旧版本连续超时及改查两个单程的经验；已将该条过时记录标为 invalid，保留审计记录，不修改数据库结构。通用记忆召回/生成规则同步内外仓库：历史经验不能压过当前 Skill 或将临时故障固化为永久能力限制。无自动按 Adapter 版本使所有旧记忆失效的机制，本轮针对已确认过时的记录处理。

携程增加 departureTerminal/arrivalTerminal，旧 terminal 仅兼容表示到达航站楼；guidance 明确两者对应机场。携程 50 项、内外 Backend 各 48 项测试通过。当前聊天仍含已加载旧上下文，需重启本地客户端并新建会话复验真实往返命令选择。

## 跟团游导航循环修复（0.3.4）

正确 trace f4aaf89fdb1d 显示同一调用内部重复导航。实际页面给 sv=贵阳 追加 startcity=477；vacations 使用完整查询串比较导致持续去掉站点补充参数。现按主机、路径、唯一 sv 值匹配，仅允许已观察到的 startcity 附加参数，保持目的地与 tour/package 分区隔离，并返回 departureCityId 与实际 URL。tour 实际一次返回 3 条产品，trace 7c6ace5113c1。package 共用修复有 fixture，但尚不计为真实验收通过。

对应“暂态环境故障、稍后自然恢复”的本地记忆已标记失效；错误码本身不足以确认原因。记忆归因提示同步内外仓库。携程/宿主 67 项、内外记忆协议各 18 项通过。

## 自由行类型筛选修复（0.3.5）

用户客户端 package 一次调用成功，但首三条中两条为私家团，结果类型验收未通过。实际自由行页混排了私家团，卡片 .list_product_name 才是明确类型证据。现读取 productType 和 departureCity，在应用 limit 前仅保留自由行/目的地自由行；不能以标题关键词或页面分类替代卡片类型，缺标签报无法验证，少于 limit 不以其他类型补齐。

实际调用 package 贵阳 limit=3 一次返回三条明确自由行（trace 365dc616861a），价格与评分均来自页面；卡片原文出发地为武汉。携程与宿主 68 项通过，包括混排筛选、limit 顺序、无匹配/缺标签，以及已有命令回归。等待客户端新会话复验。

## 船票空状态诊断（0.3.6）

厦门到金门、2026-09-29 的实际页面已显示“无航次信息”，原实现只等待船班卡片，因而错误报告渲染超时。站点源码对空响应和请求失败使用同一空状态；独立匿名只读查询返回 HTTP 200、code=1、data.data=null、message=“未获取到此航线的列表数据”，不作为已登录页面响应或实际无船班的证明。

新增空状态检测并返回明确 COMMAND_EXEC，保留验证码和真正超时的区别；不标记 EMPTY_RESULT，不自动重试，不增加捕获或域名权限。71 项携程/导航聚焦测试通过。有船班时的真实字段提取仍待验收，不能将本次诊断算作 ferry 完整通过。

更新公开 WebCLI 后，相同参数真实调用 trace `547641128d53` 返回明确无信息状态，未再报渲染超时；未取得船班，未购票。
