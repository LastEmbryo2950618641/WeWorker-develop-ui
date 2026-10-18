# Adapter 静态诊断

`webcli adapter status [name]` 只读展示 managed v2 的当前选择、有效包、候选包和诊断码。被 builtin/user/development 遮蔽或 disabled 的候选仍可见；包损坏、摘要变化、权限变化、目录冲突和全局状态错误沿用统一 catalog 的判断，不回退另一个来源。报告不包含本地包路径。

`webcli adapter validate <directory>` 检查指定包；`webcli adapter validate --installed [name]` 检查当前有效 v2 包（省略名称时检查所有有效包）。检查包括规范、文件闭合性、摘要和来源、声明式写模块约束，以及 Extension/HTTP JavaScript 的仅编译语法检查。命令代码不会被执行，不连接 Bridge、浏览器或外部服务，不创建或修改注册表。结果的 `executed:false` 不可被解释为真实效果已验证。

两个入口默认输出 JSON，也接受 `--json` 和 `--output-format=json|yaml|csv|table|plain|markdown`。错误退出 1；未知名称或非 active 的目标不能用空结果宣称通过。空 catalog 明确报告零包/零命令。Toolkit Python 不执行或编译，报告 `TOOLKIT_SYNTAX_NOT_CHECKED`；冻结 legacy Adapter 不在该 v2 范围内，仍是管理对齐待办。

真实读取、输入关联、写效果和恢复验证继续使用 exploration 的作者 cases、独立效果 fixture 与隔离验收。静态诊断不授权安装，不继承写确认，不代替运行验证。OpenCLI 1.8.8 的 validate/默认 verify 同样主要检查定义；其可选 smoke 依赖包外测试目录。本项目统一 verify/evidence 报告和 convention audit 仍开放，不因增加本入口宣称管理能力全部对齐。

源码/打包验收入口为 `webcli/scripts/verify-management-output.mjs --python=<含 PyYAML 的独立解释器>`（打包加 `--bundled`），仅使用临时目录和自建 loopback 服务。具体结果与限制见能力台账和交接文档。
