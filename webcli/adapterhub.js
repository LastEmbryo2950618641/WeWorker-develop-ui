/**
 * AdapterHub CLI — 兼容转发入口。
 *
 * 历史上这里曾是一套独立的完整实现；现已与 adapterhub-cli.js 合并为唯一规范实现
 * （见该文件）。本文件仅保留 shim，使旧 import（含测试）不破坏：
 *   import { runAdapterHubCli } from "./adapterhub.js"
 *
 * index.js 的公共入口直接 import ./adapterhub-cli.js，不经此 shim。
 */
export { runAdapterHubCli } from "./adapterhub-cli.js";
