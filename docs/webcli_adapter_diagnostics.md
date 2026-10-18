# Adapter 静态诊断

`webcli adapter status [name]` 只读展示 managed v2 的当前选择、有效包、候选包和诊断码。被 builtin/user/development 遮蔽或 disabled 的候选仍可见；包损坏、摘要变化、权限变化、目录冲突和全局状态错误沿用统一 catalog 的判断，不回退另一个来源。报告不包含本地包路径。

`webcli adapter validate <directory>` 检查指定包；`webcli adapter validate --installed [name]` 检查当前有效 v2 包（省略名称时检查所有有效包）。检查包括规范、文件闭合性、摘要和来源、声明式写模块约束，以及 Extension/HTTP JavaScript 的仅编译语法检查。命令代码不会被执行，不连接 Bridge、浏览器或外部服务，不创建或修改注册表。结果的 `executed:false` 不可被解释为真实效果已验证。

两个入口默认输出 JSON，也接受 `--json` 和 `--output-format=json|yaml|csv|table|plain|markdown`。错误退出 1；未知名称或非 active 的目标不能用空结果宣称通过。空 catalog 明确报告零包/零命令。Toolkit Python 不执行或编译，报告 `TOOLKIT_SYNTAX_NOT_CHECKED`；冻结 legacy Adapter 不在该 v2 范围内，仍是管理对齐待办。

真实读取、输入关联、写效果和恢复验证继续使用 exploration 的作者 cases、独立效果 fixture 与隔离验收。静态诊断不授权安装，不继承写确认，不代替运行验证。OpenCLI 1.8.8 的 validate/默认 verify 同样主要检查定义；其可选 smoke 依赖包外测试目录。本项目统一 verify/evidence 报告仍开放；规范审计见下节，不因增加本入口宣称管理能力全部对齐。

源码/打包验收入口为 `webcli/scripts/verify-management-output.mjs --python=<含 PyYAML 的独立解释器>`（打包加 `--bundled`），仅使用临时目录和自建 loopback 服务。具体结果与限制见能力台账和交接文档。

## 导出内置包并编辑

`webcli adapter eject <name> --directory <new-directory>` 将当前校验有效的 builtin v2 包完整复制到明确的新目录；目录名必须等于包名，父目录须已存在。即使当前选择 user/development，导出的仍是内置基线。包括命令与共享文件的摘要在复制前后核对，报告 `activated:false`。

已有目录、符号链接、包名不匹配、managed 安装/状态/缓存/工作区目录均拒绝，不覆盖、合并、删除或自动激活。失败时保留新建的未完成目录供检查，不能将其视作可用包。此操作不执行 Adapter 代码。

编辑后用 `adapter validate <directory>` 做静态检查，实际效果仍须按读取/写验证流程核对。显式 `adapter develop <directory>` 复用现有权限检查并选择开发源；`adapter use <name> builtin` 切回内置源且保留编辑文件。三个入口支持六类显式输出。上游 eject 依赖自动用户目录覆盖；本项目沿用显式选择机制，避免复制动作隐式改变运行来源。没有实现或执行删除式 reset。

`webcli/scripts/verify-adapter-export.mjs [--bundled]` 使用真实 CLI、独立 loopback API 和临时目录验证复制字节、原包完整、显式选择前后实际请求与切回，未接入用户 Bridge 或浏览器。


## 规范审计

`webcli adapter convention-audit <directory>` 或 `--installed [name]` 复用同一包、目录、摘要和来源检查，不执行命令。返回 packages/findings/diagnostics、相对文件与行号、包摘要和 executed:false；六类输出都保留提示，发现问题或无效包退出 1。空目录清单明确为零包。

七类检查：未显式 safety；静态 return 对象的字段不在现有显示映射；显示键混合大小写；limit 的 Math.min 截断；简单 catch 返回空数组；unknown/N/A 等占位回退；like/follow/create 等写命令缺少已声明反向写命令。后六类是启发式提示，可能是合理实现，必须结合实际代码和行为判断；camelCase 和反向操作不是项目强制规范，也不能据此自动重命名字段或添加删除能力。JSON 结果始终保留原字段。

只分析命令模块中的简单静态模式，注释被排除；动态对象、嵌套控制流、共享 helper 数据流、Toolkit/legacy 不在该扫描范围。JavaScript 仅编译检查，绝不导入。检查无提示不表示实际行为正确，也不能替代作者 cases/独立写效果。`verify-conventions.mjs [--bundled]` 使用隔离目录实测会抛错的模块未执行、六格式/退出码、安装来源和缺失/语法失败；完整结果见交接。
