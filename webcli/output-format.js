/**
 * WebCLI call 命令输出格式化。
 *
 * 终端默认输出 markdown（人类可读），管道/脚本默认 json；
 * 调用方可通过 --output-format=markdown|json 显式指定。
 * json 输出与历史行为逐字节一致：JSON.stringify(data, null, 2)。
 *
 * markdown 渲染面向 Agent，按实际结果结构选择最短且稳定的展示：
 * - MultiSectionData（{ sections: [{ title, columns?, rows? }] }）按 section 渲染多张表，
 *   每张表只展示 columns 指定的字段（与 WECLI output.ts renderMultiSectionMarkdown 对齐）；
 * - 列表结果（含 items/tickets/rows/records/list 数组的对象）渲染为一张表，
 *   有 columns 时只展示这些列（缺失的字段自动跳过），没有时退化为全字段；
 * - 写操作结果渲染为稳定的逐行字段；
 * - 其余对象渲染为纵向详情表；JSON 模式始终输出全量字段。
 */

export const DEFAULT_OUTPUT_FORMAT = "markdown";
export const SUPPORTED_OUTPUT_FORMATS = ["markdown", "json"];

/** 常见列表键：markdown 渲染时优先把该数组渲染成表格。 */
const LIST_KEYS = [
  "items", "tickets", "rows", "records", "list", "results",
  "products", "orders", "emails", "rooms", "notes", "candidates",
  "spaces", "folders", "files", "steps", "fields",
];

/**
 * 校验并归一化输出格式，同时处理 CLI 的 TTY 默认策略。
 * 未指定时终端默认 markdown、管道/脚本默认 json；显式空值和不支持的格式直接抛错。
 */
export function resolveOutputFormat(value, isTTY = Boolean(process.stdout && process.stdout.isTTY)) {
  if (value === undefined || value === null) {
    return isTTY ? "markdown" : "json";
  }
  const v = String(value).trim().toLowerCase();
  if (v === "") {
    throw new Error(`--output-format 缺少参数值（可用：${SUPPORTED_OUTPUT_FORMATS.join(" / ")}）`);
  }
  if (!SUPPORTED_OUTPUT_FORMATS.includes(v)) {
    throw new Error(`不支持的输出格式: "${value}"（可用：${SUPPORTED_OUTPUT_FORMATS.join(" / ")}）`);
  }
  return v;
}

/**
 * 格式化 call 输出。
 * @param {unknown} data 工具结果（或错误信封）
 * @param {string} [format] markdown | json
 * @param {{ columns?: string[] }} [options] columns：该命令的「用户可感知字段」展示列
 */
export function formatCallOutput(data, format = DEFAULT_OUTPUT_FORMAT, options = {}) {
  const resolved = resolveOutputFormat(format);
  if (resolved === "json") return JSON.stringify(data, null, 2);
  return renderMarkdownOutput(data, options);
}

function renderMarkdownOutput(data, options = {}) {
  if (data === null || data === undefined) return "_暂无数据_";
  // 1) cmdCall 的 result 包装：{ result: <any>, trace_id? }，直接渲染内部结果
  if (isResultWrapper(data)) {
    const body = renderMarkdownOutput(data.result, options);
    return appendTrace(body, data.trace_id);
  }
  // 2) 错误和写操作结果优先于普通对象
  if (isErrorEnvelope(data)) return renderError(data);
  if (isActionResult(data)) return renderAction(data);
  // 3) MultiSectionData（WECLI 多表结构）：detail 视图等，按 section 渲染
  if (isMultiSectionData(data)) {
    return renderSections(data, options);
  }
  // 4) 列表结果：对象里带 items/tickets/rows/records/list 数组 → 渲染成一张表
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const listKeys = findListKeys(data);
    if (listKeys.length > 1) return renderListSections(data, listKeys, options);
    if (listKeys.length === 1) return renderListObject(data, listKeys[0], options);
  }
  // 5) 纯数组：有 columns/mapping 时按列渲染，否则按元素类型渲染
  if (Array.isArray(data)) {
    return renderArray(data, 0, options.columns, options.mapping);
  }
  // 6) 单对象详情：映射决定字段、顺序和标签；无映射时完整展示
  if (data && typeof data === "object") {
    return renderDetail(data, options.columns, options.mapping);
  }
  // 7) 文本和标量保持原值
  return String(data);
}

function isResultWrapper(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const keys = Object.keys(data);
  return keys.includes("result") && keys.every((k) => k === "result" || k === "trace_id");
}

function isMultiSectionData(data) {
  return (
    data !== null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    Array.isArray(data.sections)
  );
}

function isErrorEnvelope(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.error !== "string") return false;
  return Object.keys(data).every((key) => ["error", "error_code", "code", "trace_id", "hint"].includes(key));
}

function isActionResult(data) {
  return data !== null && typeof data === "object" && !Array.isArray(data) && data._type === "confirm";
}

function findListKeys(data) {
  const keys = [];
  for (const key of LIST_KEYS) {
    const value = data[key];
    if (Array.isArray(value) && value.every((v) => v && typeof v === "object" && !Array.isArray(v))) {
      keys.push(key);
    }
  }
  return keys;
}

function renderListSections(data, listKeys, options) {
  const lines = [];
  for (const key of listKeys) {
    lines.push(`## ${key}`, "", data[key].length ? renderTable(data[key], options.columns, options.mapping) : "_暂无数据_", "");
  }
  return appendTrace(lines.join("\n").trim(), data.trace_id);
}

function renderSections(data, options = {}) {
  const lines = [];
  for (const section of data.sections) {
    if (!section || typeof section !== "object") continue;
    if (section.title) lines.push(`## ${section.title}`, "");
    if (typeof section.content === "string") {
      lines.push(section.content, "");
      continue;
    }
    const rows = Array.isArray(section.rows) ? section.rows : [];
    if (rows.length === 0) {
      lines.push("_暂无数据_", "");
      continue;
    }
    const mapping = { ...(options.mapping || {}), ...(section.labels || {}) };
    lines.push(
      rows.length === 1
        ? renderDetail(rows[0], section.columns, mapping)
        : renderTable(rows, section.columns, mapping),
      "",
    );
  }
  return appendTrace(lines.join("\n").trim(), data.trace_id);
}

function renderListObject(data, listKey, options = {}) {
  const rows = data[listKey];
  if (rows.length === 0) return appendTrace("_暂无数据_", data.trace_id);
  const lines = [renderTable(rows, options.columns, options.mapping)];
  const count = data.count ?? data.total ?? rows.length;
  lines.push(`> 共 ${count} 条`);
  return appendTrace(lines.join("\n\n"), data.trace_id);
}

function renderArray(arr, depth, columns, mapping) {
  if (arr.length === 0) return "_暂无数据_";
  const allObjects = arr.every((v) => v !== null && typeof v === "object" && !Array.isArray(v));
  if (allObjects) return renderTable(arr, columns, mapping);
  const indent = "  ".repeat(depth);
  return arr.map((item) => `${indent}- ${escapeCell(item)}`).join("\n");
}

function renderDetail(obj, columns, mapping) {
  const allKeys = Object.keys(obj).filter((key) => key !== "trace_id");
  const hasColumns = Array.isArray(columns) && columns.length > 0;
  const hasMapping = mapping && typeof mapping === "object" && Object.keys(mapping).length > 0;
  const wanted = hasColumns ? columns : hasMapping ? Object.keys(mapping) : allKeys;
  let keys = wanted.filter((key) => Object.prototype.hasOwnProperty.call(obj, key) && key !== "trace_id");
  if (keys.length === 0) keys = allKeys;
  if (keys.length === 0) return appendTrace("_暂无数据_", obj.trace_id);
  const label = makeLabel(mapping);
  const rows = keys.map((key) => `| ${escapeCell(label(key))} | ${escapeCell(obj[key])} |`);
  return appendTrace(["| 字段 | 内容 |", "| --- | --- |", ...rows].join("\n"), obj.trace_id);
}

function renderAction(data) {
  const hasConfirmCommand = data.confirm_command || data.confirmCommand;
  const hasFollowUp = data.task_id || data.taskId || data.query_command || data.queryCommand || data.next_command || data.nextCommand;
  const status = hasConfirmCommand ? "confirm_required" : hasFollowUp ? "accepted" : "success";
  const operation = [data.resource, data.action].filter(Boolean).join(".");
  const lines = [`status: ${status}`];
  if (operation) lines.push(`operation: ${escapeInline(operation)}`);
  const fields = Object.entries(data)
    .filter(([key, value]) => !["_type", "action", "resource", "trace_id"].includes(key) && value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => Number(/command$/i.test(a)) - Number(/command$/i.test(b)) || Number(a === "message") - Number(b === "message"));
  for (const [rawKey, value] of fields) {
    const key = rawKey === "status" ? "result_status" : toSnakeCase(rawKey);
    const rendered = /command$/.test(key) ? `\`${String(value).replace(/`/g, "\\`")}\`` : escapeCell(value);
    lines.push(`${key}: ${rendered}`);
  }
  if (data.trace_id != null && data.trace_id !== "") lines.push(`trace_id: ${escapeInline(data.trace_id)}`);
  return lines.join("\n");
}

function renderError(data) {
  const lines = ["status: error"];
  const code = data.error_code ?? data.code;
  if (code != null && code !== "") lines.push(`error_code: ${escapeInline(code)}`);
  lines.push(`message: ${escapeInline(data.error)}`);
  if (data.hint) lines.push(`hint: ${escapeInline(data.hint)}`);
  if (data.trace_id != null && data.trace_id !== "") lines.push(`trace_id: ${escapeInline(data.trace_id)}`);
  return lines.join("\n");
}

function toSnakeCase(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/-/g, "_").toLowerCase();
}

function renderTable(rows, explicitColumns, mapping) {
  const allKeys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const hasExplicit = Array.isArray(explicitColumns) && explicitColumns.length > 0;
  const hasMapping = mapping && typeof mapping === "object" && Object.keys(mapping).length > 0;
  let wanted = hasExplicit
    ? explicitColumns
    : hasMapping ? Object.keys(mapping) : allKeys;
  // 只保留在数据里真实存在的列，避免 WECLI 旧字段名（版本漂移）渲染出空列
  let keys = wanted.filter((key) => rows.some((row) => Object.prototype.hasOwnProperty.call(row, key)));
  // 安全回退：显式列/映射与数据完全不匹配时退化为全字段，避免空表（|  |  |）
  if (keys.length === 0 && allKeys.length > 0) keys = allKeys;
  const label = makeLabel(mapping);
  const header = `| ${keys.map((k) => escapeCell(label(k))).join(" | ")} |`;
  const separator = `| ${keys.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (row) => `| ${keys.map((k) => escapeCell(row[k])).join(" | ")} |`,
  );
  return [header, separator, ...body].join("\n");
}

function makeLabel(mapping) {
  const hasMapping = mapping && typeof mapping === "object";
  return (key) => (hasMapping && mapping[key] ? mapping[key] : key);
}

function escapeInline(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

/** 表格单元格：null/undefined 空串，标量数组 <br> 连接，对象紧凑 JSON（避免 [object Object]），换行转 <br>，竖线转义。 */
function escapeCell(value) {
  if (value === null || value === undefined) return "";
  let text;
  if (Array.isArray(value)) {
    // 区分标量数组和对象数组：对象元素紧凑 JSON，标量直接展示
    text = value
      .map((item) => {
        if (item === null || item === undefined) return "";
        if (typeof item === "object") return JSON.stringify(item);
        return String(item);
      })
      .join("<br>");
  } else if (typeof value === "object") {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }
  return text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function appendTrace(body, traceId) {
  if (traceId == null || traceId === "") return body;
  return `${body}\n\n> trace_id: ${traceId}`;
}
