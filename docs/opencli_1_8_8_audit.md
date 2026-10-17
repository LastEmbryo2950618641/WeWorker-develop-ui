# OpenCLI 1.8.8 对照核查

核查日期：2026-10-17。本机 opencli --version 为 1.8.6；另从 npm 官方 registry 读取并解包 [@jackwener/opencli 1.8.8](https://www.npmjs.com/package/@jackwener/opencli/v/1.8.8)，未全局安装、未修改用户 OpenCLI 环境。以下是发布包静态接口核查，不等于所有上游命令实机通过；本项目实测状态见 [能力台账](opencli_parity.md)。

最新 HTTP 增量：已补独立 `http` Runner，PUBLIC_API/AUTH_API 无浏览器普通调用、COOKIE_API 按 profile 临时读取 Cookie/CSRF，以及生成、作者断言、审阅安装和只读 repair。version 2 增加环境 Bearer/header/Basic/声明式 HMAC 与 Cookie store/分区选择；双真实 Chromium 与打包 CLI 已验证。无页面 API 发现、任意站点签名/OAuth 仍未完成；下文最初审计中的“独立 runner 未实现”保留为历史，不代表当前状态。详见 [HTTP 契约](http_adapter_runtime.md)。

来源：package.json、cli-manifest.json、dist/src/cli.js、dist/src/browser/analyze.js、README.md、包内 opencli-adapter-author 技能。公开发布包 tarball 为 https://registry.npmjs.org/@jackwener/opencli/-/opencli-1.8.8.tgz 。没有复制上游业务实现。

多浏览器核查补充（最初文档设计记录）：继续读取该发布包的 dist/src/browser/profile.js，确认 alias 映射、持久 defaultContextId、显式 flag/OPENCLI_PROFILE 的选择，以及显式 contextId 与 preferredContextId 的路由参数区别；尚未据此核实 daemon 在全部冲突/断线场景的行为。WebCLI 拟保留更明确的离线失败规则，不将持久默认自动降级到其他浏览器；这属于本项目设计选择，不能声称与上游逐项相同。现有 `_extensionWs`、响应广播、单服务根与 tabId 锁的问题及完整验证要求见开发设计。用户要求在此检查点暂停，暂无 profile 实现或双浏览器实测证据。

- cli-manifest.json 包含 1366 个命令条目、179 个 site 分组（包括桌面应用，不能全部称为网站）。策略字段计数：cookie 778、public 345、ui 195、local 26、intercept 22。这个枚举比作者技能中的六种策略更粗；不能只按标签数宣称能力相等。
- 作者技能仍按 PUBLIC_API / COOKIE_API / PAGE_FETCH / INTERCEPT / DOM_STATE / UI_SELECTOR 选择，要求来源证据、契约与替代策略理由。analyze 对实际响应做业务数据、噪声、权限阻塞判别；页面请求多不等于接口可复用。WebCLI 本轮加入结构分析与保留失败 revision 后显式重做计划，未实现自动运行时静默回退。
- 浏览器接口除既有基本操作外，仍包含 state 的 AX 对比选项、截图标注与临时视口尺寸、console/network since/until/follow、跨源 frame eval、download 等待。WebCLI 已补嵌套跨源 eval、download 等待、console/network 持续输出、AX/DOM 来源对比及编号/临时尺寸截图，并经真实 Chromium 与日常 Chrome 检查；各项覆盖与限制分别记录，不由普通截图通过推断全部能力。
- profile list/rename/use 与全局 --profile、环境 OPENCLI_PROFILE 支持多个扩展连接，不明确时选择 profile；另有 OPENCLI_CDP_ENDPOINT / OPENCLI_CDP_TARGET 和 Electron 应用适配。WebCLI 现已实现独立多连接 profile：统一 call profile.*、--profile/WEBCLI_PROFILE、alias/default 与双连接/重启实测；桌面选择 UI、外部 CDP/Electron 目标仍未对齐。
- 其他接口包括 skills list/read、validate/verify、convention-audit、adapter status/eject/reset、plugin create/install/update/uninstall、daemon status/stop/restart、external register/install/list 和 shell completion。WebCLI 部分已有相近的 Adapter 管理/服务/Skill 分发能力，仍需逐命令核对输出、错误、覆盖和差异；不能直接按名字视为完成。
- PUBLIC_API 可在没有浏览器时通过 host HTTP 执行；COOKIE_API 使用明确的运行时鉴权。WebCLI 当前自动生成的 API 命令仍是 Extension PAGE_FETCH，独立 host HTTP/通用鉴权能力待设计，同时必须遵守本项目 Extension 与 Toolkit Runner 边界。
- 179 个分组/1366 个命令的业务覆盖也并未等同于本项目当前 Adapter 集合。后续先完成运行与生成能力，再核查站点覆盖需求，不以单个 B 站结果推断任意网站可用。

下一步 CLI 对齐仍包括目标网站多步 UI/写命令、复杂浏览器能力、知识修订和独立 Agent 验收；鉴权最新范围见顶部增量。用户明确不需要 OpenCLI 桌面客户端；WeWorker UI/聊天共用服务及 profile 选择界面单列产品集成，不作为 CLI 对齐完成条件。CDP/Electron 指 CLI 控制外部目标。此核查更新比较基线，不改变其余 CLI 能力对齐目标。

下载对照增量：核对发布包 cli.js 的 wait download、browser/page.js 与类型声明。本项目使用同一 call 入口，显式区分未见/进行中/中断/歧义；匹配为字面子串，downloadId 为 CDP GUID，Chrome 数字 ID 只是可选元数据。每次等待最长 30 秒，可按同一 ID 续等；不保证总能取得路径，不改浏览器下载策略。子 frame DOM 点击在日常 Chrome 未形成下载，focus + 原生 Enter 的跨源示例完成；这是仍待补原生子 frame 指针的实际边界。

原生 frame 输入增量：通用 click/dblclick/hover/drag 已补齐嵌套同源/跨源 frame 的原生指针，新增能力守卫避免旧插件退回 DOM 事件。日常 Chrome 上一阶段的跨源下载限制已由原生 click 解决。保留 Chrome frameId/documentId 选择契约与同 frame 拖拽范围；不据此声明所有复杂控件或 HTML5 拖放协议已等同。

持续观察对照增量：核对发布包 cli.js 中 console/network 的 since/until/follow（console 约 1216 行，network 约 2376/2480 行）。本项目继续使用统一 call 命令，CLI 输出 JSONL，其他调用方使用 browser.events 非锁定轮询；主/子 target 分开记录，不按时间戳去重，过期游标或容量缺口明确失败。时间裸数沿用本项目历史秒单位，OpenCLI 默认为毫秒，故推荐显式 ms/s/m/h；本项目轮询默认 500ms，可调 100–5000ms。真实验证包括两个独立订阅者、原生输入、子 frame、详情脱敏、信号、管道关闭和 Bridge 重启续接。一次性旧 console/network 保持主 target 缓存形态，流式正文、持久流量回放和 Worker target 订阅未实现。

AX 对照增量：核对 cli.js state 的 --source 与 --compare-sources，以及公开 ax-snapshot 类型声明和 BasePage 的 source 分派。OpenCLI 的比较是 DOM/AX 快照覆盖与耗时指标，并非前后历史差异；本项目以 browser.state source=ax / compareSources=true 实现，不复制上游快照或引用实现。默认 AX 汇总可访问 frame，显式 frame/document 限定范围；ref 绑定实际节点，名称变化、节点替换或文档过期明确拒绝，不按相同 role/name 重绑定。已实测开放/关闭/嵌套 Shadow DOM 原生点击与输入、重复名称、两个同 URL 子 frame、悬停名称变化以及比较后继续使用旧引用。输入 value 不进入 AX 输出，限额/部分 frame 明确标记。深层 selector、全部自定义组件和截图高级选项尚未等同。

截图对照增量：核对发布包 cli.js screenshot 的 full-page/annotate/width/height 与 visual-refs 类型说明。WebCLI 用 annotate/width/height/path 参数，width/height 为真实 CSS 视口尺寸，fullPage 忽略 height。上游说明通过临时 DOM 覆盖层标注，本项目在 PNG 合成，实际 MutationObserver 证明无覆盖层 DOM 变动；刷新主文档 DOM refs 后返回编号映射，暂不编号 AX/Shadow DOM/子 frame。默认返回 base64，保存只接受绝对新路径且不覆盖；与 OpenCLI 的任意输出路径策略有意保留差异。

真实 Chromium 与日常 Chrome 均覆盖标注/ref 点击、响应式视口、完整页面、滚动恢复、像素上限、失败/导航恢复及保存文件；隔离浏览器另测 125% zoom，日常 Chrome 验证原生高 DPR。截图时 Chrome 重置已有 emulation 导致像素/视口错配，已通过丢弃后一次重拍处理，并以实际按钮颜色/框线像素验证，未用图片缩放伪造布局。恢复报告明确是否保留 measured desktop override；其他客户端的完整手机模拟配置无法读取，因此未声称精确还原任意设备模拟。

开放 Shadow DOM 对照增量：发布包 dom-snapshot.js 可遍历开放 shadowRoot，Skill 另提供语义 find 与 AX 作为复杂组件入口。本项目保留普通 CSS 范围，通过 shadow=true 显式查询所选文档和开放根；CSS 组合器不跨树，结果附 host 路径与 refs，多个匹配不选首项。局部 aria-labelledby、嵌套根、原生指针/同 frame drag、表单 composed 事件、过期/遮挡/限额拒绝及跨源 frame 均纳入实际验收。关闭根继续用 AX；该实现不等于完整无障碍算法、复合 date/select/file 元数据、通用自定义控件或 Shadow 文件输入均已对齐。

复合字段/HTML 树增量：按 compound.d.ts、html-tree.d.ts 和 browser Skill 的公开契约核对。WebCLI DOM state/find 默认提供日期/时间格式与约束、select 列表/current、file 名称与 accept/multiple，get compound 可单独读取；列表同样限 50，选中项独立读取以覆盖列表之外的选中值，另附 currentValues、disabled optgroup、原生 validity 与显式省略/截断。AX state 保留原有省略值规则，需显式 get compound。

select 支持 by=auto/value/label，使用 option.label 并核对修改后状态。与 OpenCLI 标签优先选择相比，本项目在 value/label 碰撞或同类重复时明确拒绝，需要作者明确匹配方式；不能把这种差异写成逐参数完全相同。结构化 HTML 用 get property=html as=json，支持 depth=0、html 根节点、子节点/文本/总节点限额，包含复合信息和截断报告。默认有界、限定属性、密码值/脚本正文省略，原 raw HTML 保留；树不自动遍历 shadow roots，选中内部元素再读。自定义日期弹层/组件状态机和 Shadow 文件输入仍未覆盖。

上传对照增量：核对发布包 BasePage.uploadFiles 的 selector/semantic/ref 入口和 CDP setFileInput。WebCLI 统一 upload target 与其他命令，新增准确 frame/document、开放 shadow 与关闭 AX ref 上传，隐藏原生 input 也可选择。实现保留隔离世界实际节点，经所属 target session 按 objectId 赋文件，不向 DOM 写标记属性；验证文件名/顺序/大小，失效目标不重识别，已派发失败明确标记。原生 disabled/单多文件限制和目录输入拒绝均纳入测试；目录/文件选择弹窗、通用自定义上传业务流程尚未覆盖。

多 profile 实现增量（2026-10-17）：按上述 1.8.8 发布接口实现 list/rename/use 与选择优先级，保留本项目离线 default 不回退的选择。普通调用、后台探索/Worker、trace、follow 均绑定选定连接，响应不广播；双 Chromium 和日常 Chrome 回归通过。旧数据通过 legacy 只读访问，未自动迁移。对照仍是发布包接口与本机 1.8.6 help，未宣称上游 daemon 全部冲突/断线行为与本实现相同。
