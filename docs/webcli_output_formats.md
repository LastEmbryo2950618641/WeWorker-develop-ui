# WebCLI 输出格式

`webcli call <namespace>.<command> --output-format=<格式>` 支持 json、markdown（md）、table、plain、csv、yaml（yml）。这不占用业务参数 `--format`。未指定时，业务命令保留终端 markdown、管道 JSON；browser/exploration/profile 管理命令保留默认 JSON。显式格式同样作用于管理结果、错误及帮助，不改变错误退出码。

`list`、`adapter list/info/status/validate`、全局帮助、Adapter 帮助和三级渐进帮助也接受 `--output-format`，返回各自完整数据模型。AdapterHub 的既有 JSON 路径统一接入这些格式，包括结果、help 和错误；未知格式在调用前拒绝，参数错误退出 2、运行错误退出 1，安装来源/权限/发布确认语义保持。其余 Adapter 管理动作暂不接受该选项，会在执行前拒绝；原 `--json` 保持兼容。原始 Skill 文本、进程日志与 shell 补全脚本仍使用自身文本协议。

`skills list` 展示随包的四个 Skill；`skills read <name[/path]> [path]` 默认原样输出 UTF-8 文本（含原 BOM），`--json` 或显式格式返回 skill/path/content。仅允许安装包内的普通文本文件，不遍历用户 Skill，不跟随符号链接，不执行其中指令。

- JSON 保持原完整 JSON 序列化。YAML 输出同一 JSON 数据模型，字符串和键加引号，避免前导零、日期、布尔文本被重新解释；不生成标签或别名。数组调用的 result/trace_id 包装也完整保留。
- CSV/table 对单一列表字段或 result 包装中的行渲染；列为所有行字段的有序并集，命令显式 columns 时按指定顺序。复杂单元格为 JSON，CSV 对表头和单元格统一转义双引号、逗号和 CR/LF，行分隔 CRLF。空列表无输出。多个列表保留为对象的 JSON 单元格。需要完整信封和元数据时用 JSON/YAML。
- table 使用文本边框，转义控制字符；plain 对单字段 response/content/markdown/text/value 直接输出内容，其他字段逐行输出，复杂值为 JSON。markdown 继续使用既有列映射、多段表格与动作/错误展示。
- `browser.console/network --follow` 固定输出 JSON Lines；显式非 JSON 格式在启动 Bridge 前失败，不将事件流伪装成单份 YAML/CSV。空值或未知格式也在调用前拒绝。

对照：OpenCLI 1.8.8 的 output.js 提供上述六类格式；本项目保留既有默认值、统一 call 入口与业务参数分离。不会把首行字段当作所有行列全集，CSV 的表头与复杂单元格也保留有效转义。

## Shell 补全

`webcli completion bash|zsh|fish` 只输出脚本，不写用户配置。按需要在当前 shell 加载：

```bash
# Bash
source <(webcli completion bash)
# Zsh（已有 compinit 时只需第二行）
autoload -Uz compinit; compinit
source <(webcli completion zsh)
# Fish
webcli completion fish | source
```

补全首级内置命令、Adapter ID，以及第二级 `call <namespace.command>`、`browser/exploration/profile <command>` 和 `<adapter> <command>` 的命令与别名。候选来自当前静态 catalog/help；不猜业务参数，不连接 Bridge，不执行 Adapter 模块或 Python。旧版 Adapter 使用静态字符串注册名和别名，动态计算的名字不求值；无法读取 catalog 时仍提供内置候选，实际诊断通过正常 help/list 查看。候选限可移植字符，shell 参数逐词传递，不将词或注册名求值。

对照上游 1.8.8 的首级/二级补全范围，保留本项目统一 call 入口。验收脚本 `webcli/scripts/verify-completion.mjs --python=<独立 Python> --fish=<Fish 可执行文件>` 使用临时 catalog/home、Bash/Zsh 真实交互 Tab 和 Fish 原生 `complete -C`；加 `--bundled` 检查打包产物。不会改用户 shell 配置或执行候选工具。未提供 Fish 时报告明确记录欠账。

验证入口：`webcli/__tests__/output-formats.test.js`；真实隔离 loopback/CLI 的 `webcli/scripts/verify-output-formats.mjs --python=<含 PyYAML 的独立解释器>`，加 `--bundled` 检查打包 CLI。独立 Python YAML/CSV 解析器核对输出，实际请求检查前导零与业务 format 原样传输。最新结果见 ROADMAP 和交接末尾。
