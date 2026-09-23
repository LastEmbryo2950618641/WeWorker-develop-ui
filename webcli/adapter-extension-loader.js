/**
 * v2 Adapter loader — extension 侧纯逻辑（无 chrome 依赖，可单测）
 *
 * Shared contract: docs/adapter_architecture_unification.md
 * 注入顺序：internal/（字母序）→ commands/（manifest 声明序）
 * 命令文件只含 IIFE + `__webcliRegisterCommand(id, handler)`；
 * definition/schema 由本模块从 manifest 合入（单源），经 bootstrap 预埋进页面。
 */

/** 单个命令的注册定义（对接 injector 的 __webmcpRegister 协议） */
export function v2CommandDef(manifest, command) {
  const defaultRouteDomain = (manifest.match || [])[0] || "";
  const routeDomain = command.routeDomain || command.tabDomain || defaultRouteDomain;
  return {
    id: command.id,
    aliases: [...(command.aliases || []).map((alias) => manifest.name + '.' + alias), ...(command.legacyNames || [])],
    name: `${manifest.name}.${command.id}`, // 公开名 = handlerName（call_tool 默认按工具名取 handler）
    description: command.description || "",
    parameters: command.schema || { type: "object", properties: {} },
    safety: command.safety || 'read',
    ...(command.execution?.runtime === 'background' ? { execution: command.execution, directCapable: true, executionMode: 'direct' } : {}),
    adapterId: manifest.name,
    routeDomain,
    ...(command.excludeTabDomain ? { excludeTabDomain: command.excludeTabDomain } : {}),
    tabDomain: command.tabDomain || routeDomain,
  };
}

/** bootstrap 代码：预埋定义 + 定义 __webcliRegisterCommand（幂等） */
export function buildV2Bootstrap(manifest) {
  const defs = {};
  for (const command of manifest.commands || []) {
    if (command.runtime !== "extension") continue;
    defs[command.id] = v2CommandDef(manifest, command);
  }
  const header = `/* v2 adapter bootstrap (${manifest.name}) */`;
  return `${header}
(function () {
  var defs = ${JSON.stringify(defs)};
  window.__webcliRegisterCommand = function (id, handler) {
    var def = defs[id];
    if (!def) throw new Error('[v2] unknown command: ' + id);
    if (typeof handler !== 'function') throw new Error('[v2] command "' + id + '" handler is not a function');
    window.__webmcpRegister({
      adapterId: def.adapterId,
      routeDomain: def.routeDomain,
      tabDomain: def.tabDomain,
      excludeTabDomain: def.excludeTabDomain,
      tools: [{
        name: def.name,
        publicName: def.name,
        handlerName: def.name,
        description: def.description,
        parameters: def.parameters,
        handler: function (args) {
          if (def.safety === 'write' && args?.__confirmed !== true) {
            var error = new Error('Explicit confirmation is required for this write command.');
            error.code = 'CONFIRMATION_REQUIRED';
            throw error;
          }
          return handler.apply(this, arguments);
        },
      }],
    });
  };
})();
`;
}

/**
 * 依序返回需要注入的包内相对路径。
 * @param {object} manifest v2 manifest
 * @param {string[]} allFiles adapter 目录下全部相对路径（来自 bridge 列举）
 * @returns {{ internal: string[], commands: string[] }}
 */
export function v2InjectionFiles(manifest, allFiles) {
  const internal = allFiles
    .filter((rel) => /^extension\/internal\/[^/]+\.js$/.test(rel))
    .sort((a, b) => a.localeCompare(b));
  const commands = (manifest.commands || [])
    .filter((command) => command.runtime === "extension")
    .map((command) => command.module);
  return { internal, commands };
}
