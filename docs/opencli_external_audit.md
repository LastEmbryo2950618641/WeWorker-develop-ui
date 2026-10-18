# OpenCLI external CLI 审计

2026-10-18，固定参考官方 1.8.8 发布包 `dist/src/external.js`、`external-clis.yaml` 与 `cli.js:3255–3324`。仅静态阅读，没有运行其安装命令或任何账户操作。

上游实际能力：13 个随包元数据（gh、obsidian、ntn、docker、lark-cli、longbridge、dws、wecom-cli、vercel、tg、discord、wx、wrangler），用户 YAML 同名覆盖；external register 保存 binary/description/install，list 显示 PATH 检查与元数据，install 选择系统安装命令。根命令按注册名透传，继承 stdin/stdout/stderr，保留子进程退出码，signal 不报成功。二进制缺失会自动安装；安装字符串拒绝 shell 操作符后拆 argv。Windows 有 .cmd/shell 后备，不代表已在本机验证。

本项目逐项核对 `index.js` 路由、`managed-adapter-cli.js`、`toolkit-runner.js`：现有 Adapter install/develop/use 与 embedded Toolkit 面向包内工具，未提供外部 CLI 注册和透传。不能把 Toolkit 作为同等能力，亦不能以用户机器已有 gh 等程序宣称已对齐。

剩余实现需明确独立命名空间、受控注册目录、注册/安装/执行分离、原样参数/stdio/退出码和取消语义，复用现有格式与补全；不得混入 Adapter 底层 Runner。真实验收仅运行临时公开 fixture 可执行文件与隔离安装目标，不修改全局工具或真实账户。上游自动安装与本任务要求的受限操作单独授权不同，执行策略必须明确记录，不能静默触发安装。

状态：审计已确认实际差距，尚未实现/验收；台账 U05 保持开放。13 个工具的实际业务能力仍分别属于站点/外部系统与平台验收范围，不由透传成功代替。
