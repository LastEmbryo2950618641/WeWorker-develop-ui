# WeWorker Roadmap

- 2026-10-18（UI 原生表单单次提交）：从 `0a97cfb` 接续，新增 UI_SELECTOR/uiWrite 固定契约，原生字段无 input/change 填写、一次 requestSubmit、同文档新回执与独立 GET 的稳定身份/全部参数/改变关联值验证；复用精确审阅、派发前持久消费、取消/重启不重放、安装和知识。普通 call 明确 effectVerified:false。无幂等假设：断响应实测一次 submit/3 次请求/3 次服务端 mutation，uncertain 只能只读回查。WebCLI 116 文件/1284 项、写相关 80 项、扩展 18 项、Chromium 1217 完整 70 项、最终打包 UI 7 项/HTTP 15 项/页面写 10 项通过；同 URL 提交后重载的最终专项及报告见交接末尾。构建/公开配置/19 文件语法/npm pack 619 文件通过。复杂控件/整页提交/hidden CSRF/多步写/写修复/扩展回查与 1194 兼容待办保留。Python 网站探索agent未动，不推送/PR；独立阶段后按用户要求暂停整体目标。

- 2026-10-18（实际写响应 ID 回查）：从 `2bb411c` 接续，HTTP/PAGE_FETCH 的 effect.resultReadback 使用已审阅同源单段模板与实际公开字符串 ID，保留固定 before/after 并严格核对资源身份和内容；最小 ID 先落盘，取消/重启仅 GET 回查，缺失/非法/丢响应不猜值、不重写，不确定状态不放行安装。真实 ID 不进入摘要/知识/安装包，普通 call 行为保持单写。WebCLI 115 文件/1275 项、最终聚焦 76 项、扩展相关 14 项通过；源码与最终打包 HTTP 各 15 项、页面写各 10 项通过。Chromium 1217 完整 65 项通过（早于最后断言别名加固，最终全量/聚焦/打包覆盖）；CLI/Bridge 构建、公开配置、10 文件语法/npm pack 617 文件通过。UI 控件写、多步写、数字/多 ID/响应 URL、写修复和完整对齐仍待办；1194 既有兼容问题保留。Python 网站探索agent未动，保存本地检查点、不推送/PR，按用户要求暂停整体目标。

- 2026-10-18（Extension 声明式页面写）：PAGE_FETCH 写计划绑定固定同源路由、JSON 字符串字段和明确服务端幂等契约，复用 mock/精确审阅/派发前账本/before-write-after/安装/知识；取消、重启、丢响应不应用层重放。实测 Chromium 底层会重发，四种写方法丢响应均为 3 请求/1 实际修改，必须由服务端按稳定 key 去重；不声称单次网络写或任意接口可用。WebCLI 114 文件/1224 项、扩展 59 项、最终打包 CLI＋Bridge 页面专项 7 项及 HTTP 回归 12 项、构建/配置/17 文件语法/npm pack 616 文件通过。Chromium 1217 完整 62 项通过；1194 的 Shadow 失败在 5cabcb8 复现并保留兼容待办。UI 控件写、无幂等支持、动态 ID、多步写/写修复及完整对齐继续待办；Python 网站探索agent未动，未推送/PR。

- 2026-10-18（HTTP 写命令与真实效果验证）：新增显式写来源声明、语义骨架、独立 mock fixture、精确请求审阅与 GET before/write/GET after；授权在派发前持久化消耗，同 review 重入、取消、进程重启、响应丢失均不重放。不确定结果可独立只读回查，未通过不得安装；普通 HTTP write 强制确认、单请求、禁重定向，未完成请求不能提前返回成功。WebCLI 113 文件/1218 项、最终写相关 46 项、完整 Chromium 57 项通过；源码与最终打包 CLI/Bridge 各 12 项 HTTP 验收通过，构建、公开配置、18 文件语法与 npm pack dry-run（614 文件）通过。全量后请求头规范化加固由最终聚焦及打包验收覆盖。真实副作用仅使用隔离 PUBLIC/AUTH loopback；页面/多步写、动态 ID 回查、写修复及完整 OpenCLI 对齐仍未完成。Python 网站探索agent未动；OpenCLI 桌面客户端排除，WeWorker UI 单列产品待办。

- 2026-10-18（多步只读网站流程）：exploration.query 的 workflow 模式组合 2–8 个导航/搜索/固定页筛选/翻页步骤，参数预检、结果关联、步骤间 URL/文档身份、动作权限、失败停止、总预算、观察/作者验证取消与断线不重放已接通。生成→逐 case 验证→安装→重复调用→知识→提取修复通过。WebCLI 112 文件/1203 项、最终扩展相关 64 项、完整 Chromium 57 项、最后打包 CLI 工作流专项 7 项通过；CLI/Bridge 构建、公开配置、23 文件语法与 npm pack dry-run（613 文件）通过。写命令/副作用验证、循环/分支、自定义控件及跨源/跨 frame 流程仍未完成；完整对齐继续，OpenCLI 桌面客户端排除，Python 网站探索agent全程未动。

- 2026-10-18（参数化详情页导航）：exploration.query 新增 UI_SELECTOR navigate，同源主文档路径参数保留前导零/Unicode；一次导航等待准确目标、新文档与稳定结果，超时/重定向/文档改变不重放。生成、两组不同路径作者断言、安装权限、普通调用、知识及保留路由的局部修复已接通。WebCLI 111 文件/1197 项、扩展聚焦 40 项、完整 Chromium 52 项、打包 CLI 导航专项 4 项通过；CLI/Bridge 构建、公开配置、20 文件语法与 npm pack dry-run（611 文件）通过。动态 query/hash/跨源页面、多步网站流程和写命令生成仍未完成；OpenCLI 桌面客户端排除，WeWorker UI 单列，Python 网站探索agent全程未动。

- 2026-10-17（无浏览器 HTTP 探索）：mode=http 任务支持明确 OpenAPI 3.0/3.1、Swagger 2 JSON 发现与真实只读宿主请求，生成/作者断言/审阅安装/普通调用/知识/局部修复无需浏览器；需要 Bridge。文档声明不构成执行证据，查询和响应标量省略，重定向逐跳校验，取消与运行中重启不重放且保留次数。WebCLI 111 文件/1193 项、完整 Chromium 50 项、源码与打包 CLI/Bridge 各 8 项零浏览器验收、打包 HTTP 36 项通过；CLI/Bridge 构建、公开配置与 npm pack dry-run（610 文件）通过。JSON 文档仅本地引用，不支持 YAML/自动爬取；完整对齐继续推进动态页面/多步 UI/写命令，OpenCLI 桌面客户端排除，WeWorker UI 单列。Python 网站探索agent未动。

- 2026-10-17（OpenCLI 对齐范围澄清）：用户明确不需要 OpenCLI 桌面客户端，目标为 CLI、浏览器扩展与相关工具能力。此前“桌面 UI”指 WeWorker 自有 API 探索/聊天/profile 界面，单列产品集成，不作为 CLI 对齐完成条件；目标网站多步 UI 和 CDP/Electron 外部目标控制仍按 CLI 能力核对。本次仅同步范围文档，通过 diff 格式检查，未重跑功能测试；Python 网站探索agent未动。

- 2026-10-17（HTTP 宿主鉴权与 Cookie 分区）：契约 version 2 新增 AUTH_API，支持环境 Bearer/header/Basic/声明式 HMAC，精确 origin 注入、重定向按实际请求重新签名，凭据不进入 Worker；Cookie 可选 storeId/partitionKey，旧插件能力不足拒绝派发，不回退默认 store/分区。生成/预览/安装权限/普通调用/只读 repair 已接入。WebCLI 110 文件/1183 项、最终聚焦 84 项、扩展 4 项、完整真实 Chromium 50 项、最终 HTTP 8 项、打包 CLI 36 项通过；构建/配置/22 文件语法检查通过，npm pack dry-run 607 文件含新模块。未重跑日常浏览器/外站，未验证隐身 store、任意站点签名/OAuth；下一步无页面 API 发现，整体 OpenCLI 对齐继续。Python 网站探索agent未动。

- 2026-10-17（独立 HTTP Runner）：新增版本化 `http` runtime 与 PUBLIC_API/COOKIE_API，保持 Extension/Toolkit Runner 分离。公开命令无需 Bridge/浏览器，Cookie 命令固定 profile、按 URL/名称临时读取 HttpOnly Cookie 与 CSRF，精确 origin 授权、失败不重放；接入探索生成、作者 cases、安装、普通调用与只读定向修复。WebCLI 109 文件/1161 项、扩展聚焦 6 项、完整 Chromium 47 项、最终 HTTP 聚焦 6 项、打包 CLI HTTP 16 项通过；CLI/Bridge 构建与配置通过，日志/任务/安装目录无原始占位凭据。尚未实现通用签名/环境凭据、分区 Cookie、无页面 API 发现和多步 UI/写命令；整体 OpenCLI 对齐继续。Python 网站探索agent未改动。

- 2026-10-17（多浏览器 profile）：稳定 contextId 与每连接身份、profile list/rename/use、flag/env/default 选择；普通调用/探索/Worker/trace/follow 固定路由，响应仅回请求者，断线不重放；会话/任务/知识/锁按浏览器隔离，旧根通过 legacy 只读保留。WebCLI 1145 项、扩展相关 85 项、完整真实 Chromium 44 项通过；日常 Chrome/B 站 Excel 第一页 24 卡片标题/链接逐项一致。最终 trace/打包检查见交接日志。完整 OpenCLI 对齐继续，Python 网站探索agent零改动。

- 2026-10-17（CLI 会话交接）：应用户要求，在已完成上传功能 `3e9a7ff` 后暂停当前目标。完成多浏览器连接的源码路由核查与下一阶段设计记录，尚未实现 profile；本次仅更新文档，未重跑功能验收。交接文档顶部新增接手入口、当前状态、验证证据与同步边界。整体 OpenCLI 对齐未完成，Python 网站探索agent未动。

- 2026-10-17（文件输入目标扩展）：browser.upload 支持隐藏/语义/开放 Shadow/关闭 AX/明确 frame 文档，保留实际节点与 target session，派发前复核、派发后验证文件名/顺序/大小；禁用/歧义/替换/导航/过期失败不重放，报告 dispatched。WebCLI 1133 项、扩展相关 122 项、隔离 Chromium 完整 38 项及最终聚焦通过；日常 Chrome 实际文件内容和本地 multipart 接收、B 站 24 卡片回归通过。目录输入/自定义业务流程和其他 OpenCLI 差距继续进行，Python 网站探索agent零改动。

- 2026-10-17（复合字段与结构读取）：DOM state/find 增加日期/下拉/文件元数据，独立读取保留列表第 50 项后的选中状态；get compound 支持隐藏输入、AX ref 和 frame，HTML JSON 树提供明确预算/截断并省略密码值和脚本。select 支持 by=value/label，歧义/禁用拒绝，页面撤回选择明确失败。WebCLI 1132 项、扩展相关 117 项、隔离 Chromium 完整 37 项及最终聚焦通过；日常 Chrome 真实上传/选择/读取和 B 站 24 卡片回归通过。通用自定义组件、Shadow 上传、多连接等继续进行；Python 网站探索agent零改动，详见跟进文档。

- 2026-10-17（开放 Shadow DOM 查询）：browser 定位支持显式 shadow=true，遍历所选文档及开放根，返回树内名称、宿主路径和引用；CSS 组合器不跨树，重复/过期/遮挡/超限明确失败，input/change 可到达宿主。原生嵌套点击/同 frame drag、selector 等待与跨源 frame 操作通过。WebCLI 1131 项、扩展相关 109 项、隔离 Chromium 完整 36 项和日常 Chrome/B 站 24 卡片回归通过；关闭根继续用 AX，复杂控件/Shadow 文件输入/多连接等继续进行，Python 网站探索agent零改动。详细证据见跟进文档。

- 2026-10-17（截图高级选项）：browser.screenshot 支持主文档 DOM 编号、真实 CSS 视口尺寸、fullPage 与本地新 PNG 文件保存；图像侧合成不插入页面覆盖层，核对像素/几何，失败与导航均恢复观测视口，导航不复用旧滚动。WebCLI 1130 项、扩展相关 105 项、隔离 Chromium 完整 35 项通过；日常 Chrome 高 DPR 同类验收及 B 站 24 卡片回归通过。未知设备模拟配置不保证完整恢复，AX/子 frame 标注尚未覆盖；其他 OpenCLI 差距继续推进，Python 网站探索agent零改动。详细证据和分发结果见跟进文档。

- 2026-10-17（AX 页面状态）：state 支持 source=ax 与 compareSources，读取 Chrome 计算的名称/语义树并汇总可访问 frame；引用绑定实际节点和文档，可操作关闭/嵌套 Shadow DOM，拒绝同名替换、名称漂移、错配文档、禁用与遮挡。比较仅输出覆盖指标，不改当前引用；限额/帧失败明确标记。WebCLI 1129 项、扩展相关 98 项通过；隔离 Chromium 完整 34 项及最终 AX 聚焦通过，日常 Chrome 同类操作和 B 站主文档 AX/24 卡片回归通过。截图高级选项、深层 selector/复杂控件、多连接及其他 OpenCLI 差距继续进行；Python 网站探索agent零改动，最终检查见跟进文档。

- 2026-10-17（持续浏览器观察）：新增 browser.events、console/network --follow JSONL、时间窗口与序列游标；主/子调试 target 分离，独立订阅、输出背压、信号退出、断线续接和丢失错误，扩展主动调试断开明确清理。WebCLI 106 文件/1128 项、扩展聚焦 76 项及 Adapter helper 回归 15 项通过；隔离 Chromium 完整 32 项与日常 Chrome 持续观察通过，B 站 Excel 第一页 24 卡片逐项回归通过。裸时间单位沿用秒，观察历史有界；AX/截图高级选项、profile/多连接及其他 OpenCLI 差距继续推进，Python 网站探索agent零改动。最终分发与交接结果见跟进文档。

- 2026-10-17（子 frame 原生指针）：click/dblclick/hover 与同 frame drag 支持嵌套同源/跨源文档，复用身份守卫，按内容四边形投影/逆变换并逐层检查遮挡；悬停后移动、文档导航或准备超时拒绝继续，异常释放按钮。WebCLI 1119 项、扩展聚焦 69 项、隔离 Chromium 完整 29 项与最终浏览器聚焦通过；日常 Chrome 六 frame 的原生事件、缩放/旋转/透视、父层遮挡和跨源点击下载通过，B 站 24 卡片回归通过。Shadow DOM、跨 frame/DataTransfer 拖拽、持续观测与其他 OpenCLI 差距继续推进；Python 网站探索agent零改动。

- 2026-10-17（下载生命周期）：新增 browser.downloads / wait kind=download，按标签与跨源子页面事件观察、游标/ID 续等、进度超时、中断与歧义错误；观察不占点击锁，Bridge 重启可继续，落盘路径只返回限定 URL/时间的唯一匹配。WebCLI 105 文件/1118 项、扩展聚焦 64 项、隔离 Chromium 完整 28 项通过；日常 Chrome 主页面/慢速/跨源 frame 原生键盘触发及文件内容通过，B 站 Excel 第一页 24 卡片回归通过。子 frame DOM 点击仍可能无法触发下载，原生指针及其他 OpenCLI 差距继续开发；Python 网站探索agent零改动。详细失败诊断和边界见跟进文档。

- 2026-10-17（跨 frame 执行）：browser.frames 返回 frameId/documentId，eval 与页面定位支持明确文档身份；递归跨源子会话隔离 context ID，执行一次、不按 URL 猜测，导航/脚本错误/不结束 Promise 明确失败。WebCLI 105 文件/1117 项、Extension 聚焦 52 项通过；隔离 Chromium 最终完整 27 项通过，包含 Promise 超时与页面重写函数的隔离检查；日常 Chrome 五个同 URL/嵌套跨源/严格 CSP frame 实测通过，B 站明确文档执行与旧命令 24 卡片回归通过。构建和配置通过；子 frame 原生指针、Shadow DOM、AX、下载/profile 及完整 OpenCLI 对齐继续进行。Python 网站探索agent零改动，详细打包/交接结果见跟进文档。

- 2026-10-17（来源分析与方案历史）：新增 exploration.analyze/replan/revisions/revision-read，结构分类、策略理由及失败建议；旧草稿/计划/cases/验证结果保留，切换来源后必须重新验证审阅。明确 PAGE_FETCH 执行范围，PUBLIC_API/COOKIE_API 尚无独立 runner。WebCLI 105 文件/1116 项、Extension 聚焦 53 项、隔离 Chromium 26 项通过，含 API 503→DOM→安装调用及重启读取历史。真实 Chrome 完成 API 草稿留档→DOM 生成→预览/安装/普通调用，24 张可见卡片标题/链接逐项一致，重启后历史与调用通过；原 API 正常，页面仍为 excel 第一页。CLI/Bridge 构建、配置及 npm pack dry-run 590 文件通过。OpenCLI 1.8.8 静态审计与缺口已记录，完整对齐继续进行；Python 网站探索agent零改动。

- 2026-10-17（跨文档页面查询）：新增 exploration.query，单次读控件触发后等待同源固定结果路径、URL 参数与稳定 DOM/公开状态；生成命令通过后台续接跨文档返回结果，允许从结果页重复调用，参数命令至少两组不同值验证。修复目录刷新重载打断探索的问题，探索/预览/browser 与普通调用共用页面队列。WebCLI 104 文件/1100 项、Extension 聚焦 58 项、隔离 Chromium 25 项通过；真实 Chrome 两关键词预览、安装与普通调用通过，24/27 张视频卡片与当前 DOM 逐项一致，旧 API/DOM/下一页回归通过。B 站重复同词不触发查询时明确超时，已恢复 excel 第一页并保存知识。构建/配置与 npm pack dry-run 588 文件通过。动态页面路径、跨源查询导航、多步 UI、写命令及完整 OpenCLI 对齐仍未完成；Python 网站探索agent零改动。

- 2026-10-17（页面触发查询 INTERCEPT）：新增搜索/原生筛选/下一页控件与新响应关联，显式 API 端点、query/body 参数关联、临时预览授权、两组不同参数验证；观察仅存结构。WebCLI 103 文件/1094 项、Extension 聚焦 63 项通过，隔离真实 Chromium 24 项包含跨域页面签名 GET/POST 与错误分支；CLI/Bridge 构建和公开配置通过。真实 Chrome 发现后台页吞原生点击，已修复前台激活；公共视频搜索页新增下一页命令完成预览/安装/普通调用，页码 4→5，返回 35 视频并排除 7 非视频，旧 API/DOM 回归通过。整页导航、自动策略回退、多步 UI、写命令和完整 OpenCLI 对齐仍未完成。Python 网站探索agent零改动；详细边界与最终验证见跟进文档。

- 2026-10-17（API 动态路径参数）：Agent plan 可显式绑定 pathname 段与字符串参数，覆盖脱敏 :id 或作者选择的 slug；生成 schema 必填、无捕获值默认参数、单段编码、保持前导零，区分 path/query/body。至少两组不同路径组合实际验证，映射随站点知识保存。WebCLI 102 文件/1090 项、隔离真实 Chromium 23 项通过，含 GET/POST 四组 ID/中文/特殊字符精确断言、安装后普通调用和非法路径零请求；CLI/Bridge 构建及公开配置通过。本轮未在外部站点验证动态详情接口；动态页面路由、INTERCEPT、写操作及完整 OpenCLI 对齐仍未完成。Python 网站探索agent零改动。

- 2026-10-17（页面来源探索与修复）：新增 observe 与 UI_SELECTOR/DOM_STATE，支持无 JSON API 的 DOM 列表、公开页面状态和 JSON 脚本生成；页面证据独立绑定，作者 cases 必填，支持混合计划、站点知识与定向修复。新增 pageRoute 精确页面选择，避免同域首页误调用，缺失/歧义明确报错。WebCLI 全量 101 文件/1086 项、Extension 聚焦 40 项、隔离真实 Chromium 22 项通过；CLI/Bridge 构建、公开配置和 npm pack dry-run（583 文件）通过。用户指定公共搜索页新增 DOM 命令本地安装后读取 27 张已渲染卡片，标题/链接与当前页逐项一致；已有 API 三组查询仍通过。INTERCEPT、动态路径、写操作、多步 UI、跨 Agent 独立对话及完整 OpenCLI 对齐仍在进行；Python 网站探索agent零改动。

- 2026-10-17（已安装命令定向修复）：新增 repair-info/repair，从当前包和新采集证据建立隔离草稿，限定所选只读命令模块/schema/description；共享文件、其他命令、权限和路由保持原样，安装基线变化拒绝覆盖。历史 cases 自动带入并标记过期，必须重新实际验证。WebCLI 全量 100 文件/1080 项通过；真实 Chromium 20 项通过，包含返回字段变化→旧六组全部失败→CLI 修复→六组通过→安装与普通调用。共享文件/写命令修复、其他策略与完整 OpenCLI 对齐仍待做，Python 网站探索agent未动。

  用户指定的真实搜索页已追加三组精确断言：发现课程混排导致空视频标识后，通过上述入口局部修复本地生成命令，验证、审阅安装及普通调用均通过；第一页 17 个视频并报告排除 3 个课程，其余两组各 20 个视频。cases 与字段说明保存在本地站点知识，真实结果未提交。

- 2026-10-17（探索验证与站点知识）：新增 verification-read/write，Agent 可按工具编写 1–10 组真实参数及精确路径、类型、非空、格式、值、行数断言；修复扩展预览仅执行前五组的限制，改为分批汇总，旧插件能力不足时明确拒绝。新增 knowledge-read/save，保存已验证的选中结构端点、字段含义、备注和作者 cases，按 30 天与安装包摘要标记过期，支持跨 Bridge 重启恢复。真实测试第六组故意错误能定位 caseId/path 并阻止安装，修复后全通过。另修复目录刷新重载页面打断普通调用的竞态，刷新与 managed page 调用共用队列。WebCLI 全量 100 文件/1077 项通过；完整 OpenCLI 对齐与安装后修复仍进行中，Python 网站探索agent未动。

- 2026-10-17（OpenCLI 能力对齐进行中）：新增 34 个独立 browser 命令及 Skill，命名会话/身份守卫、主 frame 原生鼠标/拖拽、文件输入、弹窗、console、完整截图、网络过滤/JSON 详情；browser 与 exploration 共用 tab 锁。探索支持显式 API origin 授权、Agent 计划的 JSON/form POST 与 GraphQL query、1–50 工具、draft-add 和结构 trace。用户指定公共视频搜索页已完成采集→生成→真实验证→增量安装→普通关键词/分页调用，三次查询均返回 20 条且分页/关键词改变结果；无原始用户数据入库到仓库。隔离真实 Chromium 17 项通过，WebCLI 全量 98 文件/1069 项、Extension 聚焦 42 项、CLI/Bridge 构建与公开配置通过，npm pack dry-run 577 文件含新模块/Skill。Python 网站探索agent零改动。完整策略生成、动态路径、写工具、站点知识/安装后修复、多连接、外部 CLI/CDP、UI 统一和跨 Agent 新对话仍待做，详见 `docs/opencli_parity.md` 和跟进文档。

- 2026-10-17（独立探索 CLI 真实验收）：真实 Chromium + 插件 + 独立 CLI/Bridge + loopback 示例站点全流程 15 项通过，覆盖采集/搜索探测、草稿编辑与修复、真实验证、审阅安装、普通搜索/分页调用、空态/HTTP 错误、同站点增量保留、取消和重启恢复。修复登录辅助工具跳过数误阻止安装的问题，仅独立流程限定目标工具统计，共享验证器默认行为不变。新增可复跑浏览器验收脚本；WebCLI 全量 97 文件/1056 项、CLI/Bridge 构建、公开配置及语法检查通过。原有全局 Bridge/用户浏览器未动，Python 网站探索agent无改动；真实登录业务站点、独立 Claude/Codex 对话和各平台安装包仍未验收。记录见 `docs/api_exploration_cli_handoff.md`。

- 2026-10-17（独立 API 探索 CLI）：按用户修正移除桌面 Backend 前置条件，WebCLI Bridge 新增无模型探索任务、结构证据、安全探测、Agent 草稿读写、验证与审阅安装命令，提供外部 Agent Skill。当前首版范围为同源只读 GET；UI 统一、POST/跨源/写工具及真实外部 Agent 对话验收待后续。WebCLI 97 文件/1055 项通过，CLI/Bridge 构建、npm prepack dry-run、公开配置及语法检查通过；真实浏览器/模型未验收。详细记录见 `docs/api_exploration_cli_handoff.md`；本轮未修改 Python 网站探索agent。

- 2026-10-17（API 探索 CLI 集成与设计）：#106/#91 已合入 develop；从 `4c3d5bd` 建集成基线并整合 dev-1.1.0 `dae8932`，解决 7 文件冲突。设计/交接见 `docs/api_exploration_cli_design.md`、`docs/api_exploration_cli_handoff.md`。聚焦 94 项、Renderer 构建与公开配置检查通过；Backend 类型检查缺 yauzl 声明，Python 聚焦测试缺 uv，尚未完成全量/真实验收。CLI 实现未开始。

- 2026-10-17（PR #91 分支同步）：将含 #106 修复的最新 develop 合入 `chore/remove-legacy-extension-adapters`（无冲突），check-public-config 台账 fixture 随 legacy 目录移除精简（去掉 `extension/adapters/index.json` 桩）。worktree 聚焦复验：真实仓库校验通过、scripts 测试 4 项、webcli 两文件 37 项（即 #106 所修用例）、扩展 tool-route 与 wecli-runtime-helper 33 项全部通过。

- 2026-10-17（API 探索 CLI 规划）：新增 `docs/api_exploration_cli_handoff.md`，记录 develop/dev-1.1.0 与未合入 PR #106/#91 的基线快照、拟建集成/功能分支、上游同步与冲突处理流程、验收清单及交接日志。当前仅完成分支核对和文档建立，尚未建分支、合并或实现 CLI；#91 是否纳入及最终发布目标待明确。

- 2026-10-17：修复 PR 上「配置一致性检查」存量失败：webcli 自 10-15 起由发布脚本按 npm 独立发版节奏升至 1.0.4，check-public-config 不再要求 webcli/package.json 等于桌面应用版本，改为校验 webcli 自身发布台账（package.json、version.json、.claude-plugin/plugin.json 与 SKILL.md frontmatter 四处一致）。新增临时目录 fixture 聚焦测试 2 项（版本独立不报错、台账漂移逐文件报错），真实仓库校验与 scripts 测试 4 项通过；未改动发布脚本与 workflow 本身，Release Latest 在 develop 上的历史失败未在本轮排查。

- 2026-10-16：为网站探索agent的 Windows PyInstaller 可执行文件补充 WeWorker 版本资源。构建时动态生成 VERSIONINFO，文件属性包含 ProductName/CompanyName「WeWorker」、描述、产品版本、原始文件名等关键字，保留现有 Webwright.exe 文件名和 embedded onedir 结构；补充分发契约测试。验证：distribution 契约测试 10 项通过、Python 语法检查通过；未在本次变更中构建完整 Windows 安装包或进行安全软件白名单实机验收。
- 2026-10-15（API 探索优化 PR 整理）：从最新 develop（783e6dbc）建立 codex/api-exploration-optimization，仅迁入探索候选来源/结束条件、输出包装层与业务错误判定、补采回放保留、已有站点包增量生成及默认 auto 优化；未带入演示分支的模型、机器人、导航或版本变更。默认先生成并验证，具体草稿错误最多一次限时 60 秒模型修复；探索预装证据/指引、显式确认目标并结束分析，分析限时 180 秒。独立锁定依赖和 public 33 包准备后，WebCLI 33 文件/241 项、Backend 5 文件/46 项、Renderer 7 项、扩展 35 项共 329 项通过；Backend 类型检查、Renderer 与 Backend/Bridge/WebCLI 构建、34 个 JavaScript 文件语法及差异检查通过。新工作区首轮漏准备资源导致测试失败；构建与测试并行阶段还出现计划缺失和 Windows 临时目录清理失败，二文件独立复查与构建完成后完整聚焦重跑均通过。集成分支真实两轮约 71.439/85.731 秒及 7 次新工具查询只作为迁入前证据，本 PR 尚未重跑完整客户端、真实网站、macOS 或安装包；无 99.999% 结论。操作与边界见 docs/api_exploration_local_acceptance.md、docs/api_exploration_reliability_plan.md。

- 2026-10-16：移除 `extension/adapters/` 旧版 v1 内置目录及其全部管线，仓库根 `adapters/` 成为内置 Adapter 唯一源。该目录此前仅剩空 `index.json`，功能已由 v2 host-managed 包取代。具体：`prepare-build.cjs` 删除 legacy 拷贝管线，扩展内置清单恒为空（`adapters/index.json`/`registry.json` 仍构建生成，供扩展启动初始化与 skill-installer legacy 读取）；`selectBuiltinAdapters` 去掉 `legacyDir` 回退，缺包直接报错；`.profile.json` 元数据移除 `legacy` 字段（写端 builtin-adapter-build.js 与读端 paths.js、adapter-catalog.js 同步）；删除无生产调用方的 backend-ts `adapter-scaffold.ts`（其测试实际测的是 webcli JS 版）、`migrate-legacy-extension-adapters.cjs`、`sync:adapters-registry` script、certification 对旧清单的硬读取，以及经查零消费方的 backend `src/registry.json`（同步清理 shared-core-files exceptions）；`check-public-config` 改为只校验 build profile ↔ 根 `adapters/` 一致性。修复死链与导航白名单：jd.com/mail.163.com/nnfp.jss.com.cn manifest `homepage_url` 从失效 GitHub 旧路径改为站点真实地址、scaffold 提示文案改指根 `adapters/`；jd.com `match` 补全 www/search/item/cart/order 真实主机名（修复 `Adapter navigation host is not allowed`），保持 `jd.com` 为 `match[0]` 以维持 routeDomain 后缀匹配语义。service-worker 管理路径 tab 选择改为两段式：精确 hostname 优先，回退限定在 manifest.match 声明的页面主机（含 `*.` 通配）内复用已开标签页——不选用 runtime_allowed_hosts 辅助域作执行页（既有守卫语义保持）。文档同步：AGENTS.md 模块地图、extension/README、EXTENSION_DEV_GUIDE §7/§8.7、weworker/README、officialWeb/README、adapter_developer_guide 顶部加 v1 历史注记、KNOWN_ISSUES 路径。验证：`check-public-config` 通过；`prepare-build --profile public` 产出 33 个 host-managed 包且空清单/`.profile.json`（无 legacy 字段）正确生成；webcli vitest 988/988 通过（main 基线 prepare 后同为全绿，无新增失败）；tool-route 23/23（新增后缀复用与精确优先 2 个用例，辅助域守卫用例保持通过）；CI 扩展测试清单 4 文件 41/41；webwright-scripts 11/11；backend-ts `tsc --noEmit` 通过、adapter-desktop 单测 8/8。未验证：真实 Chrome 扩展端到端调用（jd 搜索需发版后加载扩展实测）；`check-shared-parity` 需 peer 内部仓本地无法运行（exceptions 清单清理仅静态核对）。
- 2026-10-14：侧栏告警改为扩展状态旁的固定感叹号入口，移除占用侧栏高度的版本/端口长提示；点击入口显示告警列表，点击条目打开详情弹窗，保留扩展指引、按系统区分的端口查询命令和通道错误详情。入口在无告警时隐藏但保留位置，列表及详情通过浮层展示。聚焦单测 7 项、Renderer 构建及差异检查通过；Chrome/Playwright 模拟状态验证告警出现/消失与开列表不改变侧栏几何位置、版本与通道详情、窄窗口防越界和 Escape 关闭，无运行时错误。

- 2026-10-14：网站探索模型的连接成功提示采用主题绿色，与按钮保持和上方表单一致的 14px 间隔；标题“已连接”增加绿色状态点，检测中或失败时不显示绿点。模型连接单测 2 项、Renderer 构建及差异检查通过；本地 Chrome/Playwright 模拟响应验证了颜色、间距、成功/失败状态、输入保留和手动折叠，无运行时错误。未调用真实模型接口。

- 2026-10-14：修复模型设置中“重新检测已保存配置”成功后自动收起的问题；重新检测仅更新连接结果，保留展开状态及未保存的表单输入。通过模型连接单测 2 项、Renderer 构建与差异检查；使用本地隔离组件及模拟响应完成 Chrome/Playwright 交互验证，覆盖成功、失败、重试、输入保留、按钮位置不变和手动收起，无运行时错误。未调用真实模型接口。

- 2026-10-17：**客户端性能修复（四处）与单轮瓶颈定位**。起因：用户反馈对话响应慢。只读定位（works.db + main.log + 扩展 trace）结论：一轮 15.2s 中模型仅 3.57s、工具执行 11.68s，其中 `ask_user` 3.10s（等人点击，正常）、`PowerShell → webcli call jd.com.check-login-status` 8.58s，而后者有 **7.55s 花在 Chrome 扩展内部等一个注定被拒的页面加载完**（适配器 manifest 声明 `jd.com` 却跳 `www.jd.com`，属适配器数据问题，本次不改适配器）。修复四处：① **扩展侧 fail-fast**：新增 `classifyNavigationTarget`（`allowed/forbidden/unknown`，与 `assertAdapterNavigationUrl` 共用同一份白名单）与 `createNavigationGuard`（`NAVIGATION_TARGET_SETTLE_MS=1500`，仅当同一个非白名单 http(s) URL 连续稳定 ≥1.5s 才判失败，URL 一变即重置，因此不会误杀"先跳 A 再 302 到合法 host"的正常流程），接入 `waitForManagedPageReady` 与 `navigateAdapterTab` 两条等待路径。② **prewarm 提前**：进入/切换会话即复用既有 `requestChatWarmup`（60s 去重 + 后端会话池上限 3，不会预热风暴）。③ **三段观测**：`webcli` 启动→bridge 收单 / 收单→派发 / 派发→扩展返回分别记日志（`[Bridge] 调用分段: …`），扩展内部耗时进既有 `traceLog`。④ **修正 timing 记账**：新增 `backend-ts/src/turn-timing.ts`（`exec`=工具区间并集、`llm`=其余，构造上 `llm+exec===total`；缺结果事件的工具在图片事件或 `finish()` 计入 exec、绝不计入 llm），接入 `server.ts`/`task-executor.ts`/`channel-manager.ts`/`wecom-channel.ts`。**实测收益**（真实日志）：扩展内部 7547ms→**1977ms**、`open_browser` 拒绝 850–980ms→**40–83ms**、首轮 `sdk_start_to_first_event` 760ms→**29ms**、`turn end` 由矛盾值变为 `total=13.08s llm=6.80s exec=6.29s`（6.80+6.29≈13.08 ✓）、三段日志已在实际调用中打出。验证：扩展全量 18 文件 115 项、后端 `tsc --noEmit` 与全量 1289 项、Renderer 构建与全量 308 项、webcli bridge 分段测试 4 项全部通过。未做：未在真实 Chrome 复现 fail-fast（按要求未重载用户扩展；但扩展重连风暴经审查确认为 Chrome 重载抖动而非代码缺陷，已补 1 个消息路径健壮性测试 5 项）；未做端到端首轮预热实测（以日志数字为准）；未消除 `webcli call` 每次 spawn 进程（~0.8–0.9s/次）与 `check_file_encryption` 的 3.79s（列为后续）。

- 2026-10-17：**移除 ZCF 集成，风格转为应用内置纯提示词**。起因：用户反馈对话响应慢，实测后端每轮 `context_tokens.rules` 高达 14369，其中「自动规划」把 `commands/zcf/{workflow,git-commit,feat,init-project}.md` **四份工作流文档全文**（7174，占 49.9%）每轮注入系统提示词，`weworker-clear` 风格正文另占 1203，且每轮都真实写盘（`ensureBundledZcfInstalled` 走「rmSync 扩展目录 + 重建」分支，日志 17 次 `{"filesCopied":2}`）。现在：① 整体删除 ZCF 机制——`zcf-sync.ts`（891 行）、`zcf-role-settings.ts`、`bundled/zcf/**`（8 个模板）、`/zcf/*` 与 `/settings/zcf-*` 端点、模板语言、「从 ZCF 更新扩展」、ZCF 包版本、ZCF 扩展风格扫描、工作流模式（默认／自动规划），renderer 侧删除 `store/zcf.js`、`ZcfPicker`、`useZcfStore`。② **风格全部保留并与 ZCF 脱钩**：现有内置风格（默认／工程师专业版／专业严谨简单明确）正文改为应用内置常量（`backend-ts/src/style-presets.ts`，去掉 frontmatter、ZCF 包裹句与与风格正文重复的硬编码 strictRules），自定义风格链路（卡片编辑按钮＋弹窗＋删除二次确认＋`style-draft.js` 单测）原样保留；后端端点收敛为 `POST /settings/styles` 与 `PATCH /works/:id/style`。③ 为避免数据迁移与丢失用户当前选中的风格，`zcf_custom_roles` / `zcf_default_role` / `zcf_enabled_roles` 三个键名与 work 表 `zcf_role` 字段保持不变（SQLite 历史列 `zcf_mode` 仅做查询投影，删列属 schema 迁移故不动），老设置里的 `zcf_lang` / `zcf_default_mode` / `zcf_package_version` / `zcf_sync` 在加载时剔除（不报错），已删除风格的残留 id 规范化回落 `default`。④ 顺带修掉 `usage` 埋点：`duration_api_ms` 实测是**会话累计值**（CLI 内嵌 JS 证据：`Xg()-We`），旧口径会出现 `api` 大于整轮 `dur` 的误导值，现改为相邻采样的差值（本轮 `api`）并另附 `api_total`，账本重置打 `api_reset`，字段缺失时输出 `?` 而**不猜测**；`ttft` 经核对本来就是本轮值。验证：Backend `tsc --noEmit` 通过、全量 131 文件 1281 项通过；Renderer 全量 307 项与生产构建通过；用仓库自带 tsx 复现真实 `buildSystemPrompt` 得到 `rules`＝默认 **5948**、工程师专业版 6993、专业严谨简单明确 7017（改动前同条件 14369）；真实运行日志中出现 `rules=7017`、ZCF 写盘 **0** 次、`api=4191ms ≤ dur=15217ms`，首字 2218ms→1821ms（**非同条件对照**，两条消息与风格不同，仅供参考）。未在真实窗口逐项点击验收（无 jsdom，仅静态验证）；`scripts/chat-bench` 基准未能运行（`self` 模式固定绑定 8765，与运行中的客户端冲突；`remote` 模式所需 token 由 Electron 启动时生成、不落盘、不暴露给 preload）。**未解决**：同一轮 15.2 秒里约 11 秒不在模型调用内（`turns=3`、`api` 仅 4.2 秒），疑为工具执行与 `webcli` 每次调用的进程冷启动，仍在定位。

- 2026-10-17：设置页自定义风格的编辑方式改为「卡片按钮 + 弹窗」，并修掉切换设置页签丢失未保存草稿的既有缺陷。起因：用户要求把常驻在卡片列表下方的「编辑自定义风格」表单改成点按钮弹窗，并指出卡片左侧类型图标已是铅笔、按钮再用铅笔重复。现在：① 自定义风格卡片上新增「编辑」按钮（铅笔 `EditOutlined`，垂直居中、紧靠右侧选择圆点左边，绝对定位**不参与高度计算**，卡片高度与内置卡片一致；窄屏回退到圆点上方避免压字），点击打开模态框编辑「名称／提示词」，复用设置页既有弹窗约定（`createPortal`、遮罩点击与 `Esc` 关闭、Tab 陷阱、自动聚焦、卸载即丢弃草稿），弹窗内保留删除（仅对已存在风格显示，走全局二次确认，删除当前选中项回落内置默认，仍是本地草稿、需点「保存配置」落盘）。② 卡片左侧「自定义风格」类型图标改为画家调色板（与同文件其它类型图标同一套描边）。③ 顺带修掉既有缺陷：`{tab === 'config' && <ConfigTab />}` 条件渲染导致切页签卸载面板、重挂时从已持久化设置重新初始化而丢失草稿；另一条独立路径是任何一次设置保存都回传整份 settings（内容相同的新引用）触发 `useEffect(..., [zcfCustomRoles])` 覆盖本地草稿——改为「内容签名变化才同步」，并让「配置」页签首次进入后常驻（切走仅 `hidden`），「配置」页其它字段的同类丢失一并修好。验证：Renderer 全量 307 项（新增 8 项纯函数单测）与生产构建通过；用 headless Chrome 以构建产物 CSS 复刻真实设置页 DOM 实测：各视口下内置与自定义卡片行内高度差 0px、显示/隐藏按钮前后高度 delta 0.00px、裁剪感知相交检测无遮挡、>580px 时按钮垂直中心与卡片一致且距 radio 左缘 8.00px。未在真实窗口目视验收；「切页签回来草稿仍在」无组件级自动化测试（Renderer 无 jsdom）。已知同类问题仍存在于「模型」「记忆」两个页签（均为既有问题，本次未修）。

- 2026-10-17：长期记忆新增「其他长期记忆」类型并加入按类型的容量管理。起因：用户明确要求「把这件事写进长期记忆」，助手回答「已写入」，但记忆库里没有——候选被准入层以 `execution_evidence_insufficient` 拒绝（`task_execution` 要求本回合有真实执行证据，符合项目「宁可漏记不可错记」契约），而拒绝时后端**不发任何 `memory_status`**（只在 `plannedMemoryEvents.length > 0` 时发），模型与用户都被蒙在鼓里；同时记忆类型只有 `user_usage` / `task_execution` / `extension:*` 三类，模型无处安放「用户明确要求记住」的内容。现在：① `MemoryType` 增加 `other`，模型协议允许该类型，准入要求本回合成功、按 `provisional` 记录并封顶置信度 0.6；`memory-event-planner` 补 `other` 分支（缺了它候选即使通过准入也会被静默丢弃，且 `memory-lifecycle` 的类型校验会直接报错）；`other` 与 `user_usage` 一样稳定召回。② 新增 `memory-capacity.ts`：四个档位（`user_usage` / `task_execution` / `other` / `extension`，`extension:*` 归入 `extension`）各有独立估算 token 预算，超出时**先融合近重复**（同组保留价值最高者）、**仍超则按价值升序淘汰**，一律 `setStatus('superseded')` 保留审计且**至少保留 1 条**；价值 = `置信度 × 1/(1+天数/30)`；估算按 CJK 1 字/token、其余 3.5 字符/token；未超预算时不做任何写操作。③ 设置新增「记忆」页（位于「配置」与「权限」之间）：四档预算输入（默认 `user_usage 800 / task_execution 1600 / other 1200 / extension 800`，范围 0-20000）、各档当前用量与条数、已存记忆列表（类型筛选、置信度、更新时间、删除二次确认）。④ 新增 `GET/POST /memory/settings`、`GET /memory/records`、`DELETE /memory/records/:id`（只返回公开字段，不暴露 `facts`），`memory_budgets` 进入设置响应。验证：Backend `tsc --noEmit` 与全量 130 文件 1284 项（新增 2 文件 30 项，既有测试零回归）、Renderer 全量 45 文件 296 项（新增 8 项）与生产构建通过、`npm run dev` 实际启动成功（构建配置校验通过，Backend 8765 / 网站探索agent 8766 / Bridge 3711 均监听）、新路由经真实 HTTP 探测返回 401（已注册且鉴权生效）。未在 Renderer 人工点击联调 4 条 `/memory/*` 路由；对话与定时任务两条写入路径均已挂预算执行；准入被拒时已补发 `memory_status` 如实告知（不再静默）。后续修正：用户明确要求记住的内容一律用 `other`（否则会被误判为 `task_execution`，再因缺少执行证据被拒）；本地文件路径不再视为敏感信息（允许原样写入记忆，密钥／Token／账号等凭据拦截保持不变）；定时任务写入路径同样执行预算。未实现：真正的**语义精炼**（把多条记忆改写为一条更短的）需模型参与，本次只做确定性的近重复融合。

- 2026-10-17：模型名不再写死在构建配置里。供应商配置只保留构建期必需的路由与安全项（协议、地址、认证方式、结构化输出），`models` 与 `defaultModel` 一律置空，模型列表只来自模型列表接口或用户手填。起因：`deepseek` 内置的 `deepseek-v4-flash` 早已不在接口返回中（接口为 `deepseek-flash`、`deepseek-v4-pro`），引导完成后「当前模型」因此是一个不可用模型——设置页会把表单自动纠正为接口返回的名字（只改表单、不落盘），聊天区则显示存档里的旧名字，两处模型列表因此不一致（聊天区多出一个「不可用」项）。现在：模型列表接口失败时不再回退内置列表（返回空列表，由用户手填）；聊天区首次拉到列表且尚未选模型时自动落到第一个可用模型；新建模型配置的模型为空，未选定前不允许激活。Renderer：`AppDropdownSelect` 新增可选 `searchable` 与 `allowCustom`（默认 `false`，其余数十处调用行为、DOM 结构与 aria 属性不变），模型下拉支持搜索与手动输入，设置页两处模型字段与聊天区均已接入。构建侧：`build-profile-validator` 允许 `defaultModel` 为空（非空时仍必须出现在 `models` 里，否则构建失败），`bundle-backend-ts` 的开发兜底供应商副本同步去模型名。验证：Backend 全量 130 文件 1254 项（新增 1 项防回归断言）、`tsc --noEmit`、构建配置校验测试 3 项（新增 1 项）、Renderer 全量 44 文件 288 项（新增 9 项）与生产构建通过、`npm run dev` 实际启动成功（Backend 8765、网站探索agent 8766、Bridge 3711）；未在真实窗口逐项点击验收搜索、手填与自动聚焦交互。内置模型 `builtin`、`builtin_dev` 是固定服务且没有模型列表接口，仍保留其内置模型名。

- 2026-10-16：专属 Agent 生成的「项目文件夹」改为只读：文件夹名固定为 `专属 Agent - Agent 名字`，用户不能再手动重命名，只能通过修改 Agent 名称同步更新。Backend：Agent 改名（`PATCH /dedicated-agents/:id`）后按同一命名规则同步重命名项目文件夹（同名冲突时回退 `名字 (2)`、`名字 (3)`…，且不会因文件夹冲突导致 Agent 改名失败）；`GET /projects` 给 Agent 项目附加 `dedicated_agent: true`；`PATCH /projects/:id` 对 Agent 项目返回 400，提示改用 Agent 名称。Renderer：侧栏对这类项目隐藏「重命名项目」与「在项目中创建新对话」入口（对话只能在专属 Agent 页里新建），并在文件夹名上悬停说明原因。验证：dedicated-agent 工作区测试 6 项（新增 2 项）、Backend 类型检查、Renderer 生产构建与单测 9 项通过；未在真实窗口内逐项点击验收。

- 2026-10-16：专属 Agent 名称支持就地修改：左侧列表项与详情页头部的名称旁新增小铅笔图标，点击后名称切换为输入框，Enter／失焦经 `PATCH /dedicated-agents/:id` 保存并同步列表与详情，Esc 取消；名称做 trim、非空与 40 字符上限校验。列表项由 `<button>` 改为 `role="button"` 的 `div`，避免「按钮嵌套按钮」并容纳行内输入。新增 `normalizeAgentName` 纯函数及单测（dedicated-agents 单测 9 项通过）、Renderer 生产构建通过；已通过 Vite HMR 应用到运行中的应用，未在真实窗口内逐项点击验收。

- 2026-10-16：修复上下文面板把一次查询内部多轮模型／工具调用的累计 usage 当成单次上下文大小的问题。普通模型 usage 仅用于用量指标，不再校准全局规则等上下文分类；turn-end 快照继续显示当前请求的本地估算，只有上下文探针才执行 provider 校准。Backend 上下文聚焦测试与 Renderer 上下文测试通过。

- 2026-10-16：自动规划模式的工作流选择改为内部判断，不再要求首条回复展示“选用直接执行”等模式标签与理由；要求直接回应用户并保持简洁。Backend ZCF 同步测试 19 项、类型检查通过。

- 2026-10-16：新增首次启动模型初始化界面：默认选择内置模型，支持两个内置模型与 Anthropic、智谱 GLM、DeepSeek 三个预定义供应商；供应商必须先保存 API Key 才能继续。初始化完成状态持久化到 Backend 设置，后续启动直接进入主界面；Renderer 构建、初始化状态存储测试、模型设置测试与 Backend 类型检查通过。

- 2026-10-16：修复 Windows 卸载残留：托盘后台和网站探索agent子进程可能在 NSIS 删除安装目录前仍占用 Electron DLL 与 `resources`，导致卸载后留下文件。新增 `customRemoveFiles`，卸载时结束 WeWorker/Webwright 进程树、等待句柄释放后递归删除安装目录；用户数据目录仍保留。补充打包配置测试；未构建完整安装器或在真实安装/卸载流程中验收。
- 2026-10-16：为网站探索agent的 Windows PyInstaller 可执行文件补充 WeWorker 版本资源。构建时动态生成 VERSIONINFO，文件属性包含 ProductName/CompanyName「WeWorker」、描述、产品版本、原始文件名等关键字，保留现有 Webwright.exe 文件名和 embedded onedir 结构；补充分发契约测试。验证：distribution 契约测试 10 项通过、Python 语法检查通过；未在本次变更中构建完整 Windows 安装包或进行安全软件白名单实机验收。
- 2026-10-16：整合本地专属 Agent 工作区改动：创建草稿立即入列表，向导支持名称编辑、必填提示及步骤保留；列表尺寸与对话侧栏对齐。创建成功生成专属项目和首个同名对话，主对话页与 Agent 页共用 work_id，企业微信/微信配对与后续新对话沿用该项目；旧会话取消主列表过滤。合入 #90、#94 后保留两边更新记录，Backend 8 文件 77 项、Renderer 全量 275 项测试及两端构建通过；未验证真实扫码和打包界面。
- 2026-10-16：将本地思考关闭功能整合到最新 dev-1.1.0 会话预启动实现。菜单新增「关」并默认关闭；未知模型通过 extra body 显式发送 disabled，开关变化触发会话重建，预启动与正式请求保持一致；模型总耗时和工具等待不再标作思考。合入 #90 后解决 agent 导入冲突，同时保留即时输出过滤器；公开 profile 准备后 Backend 53 项、Renderer 7 项聚焦测试及两端构建通过。未验证第三方线上服务是否遵循参数或承诺提速。
- 2026-10-15：桌面端新对话首轮预启动。用户在输入框开始输入时（每个对话目标 60 秒内最多一次，`!` 命令不触发），Renderer 调用 `POST /works/:id/warmup`（已有对话、专属 Agent 对话）或 `POST /chat/warmup`（欢迎页，尚无 work）；Backend 按与 `/works/:id/chat` 相同的选项完成准备并提前启动 Claude Code CLI，欢迎页的备用会话在首条消息创建 work 后按配置指纹绑定，MCP 工具改为调用时解析 work。预启动会话首轮发送完整提示；配置不一致时不使用；未使用的预启动会话 3 分钟关闭，同一目标的并发预启动只执行一次。验证：Backend 类型检查、全量 106 文件 859 项（新增预启动 4 项）、public bundle；Renderer 全量 268 项（新增 4 项）与生产构建通过。本机真实 CLI + 本地假模型端点、模拟输入 8 秒：新对话首字由约 10.5 s 降到约 0.8–1.8 s。未验证：真实模型与打包版 Electron 下的效果、macOS；输入时间短于 CLI 启动时间时只能省掉一部分等待。未提交。
- 2026-10-15：按 `docs/2026-10-13-issue-record.md` 优化桌面端对话延迟。① 桌面对话（含专属 Agent 桌面续聊）每个 work 保留一个 streaming-input 模式的 Claude Code 进程，后续轮次只发送新消息，不再冷启动 CLI、不再文本重放历史和已加载 Skill；配置指纹（模型/Key 摘要/系统提示/Skill 索引/Adapter 摘要等）或历史前缀不一致、压缩、出错、中断、并发轮次时回退或重建；最多 3 个会话、空闲 10 分钟关闭，删除 work 与手动压缩会释放会话；全 URL 转发 relay 随会话关闭。渠道、定时任务、探索与压缩路径行为不变。② Backend 共享 Adapter 目录快照（按注册表、内置 profile、根目录条目、开发/已安装包文件 stat 判定失效），托管 Skill 刷新在快照与目录未变时跳过，内容相同不重写 SKILL.md；`.claude.json`/`settings.json` 仅变化时写入。③ 修复历史重放标题乱码；专属 Agent 桌面固定直接执行模式、专属 Skill 每个对话只加载一次，并补充不可恢复错误不等待重试、禁止 `Start-Sleep;`/`webcli trace` 的提示；自动规划选择直接执行时不再输出工作流说明。④ 新增 `chat_turn_timing` 阶段耗时日志及 SDK ttft/请求耗时字段（不含提示正文）。验证：Backend 类型检查与全量 106 文件 852 项通过（新增会话复用、目录快照、Skill 刷新跳过、专属 Agent 直接模式等测试；两次全量中各有 1 项时序相关用例偶发失败，单独重跑通过，第三次全量全绿），public bundle 通过；WebCLI 相关 3 文件 31 项与语法检查通过。本机真实 CLI + 本地假模型端点实测：首轮约 13–15 s，复用后第 2、3 轮首字约 0.5 s（原每轮 CLI 启动约 5–8 s、托管 Skill 同步约 1–2.4 s）；中断后会话及 CLI 进程被清理，Backend 被强杀时空闲 CLI 随 stdin 关闭退出。未验证：真实模型（GLM 等）多轮质量与提示缓存、真实网站 Adapter 场景、打包版 Electron 下的会话生命周期与退出清理、macOS；新对话首轮的 CLI 冷启动仍存在（可后续做输入时预热）。未提交。

- 2026-10-16：优化对话首字输出并兼容最新 Claude 会话实现。普通文本在 SDK 文本块结束前增量推送，隐藏记忆块继续完整解析和保存，base64 图片不显示；保留 #92 的 chat-session 会话复用、输入预启动和阶段耗时日志，移除已被替代的旧会话实现。补齐复用与预启动后的当前站点工具提示，切换流式模式时重建会话，删除专属 Agent 对话时释放会话及压缩缓存；Windows 避免每轮执行 Unix 路径查询。验证：Backend 类型编译、全量 127 文件 1234 项通过（2 文件 4 项按原条件跳过）、公开 profile 生成与 Backend bundle 通过；真实 Claude SDK 配合隔离配置和本地模拟接口验证单进程两轮工具调用、当前轮回调、上下文延续及退出清理，未调用付费供应商。首次聚焦运行有 1 项触发默认 5 秒超时，标准 test:ci 全量运行通过。未验证真实供应商延迟对照、跨平台安装包和桌面端完整生命周期；无 Renderer 改动。

- 2026-10-16：将执行权限已拒绝的 13 个原生工具加入 SDK 加载排除名单（工作树、Agent 通信、任务管理、唤醒、搜索及工作流），避免向模型注入其定义。保留现有文件工具、Skill、平台命令工具及 MCP 配置。相关 4 文件 32 项测试、Backend 类型检查通过；使用隔离配置和本地模拟接口捕获 Windows 原生命令工具开启时的 SDK 请求，确认 13 项均不再出现、支持的 8 项仍存在，原生工具定义从 61,014 降至 25,935 字符。该字符数不含真实运行的 MCP/Skill/规则，不代表 token 或首字耗时；未进行真实模型延迟验证。

- 2026-10-16：把工作区积压的智能路由 P0~P4 与两项独立修复落成 5 个提交并推送到 `origin/dev-1.1.0`（`a603ba3..1ce80bf`，规范仓本体分支直推，非 fork 流程）。提交划分：`b4c3002` `fix(webwright)` worker 子进程不再继承父进程 stdin（`process_manager.py` 的 `Popen` 加 `stdin=subprocess.DEVNULL` + 单测）；`3737848` `test(webcli)` 补 `base_url_is_full` 以匹配 `normalizeAiConfig` 规范化后的桥接层配置；`0e3fda8` `feat(router)` 智能路由 P0~P4 全量移植（97 文件：`router-config/` 分层加载与校验、`api-query-router/` 十层级联、`site-gate`/`tier4-dispatch`/`tier4-graduation`/`toolkit-skills`/`webwright-client`、`weworker/router-config/` 九个配置文件、Renderer 站点「路由直达」徽标与 `!` 别名同源、`gen-routes`/`route-replay` 脚本、`docs/intelligent_routing_*.md` 与 `docs/router-config-manual-testcases.md`、`EXTENSION_DEV_GUIDE.md` §8.8）；`797969d` `feat(chat-bench)` 新增 `--router-cases`/`--only` 与 `results.md` 逐条台账；`1ce80bf` `fix(router)` 收窄 `adapter-grouped` 测试对 `raw` 的断言。**推送前复跑验证发现 P4 条目所称「`tsc --noEmit` 无输出」不成立**：`src/__tests__/adapter-grouped.test.ts` 有 5 处 TS18046（`AdapterGroupedExpansion.raw` 类型为 `unknown`，测试直接 `out.raw.configs` 下标访问），已在 `1ce80bf` 以测试侧 `rawObject()` 收窄修掉，未改源码语义。另发现既有的环境缺口：`weworker/backend-ts/package.json` 声明了 `yazl` 与 `@types/yazl`（基线 `a603ba3` 即有，本次未改这两行），但本机 `node_modules` 未安装，导致 `skill-zip-import.test.ts` 与 `dedicated-agent-skill-import.test.ts` 报 `Cannot find package 'yazl'`；已用 `npm install` 补齐（该命令会重写 lockfile 的 `peer` 标记，属 npm 版本造成的元数据抖动、无包与版本变化，按「本次不改依赖」口径已 `git checkout` 丢弃 lockfile 改动，仓库内依赖文件保持零变化）。`.scratch-router/`（route-replay 日志、dry-run 报告与临时扫描脚本等本地产物）已加入 `.gitignore`，未进入任何提交。验证（推送前于本机全部复跑）：`tsc --noEmit` 无输出、退出码 0；Backend `npm run test:ci` → **123 文件通过 / 2 文件跳过，1199 项通过 / 4 项跳过、0 失败**（补齐 `yazl` 前为 121 文件通过 / 2 文件失败、1173 项通过）；Renderer `npm run build` → ✓ 3.57s，`node --test "src/__tests__/*.test.js"` → **268 项 / 25 套通过、0 失败**；网站探索agent `uv run python -m pytest tests/unit/test_server_process_manager.py` → 23 项通过。敏感信息扫描（`sensitive_scan.py --base origin/dev-1.1.0`）命中全部为误报：`private-ip` 均为 `127.0.0.1` 回环，`browser-profile` 均为 `config`/`configured` 标识符子串，`api-key-assignment` 均为 `'fake-test-key'` 一类既有占位值。未执行安装包构建、桌面端构建与真实站点联网验收。下方 P0~P4 是同一批工作的分阶段记录，其中 P0 与 P1＋P2 条目所称「尚未接入路由链」、「尚未接入 `server.ts`」已被同批的 P3、P4 覆盖；四条（连同本次两项独立修复）今起随本条一并入库并推送。

- 2026-10-15：对话消息区新增历史消息快捷导航条；仅按用户提问生成窄标记，点击可平滑跳转，悬停或键盘聚焦显示提问预览，滚动时同步当前提问高亮。复用现有消息数据与滚动容器，未增加后端存储或依赖；导航工具 4 项单测、Renderer 生产构建与 `git diff --check` 通过。

- 2026-10-14：专属 Agent 支持微信机器人：创建向导与「更换机器人」可在企业微信/微信之间切换，微信用 iLink 扫码登录获得机器人（凭证只留在 Backend 内存并 SM4 加密落盘，不返回 Renderer；扫码返回的服务地址须在微信允许列表内），之后同样发送 6 位绑定码配对，只服务主人。抽出企业微信/微信共用的通道 profile，微信通道支持多实例并发、`/new`/`/stop`（含全角斜杠与「新对话」）中断进行中的任务；主通道默认行为保持不变。一个微信机器人只能连接主通道或一个 Agent（按机器人 ID 或登录凭证判定，主通道保存、启用与扫码均会拒绝被 Agent 占用的凭证）；旧 Agent 记录默认视为企业微信。修复微信对话一直显示「正在处理」：iLink 的 context_token 只在用户发消息后约 1.5–2 分钟内可用，超时后 sendmessage 返回 ret=-2 且原实现未检查而静默丢失结果，同时每 10 秒发送的「正在处理...」刷屏；现改为最多两条进度提示（15 秒、75 秒，后者提示超时后发任意消息取结果），检查发送结果，被拒绝的答复保留并在用户下一条消息时补发（发送「结果」只取回答复，不开新任务）。验证：Backend 类型检查、全量 104 个测试文件 839 项通过（新增微信存储/扫码会话/通道 profile、超时补发与进度提示共 16 项），public bundle 通过；Renderer 全量 260 项与生产构建通过；Electron 48 项与语法检查通过。未验证：真实微信长任务补发、真实微信扫码、同一微信号重复扫码时 iLink 返回的机器人 ID 是否不变、微信端绑定码配对与 `/new`/`/stop`、多个微信 Agent 同时在线，以及桌面端界面交互；未提交。

- 2026-10-14：按参考补丁移植「专属 Agent」：每个 Agent 绑定一个网站 Adapter、可选私有/共享 Skill 与独立企业微信智能机器人，6 位绑定码确认主人，非主人不可操作；支持 `/new`、`/stop`（兼容全角斜杠、零宽字符和「新对话」）。Bot Secret 以 SM4 加密存 Backend，不返回 Renderer；一个机器人只能连接主通道或一个 Agent，已适配多机器人配置（任一已保存的企微配置均视为占用，主通道保存/启用也会拒绝被 Agent 占用的机器人）。Agent 使用独立 `CLAUDE_CONFIG_DIR`，只复制 webcli、本站 Adapter Skill、本站自定义 Skill 与所选 Skill；工具限制为本站单条 `webcli call`，并防止同前缀更长 Adapter ID 被误判为本站。Skill 支持 AI 生成/修改、导入 `.md` 或含 `SKILL.md` 的 ZIP；ZIP 改用已有 `yauzl` 依赖（未新增 fflate），先校验中央目录与本地文件头一致、路径穿越、绝对路径、加密/ZIP64/分卷、符号链接/特殊文件、条目数与解压大小。桌面端在主导航新增「专属 Agent」入口，页面打开时隐藏主侧栏；创建向导、对话/设置页签、开关与下拉统一复用 AppSwitch/AppDropdownSelect，确认提示改用全局弹窗。Electron 新增后台常驻：关闭窗口隐藏（Windows 可关闭此行为）、真正退出时提醒、托盘/菜单栏、打包版默认开机自启；托盘图标由现有品牌图标生成到 `electron/assets/`。验证：Backend 类型检查、全量 102 个测试文件 823 项通过（含新增 6 文件 73 项中性 fixture 测试），Backend public bundle 通过；Renderer 全量 259 项（新增 7 项）与生产构建通过；Electron 全部 48 项（新增 12 项）、webwright 集成 23 项与语法检查通过。未验证：真实企业微信扫码/绑定/`/new`/`/stop`/续聊、真实模型生成 Skill、内置浏览器界面交互、Windows 托盘与退出确认、打包版开机自启、macOS 关闭窗口/Dock 唤回/⌘Q 提醒及应用退出清理；新增 Electron 测试尚未接入 CI 脚本。未提交或推送。

- 2026-10-14：仅优化场景工作区排版：左侧新增场景入口、站点选择、搜索、列表标题与场景行改为紧凑层级和整行选中态；右侧场景标题区与折叠编辑区收紧间距并保持清晰边界；未修改场景创建、选择、搜索、编辑或保存逻辑。Renderer 生产构建与 `git diff --check` 通过。

- 2026-10-14：Skill 工作区新增 ZIP 导入入口。桌面端只通过文件选择器传递本地 ZIP 路径，由 Backend 直接读取并安全解压到运行时 `~/.weworker/claude-config/skills`，校验路径穿越、符号链接、条目数量、解压大小、`SKILL.md` 结构与同名冲突，成功后刷新公共 Skill 列表；失败会清理临时目录且不覆盖已有 Skill。Backend ZIP 导入 4 项聚焦测试、类型检查、构建与 Renderer 生产构建通过；未使用真实安装包或真实用户 ZIP 验证。

- 2026-10-14：Skill 工作区改为卡片目录，详情移入默认收起的右侧抽屉；卡片悬停/键盘聚焦显示“查看”，点击后打开对应详情。抽屉提供 Skill 详情与工具包两个视图，保留既有工具包功能；场景工作区保持原布局。内置浏览器通过合成数据验证默认收起、查看按钮、抽屉关闭、工具包切换及分栏无遮挡，未检查窄屏小于 760px 的最终动画布局；相关 10 项单测、Renderer 构建和差异检查通过。

- 2026-10-14：调整 Skill 详情标题区顺序，将名称置于最上方，来源信息降为辅助行，并收紧标签字号、内边距与间距，减少标题区占用空间；保留标签编辑和来源提示功能。

- 2026-10-14：优化 Skill 详情标题区层级：来源改为带状态点的小型辅助标识，名称作为主标题突出显示，标签紧随标题排列，右侧操作统一对齐，减少空白并保持现有功能。内置浏览器合成数据验证官方/自定义 Skill 切换、文档与资源展开状态及无控制台错误；相关 10 项单测、Renderer 构建和差异检查通过。

- 2026-10-14：按选定方案将添加技能入口替换为 ThunderboltOutlined 闪电与 PlusOutlined 加号角标，保留原按钮尺寸与配色，提示统一为“添加技能”。内置浏览器合成数据验证图标显示和点击新增，无控制台错误；相关 10 项单测、Renderer 构建和差异检查通过。

- 2026-10-14：Skill 列表的新增入口改用 FileAddOutlined 文件加号图标，明确新增 Skill 文档的含义；相关 10 项单测、Renderer 构建及差异检查通过。

- 2026-10-14：Skill 详情的 SKILL.md 与资源文件整理为统一白底文件分组，数量紧邻标题，统一图标、行高与边距，资源添加入口固定右侧；无阴影，保留编辑、折叠与资源操作。内置浏览器通过合成数据验证宽窄布局、鼠标与键盘折叠、添加菜单独立、新建/重命名/编辑资源、文档编辑及官方只读，无控制台错误；相关 10 项单测、Renderer 构建和差异检查通过。

- 2026-10-14：修复 Skill 卡片固定高度下标签换行挤压名称与描述的问题；标签改为单行溢出省略，卡片按内容确定高度并保留三行文字空间。Chrome/Playwright 复现原名称/描述高度为零，并验证修复后宽窄窗口与 100%/150% 缩放均完整显示；相关 10 项单测、Renderer 构建和差异检查通过。

- 2026-10-14：Skill 列表悬停提示简化为名称，避免类型、说明与参数形成过长提示；相关 10 项单测、Renderer 构建及差异检查通过。

- 2026-10-14：Skill 列表精简为搜索、添加和统一列表，取消范围、站点和来源的强制筛选；原分类转为可增删的初始标签，搜索覆盖名称、描述和标签。标签保存为本机管理偏好，允许删除全部初始标签且重开不恢复；官方文档保持只读。新增 Skill 默认使用不绑定站点的公共自定义存储，兼容原站点 Skill 编辑与场景入口；没有站点也可新增。Renderer 252 项测试、构建、语法与差异检查通过；Chrome/Playwright 合成数据验证跨站点/公共搜索、标签增删/取消/重载、新增、空站点和窄屏，无运行时错误。未验证真实 Skill 执行与跨设备标签同步，未提交或推送。

- 2026-10-14：四种通道信息统一为基本信息与配置两组圆角边框，复用模型配置的边框、背景、圆角和内边距规则，保留扫码、凭证与权限操作。相关 17 项单测、Renderer 构建和差异检查通过；Chrome/Playwright 模拟响应验证四种通道分组样式及窄窗口无溢出，原有机器人管理交互回归通过。

- 2026-10-14：机器人下拉菜单的悬停与键盘聚焦背景统一覆盖整行，名称和操作按钮不再单独变灰；选中行保持绿色。Chrome/Playwright 验证整行背景、子按钮透明及选中态，相关 17 项单测、Renderer 构建与差异检查通过。

- 2026-10-14：通道配置移除同类型机器人中间列表，改为顶部下拉选择；菜单保留使用、重命名、删除和添加，名称旁以铅笔行内编辑，下方明确标注机器人类型。选择配置与启用保持独立，长列表滚动且菜单挂载顶层。相关 17 项单测、Renderer 构建和差异检查通过；Chrome/Playwright 模拟响应验证切换、新增、两处重命名、删除取消/确认/最后一项、空态、配置/检测/扫码归属、键盘关闭与窄屏布局，无运行时错误；未使用真实账号验证平台接入，未提交或推送。

- 2026-10-14：模型配置名称移至顶部标题行，通过编辑图标行内修改，移除基本信息中单独的名称输入行；Enter／失焦即时保存、Esc 取消，空名称和保存失败保留编辑以便重试。仅提交名称，保留未保存的接口参数，固定供应商名称保持只读。相关单测 42 项、Renderer 构建与差异检查通过；Chrome/Playwright 验证保存、取消、失焦、错误重试和固定名称只读，无运行时错误。未提交或推送。

- 2026-10-14：机器人配置顶部名称增加编辑图标，点击可行内重命名，Enter／失焦保存、Esc 取消，保存后同步左侧机器人列表；空名称保留编辑并提示错误，失败可重试。配置状态单测 4 项、Renderer 构建和差异检查通过；Chrome/Playwright 模拟响应验证顶部保存、取消、失焦保存及列表与标题双向同步，无运行时错误。未提交或推送。

- 2026-10-14：通道支持按类型保存多个命名机器人，在类型工作区内增加机器人列表与独立配置两栏，提供使用、行内重命名、确认删除及新增入口；每类仅一个启用实例，切换串行停止旧连接，删除使用中配置后停用该类。兼容旧单机器人配置，独立凭证沿用加密存储且不返回前端；扫码导入、失败重试和连通性检测绑定具体配置，微信二维码增加会话校验。后端相关 13 文件 106 项测试、类型检查、Renderer 全量 247 项及新增清理用例聚焦检查、构建与差异检查通过；Chrome/Playwright 模拟响应验证新增空配置、切换、重命名、确认删除、扫码与检测归属、滚动及窄屏无越界。未使用真实账号验证多机器人切换或平台扫码，不代表安装包验收；未提交或推送。

- 2026-10-14（智能路由 P4：生效范围可观测 + 输入框别名同源 + 文档收口）：让「配置改完是否生效」不再只能靠猜，并补齐 Adapter 侧路由字段的公开文档。新增 `weworker/backend-ts/src/router-config/routable.ts`：`computeRoutableSites(bundle, adapterIds)` 的判据是**「只说能证明的事」**——某站点 `routable` ⇔ 该 Adapter 已启用，且其名下工具被当前配置里**至少一条启用条目**引用；来源覆盖 `routes` / `aliases` / `shortcuts` / `patterns.configs` / `plans`（resolver 与 terminal）/ `scenario-routes` 六类，逐条跳过 `enabled:false`、`optout`／`direct:false`、以及被 `isToolInAdapterScope` 判为作用域外的条目；工具归站按**最长前缀**匹配（`mail.qq.com.cn` 的工具不会被算到 `mail.qq.com` 上），工具名等于 Adapter id 本身同样计入；返回 `{ routable, entryCount }` 两个只读视图，空集／空束／坏配置一律返回空报告，绝不抛异常。`index.ts` 追加 `computeRoutableSitesFromConfig(adapterIds)` 便捷出口（读的已是按启用 Adapter 作用域过滤后的配置束，因此 `manifest.layers` 开关自动生效，不重复实现层开关）。`server.ts`：`GET /sites` 每项追加 `routable`（boolean）与 `routeEntryCount`（number）；新增 `GET /router/aliases`——复用既有的 `listAliasTexts()`（**不另建一份渲染层清单**），异常时返回空数组而非 500，因为输入框靠「空数组」回退到随包静态清单，`!` 命令不会整体失灵。Renderer：`SitesCapabilitiesView.jsx` 站点列表行加「路由直达」徽标（title 提示命中条数）、网格缩略图加同信息角标（选择器 `.cap-site-mini span.cap-site-mini-badge` 特意比同格 `span` 更具体，否则被 `width:100%` 撑满）；`api/sites-api.js` 增 `fetchRouterAliases()`；`store/sites.js` 的 `load()` 把别名并入 `Promise.all`（`.catch(() => [])` 兜底）；`InputBar.jsx` 的 `!` 命令识别从手维护静态清单改为读**后端生效别名**（`state.routerAliases`；静态清单降为后端缺席时的兜底），并把配置别名一并列进 `!` 补全菜单（`bang:alias:` 条目、`kind: 'alias'` → 标签“route”），使「改 `aliases.json` → 输入框跟着变」成为同一条链路。文档：`EXTENSION_DEV_GUIDE.md` §8.8 新增「可选 —— 智能路由字段」表（`scenarios[].route` 三形态与「含 `${}` 必须显式声明」、`route_templates` 的枚举槽/自由槽写法与 `validate` 禁用形态、`gate_aliases` 的词边界语义、`tool_execution` 是**按工具名索引的对象而非数组**）＋ 只读且可直调的准入硬门；`weworker/router-config/README.md` 增补两个只读出口的口径表。顺带订正三处把 `tool_execution` 描述成数组的注释（`adapter-parser.ts`、`api-query-router/page-prep.ts`、`api-query-router/tool-catalog.ts`）。公开基线的状态：`adapters/` 与 `extension/` 下**没有任何 manifest 声明 `gate_aliases` 或 `tool_execution`**（全仓 JSON grep 为空），故 siteGate 只靠域名信号、page-prep 在公开仓库是显式空态；内部规则仍只经构建 Profile Overlay 与 `WEWORKER_QUERY_ROUTES_CONFIG` 注入，本仓库不落任何内部词表。验证：`tsc --noEmit` 无输出；Backend `npm run test:ci` → **107 文件 / 1022 项通过**（2 文件 / 4 项跳过），本批新增 2 文件 / 19 项（`router-routable.test.ts` 15：六层各点亮一站、`plan.terminal` 归因、`enabled:false` 全层归零、`optout`/`direct:false` 不计、作用域外丢弃、最长前缀、工具名等于 Adapter id、坏条目跳过、空集不抛，以及 `computeRoutableSitesFromConfig` 的缺目录/坏 JSON/真实配置/空 id 集四态；`router-aliases-endpoint.test.ts` 4：正常返回、只把启用 Adapter 交给作用域、配置坏掉返回空数组而非 500、无别名返回空数组——后两项是把「不 500」当契约钉住）；Renderer `npm run build` → 3439 模块 / 2.00s 通过，`node --test "src/__tests__/*.test.js"` → **248 项 / 24 套通过**（新增 `sites-routable-badge.test.js` 2 项，钉住徽标读后端字段而非渲染层自算、列表与网格两处都在；重写 `router-bang-command.test.js` 3 项，钉住别名取自后端且 `.catch(() => [])` 兜底）。未执行安装包构建、桌面端构建与真实站点联网验收。
- 2026-10-14（智能路由 P3：第 3／4 层接入 + 毕业管线 + page-prep）：把设计文档第 14~17 行落地到运行时。新增六个模块：`weworker/backend-ts/src/webwright-client.ts`（8766 只读 HTTP 客户端：health 30 秒 TTL 含负缓存、任务 CRUD、`readWebwrightSse` 帧解析；地址只取本模块常量与 `WEWORKER_WEBWRIGHT_URL`，**不接受调用方传入 URL**）、`site-gate.ts`（第 3 层：域名／别名双遍信号匹配，0 命中即 miss、多命中即 ambiguous，ASCII 信号走 `^[\w.-]+$` 词边界、CJK 走子串，避免 `XXITSMYY` 误命中；工具清单上限 30 条／8000 字符）、`toolkit-skills.ts`（第 16 行毕业识别：扫 `<user_directory>/.claude/skills/` 的 `adapter_type=toolkit` 包，坏 JSON／缺字段／非目录一律跳过而非抛异常）、`tier4-dispatch.ts`（第 15 行判定 + 事件流映射，含 `FILE_EXTENSION_TLDS` 防「下载 v1.2.zip」误判、**首信号优先**取舍与只读护栏）、`tier4-graduation.ts`（`tier4-usage.json` 原子落盘，默认第 3 次提示一次，`0` 关闭）、`api-query-router/page-prep.ts`（第 17 行：仅对目录里声明了 `navigate_before` 的直调工具先开页面，等待语义按 bridge 回报的 `waitedMs` 补残余，异常一律 best-effort 不外抛）。接线：`server.ts` 在 `streamChat` 前并行取 siteGate＋toolkit 候选，命中即预注入站点工具清单（`agent.ts` 新增 `siteToolkitPrompt`，经 `skillContextPrefix` 与 `loadedSkills` 同通道进 prompt——内部超集此字段是**未被消费的死代码**，此处按设计目的真正接入）、miss 且含未注册站点才转交第 4 层，回合结束按 host 计数并在恰达阈值时提示固化；`adapter-parser.ts` 新增 `ParsedAdapter.gateAliases` 与 `ToolExecution.navigate_before`（含 legacy／registry 两路回退），`webcli/adapter-desktop.d.ts` 同步声明 `gate_aliases`，`tool-catalog.ts` 透出 `navigateBefore` 供 page-prep 读取（单一事实来源仍是目录，不再二次 parse）。急停开关：`WEWORKER_SITE_GATE`／`WEWORKER_TIER4`／`WEWORKER_TIER4_TIMEOUT_MS`／`WEWORKER_TIER4_ALLOW_WRITES`／`WEWORKER_TIER4_GRADUATE_AFTER`／`WEWORKER_PAGE_PREP`／`WEWORKER_PAGE_PREP_WAIT_MS`／`WEWORKER_WEBWRIGHT_URL`，全部缺省保持既有行为。同时带上内部仓库工作区尚未提交的三项修复：SSE 连接超时只覆盖建连（否则分钟级任务在第 10 秒被静默截断）、任务入口链接单独成行（与中文相邻会被链接器吞成 404）、worker 启动期停滞（`subprocess.Popen(..., stdin=subprocess.DEVNULL)`，不继承启动方给的管道）。验证：`tsc --noEmit` 无输出；Backend `npm run test:ci` 105 文件／1003 项通过（2 文件/4 项跳过），其中本批新增 6 文件／120 项（`webwright-client` 28、`tier4-dispatch` 30、`tier4-graduation` 15、`toolkit-skills` 11、`site-gate` 19、`page-prep` 17），含以 `connectTimeoutMs: 20` + 60 ms 后才产出响应体的 stub 钉住「建连超时不得中止响应体」的回归门；网站探索agent harness `uv run python -m pytest tests/unit` 得 268 项通过／3 项跳过／1 项失败（`test_local_cdp.py::test_default_user_data_dir_uses_webwright_home_on_windows` 用 `Path("/tmp/...")`，在 Windows 上非绝对路径，本批未改动该文件，属既有环境性失败），聚焦 `test_server_process_manager.py`＋`test_server_lifecycle.py` 29 项通过（含新增 `stdin is DEVNULL` 断言），`npm run test:webwright-integration` 23 项通过。生命周期部分**未改动任何生命周期逻辑**：本次只新增对 8766 的只读 HTTP 客户端；已核对 `webwright-manager.js` 对**服务器**仍以 `--exit-on-stdin-close` 拉起并在正常停止时 `child.stdin.end()`，而 `stdin=DEVNULL` 改的是 Python 服务器自己的 **worker** 层，worker 从不接收该参数（全仓 grep 确认），故正常停止通道与「只清理本次启动的进程」「8766 被占用时不接管未知进程」语义不变；既有聚焦用例 `port conflict does not spawn or terminate another process`、`normal stop closes stdin before waiting for process exit`、`unexpected exit schedules a bounded restart` 全部通过。未执行安装包构建、桌面端构建与真实站点联网验收。

- 2026-10-14（智能路由 P1＋P2：级联引擎 + 配置化层）：在 `weworker/backend-ts/src/api-query-router/` 落地级联引擎，`cascade.ts` 按设计文档顺序编排十层 `route`（层 P 配置路由）→ `scenario-a`（第 0 层形态 A 单工具）→ `scenario-a-plan`（形态 A 多跳）→ `template`（Tier −2 manifest 模板直达）→ `scenario`（形态 B 话术／形态三 opt-out，两者均先于硬门 ① / ①b 判定）→ `pattern`（Tier −1 提示词配置）→ `plan`（plan 锚点 DAG）→ `alias`（`!` 别名）→ `shortcut`（Tier 0/1 守卫短路）→ `llm-classify`（Tier 2 词法召回后分类，公开基线**默认关闭**，无 `llmClassify` 匹配器即整层不生效），并固化两条顺序硬约束（第 0 层必须先于 Tier −1；Tier −2 在硬门之前但让位于 `!` 别名）与「任一层失败即 `return false` 落回 LLM」的精度红线。分层实现均为纯函数、可注入依赖（`routes-layer` / `manifest-templates` / `patterns` / `shortcuts` / `aliases` / `plan-dag` / `anchor-plan` / `recall` / `gates` / `scenario-routes` / `declarative-renderer` / `generic-renderer` / `tool-catalog`），出口为 `planRouteDecision` / `executeRoutePlan` / `tryIntelligentQueryRoute`。卡片话术编译器 `scenario-route-compiler.ts` 由 CLI 与运行时共用（规则 ①~⑥：只读硬门、args 键与必填覆盖、占位符双向闭合、与手写层冲突仅告警、含 `${}` 卡片必须有 route 决策、遮蔽门同 adapter 报错／跨 adapter 告警），`weworker/scripts/gen-routes.mjs` 用 esbuild 打包 `scenario-route-cli.ts` 后调用，`package.json` 新增 `gen:routes` 与 `gen:routes:check`。P2 打通 `shortcuts` / `aliases` / `plans` 三层的配置化增删改，改文件后下次读取即生效（mtime 热重载，无需重启），坏配置只回退该层、整条链路仍降级落回 LLM。公开基线编译产物为 11 条 opt-out（公开卡片均为写操作或纯展示，无内部业务规则，内部规则仅由 Profile Overlay 注入）。验证：`tsc --noEmit` 无输出；`npx vitest --run src/api-query-router src/__tests__/router-config.test.ts src/__tests__/profile-query-route.test.ts` 得 7 文件 / 148 项通过（含新增 `scenario-route-compiler` 31 项、`cascade` 26 项、`scenario-routes` 28 项、`config-layers` 36 项、`route-eval` 3 项，其中 `route-eval` 以 35 条对抗性负例与 `positiveChecked === routeCount` 断言防「引擎未加载导致假绿」）；`npm run gen:routes:check` 输出 `check ok`。本批新增配置层与引擎，**尚未接入 `server.ts` 的 `POST /works/:id/chat`**（接入属 P3），故运行时行为仍与今天一致。未执行安装包构建、桌面端构建与真实 Adapter 联网验证。

- 2026-10-14（智能路由 P0：配置骨架）：实现 `weworker/backend-ts/src/router-config/`（`types.ts` 分层配置类型 · `validate.ts` 逐层校验 + Adapter 作用域过滤 · `loader.ts` bundled＋`~/.weworker/router/` 覆盖层合并与 mtime 热重载 · `index.ts` 出口），并落地 `weworker/router-config/` 九个**空白无效**配置文件与维护说明。语义：数组型层按 id 逐条合并、记录型层按 key 合并且 `null` 表示删除、条目级 `enabled:false` 下线、`manifest.layers` 逐层开关；坏配置只回退该层到上一份可用版本，绝不抛异常；条目引用的工具不属于当前 Adapter 时整条丢弃。构建侧同步 `scripts/bundle-backend-ts.cjs` 复制 `.json` 到 `build/backend-ts-dist/router-config/`，`package.json` extraResources 增补 `router-config/**`。**P0 未接入路由链**（生产代码零引用），零配置行为与今天一致。验证：`tsc --noEmit` 通过；Backend `npm run test:ci` 94 个测试文件、756 项通过（2 文件/4 项跳过），其中新增 `router-config.test.ts` 19 项；`node --check` 构建脚本、`package.json` 解析通过。未执行打包构建与真实 Adapter 联网验证。

- 2026-10-14（智能路由移植方案）：产出 `docs/intelligent_routing_design.md`，规划把内部超集中的智能路由级联与网站探索agent（第 3/4 层）引擎移植到公开基线。方案明确 17 层执行顺序、每层触发条件/数据来源/参数抽取/渲染/急停开关与**明确不支持项**，并把路由规则从代码改为配置：`weworker/router-config/` 分层多文件（routes / aliases / shortcuts / patterns / plans / renderers / plan-terminals + 编译产物 scenario-routes.json）加 `~/.weworker/router/` 覆盖层，支持「改文件 → 及时生效」的 mtime 热重载；编译逻辑抽为 CLI 与运行时共用的共享函数，避免双实现漂移。**本批只出方案与设计稿，未写实现代码、未验证**；内部业务规则内容不进入公开仓库，仅由 Profile Overlay 注入。

- 2026-10-13：将 `codex/workspace-model-backup-20261009` 合并到本地 `dev-1.1.0`，保留 1.1.0 版本、Adapter 迁移与供应商兼容修复，并整合工作区、模型配置和机器人接入功能。冲突整合保留独立接口/目录 URL、完整 URL、认证方式与刷新后的模型选择；修复供应商匹配遇到空地址时报错，补充独立目录优先级回归，并更新新增自定义配置保持空白的旧测试。验证：Backend 93 个测试文件、738 项通过（2 文件/4 项跳过），Renderer 244 项、Electron 36 项、构建/Profile/生命周期聚焦 29 项、网站探索agent 配置及进程管理 34 项通过；Backend 类型检查、前后端构建、公开配置与 package/lockfile 一致性检查通过。未进行真实账号联网验证或安装包构建，未推送远端。

- 2026-10-13：客户端版本号从 `1.0.0` 提升到 `1.1.0`，为 `v1.1.0` 发版做准备。同步 `weworker`、`renderer`、`backend-ts`、`webcli`、`officialWeb`、`metrics-server` 六个 `package.json`、`extension/manifest.json` 与官网 `officialWeb/src/lib/downloadConfig.js` 的 `APP_VERSION`，以及五个 lockfile 的自身版本字段；`weworker/changelog.json` 与根 `CHANGELOG.md` 新增 1.1.0 条目，`items` 暂留空，用户可见条目待补写。已通过 `node scripts/check-public-config.mjs` 一致性校验、`scripts/__tests__/check-public-config.test.mjs`（1 项）与 `weworker/scripts/__tests__/build-profile-overlay.test.cjs`（5 项），并另行校验改动 JSON 全部可解析、`weworker` 与 `renderer` 版本一致（`prepare-build.cjs` 前置条件）。未执行 Renderer 构建、安装包构建，也未创建或推送 `v1.1.0` Tag。

- 2026-10-12：发布流程改为正式版本 Tag `v<major>.<minor>.<patch>` 推送后自动构建 Windows x64、macOS arm64 与 macOS x64 安装包，并创建 Draft Release；普通代码 push 不再触发 CI，代码检查保留在 PR 与手动触发。新增 `docs/RELEASE.md` 固化发布步骤。桌面端、安装包、浏览器扩展与官网图标统一替换为项目 logo。已完成配置静态检查、Release workflow YAML 解析、图标资源尺寸校验；完整 GitHub Actions 构建需推送 PR/Tag 后在远端验证。

- 2026-10-08（wave4提交）：整理头条0.1.1、什么值得买/arXiv 0.1.0及协作交接文档提交至codex/opencli-wave4，目标develop。8项真实数据/身份样例及头条文章空态通过；专项130项、相关回归148项、构建与包校验通过。无关文章未纳入，未合并或发版。

- 2026-10-08（协作交接）：核对17个已迁入来源目录、4个有包未对齐、158个无根v2包；整理站点范围、验收缺口、wave4未提交状态、开放PR重叠及建议分工，见docs/opencli_migration_handoff_20261008.md。未向同事发消息或分派任务。

- 2026-10-08（头条0.1.1修复）：恢复WeWorker Bridge连接，用只读诊断核实当前服务器身份API和作品列表空态，whoami登录身份及articles第1页明确空列表实测通过；不代表有作品/多页路径通过。临时诊断已移除；专项130项通过，无真实写操作。详情及trace见docs/opencli_wave4_migration.md。

- 2026-10-08（头条登录后）：whoami 未识别后台身份字段、articles 未解析文章，均未通过；不能推断会话失效或账号无作品。修正身份结构未知被误报为过期会话的问题，生成包专项121项通过。浏览器检查工具因 Codex auth token unavailable 阻塞页面核验，保留失败 trace；未执行写操作。

- 2026-10-08（wave4）：按授权合并 PR #41，基于最新 develop 202ec8ae 迁移今日头条5项、什么值得买1项、arXiv4项，共10项；7项公开读取真实样例通过，头条whoami导航超时、articles需要登录，login未执行。专项120项、相关回归138项、公开23包prepare/WebCLI构建及三包.adapt校验通过。来源仍2413694，目录映射17+4+158=179；仅公开站点包/测试/Profile/文档变更，无通用框架或内部仓库变更。本批尚未提交PR，未执行真实写操作。详见docs/opencli_wave4_migration.md。

- 2026-10-08：重新 fetch 核验 OpenCLI main 仍为 2413694；迁移分支盘点 179 个来源目录：14 已有迁移记录、4 有包未对齐、161 无包。PR #41 尚未合并，目录覆盖不代表主线发布或完整验收。完整缺口、特殊目录及下一批建议见 docs/opencli_remaining_sites_20261008.md；本轮只盘点，未新增站点实现。

- 2026-09-30（小红书登录后验收）：2.0.1 修复隐藏重复筛选项、签名详情链接规范化跳转；whoami／creator-profile／七天统计／feed／search／note／comments／user 共 8 项真实数据样例通过，另 drafts 空列表路径通过。评论实测 3 条顶层＋12 条回复。专项 214 项、相关回归 105 项及构建／包校验通过。创作者作品响应缺 note_infos、通知捕获 0 响应仍未通过，均不误报为空；未执行真实写操作。样例 trace 和限制见 docs/opencli_xiaohongshu_migration.md。

- 2026-09-30：直接迁移 GitHub OpenCLI 最新 main（核验 SHA 2413694）小红书全部 25 个来源命令，包升级 2.0.0；保留 7 个旧名／本地能力，旧读取改接新实现。211 项来源／bundle 集成测试通过，新增有界原生文本／按键 helper 及测试同步内外仓；公开 prepare 20 包、WebCLI 构建及 .adapt 校验通过。真实 whoami、search 被登录拦截，未验收业务数据和真实写操作。详情见 docs/opencli_xiaohongshu_migration.md。

- 2026-09-30：Codex直接迁移Wikipedia五项与GitHub Trending一项（来源2413694），公开v2包/Profile共20包；新增36项及相关8文件238项测试、prepare/bundle、两包.adapt校验通过。语言/域名、摘要截断、全文段落、UTC榜单日期及周期语义已覆盖。真实六项调用未验收通过：Wikipedia连接失败，GitHub传输回退错误，保留trace不冒充成功；自然语言未执行。179目录映射更新13+5+161。无内部/通用框架变化、未推送。见docs/opencli_reference_wave3_migration.md。

- 2026-09-29（审查 round 2 修复）：Codex 增量审查后修复剩余 2 项并重新冻结：36kr hot 空榜误报（等待条件从“容器存在”改为“可信区域内出现可解析行”，新增延迟填充成功与持续空区域报错 fixture 各 dated/catalog 一例；页面无已验证空态标记，取消空榜判定，持续无条目一律按渲染/结构异常报错）；36kr news RSS 信封改为有界结构扫描（未闭合/错配 rss/channel/item、多根、根非 rss、channel 外 item、条目存在但均无可用标题均报解析错误；CDATA 内伪标记不算条目/字段/错误信封，HTML 检测按真实根元素/doctype 判定，description CDATA 含 <html> 不再误判）。聚焦测试 71 项、八站+携程+宿主 5 文件 185 项、打包/Skill/Profile 8 文件 66/67 项通过（1 项为基线既有 v2-loader 失败，冻结 HEAD 复核仍在）；prepare/bundle 重建后 hot(renqi/catalog)/news 三次真实链路复跑通过并更新 trace；36kr.com .adapt sha256 变更为 23c4804d…、HN 包未变。已知：hot 不支持空榜判定；自然语言验收未执行。见 docs/opencli_news_wave2_migration.md。

- 2026-09-29（审查 round 1 修复）：Codex 审查 wave2 后修复 R1-R6 并重新冻结：36kr hot/search 改为经真实 DOM 核验的榜单/结果区域绑定（页面标题核验榜单、catalog 按真实分区归属、无全页回退、空态需页面证据），HN read 缺 author/score 输出 null 不补造，36kr 文章 ID/URL 锚定官方路径并防精度丢失，RSS 区分 HTML/畸形与合法空且 date 输出完整 ISO，fixture 全部改用占位账号，后续对齐分类改为可复算映射（docs/opencli_clis_alignment_map.json，11+4+164=179）。聚焦测试扩至 68 项、八站+携程回归 157 项、打包/Skill/Profile 8 文件 49/50 项通过（1 项为基线既有 v2-loader 失败）；重新 prepare/bundle 后 13 项全部重跑真实链路（四类榜单+真实空搜索各一次，trace 已更新）。已知：36kr 搜索卡片仍无日期元素；自然语言验收未执行。见 docs/opencli_news_wave2_migration.md。

- 2026-09-29：OpenCLI 新闻类 wave2：新增 Hacker News 9 项与 36氪 4 项公开 v2 包（news.ycombinator.com、36kr.com，全 read），13 项均通过真实 WebCLI→Bridge→Extension 只读调用并记录 trace；HN read 保留树/截断语义并加 200 条目请求预算，36kr article 明示 800 字符截断与完整性口径，hot 四类榜单各走官方路由不降级。新增聚焦测试 57 项、八站+携程回归 157 项、打包/Skill/Profile 122 项通过；公开 prepare 18 包、WebCLI 重建、两包 .adapt 校验通过。36kr 搜索真实页未暴露日期保持空串；客户端自然语言验收未执行；extension-v2-loader 有 1 项基线既有失败未处理。见 docs/opencli_news_wave2_migration.md 与 13 项机器可读清单、后续对齐路线。

- 2026-09-29：继续处理 BOSS 搜索与 12306 订单。BOSS 0.1.1 显式主世界只读请求及跨页/城市/学历经验筛选真实通过；12306 0.1.1 修复旧登录页误报，核验服务器会话与官方订单页后，成功响应无 data 的真实空状态已通过；不等于未出行/历史订单为空，有订单提取仍待验证。两站及导航聚焦116项通过；未修改内部仓库或执行业务写操作。

- 2026-09-29：整理公开迁移 PR：携程 0.3.6 与八站 81/83 命令、通用导航/Skill/记忆/二进制响应一起提交；网络捕获通用测试改用 example.com。提交前 WebCLI 198、Backend 40、扩展 30、Profile/打包 6 项通过，公开 16 包 prepare 与八包 .adapt/Skill 校验通过。抖音 draft/publish 未实现，BOSS 搜索、12306 订单及完整自然语言验收仍未通过；真实证据见迁移文档。未合并或发版。

- 2026-09-28：源码客户端重启后，豆瓣单张WebP及知乎回答Markdown+7张JPEG真实落盘通过，文件格式和相对引用核验通过。豆瓣默认Rb页面标题实际为剧照，不宣称海报分类通过；增加requested_type/page_title和业务指导。12306订单响应仍缺列表，保持未知，并增加明确空状态与未知响应区别测试。本轮聚焦3组159项与公开WebCLI构建通过，仅公开站点包/测试/文档改动，未推送。

- 2026-09-28：登录后继续OpenCLI八站迁移：知乎/点评/豆瓣/抖音/51job及12306账号只读多项真实通过；修复51job与BOSS页面主世界请求，新增知乎和豆瓣download，累计81/83项接入。知乎Markdown真实落盘5117字节，图片下载待重启源码客户端加载新Bridge。通用有界base64响应同步内外，公开224项、内部通用23项通过；BOSS搜索和12306订单仍未通过，抖音draft/publish仍待实现。详见docs/opencli_batch_migration.md。

- 2026-09-28：公开迁移 OpenCLI 八站 v0.1.0（SHA 2413694），83 项来源命令中 79 项接入 v2，4 项文件导出/抖音上传发布待实现；八包 guidance、完整清单与人工验收步骤已补齐。聚焦 193 项、Profile/打包 6 项及八包 .adapt/Skill 校验通过，公开 WebCLI 已构建。真实 12306 四项查询、豆瓣 Top250、有道公开笔记成功，其余站点仍有登录、验证、导航边界或捕获阻塞，不能称八站完整验收。仅公开包/Profile/站点测试与文档改动，内部原工作区保留。见 docs/opencli_batch_migration.md。

- 2026-09-28：公开携程 0.3.6 区分船票页面无信息状态与渲染超时，避免同参数盲目重试或推断无船班。71 项聚焦测试通过；船票有数据链路仍待真实验收。仅携程包修改，无通用架构变化。

- 2026-09-28：公开携程 0.3.5 根据卡片产品类型筛选自由行，排除 package 页面混排的私家团，增加产品类型和出发地原文。一次实测返回三条自由行，68 项聚焦通过；通用框架无改动。

- 2026-09-28：公开携程 0.3.4 修复 tour/package 被站点追加 startcity 后的导航循环，tour 实测一次返回 3 条。内外同步记忆归因规则，禁止仅凭超限/超时判定暂态环境故障。相关回归通过，package 真实验收仍待完成。

- 2026-09-28：长期记忆召回标注为历史经验，明确当前用户要求、版本化 Skill 与本轮证据优先；记忆生成禁止把临时超时写成永久跳过工具的流程。内外同步，相关 48 项测试分别通过。公开携程 0.3.3 区分出发/到达航站楼，50 项携程测试通过。

- 2026-09-28：携程 0.3.2 往返航班改读真实 batchSearch 双程与组合报价，修复旧 DOM 卡片等待超时；增加去返日期/路线校验、经停信息，65 项聚焦测试通过，实际一次调用返回三组往返报价。仅公开携程包变化，通用框架未改。

- 2026-09-28：统一派生 Skill 与旧版 Skill 生成器的参数指引，普通参数优先 `--key=value`，JSON 仅用于复杂字段或兼容兜底，移除逐工具整包 `--args` 示例，避免 PowerShell 引号丢失导致首轮失败。内外同步并更新生成回归测试。

- 2026-09-28：页面导航续执行框架同步内外仓库：自动开页、等待、重注入，同一调用返回最终结果；写操作禁止导航后重放、声明域名与包摘要校验。派生 Skill 修正开页说明，后台请求补齐禁止重定向及日志脱敏开关。设计与边界见 `docs/adapter_navigation.md`。公开携程 0.3.0 增加人工 guidance 和景点目的地解析，贵阳景点/酒店单次调用实测通过；完整产品与自然语言验收仍待完成。

- 2026-09-28：修复携程 whoami 已登录误判：保留旧 login_uid 兼容，同时接受 cticket、DUID 与 IsNonUser=F 完整组合；游客标记和不完整组合拒绝，个人资料 Cookie 不能单独证明登录。继续使用受限 chrome.cookies 后台读取，无需标签页或 debugger，不返回会话凭据。包升级 0.2.2，携程聚焦 47 项、包校验和公开 prepare 通过；已连接扩展实际 whoami 返回 logged_in=true。该结果表示本地浏览器登录标记识别成功，不等于服务器会话有效性验证。

- 2026-09-28：修复携程数字参数拒绝 CLI 字符串的问题，包升级为 0.2.1。包内共用整数解析接受十进制数字字符串，拒绝小数、空值、布尔值、数组和不安全整数；联想 limit 与页面 limit/数字 ID 共用此逻辑，WebCLI 不新增类型转换。携程聚焦 39 项、包校验和公开 Profile prepare 通过。通过本地 CLI 与已连接扩展实际执行 search、hotel-suggest（limit=5），均成功返回 5 条；这不代表客户端聊天入口和其余页面命令已全部验收。

- 2026-09-24：架构 PR #40 合入 develop 后，OpenCLI 迁移分支同步最新主线；解决重叠改动，保留原有未提交的携程迁移工作。集成聚焦 WebCLI 82 项、扩展路由 19 项通过，公开 Profile 8 包 prepare 通过；真实站点验收仍待继续。

- 2026-09-24：修正携程联想查询被错误路由到网页标签页的问题：`search` 和 `hotel-suggest` 改走既有 Extension 后台 API Runner，不再要求预先打开携程；`whoami` 改走后台 Cookie 检查，也不要求携程标签页。后台请求禁跨站重定向和浏览器回退，并隐藏 trace 中的查询及响应体。`open_browser` 白名单补充有效 v2 包域名，供其他页面命令使用。WebCLI 聚焦 69 项、扩展路由 17 项、携程包校验通过；两种联想查询经同一 Node 请求路径匿名只读实测各返回 HTTP 200/15 条。运行中的客户端/扩展尚未更新到此源码，完整客户端调用与其余真实站点命令仍待验收。

- 2026-09-23：OpenCLI 携程迁移第二批完成本地实现：固定来源 SHA `8271afc67e8504bda94c147f446ee29775d08274`，将剩余 13 项接入根 v2 包，累计 15 个命令（14 read、1 write）。分类为业务数据 DOM 8、API 2、Cookie/导航 2、SSR 2、网络响应 1；单程航班在既有 Extension Runner 内增加受限响应捕获，没有旁路 Runner 或 Toolkit 改动。登录按页面导航边界改为确认后打开官方页、人工完成后以 `whoami` 验证。Ctrip/mock 与包聚焦 61 项、WebCLI 全量 83 文件/597 项、扩展加载器/运行时 16 项、Profile/打包 6 项全部通过；公开预处理成功，内建包和 CLI 均发现 15 命令。真实携程页面、测试账号登录/验证码、live 只读查询、完整安装包及 macOS 仍未验收，详见 `docs/opencli_ctrip_migration.md`。

- 2026-09-23：OpenCLI 携程迁移第一批（来源 SHA 8271afc）：核查 Apache-2.0 与 15 个来源命令，根 v2 包及公开 Profile 加入两个只读联想命令；其余 13 项页面、登录及网络捕获命令逐项记录在 `docs/opencli_ctrip_migration.md`，不算完成。WebCLI 83 文件 566/566、扩展加载/运行时 14/14、构建 Profile/打包聚焦 6/6 通过；公开 Profile 预处理与 CLI 帮助确认 2 命令可发现。真实携程与登录验收未执行。

- 2026-10-13：对话供应商菜单补齐所有行的 Key 状态图标：内置项显示已配置，自定义项仅在对话 Key 与 URL 均已填写时显示并使用绿色勾选，预定义供应商按 Key 状态显示勾选／钥匙。不完整的自定义项即使为历史当前项也不重新插入菜单；折叠按钮保留当前名称，避免误显示为其他供应商。Renderer 41 项相关测试、生产构建（含 JSX 编译）、语法和差异检查通过；隔离界面确认图标整列展示、缺 Key／URL 自定义项隐藏、已配置自定义项正常切换，无控制台错误。

- 2026-10-13：对话输入栏供应商菜单始终显示三种预定义供应商，右侧使用绿色勾选／钥匙图标区分已填／未填 API Key（不代表连通性验证）。已配置项直接切换，未配置项弹出密码输入框，先保存到共享模型配置再切换；取消不变更，失败保留输入并提示，防重复提交。Renderer 44 项相关测试、生产构建（含 JSX 编译）、语法及差异检查通过；隔离界面验证菜单、只填 Key、设置状态同步、保存失败、取消／Escape、回车提交及已配置直接切换，无控制台错误，未提交真实密钥或调用真实模型。

- 2026-10-13：模型列表固定展示当前构建支持的 Anthropic、智谱 coding plan、DeepSeek，名称统一为供应商名称；界面只读名称并禁用删除，后端拒绝固定项改名和删除。复用原供应商配置，保留已有密钥、模型及额外配置；添加菜单仍支持创建可改名、可删除的同类配置。Backend 21 项、Renderer 30 项相关测试、类型检查、Renderer 生产构建（含 JSX 编译）、public bundle 与差异检查通过；隔离界面验证固定项展示、名称只读、删除禁用、保存及额外配置新增改名，无控制台错误，未修改真实用户配置。

- 2026-10-13：修复模型配置点击确认删除后仍留在列表的问题：保存设置时对完整模型配置集合使用替换语义，避免深度合并恢复已删除项。隔离目录回归测试验证删除返回结果、落盘、重新加载、删除最后一项及保留其他配置和凭证；Backend 模型配置与探索配置测试 30 项、Renderer 设置测试 10 项、类型检查、public bundle 通过。扩展运行的模型列表配置测试中有 2 项仍依赖旧的“新增自定义配置继承地址”行为，未在本次修改；未删除用户真实模型配置。

- 2026-10-13：修复 QQ 扫码后手机页面持续“连接中”：真实凭证鉴权成功，但原事件组合被 QQ 以 4014（disallowed intents）拒绝；群聊／私聊对照握手收到 READY。QQ 通道改用公开频道事件及正确的群聊／私聊事件位，4014 时有界尝试旧频道与基础事件组合，保留旧机器人兼容；先监听 Hello 再 Identify，补齐上线超时、鉴权失败、重连状态与定时器清理。Backend 相关测试 34 项、类型检查、public bundle 与差异检查通过；正常关闭并重启桌面端后，使用已有配置确认真实 QQ READY 上线成功，未发送测试聊天消息，手机端最终页面仍由用户确认。

- 2026-10-13：微信扫码成功后移除按钮下方重复的“微信连接成功”提示，仅保留顶部说明行的“已连接”；等待确认、过期及错误提示保持可见。Renderer 通道相关测试 7 项、生产构建（含 JSX 编译）和差异检查通过；未重新进行真实微信扫码。

- 2026-10-13：QQ、飞书通道新增扫码流程，保留 App ID／App Secret 手动配置。QQ 使用官方 `@tencent-connect/qqbot-connector` 1.2.0 完成扫码绑定，并提供官方扫码创建入口；飞书按官方创建工具的 registration 协议扫码创建并获取凭证。确认后自动保存、启用与回填，失败凭证仅在内存保留供切换页面后重试，新机器人默认问答权限，同一机器人保留已保存权限。修改凭证替换旧连接，通道并发保存避免旧快照覆盖。Backend 聚焦测试、类型检查与 public bundle、Renderer 11 项相关测试、生产构建、语法及差异检查通过；隔离界面验证二维码展示、并行确认、回填、页面切换、保存失败重试、取消与过期错误，无控制台错误。尚未使用真实账号完成手机扫码及消息收发验收；需重启应用加载新增后端接口。

- 2026-10-13：修复通道主人权限尚未保存就显示“已生效”的误导提示；按服务器已保存的主人 ID 和权限对比表单草稿，新增/修改/清空均提示待保存，仅保存成功后展示已保存权限，四类通道共用。Renderer 11 项相关测试、生产构建、语法及差异检查通过；隔离界面验证选择完全权限、保存失败和成功三种状态，无真实权限配置写入。

- 2026-10-13：通道主人权限下拉控件加宽为 200px，菜单保留独立的最小宽度，不再被短标签按钮压窄；四类通道共用，保持现有配色与选中样式。Renderer 相关测试 7 项、生产构建与差异检查通过；隔离界面验证三项菜单及最长选中名称均无截断，选择正常且无控制台错误。

- 2026-10-13：QQ、飞书、企业微信与微信的通道配置顶部新增“测试连通性”，使用当前填写信息并复用已保存的隐藏凭证；检测不保存配置、不发送聊天消息。QQ 验证认证及网关、飞书验证认证及机器人信息、企微优先复用现有连接检测心跳（无连接时临时订阅并清理）、微信通过最近会话的配置接口校验 Token，无会话时明确提示尚未验证。按通道独立检测，支持并发、重复点击防护、超时、修改配置后失效、成功绿色连接/失败断连图标及折叠检查日志。Backend 22 项聚焦测试、类型检查、Renderer 11 项相关测试、生产构建与差异检查通过；隔离界面验证并发、切换、日志展开折叠与旧结果失效，无控制台错误。未操作真实机器人平台；应用需重启加载新检测接口。

- 2026-10-13：微信通道补齐手动 Token 与服务地址输入，保留扫码登录以及 QQ、飞书既有手动凭证表单；Token 留空保留旧值，保存成功清空输入，失败保留供重试，服务地址继续执行既有允许列表校验。手动修改微信凭证或地址、重新扫码后会停止旧连接并重新连接；扫码期间避免手动保存覆盖。Backend 相关测试 16 项、类型检查、Renderer 相关测试 9 项、生产构建及差异检查通过；隔离界面验证填写保存、空值保留、失败重试、扫码禁用与成功清空，无真实账号调用。运行中应用需重启加载后端接口变更。

- 2026-10-13：输入框改用容器宽度判断底部工具栏空间；可用宽度不超过 620px 时隐藏上下文、供应商、模型及思考选项，保留添加与发送/停止按钮，拉宽自动恢复。Renderer 相关测试 30 项、生产构建及差异检查通过；隔离界面验证 280px 输入框无横向溢出，恢复 900px 后模型选择器重新显示。

- 2026-10-12：对话输入栏模型选择宽度由 248px 收紧为 192px，供应商配置名称由 112px 加宽为 168px；窄屏同步调整为 176px/124px，保留连通状态、延迟与长名称省略。Renderer 模型测试 20 项、生产构建及差异检查通过；隔离界面确认实际宽度和模型菜单展开正常、无控制台错误。

- 2026-10-12：移除对话输入栏上下文占用按钮的常态及悬停/展开边框，保留圆环、百分比与背景交互反馈。Renderer 上下文测试 14 项、生产构建及差异检查通过；隔离界面验证常态和展开态边框均为 0，点击可打开上下文面板。

- 2026-10-12：新增自定义模型配置改为空白草稿，不再继承旧配置的接口地址、密钥、模型、模型列表地址及认证选项；高级配置默认折叠，显式空的 OpenAI 模型不再被对话模型填充。保留已有配置与预设供应商行为。Backend 回归测试 14 项及类型检查、Renderer 模型测试 20 项和生产构建通过；隔离界面验证新增后两套接口为空、未配置状态、高级配置折叠及不新增列表请求。运行中应用需重启加载后端修复。

- 2026-10-12：模型列表错误详情展开后最高 180px，超出内容在详情区内纵向滚动，长文本自动换行；保留折叠入口，支持聚焦与键盘滚动，避免错误响应撑长配置页。Renderer 模型相关测试 20 项、生产构建及差异检查通过；隔离样式验证覆盖 80 行错误的高度限制、滚动到底与重新收起。

- 2026-10-12：主功能栏由 72px 收窄为 56px，设置导航由 240px 收窄为 180px（窄窗口 160px），将释放的宽度交给右侧工作区；保留功能按钮尺寸，调整侧边留白并平衡说明文字换行。Renderer 相关测试 23 项、生产构建和差异检查通过；隔离界面确认两栏实际宽度、模型到通道切换正常且无控制台错误。

- 2026-10-12：全局共享开关由 44×28px 收紧为 30×18px，圆点由 22px 缩至 14px，内边距与滑动距离同步调整，匹配当前表单文字；覆盖模型、通道、配置、定时任务等既有使用位置。Renderer 相关测试 23 项、生产构建及差异检查通过；隔离界面确认实际尺寸、开启切换与无控制台错误。

- 2026-10-12：微信连接状态改为独立说明行，左侧“说明”、右侧状态圆点和“已连接/未连接”；右上角还原窗口按钮移除复制文档图标，按参考图改为圆角重叠窗口符号，保持紧凑尺寸与既有 IPC。Renderer 相关测试 7 项、生产构建及差异检查通过；隔离界面验证微信切换与说明行显示，未操作真实窗口还原或关闭。

- 2026-10-12：右上角窗口控制改用现有 Ant Design 图标，替换 CSS 绘制的细线；按钮从 46×38 收紧为与工作区工具栏一致的 28×28，统一圆角与间距，图标为 12px 并加强轮廓，保留关闭悬停红色及原有窗口 IPC。Renderer 生产构建及差异格式检查通过；未重新操作真实窗口关闭行为。

- 2026-10-12：模型配置连通性测试改为按配置独立管理运行状态，左侧图标与右侧测试按钮仅禁用正在检测的当前配置，支持多份配置同时检测；同步防重入并保留请求版本校验，完成或编辑一份配置不会清除其他配置的运行状态。Renderer 模型相关测试 20 项、生产构建和差异检查通过；隔离接口验证两份配置并发峰值为 2，各自成功/失败图标、检查清单及结果独立显示，无真实模型调用。

- 2026-10-12：微信连接状态改为简洁的小圆点加深色文字：已连接使用成功色圆点，未连接使用灰色圆点，移除文字勾号和整段绿色文字，无边框、底色与阴影。Renderer 相关回归测试 7 项、生产构建及差异格式检查通过。

- 2026-10-12：桌面端开启/关闭控件统一为共享滑动开关：浅灰关闭轨道、WeWorker 强调色开启轨道、白色圆点，统一尺寸与滑动动画，无阴影，支持空格键、聚焦轮廓、禁用态与减少动态效果偏好。覆盖四类机器人、定时任务、站点工具、内置技能、自动更新、模型完整 URL/复用密钥及探索智能编排；协议同意与通知通道多选仍保持复选框语义。Renderer 生产构建通过，回归测试 25 项通过、1 项失败（既有探索侧栏测试要求 App.jsx 中已不存在的条件渲染表达式，本次未改该文件）；隔离界面验证开关状态、44px 点击区域、颜色、滑动、无阴影及键盘切换。

- 2026-10-12：修复微信扫码接口中等待扫码、手机确认、连接成功、二维码过期及未发起扫码的乱码文案；Renderer 按扫码状态展示本地中文提示，兼容仍返回乱码文案的旧后端。Backend 类型检查及相关回归测试 8 项、Renderer 相关回归测试 7 项和生产构建通过；未重新操作真实微信扫码。

- 2026-10-12：通道主人权限默认统一为问答权限，前后端缺失或无效权限均回退为问答；未设置主人 ID 的旧完全权限配置在配置规范化时回落为问答，保留已有主人明确设置的权限。权限选择改用统一下拉框，清空主人 ID 同步恢复问答；空通道不会因默认权限变化自动出现在机器人列表。Backend 测试 8 项及类型检查、Renderer 测试 9 项及生产构建通过；隔离界面验证覆盖默认值、下拉选择、保存切换和清空主人。

- 2026-10-12：修复企业微信扫码创建后切换页面导致配置丢失：扫码确认后立即调用通道保存接口，仅更新企微凭证并启用，沿用已保存的主人、权限和其他通道配置；保存完成才提示成功。失败时在应用内存保留待保存配置，跨页面可重试，成功后清除临时凭证，不写浏览器存储。Renderer 相关单测 11 项、语法检查、生产构建及隔离接口界面验证通过，覆盖页面切换、重载、保存中离页及失败重试；未操作真实机器人。

- 2026-10-12：修复企微扫码错误诊断：请求先检查 HTTP 状态，旧后端 HTML 404 明确提示重启，不再被 JSON 解析错误覆盖；区分认证、超时、后端不可达与上游异常，避免展示原始响应。请求单测 3 项通过。开发环境已重启本项目托管后端并通过健康检查，加载新增扫码接口；手机扫码与创建仍待实际验证。

- 2026-10-12：企业微信通道新增“扫码创建机器人”，按官方 CLI 1.1.1 使用的扫码流程获取二维码、轮询创建结果并自动填入 BotID/Secret，保留主人 ID 与权限，用户保存后启用；支持取消、五分钟过期和失败重试，离开设置清理会话，Secret 保持密码展示且不写日志。保存时更换机器人凭证会重建长连接。Backend 类型检查及扫码/连接切换/权限测试 19 项、Renderer 相关测试 6 项和生产构建通过；模拟界面验证覆盖导入保存、取消、过期、失败、离页清理，无控制台错误。真实企微二维码获取成功；手机扫码创建、真实凭证回填与消息收发仍待用户验证。官方说明：https://open.work.weixin.qq.com/help2/pc/21670 。

- 2026-10-12：将模型列表请求的详细错误归入对应“模型”字段的失败提示下，默认折叠为“查看错误详情”，移除上下文窗口及独立列表地址之后的散落报错；Claude Code、OpenAI 与预设供应商采用同一展示方式。Renderer 相关单测 35 项、生产构建及模拟接口页面验证通过，覆盖错误归属、默认折叠、展开收起及两接口独立显示。

- 2026-10-12：通道设置改为与模型配置一致的左右工作区：左侧机器人列表及顶部添加菜单支持 QQ、飞书、企业微信和微信，右侧仅展示所选配置，固定保存栏、表单独立滚动，窄窗口字段上下排列。沿用每类型一份配置，自动识别旧配置（包括未启用和已保存凭证），重复添加打开已有配置；保留权限校验、密钥留空不覆盖及微信扫码，离开页面清理扫码轮询。Renderer 相关单测 6 项、生产构建与模拟接口页面验证通过，覆盖添加/切换草稿、保存重载、错误提示、空状态、扫码切换和 1440/900/700px 布局；未连接真实机器人平台。

- 2026-10-12：统一桌面端选择下拉菜单为白色面板、浅灰悬停、右侧勾选，统一圆角、面板与选项内边距，无阴影；覆盖模型/供应商、设置、站点多选、定时任务、网站探索agent参数和可编辑预设，替换原生 select/datalist，保留必填、禁用与数值类型。长菜单滚动并在窗口边缘自动避让。Renderer 相关单测 81 项、生产构建及模拟接口浏览器验证通过，覆盖样式一致性、键盘、多选、手动输入、长列表、任务保存、探索参数校验和模型地址配置回归，无真实模型调用。

- 2026-10-12：右侧模型配置内容字号缩小一档：字段与输入/选择控件为 12px，说明和辅助操作为 11px，接口分组标题为 13px；选择值使用常规字重。Renderer 相关单测 35 项、生产构建、差异格式检查和模拟接口页面验证通过，覆盖顶部固定、保存与检测操作及窄窗口布局。

- 2026-10-12：模型配置内容改为参考 Codex 的分组行式网格，基本信息、Claude Code 接口与 OpenAI 高级配置分别使用浅色圆角边框和行分隔线，左侧字段与说明、右侧控件对齐；保留固定顶部操作栏，窄窗口自动上下排列，无阴影或模糊。Renderer 相关单测 35 项、生产构建和差异格式检查通过；模拟接口界面验证覆盖双接口检测、保存重载、独立列表地址及认证、折叠、内置模型和窄窗口，无真实模型调用。

- 2026-10-12：模型配置的测试与保存操作移至右侧顶部标题栏，标题栏在常规宽度下收紧为 48px 并固定，仅下方配置与检查清单独立滚动；内置模型采用相同工具栏，长名称省略、窄窗口操作换行。Renderer 相关单测 35 项、生产构建与差异格式检查通过；模拟接口浏览器验证覆盖滚动固定、双接口测试、保存反馈、内置模型及 700/900/1280/1440px 布局，无真实模型调用。

- 2026-10-12：独立模型列表地址的基础 URL 模式改为默认补全 `/v1/models`；已有 `/v1` 等版本路径时只追加 `/models`，已有模型列表后缀时不重复追加，完整 URL 模式保持原样。同步更新界面提示。Backend 地址与列表测试 17 项、Renderer 模型选择测试 20 项、类型检查、生产构建及差异格式检查通过。

- 2026-10-12：两处独立模型列表地址新增“使用完整 URL”开关。新配置默认基础 URL 模式，自动追加 `/models`，清理尾部斜杠并避免重复追加；完整模式原样保留路径及查询参数。历史已填写且没有模式标记的地址继续按完整 URL 使用，开关独立保存、复制和重载，不影响对话地址模式。Renderer 相关测试 34 项、Backend 相关测试 83 项、类型检查、生产构建与差异格式检查通过；模拟接口界面验证覆盖开关、两接口独立状态、旧配置兼容、保存重载和窄窗口布局。

- 2026-10-12：自定义 Claude Code 与 OpenAI 配置支持可选的独立模型列表完整 URL，留空继续按原基础地址推导；Claude Code 列表认证可跟随对话或单独选择 Bearer/x-api-key，复用对应接口密钥。列表请求与对话/检测地址分离，支持对话使用完整 URL，兼容旧配置及多个同供应商配置的保存、复制和清空。列表失败提示明确不代表对话不可用。Renderer 相关测试 33 项、Backend 相关测试 74 项、类型检查及生产构建通过；模拟接口的界面验证覆盖独立地址和认证、完整 URL、保存重载、折叠、清空恢复与窄窗口布局。

- 2026-10-12：对话模型下拉列表顶部增加“检测全部模型”图标，仅通过真实会话协议请求检测当前列表，切换供应商后自动检测一轮，不提供定时检测。模型旁与收起后的选择器同时显示最近一次结果：绿色连接图标及请求总耗时、红色断连状态或灰色未检测；悬停显示检测时间。结果仅以状态元数据保存在本机，重载仍保留；限制两路并发、重复点击去重，离开供应商停止未开始的请求。Renderer 相关测试 32 项、Backend 相关测试 55 项、类型检查和生产构建通过；模拟接口的浏览器验证覆盖手动批量、切换自动一轮、收起展示、重载保留、两分钟无额外请求和窄窗口布局。

- 2026-10-12：将 Claude Code 与 OpenAI 配置区的接口地址分别前置至标题下方，再展示密钥和模型选择。模型列表按接口独立获取、缓存和显示状态；缺少地址/密钥或 URL 无效时不请求，使用当前草稿与对应已保存密钥，连接信息修改后使旧列表及在途响应失效。自动获取失败也显示错误，不将兜底列表作为获取成功；OpenAI 区域补充刷新按钮，完整 URL 模式保持不推断列表地址。Renderer 相关测试 28 项、Backend 相关测试 52 项、类型检查与生产构建通过；隔离浏览器验证覆盖布局顺序、缺失配置、认证失败、独立列表、过期响应和窄窗口。

- 2026-10-12：模型设置列表新增配置名称搜索，支持忽略大小写和首尾空格的即时筛选、匹配数与无结果提示；新增配置后清空筛选，窄侧栏下搜索框自动换行。配置行高度从 48px 收紧至 42px，保留图标操作和列表滚动。移除下拉框、设置输入框聚焦及高级配置展开时的外圈阴影，使用边框与背景保留交互反馈。Renderer 生产构建、模型选择相关测试 23 项通过；隔离测试数据的浏览器交互验证覆盖搜索、清空恢复、42px 行高、展开与聚焦阴影及窄窗口布局。

- 2026-10-12：缩小欢迎页常用场景卡片：卡片边长由 112px 调整为 96px，收紧网格间距、内边距与标题字号，并将网站图标缩至 34px，让首屏布局更紧凑。Renderer 生产构建与差异格式检查通过。

- 2026-10-12：将对话信息栏移入工作区顶部工具栏，保留对话 ID、标题、累计耗时和标记颜色操作，移除消息区下方的重复显示，避免顶部工具栏被内容遮挡。Renderer 生产构建与差异格式检查通过。

- 2026-10-12：在聊天模型选择器右侧新增“思考效果”选项。默认提供低、中、高；已识别的 Claude 4.6/更新模型额外提供极高、最大档位，未知或其他供应商保持通用档位。选择结果按请求传递到 Claude Agent SDK，并在服务端校验、上下文压缩重试及欢迎页新对话链路中保持一致；Renderer 构建与 Backend 类型检查通过。

- 2026-10-12：修复定时任务侧栏加号无可见反馈的问题：每次点击“新定时任务”都会创建并选中新任务，不再静默复用已有空任务；创建失败时显示明确提示。Renderer 生产构建与差异格式检查通过。

- 2026-10-12：正常连接状态下隐藏扩展入口和空问题列表，仅在扩展未连接或端口冲突时显示感叹号及红色问题数量徽标，保持主界面干净。Renderer 生产构建与差异格式检查通过。

- 2026-10-12：将侧栏问题列表收敛为简洁菜单样式：移除告警色背景、图标块和额外操作按钮，仅保留简洁标题、感叹号告警图标、问题文字与端口命令辅助信息，保持红色数量徽标。Renderer 生产构建与差异格式检查通过。

- 2026-10-12：优化侧栏问题列表的视觉层级：改为紧凑告警托盘，标题显示待处理数量，问题项使用告警色边线和图标块，扩展项提供明确的“检查”入口，端口命令增加“查询 PID/结束进程”标签，减少大面积灰色背景。Renderer 生产构建与差异格式检查通过。

- 2026-10-12：将扩展未连接和端口冲突两类已有问题集中到侧栏告警入口；感叹号图标显示红色问题数量徽标，点击后展开问题列表，并为端口冲突补充查询占用 PID 与 `taskkill`/`kill` 命令。Renderer 生产构建与差异格式检查通过。

- 2026-10-12：移除更多功能分隔把手的箭头状态，改为收起时显示短横线、展开时显示长横线的状态切换；保留点击把手展开和收起功能项。Renderer 生产构建与差异格式检查通过。

- 2026-10-12：进一步调整更多功能入口：收起时使用低对比度细分隔线，展开时仅在分隔线位置显示小箭头，移除方形按钮感和展开状态的蓝色背景。Renderer 生产构建与差异格式检查通过。

- 2026-10-12：将更多功能入口的收起状态改为纯分隔线样式，移除按钮背景；点击分隔线展开后变为收起箭头，再次点击收起，保留可访问的点击区域与持久展开行为。Renderer 生产构建与差异格式检查通过。

- 2026-10-12：将左侧更多功能入口改为短横线抽屉把手，点击把手展开或收起功能入口；移除点击外部、按 Esc 和切换功能时的自动收起，保持抽屉直到用户再次点击把手。Renderer 生产构建与差异格式检查通过。

- 2026-10-12：浏览器扩展未连接时，主侧栏入口改用警告感叹号图标并使用提示色；扩展连接后继续显示绿色扩展图标，避免未连接状态与已连接状态使用同一图标造成误解。Renderer 生产构建与差异格式检查通过。

- 2026-10-11：将“更多功能”展开后的三个默认图标颜色从较深的次级文字色调整为与侧栏其他未选中图标一致的浅灰色，悬停和选中状态保持原有反馈。Renderer 生产构建与差异格式检查通过。

- 2026-10-11：移除左下角重复的用户目录“…”入口，用户目录继续通过主工作区工具栏的文件夹按钮访问；左侧顶部“更多功能”入口保留。Renderer 生产构建与差异格式检查通过。

- 2026-10-11：修复“更多功能”展开菜单中的 SVG 图标颜色继承问题，统一使用侧栏当前文字颜色和描边规则，避免图标回退为纯黑。Renderer 生产构建与差异格式检查通过。

- 2026-10-11：在对话和定时任务入口下方新增“更多功能”三个点按钮，点击后三个隐藏功能按垂直方向向下滑动展开；底部原有用户目录入口保持不变。Renderer 生产构建与差异格式检查通过。

- 2026-10-11：移除对话侧栏标题区域中与窗口标题栏重复的折叠按钮，保留顶部统一入口，避免同一功能出现两个控件。Renderer 生产构建与差异格式检查通过。

- 2026-10-11：侧边栏折叠/展开按钮增加方向箭头和状态动画，展开与折叠使用相反方向的图标，并与侧栏宽度变化同步过渡。Renderer 生产构建与差异格式检查通过，开发窗口通过 HMR 更新。

- 2026-10-11：将文件夹、主题切换和场景总览三个工具按钮从窗口标题栏移动到标题栏下方的主工作区工具栏，窗口控制按钮继续保留在标题栏右侧。Renderer 生产构建与差异格式检查通过，开发窗口已收到 HMR 更新。

- 2026-10-11：将侧边栏展开/收起与新对话两个按钮固定到窗口标题栏左侧，侧边栏展开或收起时保持位置不变；新对话按钮始终创建默认工作区的新对话。Renderer 生产构建与差异格式检查通过，开发窗口已收到 HMR 更新。

- 2026-10-11：修复无边框 Electron 窗口中项目名称输入框无法输入的问题，为项目弹窗、全局提示弹窗及其控件明确设置 `no-drag` 交互区域。Renderer 生产构建、差异格式检查通过，开发窗口已收到 HMR 更新。

- 2026-10-11：统一移除 Renderer 中原生 `window.alert/confirm/prompt` 弹窗，新增 WeWorker 风格的全局提示/确认弹窗队列，覆盖项目、模型配置、定时任务、消息、Skill、资源文件和文件操作提示。Renderer 生产构建与原生弹窗扫描通过，开发窗口已收到 HMR 更新。

- 2026-10-11：修复桌面 Electron 不支持 `window.prompt` 导致“新项目”点击无响应的问题，改用 WeWorker 内置项目名称对话框，提交后创建项目文件夹并创建首个对话。Renderer 生产构建与差异格式检查通过，开发窗口已收到 HMR 更新。

- 2026-10-10：对话侧栏新增 Codex 风格的新建菜单：新对话固定创建在默认工作区，新项目创建独立项目文件夹并创建首个对话；项目支持重命名、在项目内新建对话和删除。删除同时要求项目没有对话且项目文件夹为空，后端执行最终校验；旧对话继续归入默认工作区。修复空列表渲染时的 React Hook 顺序问题。Backend 类型检查、项目持久化测试、Renderer 构建与差异格式检查通过，开发窗口已重启并加载新 Backend。

- 2026-10-10：修复欢迎页常用场景上限误报：当可用网站总数少于配置上限 50 个时，不再显示“已达上限 50 个”，改为提示“已添加全部可用网站”；只有实际展示数量达到配置值时才显示上限提示。Renderer 生产构建、差异格式检查通过，开发窗口已收到 Vite HMR 更新。

- 2026-10-10：欢迎页主工作区底色恢复为纯白，移除浅灰混合背景造成的脏感；卡片交互层次与 WeWorker 蓝色反馈保持不变。Renderer 生产构建、差异格式检查通过，开发窗口已收到 Vite HMR 更新。

- 2026-10-10：优化首页“添加场景”入口：使用项目已有 Ant Design `AppstoreAddOutlined` 图标替代单一加号，移除图标内层方框和纯白卡片底，改用柔和灰底与悬停蓝色反馈，降低入口的突兀感。Renderer 生产构建、差异格式检查通过，开发窗口已收到 Vite HMR 更新。

- 2026-10-10：进一步清理右侧「场景总览」列表：移除每个场景卡片的独立外框和白色卡片层，改为低对比度分隔线；悬停使用轻微浅灰背景，展开状态使用极浅蓝色反馈，图标底保持柔和灰色块，降低连续边框造成的视觉噪声。Renderer 生产构建、差异格式检查通过，开发窗口已收到 Vite HMR 更新。

- 2026-10-10：优化首页视觉层次：欢迎工作区保持纯白底，常用场景卡片取消明显边框、阴影和悬浮位移，默认保持干净留白，选中/悬停使用低对比浅灰背景，拖拽目标保留 WeWorker 蓝色反馈。Renderer 生产构建与差异格式检查通过，开发窗口已收到 Vite HMR 更新。

- 2026-10-10：供应商与模型下拉菜单的列表增加视口自适应最大高度和纵向滚动，避免模型数量较多时菜单越出窗口；保留选中、悬停和键盘聚焦反馈。Renderer 生产构建与差异格式检查通过。

- 2026-10-10：移除项目源码中的背景虚化滤镜和带模糊半径的阴影，包括桌面端拖拽遮罩、模型下拉菜单、网站探索页面、浏览器扩展以及其他弹层；保留无模糊的边框式选中反馈、输入框失焦调用与普通透明度、亮度效果。Renderer 生产构建、差异格式检查与全项目源码扫描通过。

- 2026-10-10：Windows/Linux 窗口改用无边框模式，将最小化、最大化/还原、关闭按钮移入 WeWorker 自定义标题栏，避免系统标题栏与应用标题栏重复；macOS 保留系统标题栏按钮。Renderer 构建、Electron 语法检查与差异格式检查通过，尚未执行真实桌面窗口验收。

- 2026-10-10：高级配置按钮增加展开选中态与键盘聚焦态，使用 WeWorker 蓝色边框、浅色背景和外圈光晕明确当前状态。Renderer 样式验证通过。

- 2026-10-10：设置中的模型与黑名单匹配方式下拉统一使用项目自定义 `AppDropdownSelect`，替换原生下拉与模型 datalist；设置页打开时点击主侧栏其他功能会关闭设置并切换右侧工作区。Renderer 生产构建与差异格式检查通过。

- 2026-10-10：模型配置新增按钮改用 Ant Design `AppstoreAddOutlined` 图标表达新增模型/供应商集合，按钮背景调整为黑色，展开菜单时使用关闭图标；Renderer 生产构建与差异格式检查通过。

- 2026-10-10：移除设置工作区右上角“返回”按钮，改由固定主侧栏的“设置”入口切换设置与工作区，避免重复导航控件。Renderer 生产构建与差异格式检查通过。

- 2026-10-10：设置页改为工作区内切换：打开设置时保留主功能侧栏并高亮“设置”，仅替换右侧工作区；返回后恢复原工作区。Renderer 生产构建与差异格式检查通过。

- 2026-10-10：自定义供应商设置明确接口用途：Claude Code 接口标注为 WeWorker 对话用途，OpenAI 接口标注为网站探索agent用途；连通性检查与复制日志标签补充协议名称，区分“ WeWorker 对话接口（Claude Code 接口）”和“网站探索agent 接口（OpenAI 接口）”。Renderer 28 项聚焦测试、生产构建与 Playwright 标签/布局验证通过。

- 2026-10-10：模型配置表单字段与下方连通性检查标题、状态列表左侧统一对齐；检查区外沿也与表单内容区一致。Playwright 以像素坐标验证基线差不超过 1px，并通过 1266×715、1000×720 布局及控制台检查。

- 2026-10-10：模型设置右侧配置详情区清除卡片、输入框、连通性检查面板、保存区域和日志操作按钮的可见边框，保留字段聚焦反馈与左侧列表选择状态。Renderer 28 项模型/聊天测试、生产构建和差异检查通过。

- 2026-10-10：模型配置列表的连通性状态图标调整为语义化展示：成功使用绿色 `LinkOutlined`，连接失败使用红色 `DisconnectOutlined`；检查清单仍用勾/叉表示单项检查结果。Renderer 聚焦测试与生产构建验证通过。

- 2026-10-10：连通性检查结果增加复制日志按钮和“显示日志/隐藏日志”下拉控制；默认日志消息保持单行并使用省略号，展开后显示完整内容。Renderer 28 项模型/聊天测试、Renderer 生产构建、Backend 类型检查、Playwright 隔离日志交互与布局验证通过。

- 2026-10-10：连通性测试改为类似 Cursor 的可折叠检查清单：默认收起，点击测试后自动展开；检查项目逐项运行并显示加载、绿色勾选或红色叉号，全部通过后列表中的连通性图标变为绿色连接图标，失败变为红色叉号。当前使用勾选改为绿色，内置模型详情卡片恢复白色背景。Renderer 28 项测试、生产构建、Backend 类型检查和 Playwright 动态成功/失败检查清单验证通过。

- 2026-10-10：模型配置列表改为每项只显示配置名称，供应商和模型信息不再占用列表的多行；快捷按钮与配置名称位于同一整行，悬停/选中背景覆盖名称和图标区域，保持选择、测试、删除图标状态反馈。Renderer 28 项模型/聊天测试、Backend 17 项、Renderer 构建、类型检查与 Playwright 隔离界面验证通过。

- 2026-10-10：模型配置列表新增图标快捷操作：选择并使用、测试连通性、删除。选择状态使用勾选图标，测试中显示加载图标，删除使用危险色；内置模型不提供删除，当前使用配置禁止删除并提示先切换。新增 Backend 删除接口及 Renderer 状态同步，Backend 17 项、Renderer 28 项聚焦测试、Backend 类型检查、Renderer 生产构建、Playwright 隔离界面与布局验证通过；未在真实桌面窗口执行删除或真实服务连通性测试。

- 2026-10-10：进一步修复名称同步边界：只有用户实际编辑过“配置名称”才保留本地临时值，未编辑的表单会跟随设置接口返回的编号名称更新，避免左侧列表、卡片标题与输入框出现不同名称。Renderer 27 项模型/聊天测试、生产构建及 Playwright 保存/重载/布局验证通过；当前桌面窗口需重启以加载新 Renderer。

- 2026-10-10：修复模型配置名称在设置加载后不同步的问题：首次渲染缓存的供应商默认名会在后端生成/保存编号名称到达后同步更新，且只更新未被用户编辑的临时表单值；左侧列表、卡片标题、配置名称输入框和保存后的状态保持一致。Renderer 模型/聊天测试 27 项、生产构建及 Playwright 名称保存/重载与布局验证通过。

- 2026-10-10：模型配置新增可编辑的“配置名称”字段，左侧列表与聊天模型选择器使用配置名称区分同一供应商的多个配置；供应商单独以只读字段展示。旧版供应商配置和未命名配置按供应商自动生成并冻结编号名称（如 `DeepSeek(1)`），保留原有密钥、模型、地址、活动选择及 URL 模式；内置模型也支持仅修改显示名称，不触碰受管凭据。Backend 16 项聚焦测试、Renderer 27 项模型/聊天测试、JavaScript 语法检查、Renderer 生产构建、Playwright 名称保存/刷新恢复/只读供应商/1266×715 与 1000×720 无横向溢出验证通过；未重启真实桌面窗口或修改用户配置。

- 2026-10-09：模型设置的新用户列表仅显示两个内置模型，不再把未配置的默认活动供应商视为已添加；加号通过相邻下拉菜单选择供应商，选择后新增并选中独立配置。保留旧版密钥、模型、地址及手动添加的空配置，禁止从新增接口复制内置模型。Renderer 聚焦 25 项、Backend 聚焦 12 项（含配置持久化恢复）与类型检查通过；Renderer 生产构建、JavaScript 语法及差异格式检查通过。Playwright 在 1266×715、1000×720 和 150% 缩放下以隔离数据验证初始列表、菜单定位、外部点击/Escape 关闭、键盘选择、同供应商重复添加、刷新恢复及旧配置展示，无控制台错误；未重启真实桌面窗口或修改用户配置，后端规则需重启应用后加载。

- 2026-10-09：模型配置新增按钮采用项目已有 Ant Design 的 `PlusOutlined` / `MinusOutlined` 图标；修复通用按钮内边距覆盖图标按钮样式导致的偏移，固定为 32px 按钮与 16px 图标并居中，保留 WeWorker 蓝色。Renderer 生产构建、21 项模型相关测试与差异格式检查通过；Playwright 隔离渲染实际设置组件，在 1266×715、1000×720 视口和 150% 缩放下验证展开/收起，图标中心偏差由水平 6px 修正为 0，无控制台错误；未验证真实桌面窗口。

- 2026-10-09：修复 Anthropic 兼容接口在思考模式下拒绝强制 `tool_choice` 时的连通性误报。主连接检查先执行原有工具调用验证；仅当服务返回 HTTP 400 且明确同时包含 `tool_choice` 与 `thinking` 时，自动以无工具 JSON 响应复检。其他错误保持原有失败分类，不掩盖鉴权、模型、限流或服务异常；回归测试覆盖该降级路径。

- 2026-10-09：在当前本地分支迁入两个内置模型的受管配置能力：模型卡片始终可见，内置凭据及开发模型地址以模块私有密文形式随应用提供，且保留运行时环境覆盖入口；设置接口和 Renderer 不返回该配置。开发服务器遇到陈旧的忽略构建定义时，会补齐内置模型卡片；生产构建仍严格采用构建 Profile。Backend 内置模型测试、类型检查、Renderer 内置模型测试、Renderer 生产构建和构建 Profile 测试通过；真实服务尚未验证。

- 2026-10-09：完成模型功能迁移核查（见 `docs/model-feature-migration-audit.md`）：内置供应商在 9 月 28 日重建公开 develop 后的选择性迁移中未带入，远端当前同样未注册；确认 `fbe33d4` 移除了独立探索模型设置入口、鉴权自动检测及保存时验证启用流程，`2d1909e` 有意移除了回复状态后缀。Backend 聚焦 98/98、Renderer 聚焦 53/53 通过，但不覆盖全部 UI 入口。仅完成核查，内置服务及上述入口尚未恢复，未改真实配置。

- 2026-09-28：从 develop-archive 迁移多模型配置、压缩交互及飞书支持（来源 3e6c9d9d），保留公开 develop 的 Adapter、查询路由与 Profile 边界，不导入旧版内置凭据和内部 Provider。补齐配置切换后的探索连接缓存失效、飞书异步启停清理回归；Backend 类型检查、72 项模型/渠道测试及记忆/压缩聚焦回归通过，Backend bundle、Renderer 188 项测试、生产构建与语法检查通过。完整 URL 功能（29499e29）继续迁移；未进行真实模型或飞书联调。

- 2026-09-24：按已审阅策略更新 7 个公共 Adapter 的写操作确认配置，并同步 v2 bootstrap 的调用级旧确认兼容处理；read 命令不自动获得兼容标志，调用参数与共享运行时不被修改。聚焦 6 文件 76 项通过，公开 Profile 7 包 prepare 通过。 未执行真实业务写操作；客户端需重启、扩展需重载后验收。

- 2026-09-24：命令确认策略与写操作分类分离：v2 manifest 支持布尔 `requires_confirmation`，未配置的写命令仍默认需确认；CLI、Bridge、Extension、bootstrap、帮助与派生 Skill 同步采用包内策略。关闭安装包写确认视为额外权限变更。两仓聚焦策略/路由/Skill 测试、Backend TypeScript 和 Profile prepare 通过；未执行真实写操作。配置说明见 `docs/adapter_confirmation_policy.md`。

- 2026-09-24：修复后台调用被 Adapter 刷新中断的生命周期竞争：心跳握手仅确认连接，不重复发送初始目录快照；刷新关闭 offscreen 文档前等待公共执行队列。聚焦回归 31/31 通过。内部开发扩展重建、重载后真实只读查询成功返回，未执行写操作；运行中的 Bridge 心跳优化待客户端重启加载。

- 2026-09-24：修复托管后台 Adapter 查询已完成却被 Chrome `No current offscreen document` 清理错误覆盖的问题；已消失文档的清理不会覆盖原始结果，下一次调用仍创建独立文档。`open_browser` 白名单同时纳入有效 v2 包网站，停用包不会获得许可。聚焦测试 25/25 通过。真实客户端与浏览器扩展仍需更新后复验。

- 2026-09-24：v2 Adapter 增加包内可选 `guidance.md` 与 `manifest.discovery_terms`，把人工维护的工具选择、调用顺序和结果解释纳入当前包摘要与运行时派生 Skill；`.adapt` 读取和内置 Profile 打包同步支持。B 站包迁入导航重试、收藏夹选择等旧 Skill 经验并升级到 1.0.1。公开 Profile prepare、实际 `.adapt` 打包、npm dry-run、架构相关 WebCLI 8 文件 83 项通过；先前并发全量时超时的 3 文件 29 项顺序重跑通过。与内部仓库 13 个公共文件逐字节一致。完整 WebCLI 全量未顺序重跑，真实站点未验收。设计见 `docs/adapter_guidance.md`。

## 当前阶段

WeWorker 正在完成开源发布前的仓库清理与验证。当前保留 Electron 桌面端、React Renderer、TypeScript Backend、WebCLI、浏览器扩展、公开网站 Adapter，以及内嵌的网站探索agent源码。

## 已完成


- 2026-10-09：修复工作区导航迁移不完整导致 API 探索、网站探索agent 仍与会话记录共用侧栏的问题。两项探索改为左侧独立图标入口，进入后隐藏会话／定时任务记录栏并关闭辅助面板；浏览器扩展状态收敛为独立拼图图标和连接面板。移除对话侧栏底部重复的服务、模型、扩展和设置区域，更新提示仅在有可用更新时显示在标题栏。Renderer 探索／恢复／网站探索／端口帮助聚焦测试 23/23、生产构建及差异检查通过；运行中的 Electron 未开放调试端口，未重启用户当前窗口做截图验收。

- 2026-09-23：提交模型配置简化改动时同步远端 `develop` 的 Adapter 架构更新，解决开发工作区冲突，保留远端新版界面并将模型就绪检查接入首次／继续开发入口，停止操作不受影响。合并后 Backend 聚焦 58/58、Renderer 聚焦 16/16、类型检查、Renderer 构建与差异检查通过；未重跑完整 Adapter 认证或真实服务端到端。

- 2026-09-23：简化「设置 → 模型」中的探索配置，移除连接方式选项，直接展示可编辑地址。预填优先保留显式／旧探索地址，其次使用内置完整地址映射，其他自定义地址追加 `/v1`（不重复追加），生成值明确提示验证；建议不自动持久化或改变运行时配置，验证成功才保存，主地址变化不覆盖已保存的探索地址。保留内置服务原有协议与适配器。Backend 聚焦 36/36、Renderer 聚焦 12/12、类型检查、Renderer 构建、语法与差异检查通过；隔离浏览器验证地址预填、无模式选择、默认复用 Key、改写保存与重新展开保留，无页面异常。真实服务验收未执行。

- 2026-09-22：精简模型连接失败文案为简短原因（如「模型连接超时」「密钥验证失败」），探索页去掉重复的设置路径说明，操作收敛为「重试」「模型设置」；未知错误不在提示栏展开原始详情，设置页仍可查看详情。Renderer 聚焦 12/12、构建、语法与差异检查通过。

- 2026-09-22：按用户纠正将模型配置统一收回「设置 → 模型」，移除探索工作区的「网站探索模型」表单。探索页仅检查连接，失败显示原因、重试与设置入口，成功不占用工作区；在设置中保存后自动重新检测。共享模型规范已同步，Renderer 聚焦 12/12、构建和差异检查通过；隔离浏览器验证探索页无配置表单、设置打开模型页、保存后自动恢复并收起错误提示，无页面异常。未改 Backend 协议与真实用户配置。

- 2026-09-22：模型配置改为单地址接入，主表单只展示服务地址、Key 和模型，高级设置容纳鉴权与上下文窗口；主连接验证工具调用并自动选择鉴权，验证后保存启用，不要求第二个地址。网站探索agent首次进入独立检查连接，优先复用内置完整地址映射或用户原地址，不猜网关路径；失败可补充探索地址，复用主 Key／模型或独立配置，独立 Key 使用既有加密存储。保留旧探索地址，新增配置经既有内部快照传给 Worker；检测失败不覆盖配置，配置变化后重新检测，现有任务控制不受新任务检测阻塞。共享模型规范已更新；设置弹窗不再点击遮罩关闭。Backend 6 文件 51/51、Renderer 聚焦 12/12、探索 Worker 托管配置 10/10、类型检查、Renderer 构建、JavaScript 语法与差异检查通过；隔离浏览器使用虚构响应验证主配置保存启用、探索独立服务、配置同步、窄窗口无横向溢出及遮罩／Escape 不关闭。真实模型端到端与安装包验收待完成，未操作真实用户配置。

- 2026-09-21：拆分动作分析模型上下文与证据重试修复：Backend 注入当前模型快照，Bridge 保留凭据，仅向支持新协议的扩展发送一次性 tab／site／action 关联 ID；启动失败、消费、断连与过期清理，不回退到其他模型配置。分析失败保留捕获证据、主接口选择并显示警告，重试不重新操作网站。WebCLI 全量 62 文件、387/387，Backend 聚焦 21/21、类型检查，扩展／页面聚焦 21/21，CI 对应扩展集合 26/26，Renderer 构建及语法／差异检查通过；本地模拟服务不等于真实模型或点赞验证。真实客户端需重载新代码后继续验收。

- 2026-09-21：拆分模型输出与生成恢复修复：统一单次输出策略，截断先于解析／执行拦截，保存上下文后等待用户，恢复不重置预算且暂停时间不计时；严格解析动作信封。拆分回归发现控制器将提前确认误用于发布，已改为仅恢复提前确认、发布仍等待完成。WebCLI 全量 61 文件、379/379 通过，含本地模拟模型服务与真实 Worker 的跨进程暂停恢复；真实模型端到端仍待验证，未调整用户配置或运行预算。

- 2026-09-21：将计划完整性与写工具验证修复拆为独立 PR：按计划索引绑定 API、隔离空草稿、核对实际注册工具集合、支持安全新增修订文件并在恢复时重新验证；mock 确认状态由验证器控制，成功／失败预期必须为非空 JSON 对象。本地 WebCLI 全量 58 文件、333/333 通过；真实站点完整生成与写操作验证仍待实测，不以 mock 代替。

- 2026-09-18：迁入自动探索捕获值隔离修复，保留公开仓库的匿名化、Profile/Overlay 与运行时权限边界。模型上下文与生成知识包使用响应字段／类型证据，站点记忆不再保存响应原文，生成前清除请求／响应样本；补齐历史记录读取与后续生成的聚焦回归。参考 OpenCLI `8271afc67e8504bda94c147f446ee29775d08274` 的默认结构摘要与长期记忆边界，本实现限制更严格，不代表照搬其允许显式读取原始响应的全部行为。同步迁入客户端模型配置经 IPC 注入生成 Worker 的修复，以及 Anthropic 兼容响应中多个文本块的提取修复。未引入内部站点 Adapter、真实捕获数据或旧工作区配置。

- 移除仅面向内部系统的 Adapter、测试、快捷查询路由、发布脚本、部署说明和演示材料。
- 扩展 Adapter 注册表与构建配置已收敛到仓库中实际保留的公开网站 Adapter。
- 移除源码中的固定指标服务地址和固定访问令牌；指标上报改为显式环境配置并默认关闭。
- 内部域名、私网 IP 和组织名称已从保留的代码与文档中匿名化或移除。
- 首次开源版本已统一为 `1.0.0`，公开仓库身份统一为 `WeWorker/WeWorker`。
- 根更新日志与应用内更新日志已重置为仅记录首次公开版本 `1.0.0`。
- 浏览器扩展的公开名称统一为 `WeWorker Browser Adapter`，公开链接不再指向旧项目地址。
- 根 README 已按当前真实架构、启动命令、安全边界和发布状态重写。
- 20 个目标网站清单已保留并增加“已实现／开发中／规划中”状态；Gmail 和诺诺网发票作为补充集成单独记录。
- 贡献指南已改为基于 `main` 的 GitHub Flow，并补充真实检查命令、Adapter 贡献要求和本地敏感信息自检规则。
- 已新增 Git 工作流文档，明确 PR、受保护分支、受控敏感信息检查、Squash Merge、Tag 和紧急修复流程。
- Issue 与 PR 模板已完善，覆盖 Bug、功能、文档和 Adapter 提议，并区分贡献者自检与维护者受控敏感信息检查。
- 已新增公开 PR CI，覆盖配置一致性、WebCLI、Backend、Renderer、官网、Electron 集成和 Extension 检查；敏感信息扫描和真实账号 E2E 不进入公开自动化。
- 已补齐行为准则、支持指引、第三方声明、`.gitattributes`，并完善新仓库文件边界。
- 发布工作流已改为仅手动触发，并只创建指定版本的草稿 Release，不再强制移动 Tag 或删除既有 Release。
- 构建配置支持通过外部 Profile Overlay 叠加 Adapter、Provider 与扩展权限；安装包只读取生成的 `build/extension-dist/`，构建不再回写公共源配置。
- 官网（`officialWeb/`）已切换为开源单页站点；`src/lib/sites.json` 与 `extension/adapters` 公开 Adapter 对齐。
- Backend 提供可注册的 Profile 查询路由入口；默认公开构建保持空实现，定制能力可由独立入口参与开发和打包。
- Extension 页面运行时跨域访问改由内置 Adapter manifest 的 `runtime_allowed_hosts` 显式声明，公共 Service Worker 不再包含产品域名映射。
- WebCLI 包清单使用公共超集，定制仓库可按需提供命令目录资产而无需修改公共依赖或 package 配置。
- Windows 解密工具改由 `uv` 创建隔离、固定版本的构建环境，不再依赖系统 Python 预装 PyInstaller/pywin32。

## 验证结果

- 敏感信息复扫未发现新的硬编码密钥、Token、内部域名或私网 IP；命中项均为变量名、脱敏测试样例或公开占位地址。
- WebCLI 聚焦测试通过（31 项），Backend 用户场景测试通过（5 项）。
- Backend TypeScript 类型检查通过，Renderer 与官网生产构建通过。
- Extension 公开范围测试通过（19 项），内部功能清理前遗留的运行时测试不作为公开门禁。
- Electron 集成测试通过（22 项），公开配置校验及校验器测试通过。
- Windows 本地全量测试基线：WebCLI 234/243、Backend 283/288 通过；剩余失败为 Windows 文件系统/符号链接差异、已变更的 PowerShell 平台文案和过期测试 mock，需在后续开发中修复或在 Ubuntu CI 复核。
- Git 差异格式检查通过。
- 官网生产构建通过（公开 Adapter 对应 4 个分组、7 个站点）。
- Backend Profile 聚焦测试、Adapter scaffold/用户场景测试、类型检查与公开 bundle 验证通过；公开 bundle 标记为 `public`。
- Extension manifest 跨域授权聚焦测试通过；公开 Profile 成功生成 4 个实际打包 Adapter。
- Windows 解密工具在隔离环境中成功生成 `sd_decrypt.exe`。

## 进行中

- 执行初始化前的最终受控敏感信息复扫和文件清单复核。

## 待办

- 在干净目录复制最终文件并重新初始化 Git 仓库。
- 为公开发布配置新的下载地址、指标服务和发布流程。
- 在目标平台完成 Windows x64、macOS arm64 与 macOS x64 安装包验收。

## 约束

- 仓库不得包含真实密钥、Token、密码、账号、内部域名、私网 IP 或内部系统资料。
- 示例网络地址使用 `example.com`、`example.org`、`localhost` 或 `127.0.0.1`。
- 对外界面只使用“网站探索agent”，不暴露内部组件名称。
