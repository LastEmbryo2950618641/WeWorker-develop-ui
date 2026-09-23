/* v2 compatibility implementation for mail.163.com; preserves the tracked legacy executable logic. */
(function () {
  var captured = [];
  var previousRegister = window.__webmcpRegister;
  window.__webmcpRegister = function (adapter) { captured.push(adapter || {}); };
  window.__webmcpGeneratedSupport = window.__webmcpGeneratedSupport || {};
  window.__webmcpGeneratedLegacyHandlers = window.__webmcpGeneratedLegacyHandlers || {};
  try {
/* embedded legacy source: index.js */
/**
 * 163邮箱适配脚本
 *
 * 注意：运行在 isolated world，只能操作 DOM，不能访问页面 JS 变量
 *
 * 验证版本：163邮箱 2026年2月
 * 维护者：WeWorker 项目
 */

// ─── 工具函数 ──────────────────────────────────────────────────────────────

/**
 * 等待某个选择器出现在 DOM 中
 * @param {string} selector
 * @param {number} timeout 毫秒
 */
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for element: ${selector}`));
    }, timeout);
  });
}

/**
 * 等待一段时间
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 设置 input 的值并触发框架需要的事件
 * 注意：163邮箱使用自有框架（非 React），直接赋值即可
 */
function setInputValue(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

// ─── Tool Handler 函数 ────────────────────────────────────────────────────

/**
 * 解析当前邮件列表，返回结构化数据
 *
 * 基于实际 DOM 结构（2026年2月验证）：
 * - 行容器：div[sign="letter"]
 * - 邮件ID：行容器的 id 属性
 * - 发件人：div[sign="start-from"] .nui-user
 * - 主题：span.da0
 * - 日期：div.eO0（title 属性含完整日期）
 * - 未读标记：b.nui-ico-unread
 * - 附件标记：div.nui-ico-att
 * - 摘要：.fQ0 .il0
 */
function parseEmailList() {
  const emails = [];

  const rows = document.querySelectorAll('div[sign="letter"]');

  for (const row of rows) {
    const id = row.id || "";
    const sender = row.querySelector('div[sign="start-from"] .nui-user')?.textContent?.trim() ?? "";
    const subject = row.querySelector("span.da0")?.textContent?.trim() ?? "";
    const dateEl = row.querySelector("div.eO0");
    const date = dateEl?.getAttribute("title") ?? dateEl?.textContent?.trim() ?? "";
    const isUnread = !!row.querySelector("b.nui-ico-unread");
    const hasAttachment = !!row.querySelector("div.nui-ico-att");
    const summary = row.querySelector(".fQ0 .il0")?.textContent?.trim() ?? "";

    // 邮件文件夹类型：[收件箱]、[已发送]、[草稿箱] 等
    const folderSpan = row.querySelector('span.dL0');
    const folderText = folderSpan?.textContent?.trim().replace(/[\[\]]/g, '') ?? "";
    // 映射为简短类型标识
    const folder = folderText === '已发送' ? 'sent'
      : folderText === '草稿箱' ? 'draft'
      : folderText === '收件箱' ? 'inbox'
      : folderText || 'inbox';

    if (subject && id) {
      emails.push({ id, sender, subject, date, isUnread, hasAttachment, summary, folder });
    }
  }

  return emails;
}

/**
 * 搜索邮件
 * @param {string} keyword - 搜索关键词
 * @returns {Promise<Object>} 搜索结果
 *
 * 测试条件：在163邮箱页面
 * 测试示例：await searchEmails('发票')
 */
async function searchEmails(keyword) {
  // 找到搜索输入框（用 aria-label 比 ID 更稳定）
  const searchInput = await waitForElement(
    'input[aria-label*="搜索"], input.nui-ipt-input'
  );

  // 清空并输入关键词
  searchInput.focus();
  setInputValue(searchInput, keyword);

  // 触发搜索（keyup Enter）
  searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
  searchInput.dispatchEvent(new KeyboardEvent("keyup",  { key: "Enter", keyCode: 13, bubbles: true }));

  // 等待搜索结果加载
  await sleep(2000);

  const emails = parseEmailList();
  return {
    keyword,
    count: emails.length,
    emails,
  };
}

/**
 * 获取未读邮件列表
 * @param {number} limit - 最多返回的邮件数量，默认20
 * @returns {Promise<Object>} 未读邮件列表
 *
 * 测试条件：在163邮箱页面
 * 测试示例：await getUnreadEmails(10)
 */
async function getUnreadEmails(limit = 20) {
  // 点击收件箱
  const inboxLink = document.querySelector('[title="收件箱"], [sign="inbox"]');
  if (inboxLink) {
    inboxLink.click();
    await sleep(1500);
  }

  const rows = document.querySelectorAll('div[sign="letter"]');
  const unread = [];
  for (const row of rows) {
    if (!row.querySelector("b.nui-ico-unread")) continue;
    const id = row.id || "";
    const sender = row.querySelector('div[sign="start-from"] .nui-user')?.textContent?.trim() ?? "";
    const subject = row.querySelector("span.da0")?.textContent?.trim() ?? "";
    const dateEl = row.querySelector("div.eO0");
    const date = dateEl?.getAttribute("title") ?? dateEl?.textContent?.trim() ?? "";
    if (subject && id) unread.push({ id, sender, subject, date });
    if (unread.length >= limit) break;
  }

  return { count: unread.length, emails: unread };
}

/**
 * 打开指定邮件
 * @param {string} emailId - 邮件的唯一ID
 * @returns {Promise<Object>} 邮件详情
 *
 * 测试条件：在163邮箱页面，邮件列表中有该邮件
 * 测试示例：await openEmail('1771635701103_741xtbC5RBFmml9PfBxwQAA3D_6fd294bhq81771635724863Dom')
 */
async function openEmail(emailId) {
  try {
    // 查找邮件元素
    const mailElement = document.getElementById(emailId);

    if (!mailElement) {
      return {
        error: "Email not found",
        emailId,
        message: "指定的邮件ID不存在，可能邮件已被删除或ID不正确"
      };
    }

    // 获取邮件主题，用于后续验证
    const subjectInList = mailElement.querySelector('.lh0')?.textContent?.trim() || '';

    // 点击邮件
    mailElement.click();

    // 等待邮件详情模块出现并加载完成
    // 策略：等待详情模块出现，并且主题匹配
    let detail = null;
    let attempts = 0;
    const maxAttempts = 15; // 最多尝试15次（7.5秒）

    while (attempts < maxAttempts) {
      await sleep(500);
      attempts++;

      // 尝试解析邮件详情
      const tempDetail = parseEmailDetail();

      // 检查是否成功解析且内容已更新
      if (!tempDetail.error && tempDetail.subject) {
        // 如果主题匹配（或列表中没有主题），认为加载完成
        if (!subjectInList || tempDetail.subject.includes(subjectInList) || subjectInList.includes(tempDetail.subject)) {
          detail = tempDetail;
          break;
        }
      }
    }

    if (!detail) {
      // 超时后再尝试一次
      detail = parseEmailDetail();
    }

    if (detail.error) {
      return {
        status: "clicked",
        emailId,
        warning: detail.error,
        message: "邮件已点击，但无法解析详情内容"
      };
    }

    return {
      status: "opened",
      emailId,
      detail,
      loadTime: `${attempts * 500}ms`
    };
  } catch (error) {
    return {
      error: "Failed to open email",
      emailId,
      message: error.message,
    };
  }
}

/**
 * 下载当前打开邮件的附件
 * @param {string} attachmentName - 附件名称（如'发票.pdf'）或'all'表示打包下载所有附件
 * @returns {Promise<Object>} 下载结果
 *
 * 测试条件：必须先打开一封有附件的邮件
 * 测试示例：
 *   await downloadAttachment('滴滴出行行程报销单.pdf')  // 下载单个附件
 *   await downloadAttachment('all')  // 打包下载所有附件
 */
async function downloadAttachment(attachmentName) {
  try {
    // 找到当前可见的邮件详情模块
    const allModules = document.querySelectorAll('[id*="read.ReadModule"]');
    console.log(`[163-download] allModules count: ${allModules.length}`);
    let readModule = null;
    for (const m of allModules) {
      const visible = m.offsetParent !== null || m.style.display !== 'none';
      console.log(`[163-download] module id=${m.id}, visible=${visible}, display=${m.style.display}`);
      if (visible) {
        readModule = m;
      }
    }
    if (!readModule && allModules.length > 0) {
      readModule = allModules[allModules.length - 1];
      console.log(`[163-download] fallback to last module: ${readModule.id}`);
    }

    if (!readModule) {
      return {
        error: "No email opened",
        message: "未找到打开的邮件，请先打开一封邮件"
      };
    }

    console.log(`[163-download] using readModule: ${readModule.id}`);

    // 如果是下载所有附件
    if (attachmentName === "all") {
      const downloadAllLink = readModule.querySelector('a[title*="下载全部"]');

      if (!downloadAllLink) {
        return {
          error: "Download all button not found",
          message: "未找到打包下载按钮，可能该邮件没有附件"
        };
      }

      // 点击打包下载
      downloadAllLink.click();

      return {
        status: "downloading",
        attachmentName: "all",
        message: "已触发打包下载所有附件"
      };
    }

    // 下载单个附件
    const attItems = readModule.querySelectorAll('ul.qs0 > li.lh0');
    console.log(`[163-download] attItems count: ${attItems.length}`);

    const allNames = [];
    for (const item of attItems) {
      const nameEl = item.querySelector('strong.dh0');
      const name = nameEl?.textContent?.trim() ?? "";
      allNames.push(name);
      console.log(`[163-download] found attachment: "${name}" (length=${name.length}), target: "${attachmentName}" (length=${attachmentName.length}), match=${name === attachmentName}`);

      // 逐字符对比（排查不可见字符）
      if (name.length === attachmentName.length && name !== attachmentName) {
        for (let i = 0; i < name.length; i++) {
          if (name.charCodeAt(i) !== attachmentName.charCodeAt(i)) {
            console.log(`[163-download] char diff at index ${i}: name=${name.charCodeAt(i)} vs target=${attachmentName.charCodeAt(i)}`);
          }
        }
      }

      if (name === attachmentName) {
        // 查找该附件的下载链接
        const allLinks = Array.from(item.querySelectorAll('a'));
        console.log(`[163-download] links in matched item: ${allLinks.length}`);
        for (const link of allLinks) {
          console.log(`[163-download]   link text="${link.textContent?.trim()}", href="${link.href?.substring(0, 100)}", visible=${link.offsetParent !== null}`);
        }

        const downloadLink = allLinks.find(
          link => link.textContent?.trim() === '下载' && link.href
        );

        if (!downloadLink) {
          return {
            error: "Download link not found",
            attachmentName,
            message: "找到了附件但未找到下载链接",
            debug: { linksCount: allLinks.length, linkTexts: allLinks.map(l => l.textContent?.trim()) }
          };
        }

        console.log(`[163-download] clicking download link: href="${downloadLink.href?.substring(0, 100)}"`);

        // 点击下载
        downloadLink.click();

        return {
          status: "downloading",
          attachmentName,
          message: `已触发下载附件: ${attachmentName}`,
          debug: { href: downloadLink.href?.substring(0, 200), moduleId: readModule.id }
        };
      }
    }

    // 未找到指定的附件
    console.log(`[163-download] attachment not found. available: ${JSON.stringify(allNames)}`);

    return {
      error: "Attachment not found",
      attachmentName,
      availableAttachments: allNames,
      message: `未找到名为"${attachmentName}"的附件`
    };

  } catch (error) {
    console.error(`[163-download] error:`, error);
    return {
      error: "Failed to download attachment",
      attachmentName,
      message: error.message,
    };
  }
}

/**
 * 解析打开后的邮件详情
 *
 * 基于实际 DOM 结构（2026年2月验证）：
 * - 邮件详情容器：[id*="read.ReadModule"]
 * - 主题：h1[id*="h1Subject"]
 * - 发件人/收件人/时间：通过正则从文本中提取
 * - 正文：在 iframe[id*="frameBody"] 内的 #content 元素中
 * - 附件：ul.qs0 > li.lh0，文件名在 strong.dh0 中
 */
function parseEmailDetail() {
  try {
    // 查找当前可见的邮件详情模块（多封邮件打开时会有多个 ReadModule）
    const allModules = document.querySelectorAll('[id*="read.ReadModule"]');
    let readModule = null;
    for (const m of allModules) {
      if (m.offsetParent !== null || m.style.display !== 'none') {
        readModule = m;
      }
    }
    // 如果 offsetParent 判断不准，fallback 取最后一个（最新打开的）
    if (!readModule && allModules.length > 0) {
      readModule = allModules[allModules.length - 1];
    }
    if (!readModule) {
      return { error: "邮件详情模块未找到" };
    }

    // 解析主题
    const subjectEl = readModule.querySelector('h1[id*="h1Subject"]');
    const subject = subjectEl?.textContent?.trim() ?? "";

    // 如果主题为空，说明内容还没加载
    if (!subject) {
      return { error: "邮件主题为空，内容可能还在加载中" };
    }

    // 从文本中提取发件人、收件人、时间
    const fullText = readModule.textContent;

    const fromMatch = fullText.match(/发件人[：:]\s*([^收]+?)(?=收件人|$)/s);
    let from = fromMatch?.[1]?.trim().replace(/\s+/g, ' ') ?? "";
    // 清理发件人中的广告文本
    from = from.replace(/\s*\+\(.*?\).*$/, '').trim();

    const toMatch = fullText.match(/收件人[：:]\s*([^时]+?)(?=时\s*间|$)/s);
    let to = toMatch?.[1]?.trim().replace(/\s+/g, ' ') ?? "";
    // 清理收件人中的多余符号
    to = to.replace(/\s*\+\s*$/, '').trim();

    const dateMatch = fullText.match(/时\s*间[：:]\s*([^\n附]+?)(?=附\s*件|$)/s);
    const date = dateMatch?.[1]?.trim() ?? "";

    // 解析正文（从当前 readModule 内的 iframe 中获取）
    let body = "";
    try {
      const iframe = readModule.querySelector('iframe[id*="frameBody"]');
      if (iframe) {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        const contentEl = iframeDoc.getElementById('content');
        body = contentEl?.textContent?.trim() ?? "";
      }
    } catch (e) {
      body = `[无法读取邮件正文: ${e.message}]`;
    }

    // 解析附件列表
    const attachments = [];
    const attList = readModule.querySelectorAll('ul.qs0 > li.lh0');
    for (const attItem of attList) {
      const nameEl = attItem.querySelector('strong.dh0');
      const sizeEl = attItem.querySelector('td.gx0');

      if (nameEl) {
        const name = nameEl.textContent?.trim() ?? "";
        const fullText = sizeEl?.textContent?.trim() ?? "";
        // 从 "文件名.pdf123.45K" 中提取大小
        const sizeMatch = fullText.match(/(\d+\.?\d*[KMG]B?)$/i);
        const size = sizeMatch?.[1] ?? "";

        if (name) {
          attachments.push({ name, size });
        }
      }
    }

    return {
      subject,
      from,
      to,
      date,
      body: body.substring(0, 5000), // 限制正文长度，避免过长
      attachments,
      hasAttachment: attachments.length > 0,
    };
  } catch (error) {
    return { error: `解析邮件详情失败: ${error.message}` };
  }
}

// ─── 适配器注册 ────────────────────────────────────────────────────────────
// 不使用 ES module export，由 background 通过 executeScript 注入后调用 __webmcpRegister

/**
 * 返回163邮箱收件箱首页
 *
 * 测试示例：await navigateToInbox()
 */
async function navigateToInbox() {
  try {
    const currentUrl = window.location.href;

    // 导航到收件箱首页
    window.location.href = "https://mail.163.com/js6/main.jsp";

    // 等待页面开始加载
    await sleep(1000);

    // 等待页面加载完成
    let waitTime = 0;
    const maxWait = 5000;
    while (document.readyState !== 'complete' && waitTime < maxWait) {
      await sleep(100);
      waitTime += 100;
    }

    // 额外等待一点时间确保邮件列表加载
    await sleep(1500);

    return {
      status: "success",
      message: "已返回收件箱首页",
      previousUrl: currentUrl,
      currentUrl: window.location.href,
      pageLoaded: document.readyState === 'complete'
    };
  } catch (error) {
    return {
      status: "error",
      message: `导航失败: ${error.message}`,
      error: error.message
    };
  }
}

/**
 * 写邮件：打开写信界面，填入收件人、主题、正文，可选发送或保存草稿
 * @param {Object} params
 * @param {string} params.to - 收件人邮箱地址（多个用分号分隔）
 * @param {string} [params.subject] - 邮件主题
 * @param {string} [params.body] - 邮件正文（纯文本或 HTML）
 * @param {string} [params.cc] - 抄送地址（多个用分号分隔）
 * @param {string} [params.file_path] - 附件文件的本地绝对路径（通过 CDP 上传）
 * @param {string} [params.file_name] - 附件文件名
 * @param {string} [params.action] - 操作：'send' 发送（默认）、'draft' 保存草稿、'fill' 仅填充不操作
 * @returns {Promise<Object>}
 */
async function composeEmail({ to, subject = '', body = '', cc = '', file_path = '', file_name = '', action = 'send' }) {
  try {
    // 1. 点击"写 信"按钮
    // 优先用精确 ID，备用按文本匹配
    let composeLi = document.getElementById('_mail_component_98_98');
    if (!composeLi) {
      // 备用：遍历所有候选按钮，找包含"写"字的
      const allLis = document.querySelectorAll('li.js-component-component[role="button"]');
      for (const li of allLis) {
        if (li.textContent.includes('写') && li.textContent.includes('信')) {
          composeLi = li;
          break;
        }
      }
    }
    if (!composeLi) {
      return { error: '未找到"写信"按钮', message: '请确保当前在163邮箱主界面' };
    }
    composeLi.click();

    // 等待写信界面加载 — 163邮箱点击写信后会在当前页面内加载写信模块
    // 收件人输入框可能需要较长时间出现，用较长超时
    const toInput = await waitForElement('.nui-editableAddr-ipt', 15000);
    if (!toInput) {
      return { error: '未找到收件人输入框', message: '写信界面可能未正确加载，请重试' };
    }
    await sleep(500); // 额外等待界面稳定

    // 2. 填写收件人
    toInput.focus();
    setInputValue(toInput, to);
    // 按 Enter 确认收件人地址
    toInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    toInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(500);

    // 3. 填写抄送（如果有）
    if (cc) {
      // 点击"添加抄送"链接（如果存在）
      const ccLink = document.querySelector('a[title*="抄送"], a[id*="cc"]');
      if (ccLink) {
        ccLink.click();
        await sleep(500);
      }
      // 查找抄送输入框（第二个 nui-editableAddr-ipt）
      const allAddrInputs = document.querySelectorAll('.nui-editableAddr-ipt');
      if (allAddrInputs.length > 1) {
        const ccInput = allAddrInputs[1];
        ccInput.focus();
        setInputValue(ccInput, cc);
        ccInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        ccInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
        await sleep(300);
      }
    }

    // 4. 填写主题
    if (subject) {
      const subjectInput = document.querySelector('[id$="_subjectInput"]');
      if (subjectInput) {
        subjectInput.focus();
        setInputValue(subjectInput, subject);
        await sleep(300);
      }
    }

    // 5. 填写正文（在 iframe 内的 contenteditable body 中）
    if (body) {
      // 等待编辑器 iframe 加载
      let editorBody = null;
      let attempts = 0;
      while (!editorBody && attempts < 10) {
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            const b = doc?.querySelector('body[contenteditable="true"]');
            if (b) { editorBody = b; break; }
          } catch { /* cross-origin, skip */ }
        }
        if (!editorBody) { await sleep(500); attempts++; }
      }

      if (editorBody) {
        editorBody.focus();
        // 支持 HTML 内容
        if (body.includes('<') && body.includes('>')) {
          editorBody.innerHTML = body;
        } else {
          // 纯文本：转换换行为 <br>
          editorBody.innerHTML = '<div>' + body.replace(/\n/g, '<br>') + '</div>';
        }
        editorBody.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);
      }
    }

    // 6. 添加附件（如果有 file_path）
    if (file_path) {
      const fileInputSelector = '[id$="_attachBrowser"] input[type="file"]';
      const fileInput = document.querySelector(fileInputSelector);
      if (fileInput) {
        // 通过 CDP 上传文件：返回 __cdp_action，由 service-worker 处理
        return {
          __cdp_action: 'set_file_input',
          selector: fileInputSelector,
          files: [file_path],
          _message: `邮件已填写，附件通过 CDP 上传。操作: ${action === 'send' ? '请手动点击发送' : action === 'draft' ? '请手动保存草稿' : '仅填充完成'}`,
        };
      } else {
        console.warn('[163-mail] 未找到附件上传 input');
      }
    }

    // 7. 执行操作
    if (action === 'send') {
      // 点击发送按钮
      const sendIcon = document.querySelector('.nui-ico-sent');
      const sendBtn = sendIcon?.closest('[role="button"], .nui-btn, button');
      if (!sendBtn) {
        return { error: '未找到发送按钮', message: '邮件已填写但无法自动发送，请手动点击发送' };
      }
      sendBtn.click();

      // 等待"发送成功"提示出现（h1 含"发送成功"文本）
      let sendSuccess = false;
      for (let i = 0; i < 20; i++) {
        await sleep(500);
        const succEl = document.querySelector('h1[id$="_succInfo"]');
        if (succEl && succEl.textContent.includes('发送成功')) {
          sendSuccess = true;
          break;
        }
      }

      if (sendSuccess) {
        return {
          status: 'sent',
          to,
          cc: cc || undefined,
          subject,
          hasAttachment: attachmentAdded,
          message: attachmentAdded ? '邮件发送成功（含附件）' : '邮件发送成功',
        };
      }
      return {
        status: 'unknown',
        to,
        subject,
        hasAttachment: attachmentAdded,
        message: '已点击发送按钮，但未检测到发送成功提示，请确认邮件是否发送成功',
      };
    }

    if (action === 'draft') {
      // 点击存草稿按钮
      const draftBtns = document.querySelectorAll('.nui-btn .nui-btn-text');
      let draftBtn = null;
      for (const btn of draftBtns) {
        if (btn.textContent.includes('存草稿')) { draftBtn = btn.closest('.nui-btn'); break; }
      }
      if (!draftBtn) {
        return { error: '未找到存草稿按钮', message: '邮件已填写但无法自动保存草稿' };
      }
      draftBtn.click();

      // 等待保存成功提示
      let draftSuccess = false;
      for (let i = 0; i < 10; i++) {
        await sleep(500);
        const succEl = document.querySelector('h1[id$="_succInfo"]');
        if (succEl && succEl.textContent.includes('保存')) {
          draftSuccess = true;
          break;
        }
      }

      return {
        status: draftSuccess ? 'draft_saved' : 'unknown',
        to,
        subject,
        message: draftSuccess ? '草稿保存成功' : '已点击存草稿，但未检测到保存成功提示',
      };
    }

    // action === 'fill'
    return {
      status: 'filled',
      to,
      cc: cc || undefined,
      subject,
      hasBody: !!body,
      hasAttachment: attachmentAdded,
      message: '写信界面已填写完毕，请用户确认后手动操作',
    };
  } catch (error) {
    return {
      error: '写邮件失败',
      message: error.message,
    };
  }
}

/**
 * 检测163邮箱是否已登录
 *
 * 检测策略（多重判断，鲁棒性优先）：
 * 1. URL 特征：登录页 URL 包含 entry/cgi/ntesdoor 或 dl.reg.163.com
 * 2. DOM 特征：未登录时存在 .main-login-wrap / #loginBlock / #appLoginTab / #normalLoginTab
 * 3. 已登录特征：存在 .nui-mainArea / div[sign="letter"] / .nui-tree（邮箱文件夹树）
 *
 * 测试示例：checkLoginStatus()
 */
function checkLoginStatus() {
  try {
    const url = window.location.href;

    // 1. URL 判断：是否在登录页
    const loginUrlPatterns = [
      'entry/cgi/ntesdoor',
      'dl.reg.163.com',
      '/register/',
      'login.163.com',
    ];
    const isLoginUrl = loginUrlPatterns.some(p => url.includes(p));

    // 2. DOM 判断：是否存在登录界面元素
    const loginSelectors = [
      '.main-login-wrap',
      '#loginBlock',
      '#appLoginTab',
      '#normalLoginTab',
      '.loginForm',
      '#switchAccountLogin',
    ];
    const hasLoginElements = loginSelectors.some(s => document.querySelector(s) !== null);

    // 3. DOM 判断：是否存在已登录的邮箱主界面元素
    const loggedInSelectors = [
      '.nui-mainArea',
      'div[sign="letter"]',
      '.nui-tree',
      '#_mail_tabmain',
      'li[sign="inbox"]',
    ];
    const hasLoggedInElements = loggedInSelectors.some(s => document.querySelector(s) !== null);

    // 综合判断
    if (hasLoggedInElements && !hasLoginElements) {
      return { logged_in: true };
    }

    if (isLoginUrl || hasLoginElements) {
      return {
        logged_in: false,
        hint: '163邮箱未登录，请先在浏览器中登录163邮箱后再操作',
      };
    }

    // 页面可能还在加载中
    if (document.readyState !== 'complete') {
      return {
        logged_in: false,
        hint: '163邮箱页面尚未加载完成，请稍后再试',
      };
    }

    // 无法确定状态（可能是其他页面）
    return {
      logged_in: false,
      hint: '无法确定163邮箱登录状态，请确认当前页面是否为163邮箱',
    };
  } catch (error) {
    return {
      logged_in: false,
      hint: `检测登录状态失败: ${error.message}`,
    };
  }
}

/**
 * 获取当前163邮箱页面的状态信息
 *
 * 测试示例：getCurrentPageInfo()
 */
function getCurrentPageInfo() {
  try {
    const url = window.location.href;
    const title = document.title;

    // 判断页面类型
    const isInbox = url.includes('main.jsp') || url.includes('inbox');
    const isEmailDetail = !!document.querySelector('[id*="read.ReadModule"]');
    const isComposing = !!document.querySelector('[id$="_subjectInput"]') || !!document.querySelector('.nui-ico-sent');

    // 获取邮件列表信息
    let emailListInfo = null;
    if (!isEmailDetail && !isComposing) {
      const emailRows = document.querySelectorAll('div[sign="letter"]');
      emailListInfo = {
        totalEmails: emailRows.length,
        hasEmails: emailRows.length > 0
      };
    }

    // 获取邮件详情信息
    let emailDetailInfo = null;
    if (isEmailDetail) {
      const subjectEl = document.querySelector('h1[id*="h1Subject"]');
      const subject = subjectEl?.textContent?.trim() ?? "";
      const attachments = document.querySelectorAll('ul.qs0 > li.lh0');

      emailDetailInfo = {
        subject,
        hasAttachments: attachments.length > 0,
        attachmentCount: attachments.length
      };
    }

    return {
      url,
      title,
      pageType: isEmailDetail ? 'email_detail' : (isComposing ? 'composing' : 'inbox'),
      isInbox,
      isEmailDetail,
      isComposing,
      emailListInfo,
      emailDetailInfo,
      readyState: document.readyState
    };
  } catch (error) {
    return {
      error: "Failed to get page info",
      message: error.message
    };
  }
}

window.__webmcpRegister({
  name: "163-mail-adapter",
  match: ["mail.163.com"],
  tools: [
    {
      name: "mail.163.com.check_login_status",
      description: "检测163邮箱是否已登录。打开163邮箱后应首先调用此工具确认登录状态，未登录时需提醒用户先登录。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      handler: () => checkLoginStatus(),
    },

    {
      name: "mail.163.com.navigate_to_inbox",
      description: "返回163邮箱收件箱首页。当需要执行多步骤操作（如批量下载附件）或当前页面状态不明确时，使用此工具返回初始状态。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      handler: () => navigateToInbox(),
    },

    {
      name: "mail.163.com.search_emails",
      description: "在163邮箱中搜索邮件，支持按关键词搜索",
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description: "搜索关键词，例如「发票」「合同」「会议」",
          },
        },
        required: ["keyword"],
      },
      handler: async ({ keyword }) => searchEmails(keyword),
    },

    {
      name: "mail.163.com.get_unread_emails",
      description: "获取163邮箱收件箱中的未读邮件列表",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "最多返回的邮件数量，默认20",
          },
        },
        required: [],
      },
      handler: async ({ limit = 20 }) => getUnreadEmails(limit),
    },

    {
      name: "mail.163.com.open_email",
      description: "打开163邮箱中的指定邮件，查看完整内容。邮件ID可以从search_emails或get_unread_emails的返回结果中获取",
      parameters: {
        type: "object",
        properties: {
          emailId: {
            type: "string",
            description: "邮件的唯一ID，例如：1771635701103_741xtbC5RBFmml9PfBxwQAA3D_6fd294bhq81771635724863Dom",
          },
        },
        required: ["emailId"],
      },
      handler: async ({ emailId }) => openEmail(emailId),
    },

    {
      name: "mail.163.com.download_attachment",
      description: "下载163邮箱中当前打开邮件的附件。使用前需要先调用open_email打开邮件。",
      parameters: {
        type: "object",
        properties: {
          attachmentName: {
            type: "string",
            description: "要下载的附件名称（例如：'发票.pdf'），或使用'all'打包下载所有附件",
          },
        },
        required: ["attachmentName"],
      },
      handler: async ({ attachmentName }) => downloadAttachment(attachmentName),
    },

    {
      name: "mail.163.com.get_current_page_info",
      description: "获取当前163邮箱页面的状态信息，用于判断当前在哪个页面（收件箱、邮件详情、写信等）",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      handler: () => getCurrentPageInfo(),
    },

    {
      name: "mail.163.com.compose_email",
      description:
        '在163邮箱中写邮件：打开写信界面，自动填入收件人、主题、正文，并可选择发送、保存草稿或仅填充。' +
        '支持添加附件（通过 file_path 传入本地文件路径）。多个收件人或抄送地址用分号分隔。',
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "收件人邮箱地址，多个用分号分隔，例如 alice@example.com;bob@example.com",
          },
          subject: {
            type: "string",
            description: "邮件主题",
          },
          body: {
            type: "string",
            description: "邮件正文内容（纯文本或 HTML 格式均可）",
          },
          cc: {
            type: "string",
            description: "抄送地址，多个用分号分隔",
          },
          file_path: {
            type: "string",
            description: "附件文件的本地绝对路径，通过 CDP 上传到浏览器",
          },
          file_name: {
            type: "string",
            description: "附件文件名（含扩展名），例如 report.pdf",
          },
          action: {
            type: "string",
            enum: ["send", "draft", "fill"],
            description: "操作类型：send 填写后直接发送（默认），draft 保存为草稿，fill 仅填充不执行操作",
          },
        },
        required: ["to"],
      },
      handler: async (args) => composeEmail(args),
    },
  ],
});

  } finally {
    window.__webmcpRegister = previousRegister;
  }
  var tools = [];
  for (var i = 0; i < captured.length; i++) {
    var list = Array.isArray(captured[i].tools) ? captured[i].tools : [];
    for (var j = 0; j < list.length; j++) if (list[j] && typeof list[j].handler === 'function') tools.push(list[j]);
  }
  var support = window.__webmcpGeneratedSupport["mail.163.com"];
  if (support && Array.isArray(support.tools)) {
    for (var k = 0; k < support.tools.length; k++) if (support.tools[k] && typeof support.tools[k].handler === 'function') tools.push(support.tools[k]);
  }
  var byName = Object.create(null);
  for (var n = 0; n < tools.length; n++) {
    var tool = tools[n];
    var names = [tool.publicName, tool.name, tool.handlerName];
    for (var z = 0; z < names.length; z++) if (typeof names[z] === 'string' && names[z] && !byName[names[z]]) byName[names[z]] = tool;
  }
  window["__mail_163_com_internal"] = {
    invoke: async function (publicName, params) {
      var tool = byName[publicName];
      if (!tool || typeof tool.handler !== 'function') throw new Error('Legacy handler unavailable for ' + "mail.163.com" + '.' + publicName);
      return tool.handler(params || {});
    },
    names: Object.keys(byName)
  };
})();
