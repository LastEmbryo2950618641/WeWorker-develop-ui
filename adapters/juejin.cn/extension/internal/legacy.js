/* v2 compatibility implementation for juejin.cn; preserves the tracked legacy executable logic. */
(function () {
  var captured = [];
  var previousRegister = window.__webmcpRegister;
  window.__webmcpRegister = function (adapter) { captured.push(adapter || {}); };
  window.__webmcpGeneratedSupport = window.__webmcpGeneratedSupport || {};
  window.__webmcpGeneratedLegacyHandlers = window.__webmcpGeneratedLegacyHandlers || {};
  try {
/* embedded legacy source: webcli-generated/shared/juejin.cn.runtime.generated.js */
/**
 * Shared generated runtime helpers
 *
 * Injected before generated tool modules.
 */

(function initGeneratedRuntime() {
  const runtime = window.__webmcpGeneratedRuntime || (window.__webmcpGeneratedRuntime = {});
  if (runtime.__initialized) return;

  const globalStore = window.__webmcpGeneratedSupport || (window.__webmcpGeneratedSupport = {});

  function ensureSiteStore(siteKey) {
    if (!globalStore[siteKey]) {
      globalStore[siteKey] = {
        source: 'site_memory',
        workflowVersion: '',
        toolNames: [],
        actionHints: {},
        tools: [],
      };
    }
    return globalStore[siteKey];
  }

  function registerTool(siteKey, toolDefinition) {
    const siteStore = ensureSiteStore(siteKey);
    const existing = siteStore.tools.find((item) => item?.name === toolDefinition?.name);
    if (existing) return existing;
    siteStore.tools.push(toolDefinition);
    return toolDefinition;
  }

  async function invokeTool(siteKey, toolName, args = {}) {
    const siteStore = ensureSiteStore(siteKey);
    const tool = siteStore.tools.find((item) => item?.name === toolName);
    if (!tool || typeof tool.handler !== 'function') {
      throw new Error(`Generated tool not found: ${toolName}`);
    }
    return tool.handler(args || {});
  }

  function parseMaybeJson(text) {
    if (typeof text !== 'string') return text;
    const normalized = text.trim();
    if (!normalized) return normalized;
    try {
      return JSON.parse(normalized);
    } catch {
      return normalized;
    }
  }

  function hasOwnKey(value, key) {
    return !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);
  }

  function hasMeaningfulValue(value) {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  function sameStructuredValue(left, right) {
    if (left === right) return true;
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneStructuredValue(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      if (Array.isArray(value)) return [...value];
      if (isPlainObject(value)) return { ...value };
      return value;
    }
  }

  function normalizeValueAgainstDefault(value, defaultValue) {
    if (!hasMeaningfulValue(value)) return value;
    if (typeof value !== 'string') return value;

    const normalized = value.trim();
    if (!normalized) return value;

    if (typeof defaultValue === 'number' && /^-?\d+(?:\.\d+)?$/.test(normalized)) {
      return Number(normalized);
    }
    if (typeof defaultValue === 'boolean' && /^(true|false)$/i.test(normalized)) {
      return normalized.toLowerCase() === 'true';
    }

    const suspiciousStructuredString = normalized === '[object Object]' || normalized === '[object Array]';
    const parsed = parseMaybeJson(value);

    if (Array.isArray(defaultValue)) {
      if (Array.isArray(parsed)) return parsed;
      if (suspiciousStructuredString) return cloneStructuredValue(defaultValue);
      return value;
    }

    if (isPlainObject(defaultValue)) {
      if (isPlainObject(parsed)) return parsed;
      if (suspiciousStructuredString) return cloneStructuredValue(defaultValue);
      return value;
    }

    return value;
  }

  function normalizeArgsWithDefaults(args, defaults) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
    const normalized = { ...args };
    Object.keys(normalized).forEach((key) => {
      if (!hasOwnKey(defaults, key)) return;
      normalized[key] = normalizeValueAgainstDefault(normalized[key], defaults[key]);
    });
    return normalized;
  }

  function normalizePlainObjectArg(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ...value };
    }
    if (typeof value !== 'string') return {};
    const parsed = parseMaybeJson(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...parsed }
      : {};
  }

  function encodeFormBody(params) {
    const body = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      body.set(key, String(value));
    });
    return body.toString();
  }

  async function fetchGet(url, params) {
    const requestUrl = new URL(url, window.location.origin);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      requestUrl.searchParams.set(key, String(value));
    });

    const response = await fetch(requestUrl.toString(), {
      method: 'GET',
      credentials: 'include',
      headers: {
        'x-requested-with': 'XMLHttpRequest',
      },
    });

    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      url: requestUrl.toString(),
      data: parseMaybeJson(text),
      rawText: text,
    };
  }

  async function postForm(url, params) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: encodeFormBody(params),
    });

    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      url,
      data: parseMaybeJson(text),
      rawText: text,
    };
  }

  async function sendJson(url, method, payload) {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      url,
      data: parseMaybeJson(text),
      rawText: text,
    };
  }

  function checkLoginStatus() {
    const hostname = window.location.hostname;
    const href = window.location.href;
    const onLoginPage = /passport|sso|login|account/i.test(hostname) || /\/login\b/i.test(href);
    const hasVisibleBody = !!document.body && document.body.innerText.trim().length > 0;
    return {
      logged_in: hasVisibleBody && !onLoginPage,
      on_login_page: onLoginPage,
      current_url: href,
      hint: onLoginPage ? 'current page looks like login page' : 'page is available for cookie-auth API calls',
    };
  }

  function toAvailabilitySlot(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    return match ? `${match[1]}T${match[2]}` : trimmed;
  }

  function formatLocalDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function withDayOffset(referenceDate, offsetDays) {
    const base = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
      ? new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate())
      : new Date();
    base.setDate(base.getDate() + offsetDays);
    return base;
  }

  function resolveDateLabel(text, referenceDate = new Date()) {
    if (typeof text !== 'string') return '';
    const normalized = text.trim();
    if (!normalized) return '';

    const explicitIso = normalized.match(/(\d{4}-\d{2}-\d{2})/);
    if (explicitIso) return explicitIso[1];

    const explicitCn = normalized.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (explicitCn) {
      return `${explicitCn[1]}-${String(Number(explicitCn[2])).padStart(2, '0')}-${String(Number(explicitCn[3])).padStart(2, '0')}`;
    }

    const monthDay = normalized.match(/(\d{1,2})月(\d{1,2})日/);
    if (monthDay) {
      const base = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime()) ? referenceDate : new Date();
      return `${base.getFullYear()}-${String(Number(monthDay[1])).padStart(2, '0')}-${String(Number(monthDay[2])).padStart(2, '0')}`;
    }

    if (/大后天/.test(normalized)) return formatLocalDate(withDayOffset(referenceDate, 3));
    if (/后天/.test(normalized)) return formatLocalDate(withDayOffset(referenceDate, 2));
    if (/明天/.test(normalized)) return formatLocalDate(withDayOffset(referenceDate, 1));
    if (/今天|今日/.test(normalized)) return formatLocalDate(withDayOffset(referenceDate, 0));

    const nextWeek = normalized.match(/下周([一二三四五六日天])/);
    if (nextWeek) {
      const weekdayMap = {
        '一': 1,
        '二': 2,
        '三': 3,
        '四': 4,
        '五': 5,
        '六': 6,
        '日': 0,
        '天': 0,
      };
      const target = weekdayMap[nextWeek[1]];
      if (target !== undefined) {
        const base = withDayOffset(referenceDate, 0);
        const current = base.getDay();
        const delta = ((7 - current + target) % 7) + 7;
        return formatLocalDate(withDayOffset(base, delta));
      }
    }

    return '';
  }

  function normalizeClockToken(token, context = '') {
    if (typeof token !== 'string') return '';
    const normalized = token.trim().replace(/点半$/, ':30').replace(/点$/, ':00');
    const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (!match) return '';

    let hour = Number(match[1]);
    const minute = Number(match[2] || '0');
    if (Number.isNaN(hour) || Number.isNaN(minute) || hour > 23 || minute > 59) return '';

    if (/凌晨/.test(context)) {
      if (hour === 12) hour = 0;
    } else if (/中午/.test(context)) {
      if (hour >= 1 && hour <= 10) hour += 12;
    } else if (/下午|晚上|晚间|傍晚/.test(context)) {
      if (hour >= 1 && hour <= 11) hour += 12;
    } else if (/上午|早上|早晨|清晨/.test(context)) {
      if (hour === 12) hour = 0;
    }

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function extractGenericActionIntent(instruction) {
    const text = typeof instruction === 'string' ? instruction.trim() : '';
    const result = {
      resourceQuery: '',
      startTime: '',
      endTime: '',
    };
    if (!text) return result;

    const explicitRange = text.match(/(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})(?::\d{2})?\s*(?:-|~|至|到)\s*(?:(\d{4}-\d{2}-\d{2})[ T])?(\d{1,2}:\d{2})(?::\d{2})?/);
    if (explicitRange) {
      const startHour = explicitRange[2].padStart(5, '0');
      const endDate = explicitRange[3] || explicitRange[1];
      const endHour = explicitRange[4].padStart(5, '0');
      result.startTime = `${explicitRange[1]} ${startHour}:00`;
      result.endTime = `${endDate} ${endHour}:00`;
    } else {
      const startOnly = text.match(/(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})(?::\d{2})?/);
      if (startOnly) result.startTime = `${startOnly[1]} ${startOnly[2].padStart(5, '0')}:00`;
    }

    if (!result.startTime || !result.endTime) {
      const resolvedDate = resolveDateLabel(text, new Date());
      const relativeRange = text.match(/((?:今天|今日|明天|后天|大后天|下周[一二三四五六日天]|\d{4}-\d{2}-\d{2}|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日)[^\d]{0,12})?(\d{1,2}(?::\d{2})?|\d{1,2}点半|\d{1,2}点)\s*(?:-|~|至|到)\s*((?:今天|今日|明天|后天|大后天|下周[一二三四五六日天]|\d{4}-\d{2}-\d{2}|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日)[^\d]{0,12})?(\d{1,2}(?::\d{2})?|\d{1,2}点半|\d{1,2}点)/);
      if (resolvedDate && relativeRange) {
        const startContext = (relativeRange[1] || '') + ' ' + text;
        const endContext = (relativeRange[3] || relativeRange[1] || '') + ' ' + text;
        const startClock = normalizeClockToken(relativeRange[2], startContext);
        const endClock = normalizeClockToken(relativeRange[4], endContext);
        const endDate = resolveDateLabel(relativeRange[3] || relativeRange[1] || text, new Date()) || resolvedDate;
        if (!result.startTime && startClock) result.startTime = `${resolvedDate} ${startClock}:00`;
        if (!result.endTime && endClock) result.endTime = `${endDate} ${endClock}:00`;
      } else if (resolvedDate) {
        const singleTime = text.match(/((?:今天|今日|明天|后天|大后天|下周[一二三四五六日天]|上午|下午|中午|晚上|晚间|早上|早晨|清晨|凌晨)[^\d]{0,12})?(\d{1,2}(?::\d{2})?|\d{1,2}点半|\d{1,2}点)/);
        if (singleTime) {
          const clock = normalizeClockToken(singleTime[2], (singleTime[1] || '') + ' ' + text);
          if (!result.startTime && clock) result.startTime = `${resolvedDate} ${clock}:00`;
        }
      }
    }

    const quoted = text.match(/["'“”‘’]([^"'“”‘’]{1,40})["'“”‘’]/);
    if (quoted) {
      result.resourceQuery = quoted[1].trim();
    } else {
      const reverseResourceMatch = text.match(/的\s*([A-Za-z0-9_\-\u4e00-\u9fa5]{1,30})\s*(?:会议室|资源|房间|教室|工位|设备)/);
      const compactResourceMatch = text.match(/([A-Za-z0-9_\-]{1,30})\s*(?:会议室|资源|房间|教室|工位|设备)/);
      const forwardResourceMatch = text.match(/(?:会议室|资源|房间|教室|工位|设备)\s*([A-Za-z0-9_\-\u4e00-\u9fa5]{1,30})/);
      const resourceMatch = reverseResourceMatch || compactResourceMatch || forwardResourceMatch;
      if (resourceMatch) result.resourceQuery = resourceMatch[1].trim();
    }

    return result;
  }

  function deriveLookupDateValue(fieldName, startTime) {
    if (typeof fieldName !== 'string' || typeof startTime !== 'string') return '';
    const normalizedField = fieldName.trim().toLowerCase();
    const normalizedStartTime = startTime.trim();
    if (!normalizedField || !normalizedStartTime) return '';
    const dateMatch = normalizedStartTime.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}|\d{2}:\d{2}))?/);
    if (!dateMatch) return '';

    const dateOnly = dateMatch[1];
    const timePart = dateMatch[2] || '00:00:00';
    const normalizedTime = timePart.length === 5 ? `${timePart}:00` : timePart;

    if (/booktime|bookingtime|meetingtime|querytime|targettime/.test(normalizedField)) {
      return `${dateOnly} 00:00:00`;
    }
    if (/(date|day)$/.test(normalizedField) || /bookdate|meetingdate|querydate|targetdate/.test(normalizedField)) {
      return dateOnly;
    }
    if (/time/.test(normalizedField)) {
      return `${dateOnly} ${normalizedTime}`;
    }

    return '';
  }

  function getByPath(value, dottedPath) {
    if (!dottedPath) return value;
    return dottedPath.split('.').reduce((current, key) => {
      if (!current || typeof current !== 'object') return undefined;
      return current[key];
    }, value);
  }

  function summarizeAvailability(availabilityValue, slotKey) {
    if (!availabilityValue || typeof availabilityValue !== 'object' || Array.isArray(availabilityValue)) {
      return {
        slotKey: slotKey || '',
        status: 'unknown',
        slotValue: undefined,
      };
    }

    if (!slotKey) {
      const entries = Object.entries(availabilityValue);
      return {
        slotKey: '',
        status: 'unknown',
        slotValue: undefined,
        totalSlots: entries.length,
        availableSlots: entries.filter(([, value]) => value === null || value === undefined || value === '').length,
      };
    }

    const slotValue = availabilityValue[slotKey];
    if (slotValue === null || slotValue === undefined || slotValue === '') {
      return {
        slotKey,
        status: 'available',
        slotValue,
      };
    }

    return {
      slotKey,
      status: 'unavailable',
      slotValue,
    };
  }

  function normalizeListItems(result, hintConfig, options = {}) {
    const hints = hintConfig?.responseHints || {};
    const listPath = hints.listPath || '';
    const rawItems = getByPath(result?.data, listPath);
    const list = Array.isArray(rawItems) ? rawItems : [];
    const availabilitySlot = typeof options.availabilitySlot === 'string' ? options.availabilitySlot.trim() : '';
    const onlyAvailable = Boolean(options.onlyAvailable);
    const query = typeof options.query === 'string' ? options.query.trim().toLowerCase() : '';
    const resourceId = typeof options.resourceId === 'string' ? options.resourceId.trim() : '';
    const limit = Number(options.limit || 0);
    const normalized = list.map((item, index) => {
      const idKey = hints.preferredIdKey || '';
      const displayKey = hints.preferredDisplayKey || '';
      const availabilityKey = hints.preferredAvailabilityKey || '';
      const availability = availabilityKey && item && typeof item === 'object' ? item[availabilityKey] : undefined;
      const availabilitySummary = summarizeAvailability(availability, availabilitySlot);

      return {
        index,
        id: idKey && item && typeof item === 'object' ? item[idKey] : undefined,
        display: displayKey && item && typeof item === 'object' ? item[displayKey] : undefined,
        availability: availabilitySummary,
        raw: item,
      };
    });

    const filtered = normalized
      .filter((item) => {
        if (resourceId && String(item.id ?? '') !== resourceId) return false;
        if (query) {
          const haystack = [item.id, item.display].filter(Boolean).join(' ').toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        if (onlyAvailable && item.availability?.status !== 'available') return false;
        return true;
      });

    return {
      ok: result?.ok,
      status: result?.status,
      url: result?.url,
      listPath,
      totalItems: list.length,
      returnedItems: limit > 0 ? filtered.slice(0, limit) : filtered,
      mapping: {
        preferredIdKey: hints.preferredIdKey || '',
        preferredDisplayKey: hints.preferredDisplayKey || '',
        preferredAvailabilityKey: hints.preferredAvailabilityKey || '',
        idLikeKeys: hints.idLikeKeys || [],
        displayLikeKeys: hints.displayLikeKeys || [],
        availabilityLikeKeys: hints.availabilityLikeKeys || [],
      },
      rawData: result?.data,
    };
  }

  Object.assign(runtime, {
    __initialized: true,
    ensureSiteStore,
    registerTool,
    invokeTool,
    parseMaybeJson,
    hasOwnKey,
    hasMeaningfulValue,
    sameStructuredValue,
    isPlainObject,
    cloneStructuredValue,
    normalizeValueAgainstDefault,
    normalizeArgsWithDefaults,
    normalizePlainObjectArg,
    encodeFormBody,
    fetchGet,
    postForm,
    sendJson,
    checkLoginStatus,
    toAvailabilitySlot,
    formatLocalDate,
    withDayOffset,
    resolveDateLabel,
    normalizeClockToken,
    extractGenericActionIntent,
    deriveLookupDateValue,
    getByPath,
    summarizeAvailability,
    normalizeListItems,
  });
})();



/* embedded legacy source: webcli-generated/tools/check_login_status.generated.js */
/**
 * Generated tool module for juejin.cn.check_login_status
 */

(function registerGeneratedTool_juejin_cn_check_login_status() {
  const runtime = window.__webmcpGeneratedRuntime;
  if (!runtime) {
    throw new Error('Generated runtime not initialized before tool module injection');
  }

  const siteKey = "juejin.cn";
  const {
    checkLoginStatus,
    cloneStructuredValue,
    deriveLookupDateValue,
    extractGenericActionIntent,
    fetchGet,
    hasMeaningfulValue,
    hasOwnKey,
    invokeTool,
    normalizeArgsWithDefaults,
    normalizeListItems,
    normalizePlainObjectArg,
    postForm,
    registerTool,
    sameStructuredValue,
    sendJson,
    toAvailabilitySlot,
  } = runtime;

  registerTool(siteKey, {
    name: "juejin.cn.check_login_status",
    description: "登录状态检查工具。用于确认 juejin.cn 当前页面是否已登录，以及当前会话是否可继续调用站点接口。",
    parameters: {
      "type": "object",
      "properties": {},
      "required": []
},
    handler: () => checkLoginStatus(),
  });
})();



/* embedded legacy source: webcli-generated/tools/like_current_item.generated.js */
/**
 * Runtime DOM action for juejin.cn.like_current_item.
 *
 * This tool intentionally does not contain captured request URLs, tokens, user
 * identifiers, or item identifiers. It uses the current browser page and the
 * current signed-in session. The caller must obtain user confirmation before
 * invoking this side-effecting tool.
 */

(function registerGeneratedTool_juejin_cn_like_current_item() {
  const runtime = window.__webmcpGeneratedRuntime;
  if (!runtime) {
    throw new Error('Generated runtime not initialized before tool module injection');
  }

  const siteKey = 'juejin.cn';
  const { checkLoginStatus, registerTool } = runtime;

  function visibleText(element) {
    return String(element?.innerText || element?.textContent || element?.getAttribute?.('aria-label') || element?.title || '').trim();
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function buttonState(button) {
    if (!button) return null;
    const icon = button.querySelector?.('svg');
    const style = icon ? window.getComputedStyle(icon) : null;
    return {
      className: button.className || '',
      badge: button.getAttribute?.('badge') || '',
      text: visibleText(button),
      active: /\bactive\b/.test(button.className || ''),
      iconClass: icon?.getAttribute?.('class') || '',
      color: style?.color || '',
      fill: style?.fill || '',
    };
  }

  function findLikeButton() {
    const suspendedButton = [...document.querySelectorAll('.article-suspended-panel .panel-btn')]
      .find((button) => button.querySelector?.('.icon-zan'));
    if (suspendedButton && isVisible(suspendedButton)) return suspendedButton;

    const candidates = [
      ...document.querySelectorAll('button, [role="button"], a, .action, .action-item, .panel-btn, .item, .like'),
    ];
    return candidates.find((element) => {
      if (!isVisible(element)) return false;
      const haystack = [
        visibleText(element),
        element.getAttribute?.('class') || '',
        element.getAttribute?.('aria-label') || '',
        element.getAttribute?.('title') || '',
        element.outerHTML || '',
      ].join(' ');
      return /点赞|\blike\b|digg|icon-zan/i.test(haystack);
    }) || null;
  }

  function pageSubject() {
    const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
    return {
      title: document.title || '',
      url: canonical || window.location.href,
    };
  }

  async function likeCurrentItem() {
    const login = checkLoginStatus();
    if (!login.logged_in) {
      return {
        ok: false,
        code: 'LOGIN_REQUIRED',
        message: '请先在浏览器中登录 juejin.cn 后重试。',
        ...pageSubject(),
      };
    }

    const button = findLikeButton();
    if (!button) {
      return {
        ok: false,
        code: 'ACTION_BUTTON_NOT_FOUND',
        message: '未找到当前页面的点赞按钮。',
        ...pageSubject(),
      };
    }

    const before = buttonState(button);
    if (before?.active) {
      return {
        ok: true,
        action: 'like',
        alreadyActive: true,
        message: '当前内容已经是点赞状态，未重复点击以避免取消点赞。',
        before,
        after: before,
        ...pageSubject(),
      };
    }

    button.click();
    await wait(1200);
    const after = buttonState(button);

    return {
      ok: !!after?.active || before?.badge !== after?.badge,
      action: 'like',
      message: after?.active ? '已点赞当前内容。' : '已尝试点击点赞按钮，请核查页面状态。',
      before,
      after,
      ...pageSubject(),
    };
  }

  registerTool(siteKey, {
    name: 'juejin.cn.like_current_item',
    description: '对当前打开的掘金内容执行点赞动作。需要用户已在浏览器登录，调用前必须获得用户确认。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: () => likeCurrentItem(),
  });
})();


/* embedded legacy source: webcli-generated/tools/favorite_current_item.generated.js */
/**
 * Runtime DOM action for juejin.cn.favorite_current_item.
 *
 * This tool intentionally does not contain captured request URLs, tokens, user
 * identifiers, or item identifiers. It uses the current browser page and the
 * current signed-in session. The caller must obtain user confirmation before
 * invoking this side-effecting tool.
 */

(function registerGeneratedTool_juejin_cn_favorite_current_item() {
  const runtime = window.__webmcpGeneratedRuntime;
  if (!runtime) {
    throw new Error('Generated runtime not initialized before tool module injection');
  }

  const siteKey = 'juejin.cn';
  const { checkLoginStatus, registerTool } = runtime;

  function visibleText(element) {
    return String(element?.innerText || element?.textContent || element?.getAttribute?.('aria-label') || element?.title || '').trim();
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function buttonState(button) {
    if (!button) return null;
    const icon = button.querySelector?.('svg');
    const style = icon ? window.getComputedStyle(icon) : null;
    return {
      className: button.className || '',
      badge: button.getAttribute?.('badge') || '',
      text: visibleText(button),
      active: /\bactive\b/.test(button.className || ''),
      iconClass: icon?.getAttribute?.('class') || '',
      color: style?.color || '',
      fill: style?.fill || '',
    };
  }

  function findFavoriteButton() {
    const suspendedButton = [...document.querySelectorAll('.article-suspended-panel .panel-btn')]
      .find((button) => button.querySelector?.('.icon-collect'));
    if (suspendedButton && isVisible(suspendedButton)) return suspendedButton;

    const candidates = [
      ...document.querySelectorAll('button, [role="button"], a, .action, .action-item, .panel-btn, .item, .collect'),
    ];
    return candidates.find((element) => {
      if (!isVisible(element)) return false;
      const haystack = [
        visibleText(element),
        element.getAttribute?.('class') || '',
        element.getAttribute?.('aria-label') || '',
        element.getAttribute?.('title') || '',
        element.outerHTML || '',
      ].join(' ');
      return /收藏|\bcollect\b|favorite|star|icon-collect/i.test(haystack);
    }) || null;
  }

  function findVisibleCollectionModal() {
    return [...document.querySelectorAll('.collection-list-modal .byte-modal__content, .collection-list-modal .byte-modal__wrapper, .collection-list-modal .modal-wrap')]
      .find(isVisible) || null;
  }

  function findCollectionItem(collectionName) {
    const items = [...document.querySelectorAll('.collection-list-modal .list-item')].filter(isVisible);
    if (!items.length) return null;
    const expected = String(collectionName || '').trim();
    if (!expected) return items[0];
    return items.find((item) => visibleText(item).includes(expected)) || null;
  }

  function findConfirmButton() {
    return [...document.querySelectorAll('.collection-list-modal button, .collection-list-modal [role="button"], .collection-list-modal .confirm-btn, .collection-list-modal .byte-btn, .collection-list-modal div')]
      .filter(isVisible)
      .find((element) => visibleText(element) === '确定') || null;
  }

  function pageSubject() {
    const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
    return {
      title: document.title || '',
      url: canonical || window.location.href,
    };
  }

  async function favoriteCurrentItem(args = {}) {
    const login = checkLoginStatus();
    if (!login.logged_in) {
      return {
        ok: false,
        code: 'LOGIN_REQUIRED',
        message: '请先在浏览器中登录 juejin.cn 后重试。',
        ...pageSubject(),
      };
    }

    const collectionName = String(args.collection_name || args.collectionName || '').trim();
    const button = findFavoriteButton();
    if (!button) {
      return {
        ok: false,
        code: 'ACTION_BUTTON_NOT_FOUND',
        message: '未找到当前页面的收藏按钮。',
        ...pageSubject(),
      };
    }

    const before = buttonState(button);
    if (before?.active) {
      return {
        ok: true,
        action: 'favorite',
        alreadyActive: true,
        message: '当前内容已经是收藏状态，未重复点击以避免取消收藏。',
        before,
        after: before,
        collectionName: collectionName || null,
        ...pageSubject(),
      };
    }

    button.click();
    await wait(1000);

    let selectedCollection = null;
    const modal = findVisibleCollectionModal();
    if (modal) {
      const collectionItem = findCollectionItem(collectionName);
      if (!collectionItem) {
        return {
          ok: false,
          code: 'COLLECTION_NOT_FOUND',
          message: collectionName ? `未找到收藏夹：${collectionName}` : '未找到可选择的收藏夹。',
          before,
          modalText: visibleText(modal),
          collectionName: collectionName || null,
          ...pageSubject(),
        };
      }
      selectedCollection = visibleText(collectionItem);
      collectionItem.click();
      await wait(300);

      const confirmButton = findConfirmButton();
      if (!confirmButton) {
        return {
          ok: false,
          code: 'COLLECTION_CONFIRM_NOT_FOUND',
          message: '已选择收藏夹，但未找到确认按钮。',
          before,
          selectedCollection,
          ...pageSubject(),
        };
      }
      confirmButton.click();
      await wait(1500);
    }

    const after = buttonState(button);
    const modalStillVisible = !!findVisibleCollectionModal();

    return {
      ok: !!after?.active && !modalStillVisible,
      action: 'favorite',
      message: after?.active ? '已收藏当前内容。' : '已尝试收藏当前内容，请核查页面状态。',
      before,
      after,
      selectedCollection,
      modalStillVisible,
      ...pageSubject(),
    };
  }

  registerTool(siteKey, {
    name: 'juejin.cn.favorite_current_item',
    description: '对当前打开的掘金内容执行收藏动作。需要用户已在浏览器登录，调用前必须获得用户确认。',
    parameters: {
      type: 'object',
      properties: {
        collection_name: {
          type: 'string',
          description: '可选。要收藏到的收藏夹名称；不传时选择弹窗中的第一个收藏夹。',
        },
      },
      required: [],
    },
    handler: (args) => favoriteCurrentItem(args),
  });
})();


/* embedded legacy source: webcli-generated/tools/list_detail_candidates.generated.js */
/**
 * Generated tool module for juejin.cn.list_detail_candidates
 */

(function registerGeneratedTool_juejin_cn_list_detail_candidates() {
  const runtime = window.__webmcpGeneratedRuntime;
  if (!runtime) {
    throw new Error('Generated runtime not initialized before tool module injection');
  }

  const siteKey = "juejin.cn";
  const {
    checkLoginStatus,
    cloneStructuredValue,
    deriveLookupDateValue,
    extractGenericActionIntent,
    fetchGet,
    hasMeaningfulValue,
    hasOwnKey,
    invokeTool,
    normalizeArgsWithDefaults,
    normalizeListItems,
    normalizePlainObjectArg,
    postForm,
    registerTool,
    sameStructuredValue,
    sendJson,
    toAvailabilitySlot,
  } = runtime;

  function listDetailCandidates() {
    return {
      mode: "inspect_only",
      bestCandidateHref: "",
      bestCandidateText: "",
      networkDetailCandidates: [],
    };
  }

  registerTool(siteKey, {
    name: "juejin.cn.list_detail_candidates",
    description: "详情候选辅助工具。返回探索阶段捕获到的详情链接候选及相关元数据。",
    parameters: {
      "type": "object",
      "properties": {},
      "required": []
},
    handler: () => listDetailCandidates(),
  });
})();



/* embedded legacy source: webcli-generated/juejin.cn.site-entry.generated.js */
/**
 * Generated site entry for juejin.cn
 *
 * Sanitized for the public repository: side-effecting action drafts and captured
 * request metadata were removed. This entry only exposes inspect-only helpers.
 */

(function registerGeneratedSite_juejin_cn() {
  const runtime = window.__webmcpGeneratedRuntime;
  if (!runtime) {
    throw new Error('Generated runtime not initialized before site entry injection');
  }

  const siteKey = 'juejin.cn';
  runtime.ensureSiteStore(siteKey);
})();


/* embedded legacy source: index.js */
/**
 * Generated adapter shell for juejin.cn
 *
 * This file was created because no adapter index.js existed yet.
 * Add site-specific tools here and keep the generated support tools mounted.
 */

window.__webmcpRegister({
  name: "generated-juejin.cn-adapter",
  match: [
  "juejin.cn"
],
  tools: [
    ...(window.__webmcpGeneratedSupport?.["juejin.cn"]?.tools || []),
  ],
})

  } finally {
    window.__webmcpRegister = previousRegister;
  }
  var tools = [];
  for (var i = 0; i < captured.length; i++) {
    var list = Array.isArray(captured[i].tools) ? captured[i].tools : [];
    for (var j = 0; j < list.length; j++) if (list[j] && typeof list[j].handler === 'function') tools.push(list[j]);
  }
  var support = window.__webmcpGeneratedSupport["juejin.cn"];
  if (support && Array.isArray(support.tools)) {
    for (var k = 0; k < support.tools.length; k++) if (support.tools[k] && typeof support.tools[k].handler === 'function') tools.push(support.tools[k]);
  }
  var byName = Object.create(null);
  for (var n = 0; n < tools.length; n++) {
    var tool = tools[n];
    var names = [tool.publicName, tool.name, tool.handlerName];
    for (var z = 0; z < names.length; z++) if (typeof names[z] === 'string' && names[z] && !byName[names[z]]) byName[names[z]] = tool;
  }
  window["__juejin_cn_internal"] = {
    invoke: async function (publicName, params) {
      var tool = byName[publicName];
      if (!tool || typeof tool.handler !== 'function') throw new Error('Legacy handler unavailable for ' + "juejin.cn" + '.' + publicName);
      return tool.handler(params || {});
    },
    names: Object.keys(byName)
  };
})();
