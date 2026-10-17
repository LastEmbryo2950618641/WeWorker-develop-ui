# OpenCLI 1.8.8 对照核查

核查日期：2026-10-17。本机 opencli --version 为 1.8.6；另从 npm 官方 registry 读取并解包 [@jackwener/opencli 1.8.8](https://www.npmjs.com/package/@jackwener/opencli/v/1.8.8)，未全局安装、未修改用户 OpenCLI 环境。以下是发布包静态接口核查，不等于所有上游命令实机通过；本项目实测状态见 [能力台账](opencli_parity.md)。

来源：package.json、cli-manifest.json、dist/src/cli.js、dist/src/browser/analyze.js、README.md、包内 opencli-adapter-author 技能。公开发布包 tarball 为 https://registry.npmjs.org/@jackwener/opencli/-/opencli-1.8.8.tgz 。没有复制上游业务实现。

- cli-manifest.json 包含 1366 个命令条目、179 个 site 分组（包括桌面应用，不能全部称为网站）。策略字段计数：cookie 778、public 345、ui 195、local 26、intercept 22。这个枚举比作者技能中的六种策略更粗；不能只按标签数宣称能力相等。
- 作者技能仍按 PUBLIC_API / COOKIE_API / PAGE_FETCH / INTERCEPT / DOM_STATE / UI_SELECTOR 选择，要求来源证据、契约与替代策略理由。analyze 对实际响应做业务数据、噪声、权限阻塞判别；页面请求多不等于接口可复用。WebCLI 本轮加入结构分析与保留失败 revision 后显式重做计划，未实现自动运行时静默回退。
- 浏览器接口除既有基本操作外，仍包含 state 的 AX 对比选项、截图标注与临时视口尺寸、console/network since/until/follow、跨源 frame eval、download 等待。WebCLI 当前缺少其中的高级选项与持续输出；frames 列表和普通截图通过不代表这些已具备。
- profile list/rename/use 与全局 --profile、环境 OPENCLI_PROFILE 支持多个扩展连接，不明确时选择 profile；另有 OPENCLI_CDP_ENDPOINT / OPENCLI_CDP_TARGET 和 Electron 应用适配。WebCLI 当前只验收一个 Chrome 插件连接和命名标签会话，不应把 session 当作多 profile 实现。
- 其他接口包括 skills list/read、validate/verify、convention-audit、adapter status/eject/reset、plugin create/install/update/uninstall、daemon status/stop/restart、external register/install/list 和 shell completion。WebCLI 部分已有相近的 Adapter 管理/服务/Skill 分发能力，仍需逐命令核对输出、错误、覆盖和差异；不能直接按名字视为完成。
- PUBLIC_API 可在没有浏览器时通过 host HTTP 执行；COOKIE_API 使用明确的运行时鉴权。WebCLI 当前自动生成的 API 命令仍是 Extension PAGE_FETCH，独立 host HTTP/通用鉴权能力待设计，同时必须遵守本项目 Extension 与 Toolkit Runner 边界。
- 179 个分组/1366 个命令的业务覆盖也并未等同于本项目当前 Adapter 集合。后续先完成运行与生成能力，再核查站点覆盖需求，不以单个 B 站结果推断任意网站可用。

下一步仍包括多步 UI/写命令、通用鉴权、复杂浏览器能力、知识修订、UI/聊天共用服务和独立 Agent 验收。此核查更新比较基线，不改变用户要求尽力完整对齐的目标。
