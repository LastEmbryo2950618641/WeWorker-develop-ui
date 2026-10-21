/**
 * webcli stats —— adapter 调用频次统计（远程查询）
 *
 * 本地已无缓冲数据，统一请求服务端 GET /v1/stats，看全团队汇总。
 * aggregate / percentile / parseDuration 为纯函数，保留用于对远程返回数据二次过滤与测试。
 */

/** 解析 7d / 12h / 30m 为毫秒；非法默认 30 天 */
export function parseDuration(str) {
  const m = String(str || "").match(/^(\d+)(d|h|m)$/);
  if (!m) return 30 * 86400000;
  return parseInt(m[1], 10) * { d: 86400000, h: 3600000, m: 60000 }[m[2]];
}

export function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((s.length * p) / 100) - 1)];
}

/**
 * 聚合记录。
 * @param {Array} records
 * @param {object} opts
 * @param {"domain"|"tool"} [opts.by]
 * @param {"adapter"|"builtin"|null} [opts.kind]
 * @returns {Array<{key,calls,okRate,p50,p95,topTool,topToolCalls}>}
 */
export function aggregate(records, { by = "domain", kind = null } = {}) {
  const map = new Map();
  for (const r of records) {
    if (kind && r.kind !== kind) continue;
    const key = by === "domain" ? r.domain : r.tool;
    if (!map.has(key)) map.set(key, { calls: 0, ok: 0, times: [], tools: new Map() });
    const e = map.get(key);
    e.calls++;
    if (r.ok) e.ok++;
    if (typeof r.ms === "number") e.times.push(r.ms);
    e.tools.set(r.tool, (e.tools.get(r.tool) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].calls - a[1].calls)
    .map(([key, v]) => {
      const [topTool, topToolCalls] = [...v.tools.entries()].sort((a, b) => b[1] - a[1])[0] || [key, v.calls];
      return {
        key,
        calls: v.calls,
        okRate: v.calls ? +((v.ok / v.calls) * 100).toFixed(1) : 0,
        p50: percentile(v.times, 50),
        p95: percentile(v.times, 95),
        topTool,
        topToolCalls,
      };
    });
}

/** 渲染表格到字符串（本地/远程同构） */
export function renderTable(rows, { by = "domain", since, kind, totalCalls } = {}) {
  if (rows.length === 0) return "暂无埋点数据（运行几次 webcli call 后再试）。";
  const label = by === "domain" ? "DOMAIN" : "TOOL";
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  const lines = [];
  lines.push(
    `${pad(label, 30)} ${padL("CALLS", 6)} ${padL("OK%", 6)} ${padL("p50(ms)", 8)} ${padL("p95(ms)", 8)}  TOP TOOL`
  );
  for (const r of rows) {
    const top = by === "domain" ? `${r.topTool} (${r.topToolCalls})` : "";
    lines.push(
      `${pad(r.key, 30)} ${padL(r.calls, 6)} ${padL(r.okRate.toFixed(1) + "%", 6)} ${padL(r.p50, 8)} ${padL(r.p95, 8)}  ${top}`
    );
  }
  lines.push("─".repeat(80));
  const scope = [
    `${rows.length} ${by === "domain" ? "domain" : "tool"}`,
    `${totalCalls ?? rows.reduce((s, r) => s + r.calls, 0)} 次调用`,
    `近 ${since || "30d"}`,
    kind ? `kind=${kind}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  lines.push(`合计 ${scope}`);
  return lines.join("\n");
}

/**
 * 渲染路由决策聚合表（by=route）：命中率 + 分 kind 调用数/p50/p95。
 * 与 renderTable 同构输入不同——route 响应是 { total, hitRate, byKind }。
 * @param {{total:number,hitRate:number,byKind:Array<{kind:string,calls:number,p50:number,p95:number}>}} data
 * @param {{since?:string}} opts
 */
export function renderRouteTable(data, { since } = {}) {
  const { total = 0, hitRate = 0, byKind = [] } = data || {};
  if (!total) return "暂无路由埋点数据（触发几次 /chat 查询后再试）。";
  const hits = byKind
    .filter((r) => r.kind.startsWith("route_hit"))
    .reduce((s, r) => s + r.calls, 0);
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  const lines = [];
  lines.push(`命中率 ${hitRate}%  （命中 ${hits}/${total} · 近 ${since || "30d"}）`);
  lines.push("");
  lines.push(`${pad("KIND", 28)} ${padL("CALLS", 6)} ${padL("p50(ms)", 9)} ${padL("p95(ms)", 9)}`);
  for (const r of byKind) {
    lines.push(`${pad(r.kind, 28)} ${padL(r.calls, 6)} ${padL(r.p50, 9)} ${padL(r.p95, 9)}`);
  }
  return lines.join("\n");
}

/** 远程查询：请求服务端 GET /v1/stats，返回与 aggregate 同构的 rows */
export async function fetchRemoteStats({ endpoint, token, by, since, kind, top }) {
  const base = endpoint.replace(/\/v1\/metrics\/batch$/, "/v1/stats").replace(/\/$/, "");
  const url = new URL(/\/v1\/stats$/.test(base) ? base : `${base}/v1/stats`);
  if (by) url.searchParams.set("by", by);
  if (since) url.searchParams.set("since", since);
  if (kind) url.searchParams.set("kind", kind);
  if (top) url.searchParams.set("top", String(top));
  const res = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`服务端返回 ${res.status}`);
  return res.json(); // { rows: [...], totalCalls }
}

/**
 * 命令入口：解析参数并打印结果。
 * @param {string[]} argv  stats 之后的参数
 */
export async function runStats(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const byRaw = get("--by");
  const by = byRaw === "tool" ? "tool" : byRaw === "route" ? "route" : "domain";
  const since = get("--since") || "30d";
  const kind = get("--kind") || null; // adapter | builtin
  const top = get("--top") ? parseInt(get("--top"), 10) : null;
  const asJson = argv.includes("--json");
  // 本地已无缓冲数据，统一走远程查询；--remote 作为显式标记保留（行为与默认一致）。
  const remote = argv.includes("--remote");
  void remote;

  let rows;
  let totalCalls;

  const endpoint = process.env.WEBCLI_METRICS_ENDPOINT;
  if (!endpoint) {
    console.error("Error: webcli stats 仅查询远程服务，不提供本地统计。请设置 WEBCLI_METRICS_ENDPOINT（统计服务地址）；鉴权服务还需 WEBCLI_METRICS_TOKEN。");
    process.exit(1);
  }

  // by=route：路由决策聚合（命中率 + 分 kind 延迟），响应结构 {total,hitRate,byKind} 不同于单维聚合
  if (by === "route") {
    let data;
    try {
      data = await fetchRemoteStats({
        endpoint,
        token: process.env.WEBCLI_METRICS_TOKEN || "",
        by,
        since,
      });
    } catch (e) {
      console.error(`Error: 远程查询失败：${e.message}`);
      process.exit(1);
    }
    if (asJson) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(renderRouteTable(data, { since }));
    }
    return;
  }

  try {
    const data = await fetchRemoteStats({
      endpoint,
      token: process.env.WEBCLI_METRICS_TOKEN || "",
      by,
      since,
      kind,
      top,
    });
    rows = data.rows || [];
    totalCalls = data.totalCalls;
  } catch (e) {
    console.error(`Error: 远程查询失败：${e.message}`);
    process.exit(1);
  }

  if (asJson) {
    console.log(JSON.stringify({ rows, totalCalls, by, since, kind }, null, 2));
    return;
  }
  console.log(renderTable(rows, { by, since, kind, totalCalls }));
}
