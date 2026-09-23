/** 默认工具调用超时（毫秒） */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 120_000;

/** QQ 邮箱工具调用超时 */
export const QQ_MAIL_TOOL_CALL_TIMEOUT_MS = 3 * 60 * 1000;

/** QQ 邮箱批量下载发票：逐封打开/下载，耗时更长 */
export const QQ_MAIL_BATCH_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

const QQ_MAIL_BATCH_DOWNLOAD_TOOLS = new Set([
  "mail.qq.com.download_invoices_by_invoice",
]);

/**
 * 按工具名解析 call_tool 超时（毫秒）
 * @param {string} toolName
 */
export function resolveToolCallTimeout(toolName) {
  if (typeof toolName === "string" && QQ_MAIL_BATCH_DOWNLOAD_TOOLS.has(toolName)) {
    return QQ_MAIL_BATCH_DOWNLOAD_TIMEOUT_MS;
  }
  if (typeof toolName === "string" && toolName.startsWith("mail.qq.com.")) {
    return QQ_MAIL_TOOL_CALL_TIMEOUT_MS;
  }
  return DEFAULT_TOOL_CALL_TIMEOUT_MS;
}
