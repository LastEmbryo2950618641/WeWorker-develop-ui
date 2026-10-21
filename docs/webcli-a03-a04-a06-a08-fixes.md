# A03 / A04 / A06 / A08 修复记录

日期：2026-10-21。基于远程 `develop@fff64e38`，修复分支 `fix/webcli-version-help-github-detail`。本次不发布、不修改 CI/CD、数据库或依赖版本。

## 问题与处理

| 编号 | 修复前复现 | 修复后行为 |
| --- | --- | --- |
| A03 | 源码版本为 1.0.4，bundle 与 Windows 包装器输出 unknown version | 构建时从 WebCLI 自身 package.json 注入版本，源码、正式 WebCLI bundle 与 Windows 包装器均输出 1.0.4；不依赖调用目录 |
| A04 | 帮助宣称默认本地统计，实际缺少 endpoint 时失败 | 帮助和 README 明确所有统计均查询远端；说明 endpoint、鉴权与兼容 --remote；无配置仍明确失败，不伪造本地空统计 |
| A06 | 合法 v2 .adapt 在 --file 入口被当作旧 JS；33 个托管包的 knowledge 均拒绝 | --file 识别 .adapt 后使用既有包校验与统一安装管理器；保留权限、来源、降级控制。文本和结构化帮助明确 knowledge 仅用于旧式包，v2 使用 skill，不更换其旧 JSON 合同 |
| A08 | 模拟场景出现列表/详情往返；真实列表页未识别绝对链接且返回空详情；404 也返回普通空对象 | 只读详情改用宿主导航续执行，绝对/相对链接均按同源、同仓库及数字详情路径筛选；列表目标在当前标签页临时保留并限时校验，读完清理；有界等待标题与正文节点，区分不可用、未就绪和登录，允许正文合法为空；修正 max_comments=0 |

GitHub Adapter 版本由 1.0.0 升至 1.0.1，保持公开主机权限与 Star 等写操作逻辑不变。初始导航、列表转详情均沿用已有只读续执行合同，没有修改共享宿主协议。

## 自动化验证

新增回归先在旧实现上执行：版本打包测试失败；GitHub 导航与内容判定、统计帮助／错误提示、归档安装用例合计 9 项失败。修复后执行：

```text
cd webcli
npm test -- __tests__/github-detail.test.js __tests__/stats-cli.test.js __tests__/adapter-views.test.js __tests__/adapter-knowledge-command.test.js __tests__/metrics.test.js __tests__/adapter-host-runtime.test.js __tests__/opencli-reference-wave3-adapters.test.js __tests__/opencli-batch-adapters.test.js
结果：8 文件、222 项通过。

仓库根目录：
node --test weworker/scripts/__tests__/webcli-version.test.cjs weworker/scripts/__tests__/build-profile-overlay.test.cjs extension/test/host-adapter-navigation.test.mjs extension/test/wecli-runtime-helper.test.mjs
结果：17 项通过。

cd weworker
npm run build:webcli
结果：public 33 个托管包、扩展资源、WebCLI bundle 与包装器构建通过。

仓库根目录：
node scripts/check-public-config.mjs
结果：通过。
```

回归包含：归档非法输入不覆盖旧安装，新增写能力必须显式批准；knowledge 的文本／结构化帮助；远程统计筛选、未配置、HTTP 失败和超时；Issue/PR 列表到详情不循环、相对和绝对链接、空正文、404、未就绪、登录、外站及伪造／过期续执行目标。版本用例使用正式 esbuild 配置并从其他工作目录运行，Windows 下额外执行 .cmd。

修改的 JS/CJS 语法检查和差异格式检查通过。没有 Renderer 变更。

## 实际调用与真实页面

- Windows / Node 24.14.0；在隔离 Adapter 数据根执行正式构建的 CLI，源码、bundle、.cmd 版本输出一致。新打包的 GitHub 1.0.1 归档通过 `adapter install --file ... --json` 安装，返回 active=true；skill 可读取，knowledge 保持明确迁移提示。
- 校验 33 包生成 metadata，GitHub 源码、生成包与 WebCLI 资源逐文件比较一致。验证中发现一次构建后继续编辑造成的产物落后，重新构建后比较通过。
- 修复前，统计服务未配置时四种调用均失败；连接本次隔离模拟服务后查询与筛选正常。修复后自动化确认未配置、过滤和服务失败合同，没有使用真实统计服务。
- 独立 headless Chrome profile 中，运行当前 GitHub handler 并接入真实宿主运行时的导航逻辑：公开 issues 列表在一次宿主 execute 中进入具体 Issue，取得标题及 1200 字符正文摘要，comments_count=0；404 页明确返回 NOT_FOUND。公开 URL 和原始页面结果仅留在本地临时验收材料，仓库测试使用占位样例。

## 验证边界

- 真实页面验收通过 CDP 调用 handler 并驱动宿主续执行，未经过完整桌面 Extension/Bridge 链路；截图中原始命令、trace 与登录条件未取得，不宣称完整复现或关闭原测试机所有 A08 路径。
- 未构建或升级完整安装包，未验证 macOS、真实统计服务或全量 WebCLI 测试。依赖按现有 lockfile 安装，未升级。
- WebCLI 构建仍提示三个既有列映射资源缺失，本次未修改相关功能。
- 规范要求下，本次更新 ROADMAP；通过独立修复分支提交 PR 至 develop，等待 CI 与审阅；未合并或发布。
