/* v2 compatibility implementation for jd.com; preserves the tracked legacy executable logic. */
(function () {
  var captured = [];
  var previousRegister = window.__webmcpRegister;
  window.__webmcpRegister = function (adapter) { captured.push(adapter || {}); };
  window.__webmcpGeneratedSupport = window.__webmcpGeneratedSupport || {};
  window.__webmcpGeneratedLegacyHandlers = window.__webmcpGeneratedLegacyHandlers || {};
  try {
/* embedded legacy source: index.js */
/**
 * JD.com Adapter Script
 *
 * NOTE: Runs in isolated world — can only access DOM, not page JS variables.
 *
 * Verified: JD.com, March 2026
 * Maintainer: WeWorker project
 */

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Wait for a selector to appear in the DOM.
 * @param {string} selector
 * @param {number} timeout milliseconds
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
 * Sleep for a number of milliseconds.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── DOM Parsing ─────────────────────────────────────────────────────────────

/**
 * Parse order list from the order page.
 *
 * JD.com order DOM structure:
 * - Parent order (split): tbody#parent-{orderId}
 * - Child order: tbody#tb-{orderId} with class="split-tbody"
 * - Independent order: tbody#tb-{orderId} without split-tbody class
 *
 * Order information:
 * - Order ID: in .number span
 * - Order time: in .dealtime
 * - Products: .goods-item with product name, image, quantity
 * - Status: .order-status
 * - Amount: .spmMoney
 * - Consignee: .consignee .txt
 */
function parseOrderList() {
  const orders = [];

  // Find all order tbody elements
  const orderBodies = document.querySelectorAll('tbody[id^="tb-"]');

  for (const tbody of orderBodies) {
    try {
      const orderId = tbody.id.replace('tb-', '');

      // Skip if this is a parent order placeholder (only contains split info)
      if (tbody.id.startsWith('parent-')) continue;

      // Check if this is a split order (child of a parent order)
      const isSplitOrder = tbody.classList.contains('split-tbody');
      const parentOrderId = isSplitOrder ? tbody.getAttribute('data-parentid') : null;

      // Extract order time
      const dealTimeEl = tbody.querySelector('.dealtime');
      const orderTime = dealTimeEl?.getAttribute('title') || dealTimeEl?.textContent?.trim() || '';

      // Extract order number
      const orderNumberEl = tbody.querySelector('.number a');
      const orderNumber = orderNumberEl?.textContent?.trim() || orderId;

      // Extract products
      const products = [];
      const productItems = tbody.querySelectorAll('.goods-item');
      for (const item of productItems) {
        const nameEl = item.querySelector('.p-name a');
        const name = nameEl?.getAttribute('title') || nameEl?.textContent?.trim() || '';
        let link = nameEl?.getAttribute('href') || '';
        // 处理相对URL（//item.jd.com/... -> https://item.jd.com/...）
        if (link.startsWith('//')) {
          link = 'https:' + link;
        }

        const imgEl = item.querySelector('.p-img img');
        let image = imgEl?.getAttribute('src') || '';
        // 处理相对URL
        if (image.startsWith('//')) {
          image = 'https:' + image;
        }

        const quantityEl = item.closest('td')?.querySelector('.goods-number');
        const quantity = quantityEl?.textContent?.trim() || 'x1';

        if (name) {
          products.push({ name, link, image, quantity });
        }
      }

      // Extract consignee
      const consigneeEl = tbody.querySelector('.consignee .txt');
      const consignee = consigneeEl?.textContent?.trim() || '';

      // Extract amount
      const amountEl = tbody.querySelector('.spmMoney');
      const amount = amountEl?.textContent?.trim() || '';

      // Extract payment method
      const paymentEl = tbody.querySelector('.amount .ftx-13');
      const paymentMethod = paymentEl?.textContent?.trim() || '';

      // Extract order status
      const statusEl = tbody.querySelector('.order-status');
      const status = statusEl?.textContent?.trim() || '';

      // Determine order state category
      let statusCategory = 'unknown';
      if (status.includes('已完成')) {
        statusCategory = 'completed';
      } else if (status.includes('已取消')) {
        statusCategory = 'cancelled';
      } else if (status.includes('等待付款')) {
        statusCategory = 'pending_payment';
      } else if (status.includes('出库') || status.includes('配送') || status.includes('等待收货')) {
        statusCategory = 'shipping';
      }

      // Extract tracking info if available
      const trackingEl = tbody.querySelector('.tooltip[_orderid]');
      const hasTracking = !!trackingEl;

      orders.push({
        orderId: orderNumber,
        orderTime,
        products,
        consignee,
        amount,
        paymentMethod,
        status,
        statusCategory,
        hasTracking,
        isSplitOrder,
        parentOrderId,
      });
    } catch (error) {
      console.error(`Failed to parse order ${tbody.id}:`, error);
    }
  }

  // Also parse parent orders (split orders)
  const parentBodies = document.querySelectorAll('tbody[id^="parent-"]');
  for (const tbody of parentBodies) {
    try {
      const parentOrderId = tbody.id.replace('parent-', '');

      // Extract parent order info
      const orderNumberEl = tbody.querySelector('.number a');
      const orderNumber = orderNumberEl?.textContent?.trim() || parentOrderId;

      const dealTimeEl = tbody.querySelector('.dealtime');
      const orderTime = dealTimeEl?.getAttribute('title') || dealTimeEl?.textContent?.trim() || '';

      const amountEl = tbody.querySelector('.order-count em');
      const amount = amountEl?.textContent?.trim() || '';

      const statusEl = tbody.querySelector('.order-status');
      const status = statusEl?.textContent?.trim() || '已拆分';

      // Find all child orders
      const childOrders = orders.filter(o => o.parentOrderId === parentOrderId);

      orders.push({
        orderId: orderNumber,
        orderTime,
        amount,
        status,
        statusCategory: 'split',
        isParentOrder: true,
        childOrderIds: childOrders.map(o => o.orderId),
        childCount: childOrders.length,
      });
    } catch (error) {
      console.error(`Failed to parse parent order ${tbody.id}:`, error);
    }
  }

  return orders;
}

// ─── Tool Handler Functions ──────────────────────────────────────────────────

/**
 * 检测京东是否已登录
 *
 * 检测策略（多重判断，鲁棒性优先）：
 * 1. 如果不在 jd.com 域名下，先导航到首页
 * 2. DOM 特征：#ttbar-login-2024 .link-login 含"请登录" → 未登录
 * 3. DOM 特征：.login_info 区域存在 → 已登录，提取用户名和 PLUS 信息
 * 4. 备用选择器覆盖子页面（order.jd.com、cart.jd.com 等）
 *
 * 测试示例：checkLoginStatus()
 */
function checkLoginStatus() {
  try {
    const hostname = window.location.hostname;

    // 不在 jd.com 域名下 → 导航到首页
    if (!hostname.includes('jd.com')) {
      setTimeout(() => { window.location.href = 'https://www.jd.com/'; }, 100);
      return {
        logged_in: false,
        hint: '当前不在京东页面，正在导航到京东首页，请稍后再次调用此工具。',
      };
    }

    // 未登录标志（多选择器覆盖不同页面）
    const notLoggedInSelectors = [
      '#ttbar-login-2024 .link-login',   // 首页
      '.shortcut .link-login',            // 子页面
    ];
    for (const sel of notLoggedInSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.includes('请登录')) {
        return {
          logged_in: false,
          hint: '京东未登录，页面显示"你好，请登录"。请先在浏览器中登录京东账号。',
        };
      }
    }

    // 已登录标志（多选择器覆盖不同页面）
    const loggedInSelectors = [
      '.login_info',                      // 首页
      '.shortcut .nickname',              // 子页面
      '#ttbar-login-2024 .nickname',      // 部分页面
    ];
    for (const sel of loggedInSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        // 尝试提取用户名
        const usernameEl = el.querySelector('.userv4_show .welcome a')
          || el.querySelector('a[href*="home.jd.com"]')
          || el;
        const username = usernameEl?.textContent?.trim() || '';

        // 尝试提取 PLUS 会员信息
        const plusEl = el.querySelector('.is_plus') || document.querySelector('.is_plus');
        const plusInfo = plusEl?.textContent?.trim() || '';

        return {
          logged_in: true,
          username: username || undefined,
          plus_info: plusInfo || undefined,
        };
      }
    }

    // 页面可能还在加载中
    if (document.readyState !== 'complete') {
      return {
        logged_in: false,
        hint: '京东页面尚未加载完成，请稍后再试',
      };
    }

    // 无法确定 → 导航到首页重试
    setTimeout(() => { window.location.href = 'https://www.jd.com/'; }, 100);
    return {
      logged_in: false,
      hint: '无法在当前页面确定登录状态，正在导航到京东首页，请稍后再次调用此工具。',
    };
  } catch (error) {
    return {
      logged_in: false,
      hint: `检测登录状态失败: ${error.message}`,
    };
  }
}

/**
 * Navigate to the JD.com homepage.
 *
 * 测试示例：await navigateToHomepage()
 */
async function navigateToHomepage() {
  try {
    const currentUrl = window.location.href;

    // 立即返回响应，告诉调用者正在导航
    // 使用 setTimeout 确保响应先发送，然后再导航
    setTimeout(() => {
      window.location.href = 'https://www.jd.com/';
    }, 100);

    return {
      status: 'navigating',
      message: 'Navigating to JD.com homepage. Please wait 3-5 seconds for the page to load.',
      previousUrl: currentUrl,
      targetUrl: 'https://www.jd.com/',
      note: 'The page will navigate to the JD.com homepage. Wait for the page to load.',
    };
  } catch (error) {
    return {
      status: 'error',
      message: `Navigation failed: ${error.message}`,
      error: error.message,
    };
  }
}

/**
 * View shopping cart.
 *
 * 鲁棒性策略：
 * 1. 使用 .jdmcc-topbar 作为导航栏的唯一标识
 * 2. 通过 href 或 aria-label 定位购物车链接
 * 3. 等待购物车页面加载完成
 *
 * 测试示例：await viewCart()
 */
async function viewCart() {
  try {
    // 确保在主页
    if (!window.location.href.includes('jd.com')) {
      return {
        error: 'Not on JD.com',
        message: 'Please navigate to JD.com homepage first',
      };
    }

    // 等待导航栏加载
    await waitForElement('.jdmcc-topbar', 5000);

    // 查找购物车链接 - 使用多种策略确保鲁棒性
    let cartLink = null;

    // 策略1: 通过 href 属性查找
    cartLink = document.querySelector('.jdmcc-topbar a[href*="cart.jd.com/cart.action"]');

    // 策略2: 通过 aria-label 查找
    if (!cartLink) {
      const links = document.querySelectorAll('.jdmcc-topbar a[aria-label]');
      for (const link of links) {
        const label = link.getAttribute('aria-label');
        if (label && label.includes('购物车')) {
          cartLink = link;
          break;
        }
      }
    }

    // 策略3: 通过文本内容查找
    if (!cartLink) {
      const links = document.querySelectorAll('.jdmcc-topbar a');
      for (const link of links) {
        if (link.textContent.includes('购物车')) {
          cartLink = link;
          break;
        }
      }
    }

    if (!cartLink) {
      return {
        error: 'Cart link not found',
        message: 'Could not find shopping cart link in navigation bar',
      };
    }

    const cartUrl = cartLink.href;
    const currentUrl = window.location.href;

    // 立即返回响应，告诉调用者正在导航
    // 使用 setTimeout 确保响应先发送，然后再导航
    setTimeout(() => {
      window.location.href = cartUrl;
    }, 100);

    return {
      status: 'navigating',
      message: 'Navigating to shopping cart. Please wait 3-5 seconds for the page to load.',
      cartUrl: cartUrl,
      previousUrl: currentUrl,
      note: 'The page will navigate to the shopping cart. Wait for the page to load.',
    };
  } catch (error) {
    return {
      error: 'Failed to view cart',
      message: error.message,
    };
  }
}

/**
 * View my orders.
 *
 * 鲁棒性策略：
 * 1. 使用 .jdmcc-topbar 作为导航栏的唯一标识
 * 2. 通过 href 或 aria-label 定位订单链接
 * 3. 等待订单页面加载完成
 * 4. 解析订单列表，包括父订单和子订单
 *
 * 测试示例：await viewOrders()
 */
async function viewOrders() {
  try {
    // 如果已经在订单页面，直接解析
    if (window.location.href.includes('order.jd.com/center/list.action')) {
      // 等待订单列表加载
      await sleep(1000);
      const orders = parseOrderList();

      return {
        status: 'success',
        message: 'Order list parsed successfully',
        currentUrl: window.location.href,
        totalOrders: orders.length,
        orders: orders,
      };
    }

    // 确保在京东域名
    if (!window.location.href.includes('jd.com')) {
      return {
        error: 'Not on JD.com',
        message: 'Please navigate to JD.com homepage first',
      };
    }

    // 等待导航栏加载
    await waitForElement('.jdmcc-topbar', 5000);

    // 查找订单链接 - 使用多种策略确保鲁棒性
    let orderLink = null;

    // 策略1: 通过 href 属性查找
    orderLink = document.querySelector('.jdmcc-topbar a[href*="order.jd.com/center/list.action"]');

    // 策略2: 通过 aria-label 查找
    if (!orderLink) {
      const links = document.querySelectorAll('.jdmcc-topbar a[aria-label]');
      for (const link of links) {
        const label = link.getAttribute('aria-label');
        if (label && label === '我的订单') {
          orderLink = link;
          break;
        }
      }
    }

    // 策略3: 通过文本内容查找
    if (!orderLink) {
      const links = document.querySelectorAll('.jdmcc-topbar a');
      for (const link of links) {
        if (link.textContent.trim() === '我的订单') {
          orderLink = link;
          break;
        }
      }
    }

    if (!orderLink) {
      return {
        error: 'Order link not found',
        message: 'Could not find order link in navigation bar',
      };
    }

    const orderUrl = orderLink.href;

    // 立即返回响应，告诉调用者正在导航
    // 使用 setTimeout 确保响应先发送，然后再导航
    setTimeout(() => {
      window.location.href = orderUrl;
    }, 100);

    return {
      status: 'navigating',
      message: 'Navigating to orders page. Please call this tool again in 3-5 seconds to get the order list.',
      orderUrl: orderUrl,
      note: 'The page will navigate to the orders page. Wait for the page to load, then call view_orders again.',
    };
  } catch (error) {
    return {
      error: 'Failed to view orders',
      message: error.message,
    };
  }
}

/**
 * Parse product list from the search results page.
 *
 * DOM structure:
 * - Container: ._goodsContainer_644iz_1
 * - Each card: ._wrapper_1m8y1_3[data-sku]
 * - Title: ._wrapper_8g5fc_1[title] or ._text_1g56m_31
 * - Image: ._img_18s24_1[data-src] or [src]
 * - Price: ._price_d0rf6_14 (i._yen + integer + ._decimal)
 * - Original price: ._gray_d0rf6_61
 * - Sales: ._goods_volume_1xkku_1 span
 * - Shop: ._name_b6zo3_45 span
 * - Tags: ._textTag_1qbwk_10 span
 */
function parseSearchResults() {
  const products = [];
  const cards = document.querySelectorAll('._wrapper_1m8y1_3[data-sku]');

  for (const card of cards) {
    try {
      const sku = card.getAttribute('data-sku');
      if (!sku) continue;

      // 商品标题：优先取 ._wrapper_8g5fc_1 的 title 属性（完整无截断）
      const imgWrapper = card.querySelector('._wrapper_8g5fc_1[title]');
      const titleText = card.querySelector('._text_1g56m_31');
      const title = imgWrapper?.getAttribute('title') || titleText?.textContent?.trim() || '';

      // 商品图片
      const imgEl = card.querySelector('._img_18s24_1');
      let image = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || '';
      if (image.startsWith('//')) image = 'https:' + image;

      // 价格：拼接整数部分 + 小数部分
      const priceEl = card.querySelector('._price_d0rf6_14');
      let price = '';
      if (priceEl) {
        const integer = priceEl.childNodes[1]?.textContent?.trim() || '';
        const decimal = priceEl.querySelector('._decimal_d0rf6_28')?.textContent?.trim() || '';
        price = decimal ? `¥${integer}.${decimal}` : `¥${integer}`;
      }

      // 原价（划线价）
      const originalPriceEl = card.querySelector('._gray_d0rf6_61');
      const originalPrice = originalPriceEl?.textContent?.trim() || '';

      // 销量
      const salesEl = card.querySelector('._goods_volume_1xkku_1 span');
      const sales = salesEl?.getAttribute('title') || salesEl?.textContent?.trim() || '';

      // 店铺名
      const shopEl = card.querySelector('._name_b6zo3_45 span');
      const shop = shopEl?.textContent?.trim() || '';

      // 标签（如"只换不修"、"政府补贴"等文字标签）
      const tagEls = card.querySelectorAll('._textTag_1qbwk_10 span');
      const tags = Array.from(tagEls).map(el => el.textContent.trim()).filter(Boolean);

      // 商品链接
      const productUrl = `https://item.jd.com/${sku}.html`;

      if (title) {
        products.push({ sku, title, price, originalPrice, image, sales, shop, tags, url: productUrl });
      }
    } catch (err) {
      console.error('Failed to parse product card:', err);
    }
  }

  return products;
}

/**
 * Search for products on JD.com.
 *
 * 两阶段策略：
 * 1. 若当前不在搜索结果页 → 直接导航到 search.jd.com，返回 navigating
 * 2. 若已在搜索结果页 → 解析商品列表并返回
 *
 * @param {object} args - { keyword: string }
 * 测试示例：await searchProducts({ keyword: '耳机' })
 */
async function searchProducts(args) {
  try {
    const { keyword } = args;

    if (!keyword || !keyword.trim()) {
      return {
        error: 'Missing required parameter',
        message: 'keyword parameter is required',
      };
    }

    // 确保在京东域名
    if (!window.location.href.includes('jd.com')) {
      return {
        error: 'Not on JD.com',
        message: 'Please navigate to JD.com homepage first using jd.com.navigate_to_homepage',
      };
    }

    // 已在搜索结果页 → 直接解析
    if (window.location.href.includes('search.jd.com/Search')) {
      // 等待商品卡片渲染
      await waitForElement('._wrapper_1m8y1_3[data-sku]', 8000);
      await sleep(500);

      const products = parseSearchResults();

      return {
        status: 'success',
        keyword: keyword.trim(),
        currentUrl: window.location.href,
        totalProducts: products.length,
        products,
      };
    }

    // 不在搜索结果页 → 导航过去
    const currentUrl = window.location.href;
    const searchUrl = `https://search.jd.com/Search?keyword=${encodeURIComponent(keyword.trim())}&enc=utf-8`;

    setTimeout(() => {
      window.location.href = searchUrl;
    }, 100);

    return {
      status: 'navigating',
      message: `Searching for "${keyword.trim()}". Please wait 3-5 seconds for the search results page to load, then call this tool again to get the product list.`,
      keyword: keyword.trim(),
      searchUrl,
      previousUrl: currentUrl,
      note: 'Wait for the search results page to load, then call jd.com.search_products again with the same keyword to parse results.',
    };
  } catch (error) {
    return {
      error: 'Failed to search products',
      message: error.message,
    };
  }
}

/**
 * Open a product page.
 *
 * @param {object} args - { url: string }
 * 测试示例：await openProduct({ url: 'https://item.jd.com/100054010576.html' })
 */
async function openProduct(args) {
  try {
    const { url } = args;

    if (!url) {
      return {
        error: 'Missing required parameter',
        message: 'url parameter is required',
      };
    }

    // 验证URL是否为京东商品页
    if (!url.includes('item.jd.com')) {
      return {
        error: 'Invalid URL',
        message: 'URL must be a JD.com product page (item.jd.com)',
      };
    }

    const currentUrl = window.location.href;

    // 立即返回响应，告诉调用者正在导航
    // 使用 setTimeout 确保响应先发送，然后再导航
    setTimeout(() => {
      window.location.href = url;
    }, 100);

    return {
      status: 'navigating',
      message: 'Navigating to product page. Must wait 7-8 seconds for the page to load.',
      productUrl: url,
      previousUrl: currentUrl,
      note: 'The page will navigate to the product page. Wait for at least 7 seconds the page to load before calling buy_now.',
    };
  } catch (error) {
    return {
      error: 'Failed to open product',
      message: error.message,
    };
  }
}

/**
 * Buy the product immediately (must be on a product page).
 *
 * 注意：使用 setTimeout 延迟点击，确保响应先发送后再执行点击操作，
 * 避免点击后页面进入 BFCache 导致消息通道断开。
 *
 * 测试示例：await buyNow()
 */
async function buyNow() {
  try {
    // 确保在商品页面
    if (!window.location.href.includes('item.jd.com')) {
      return {
        error: 'Not on product page',
        message: 'Please open a product page first using jd.com.open_product',
      };
    }

    // 等待按钮加载
    await sleep(1000);

    // 查找"立即购买"按钮
    const buyButton = Array.from(document.querySelectorAll('#bottom-btns .first-row div'))
      .find(el => el.textContent.trim() === '立即购买');

    if (!buyButton) {
      return {
        error: 'Buy button not found',
        message: 'Could not find "立即购买" button on the page',
      };
    }

    // 先返回响应，再异步执行点击 + 等待 iframe + 导航到结算页
    // 原因：若在返回响应前执行 window.location.href 跳转，当前页面会进入
    // BFCache，导致 content script 消息通道断开，响应无法送达。
    setTimeout(async () => {
      buyButton.click();

      // 等待结算 iframe 加载完成
      await sleep(3000);

      // 导航到 iframe URL，使结算页成为主文档，
      // 触发 service worker 的 injectAdapters 注入 settlement adapter，
      // 从而注册 pay_now 工具。
      const iframe = document.querySelector('iframe[src*="pc-settlement-lite-pro.pf.jd.com"]');
      if (iframe?.src) {
        window.location.href = iframe.src;
      }
    }, 100);

    return {
      status: 'success',
      message: 'Buy now button will be clicked. Please wait 5-6 seconds for the settlement page to load, you should end this chat. Then call pay_now tool of pc-settlement-lite-pro.pf.jd.com in new chat!',
      note: 'Please wait 5-6 seconds for the settlement page to load, you should end this chat. Then call pay_now tool of pc-settlement-lite-pro.pf.jd.com in new chat!',
    };
  } catch (error) {
    return {
      error: 'Failed to buy now',
      message: error.message,
    };
  }
}

/**
 * Pay for the order (must be on the checkout confirmation page).
 *
 * @param {object} args - { paymentMethod: string }
 * 测试示例：await payNow({ paymentMethod: '京东支付' })
 */
async function payNow(args) {
  try {
    const { paymentMethod } = args;

    if (!paymentMethod) {
      return {
        requires_user_choice: true,
        question: '请选择支付方式',
        options: [
          { label: '京东支付', description: '推荐' },
          { label: '微信支付' },
          { label: '京东白条' },
          { label: '云闪付' },
          { label: 'APP支付' },
        ],
        message: '请调用 ask_user 工具将上述选项展示给用户选择，不要自行决定支付方式。',
      };
    }

    // 检测是否在 iframe 中
    const isInIframe = window.location.hostname.includes('pc-settlement-lite-pro.pf.jd.com');

    // 如果在主页面，检查 iframe 是否存在
    if (!isInIframe) {
      const iframe = document.querySelector('iframe[src*="pc-settlement-lite-pro.pf.jd.com"]');

      if (!iframe) {
        return {
          error: 'Checkout iframe not found',
          message: 'Please click "立即购买" first to open the checkout page',
        };
      }

      // iframe 存在但由于跨域无法操作
      // 等待一段时间让 iframe 中的 adapter 注册完成
      await sleep(2000);

      return {
        error: 'Cross-origin limitation',
        message: 'The checkout page is in a cross-origin iframe. The adapter should be automatically injected into the iframe. Please try calling this tool again in a few seconds.',
        iframe_detected: true,
        iframe_src: iframe.src,
      };
    }

    // 以下代码在 iframe 内部执行
    await sleep(1500);

    // 支付方式映射
    const paymentMethodMap = {
      '京东支付': ['京东支付', 'jdpay'],
      '京东白条': ['京东白条', 'baitiao'],
      '微信支付': ['微信支付', 'wechat'],
      '云闪付': ['云闪付', 'unionpay'],
      'APP支付': ['APP支付', 'app'],
    };

    // 查找匹配的支付方式
    let foundPaymentMethod = null;
    for (const [key, keywords] of Object.entries(paymentMethodMap)) {
      if (keywords.some(keyword => paymentMethod.includes(keyword) || key.includes(paymentMethod))) {
        foundPaymentMethod = key;
        break;
      }
    }

    if (!foundPaymentMethod) {
      return {
        error: 'Invalid payment method',
        message: `Payment method "${paymentMethod}" not recognized. Available options: 京东支付, 京东白条, 微信支付, 云闪付, APP支付`,
      };
    }

    // 查找支付方式对应的checkbox
    let paymentCheckbox = null;

    // 策略1: 通过titleText查找
    const titleElements = document.querySelectorAll('.titleText-afc128');
    for (const titleEl of titleElements) {
      if (titleEl.textContent.includes(foundPaymentMethod)) {
        // 找到对应的checkbox
        const container = titleEl.closest('.modePaymentLi-7dd46f, .jdPayment-13e444');
        if (container) {
          paymentCheckbox = container.querySelector('.el-checkbox__original');
          break;
        }
      }
    }

    if (!paymentCheckbox) {
      return {
        error: 'Payment method not found',
        message: `Could not find payment method "${foundPaymentMethod}" on the page`,
      };
    }

    // 点击选择支付方式
    if (!paymentCheckbox.checked) {
      paymentCheckbox.click();
      await sleep(500);
    }

    // 查找"立即支付"按钮
    const payButton = Array.from(document.querySelectorAll('.submit-338d03'))
      .find(el => el.textContent.trim() === '立即支付');

    if (!payButton) {
      return {
        error: 'Pay button not found',
        message: 'Could not find "立即支付" button on the page',
      };
    }

    // 点击立即支付按钮
    payButton.click();

    // 等待支付页面加载
    await sleep(2000);

    // 需要扫码的支付方式
    const qrCodeMethods = ['微信支付', 'APP支付', '云闪付'];
    const needsQrCode = qrCodeMethods.includes(foundPaymentMethod);

    return {
      status: 'success',
      message: needsQrCode
        ? `已选择「${foundPaymentMethod}」并点击了立即支付。页面应该会弹出支付二维码，请立即调用 capture_screenshot 截图，将二维码展示给用户扫码支付。`
        : `已选择「${foundPaymentMethod}」并点击了立即支付，支付流程已发起。`,
      paymentMethod: foundPaymentMethod,
      next_action: needsQrCode ? 'capture_screenshot' : null,
    };
  } catch (error) {
    return {
      error: 'Failed to pay',
      message: error.message,
    };
  }
}

// ─── Adapter Registration ────────────────────────────────────────────────────
// No ES module export — background injects this file via executeScript
// and window.__webmcpRegister is exposed by content/injector.js

window.__webmcpRegister({
  name: 'jd-adapter',
  match: ['jd.com', 'pc-settlement-lite-pro.pf.jd.com'],
  tools: [
      {
        name: 'jd.com.check_login_status',
        excludeTabDomain: 'pc-settlement-lite-pro.pf.jd.com',
        description:
          '检测京东是否已登录。打开京东后应首先调用此工具确认登录状态，未登录时需提醒用户先登录。',
        parameters: { type: 'object', properties: {}, required: [] },
        handler: () => checkLoginStatus(),
      },

      {
        name: 'jd.com.search_products',
        excludeTabDomain: 'pc-settlement-lite-pro.pf.jd.com',
        description:
          'Search for products on JD.com homepage by keyword. Fills the search box and submits the search. If currently on the homepage, it navigates to the search results page — call this tool again after 3-5 seconds to get the product list. If already on the search results page, it returns the parsed product list.',
        parameters: {
          type: 'object',
          properties: {
            keyword: {
              type: 'string',
              description: 'Search keyword (e.g., "耳机", "笔记本电脑", "运动鞋")',
            },
          },
          required: ['keyword'],
        },
        handler: (args) => searchProducts(args),
      },

      {
        name: 'jd.com.navigate_to_homepage',
        excludeTabDomain: 'pc-settlement-lite-pro.pf.jd.com',
        description:
          'Navigate to the JD.com homepage. Use this before multi-step operations to ensure a clean starting state.',
        parameters: { type: 'object', properties: {}, required: [] },
        handler: () => navigateToHomepage(),
      },

      {
        name: 'jd.com.view_cart',
        excludeTabDomain: 'pc-settlement-lite-pro.pf.jd.com',
        description:
          'View shopping cart. Navigates to the cart page from the homepage navigation bar. Returns cart URL and page status. Cart items parsing will be implemented after HTML structure is provided.',
        parameters: { type: 'object', properties: {}, required: [] },
        handler: () => viewCart(),
      },

      {
        name: 'jd.com.view_orders',
        excludeTabDomain: 'pc-settlement-lite-pro.pf.jd.com',
        description:
          'View my orders. Navigates to the orders page and returns parsed order list including order ID, products, status, amount, and consignee. Supports both split orders (parent/child) and independent orders.',
        parameters: { type: 'object', properties: {}, required: [] },
        handler: () => viewOrders(),
      },

      {
        name: 'jd.com.open_product',
        excludeTabDomain: 'pc-settlement-lite-pro.pf.jd.com',
        description:
          'Open a product page by URL. Use this before buying a product.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Product page URL (e.g., https://item.jd.com/100054010576.html)',
            },
          },
          required: ['url'],
        },
        handler: (args) => openProduct(args),
      },

      {
        name: 'jd.com.buy_now',
        excludeTabDomain: 'pc-settlement-lite-pro.pf.jd.com',
        description:
          'Click the "立即购买" (Buy Now) button on the current product page. Must be on a product page (item.jd.com). Must wait at least 7 seconds after Open Product. Use jd.com.open_product first to navigate to a product page. After clicking, a checkout iframe will appear.',
        parameters: { type: 'object', properties: {}, required: [] },
        handler: () => buyNow(),
      },

      {
        name: 'jd.com.pay_now',
        tabDomain: 'pc-settlement-lite-pro.pf.jd.com',
        description: 'Select payment method and click "立即支付" (Pay Now) button on the JD.com checkout confirmation page. Must be called after buy_now when the settlement page is open.',
        parameters: {
          type: 'object',
          properties: {
            paymentMethod: {
              type: 'string',
              description: 'Payment method to use. Options: "京东支付", "京东白条", "微信支付", "云闪付", "APP支付"',
              enum: ['京东支付', '京东白条', '微信支付', '云闪付', 'APP支付'],
            },
          },
          required: ['paymentMethod'],
        },
        handler: (args) => payNow(args),
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
  var support = window.__webmcpGeneratedSupport["jd.com"];
  if (support && Array.isArray(support.tools)) {
    for (var k = 0; k < support.tools.length; k++) if (support.tools[k] && typeof support.tools[k].handler === 'function') tools.push(support.tools[k]);
  }
  var byName = Object.create(null);
  for (var n = 0; n < tools.length; n++) {
    var tool = tools[n];
    var names = [tool.publicName, tool.name, tool.handlerName];
    for (var z = 0; z < names.length; z++) if (typeof names[z] === 'string' && names[z] && !byName[names[z]]) byName[names[z]] = tool;
  }
  window["__jd_com_internal"] = {
    invoke: async function (publicName, params) {
      var tool = byName[publicName];
      if (!tool || typeof tool.handler !== 'function') throw new Error('Legacy handler unavailable for ' + "jd.com" + '.' + publicName);
      return tool.handler(params || {});
    },
    names: Object.keys(byName)
  };
})();
