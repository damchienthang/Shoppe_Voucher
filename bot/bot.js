/**
 * Shopee Voucher Auto-Saver - Standalone Node.js Background Bot (Cách 3)
 * Runs 24/7 in the background without needing user to keep Chrome open.
 * Uses Headless Chrome via puppeteer-core to sniff messages from Zalo group [23] LONGHOUSEE.
 * Automatically claims valid Shopee vouchers (>= 5 characters, alphanumeric only).
 * Exposes a Local API Server on http://127.0.0.1:23232 to integrate with the Dashboard.
 */

import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import {
  extractVoucherCodes,
  isOfficialShopeeAndVoucherRelated,
  isShopeeMessage,
  formatShopeeError,
  extractShopeeMessage
} from '../utils/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const BOT_DATA_DIR = path.join(__dirname, 'bot_data');
const SESSION_DIR = path.join(BOT_DATA_DIR, 'zalo_session');
const CONFIG_FILE = path.join(__dirname, 'bot_config.json');
const LOGS_FILE = path.join(BOT_DATA_DIR, 'bot_logs.json');

// Ensure directories exist
if (!fs.existsSync(BOT_DATA_DIR)) {
  fs.mkdirSync(BOT_DATA_DIR, { recursive: true });
}

// Load or initialize config
let config = {
  targetGroup: '[23] LONGHOUSEE',
  minCodeLength: 5,
  rejectSpecialChars: true,
  autoClaimCodes: true,
  autoClaimLinks: true,
  shopeeCookies: {
    SPC_EC: '',
    SPC_U: '',
    csrftoken: ''
  },
  localServerPort: 23232,
  isRunning: true,
  headless: true,
  // "bot" keeps Zalo isolated in bot_data/zalo_session. Set to "system" to
  // use an existing Chrome profile (Google login and installed extensions).
  chromeProfileMode: 'bot',
  chromeProfileDirectory: 'Default'
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config = { ...config, ...loaded };
  } catch (e) {
    console.warn('[BOT] Could not read bot_config.json, using defaults.');
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('[BOT] Error saving config:', e);
  }
}

// State
let browser = null;
let page = null;
let isZaloLoggedIn = false;
let isRunning = config.isRunning !== false;
const stats = {
  messagesDetected: 0,
  codesSaved: 0,
  linksDetected: 0
};
const recentLogs = [];

function log(msg, type = 'INFO') {
  const time = new Date().toLocaleTimeString('vi-VN');
  const date = new Date().toLocaleDateString('vi-VN');
  const line = `[${time}] [${type}] ${msg}`;
  console.log(line);

  const logItem = { time, date, type, message: msg };
  recentLogs.push(logItem);
  if (recentLogs.length > 100) recentLogs.shift();

  try {
    fs.appendFileSync(path.join(BOT_DATA_DIR, 'bot_history.log'), line + '\n', 'utf8');
  } catch (e) {}
}

/**
 * Show Windows Native Toast Notification
 */
function showWindowsNotification(title, message) {
  // Disabled per user request (silent operation)
}

/**
 * Locate Chrome executable on Windows
 */
function getChromePath() {
  const candidatePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Google Chrome executable not found on this system!');
}

function getChromeProfile() {
  if (config.chromeProfileMode === 'system') {
    const userDataDir = config.chromeUserDataDir || path.join(
      process.env.LOCALAPPDATA || '',
      'Google', 'Chrome', 'User Data'
    );
    return {
      userDataDir,
      profileDirectory: config.chromeProfileDirectory || 'Default',
      usingSystemProfile: true
    };
  }

  return { userDataDir: SESSION_DIR, profileDirectory: '', usingSystemProfile: false };
}

/**
 * Save Voucher Code to Shopee via API
 */
async function saveShopeeCode(voucherCode) {
  const cookies = config.shopeeCookies || {};
  if (!cookies.SPC_EC && !cookies.SPC_U) {
    log(`[Shopee] Chưa cấu hình Cookie Shopee! Bỏ qua lưu mã: ${voucherCode}`, 'WARN');
    return { success: false, message: 'Chưa cấu hình Cookie Shopee' };
  }

  const cookieHeader = Object.entries(cookies)
    .filter(([k, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  try {
    const res = await fetch('https://shopee.vn/api/v2/voucher_wallet/save_voucher', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-shopee-language': 'vi',
        'x-requested-with': 'XMLHttpRequest',
        'x-api-source': 'pc',
        'x-csrftoken': cookies.csrftoken || '',
        'Cookie': cookieHeader,
        'referer': 'https://shopee.vn/user/voucher-wallet'
      },
      body: JSON.stringify({
        voucher_code: voucherCode,
        need_user_voucher_status: true
      })
    });

    const data = await res.json();
    if (data.error === 0) {
      stats.codesSaved++;
      log(`Lưu mã thành công: ${voucherCode}`, 'SUCCESS');
      showWindowsNotification('Shopee Voucher Auto-Saver', `Đã lưu mã ${voucherCode} thành công vào ví!`);
      return {
        success: true,
        code: voucherCode,
        errCode: 0,
        message: 'Lưu thành công vào ví!',
        voucherData: data.data
      };
    } else {
      const rawShopeeMsg = extractShopeeMessage(data);
      const errMsg = formatShopeeError(data.error, rawShopeeMsg);
      log(`Không thể lưu mã [${voucherCode}]: ${errMsg}`, 'FAIL');
      showWindowsNotification('Không Thể Lưu Mã Voucher', `Mã [${voucherCode}]: ${errMsg}`);
      return {
        success: false,
        code: voucherCode,
        errCode: data.error,
        message: errMsg,
        rawShopeeMsg,
        voucherData: data.data,
        rawError: data
      };
    }
  } catch (err) {
    log(`Lỗi kết nối Shopee khi lưu [${voucherCode}]: ${err.message}`, 'ERROR');
    return { success: false, code: voucherCode, errCode: -999, message: err.message };
  }
}

/**
 * Handle incoming detected message from Zalo
 */
async function handleDetectedMessage(payload) {
  if (!isRunning) {
    log('Bot đang ở chế độ Tắt Chạy Ngầm (Tạm dừng xử lý tin nhắn).', 'DEBUG');
    return;
  }

  const { groupName, senderName, text, links = [], codes = [] } = payload;

  // Strict check: Group name
  if (!isTargetZaloGroup(groupName, config.targetGroup)) {
    return;
  }

  // Strict check: Shopee message only
  if (!isShopeeMessage(text, links, true)) {
    return;
  }

  stats.messagesDetected++;
  log(`Nhận tin nhắn từ [${groupName}] (${senderName}): "${text.slice(0, 80)}..."`);

  // Process Codes
  if (config.autoClaimCodes && codes.length > 0) {
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      log(`Tiến hành lưu mã voucher [${i + 1}/${codes.length}]: ${code}`);
      await saveShopeeCode(code);

      if (i < codes.length - 1) {
        const safeDelay = 2500 + Math.floor(Math.random() * 1000); // 2.5s - 3.5s (Tốc độ an toàn chống Shopee quét)
        log(`Tạm nghỉ an toàn ${safeDelay}ms trước khi lưu mã tiếp theo để chống Shopee quét và bắt kết quả...`);
        await new Promise(r => setTimeout(r, safeDelay));
      }
    }
  }

  // Process Links
  if (config.autoClaimLinks && links.length > 0) {
    stats.linksDetected += links.length;
    for (const link of links) {
      log(`Phát hiện đường link Shopee sự kiện: ${link}`);
      showWindowsNotification('Sự kiện Shopee từ Zalo', `Link nhận voucher: ${link}`);
    }
  }
}

/**
 * Start the Headless Puppeteer Zalo Client
 */
async function startZaloClient(forceVisible = false) {
  const chromePath = getChromePath();
  const chromeProfile = getChromeProfile();
  // Chrome extensions do not run in headless mode, so a system profile must
  // stay visible when the user asks to use their installed extensions.
  const isHeadless = !forceVisible && config.headless && !chromeProfile.usingSystemProfile;

  log(`Đang khởi động Chrome (${isHeadless ? 'Chạy ngầm - Headless' : 'Mở giao diện'}) tại: ${chromePath}`);

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: isHeadless ? 'new' : false,
    userDataDir: chromeProfile.userDataDir,
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-notifications',
      '--disable-infobars',
      '--window-size=1200,800',
      ...(chromeProfile.profileDirectory ? [`--profile-directory=${chromeProfile.profileDirectory}`] : [])
    ]
  });

  const pages = await browser.pages();
  page = pages.length > 0 ? pages[0] : await browser.newPage();

  // Stealth: Fake navigator.webdriver so Zalo does not block or show empty blank page
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  // Expose bridge function from browser page context to Node.js
  await page.exposeFunction('onZaloBotMessage', payload => {
    handleDetectedMessage(payload);
  });

  log('Đang kết nối tới chat.zalo.me...');
  await page.goto('https://chat.zalo.me', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});

  // Check login state
  const checkLogin = async () => {
    try {
      return await page.evaluate(() => {
        return !!document.querySelector('#header-chat-title, .conv-item, .chat-message, .card--text, [data-id="header-chat-title"]');
      });
    } catch (e) {
      return false;
    }
  };

  isZaloLoggedIn = await checkLogin();

  if (!isZaloLoggedIn) {
    if (isHeadless) {
      log('Chưa đăng nhập Zalo! Vui lòng khởi động bot với giao diện hiển thị để quét mã QR lần đầu.', 'WARN');
      log('Gợi ý tiện lợi: Bạn có thể bấm "Bật Chạy Ngầm" ngay trên Dashboard để chạy bằng tab ngầm trong Chrome!', 'TIP');
      await browser.close();
      return startZaloClient(true);
    } else {
      log('VUI LÒNG QUÉT MÃ QR TRÊN MÀN HÌNH ĐỂ ĐĂNG NHẬP ZALO (Chỉ cần làm đúng 1 lần đầu tiên)!', 'IMPORTANT');
      showWindowsNotification('Shopee Bot Zalo', 'Vui lòng quét mã QR Zalo trên màn hình để đăng nhập!');

      // Wait for login
      try {
        await page.waitForSelector('#header-chat-title, .conv-item, .chat-message', { timeout: 180000 });
        isZaloLoggedIn = true;
        log('Đăng nhập Zalo thành công! Phiên đã được lưu vĩnh viễn vào bot_data/zalo_session.', 'SUCCESS');
        showWindowsNotification('Shopee Bot Zalo', 'Đăng nhập thành công! Từ nay Bot sẽ tự động chạy ngầm.');
      } catch (e) {
        log('Quá thời gian quét mã QR. Vui lòng chạy lại bot để thử lại.', 'ERROR');
      }
    }
  } else {
    log('Đã đăng nhập Zalo thành công! Sẵn sàng lắng nghe tin nhắn chạy ngầm.', 'SUCCESS');
  }

  // Inject sniffer logic
  await injectSnifferScript(page);

  // Auto re-inject on navigation or refresh
  page.on('load', async () => {
    log('Zalo page reloaded, re-injecting sniffer...');
    await injectSnifferScript(page);
  });
}

/**
 * Inject the sniffer MutationObserver into the Zalo page context
 */
async function injectSnifferScript(targetPage) {
  try {
    await targetPage.evaluate((targetGroupName) => {
      if (window.__shopee_bot_sniffer_injected__) return;
      window.__shopee_bot_sniffer_injected__ = true;

      const processedHashes = new Set();
      const targetGroup = targetGroupName || '[23] LONGHOUSEE';

      const NOISE = new Set([
        'HTTP', 'HTTPS', 'SHOPEE', 'SHOPEEVN', 'SHOPPE', 'HTML', 'TRUE', 'FALSE', 'NULL',
        'TIKTOK', 'LAZADA', 'VIETNAM', 'ZALO', 'ADMIN', 'LINK', 'COPY', 'GROUP',
        'MA-GIAM-GIA', 'NHANH', 'VIP', 'LONGHOUSE', 'LONGHOUSEE', 'ACCESSTRADE', 'SHORTEN',
        'BACK', 'SHOPEEVIP', 'SVIP', 'MAX', 'MIN', 'LUOT', 'LUU', 'LƯU', 'TAI', 'TẠI',
        'GIAM', 'GIẢM', 'DUNG', 'DÙNG', 'DON', 'ĐƠN', 'TIEN', 'TIỀN', 'CHECK', 'APP', 'WEB'
      ]);

      function getActiveChatName() {
        const headerSelectors = [
          '#header-chat-title', '[data-id="header-chat-title"]', '.header-title',
          '.conv-header__title', '.chat-title', '.chat-info__name', '[data-translate-inner="chat_title"]'
        ];
        for (const sel of headerSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const t = (el.innerText || el.textContent || '').trim();
            if (t) return t;
          }
        }
        const activeItem = document.querySelector('.conv-item.active, .conversation-item.active, .chat-item.active');
        if (activeItem) {
          const n = activeItem.querySelector('.conv-item__name, .name, .title');
          const t = (n ? n.innerText : activeItem.innerText) || '';
          const c = t.split(/[\r\n]+/)[0].trim();
          if (c) return c;
        }
        const docTitle = document.title || '';
        if (docTitle && !docTitle.startsWith('Zalo Web')) {
          return docTitle.replace(/\s*-\s*Zalo\s*Web/i, '').replace(/^\(\d+\)\s*/, '').trim();
        }
        return '';
      }

      function extractCodes(text) {
        if (!text) return [];
        const codes = new Set();
        const cleanText = text.replace(/https?:\/\/[^\s<>"'()]+/gi, ' ');

        // Explicit pattern: Mã / Code / Back <CODE> (>= 5 characters, alphanumeric only)
        const explicitRegex = /(?:mã|code|nhập|voucher|nhap|back\s+mã|mã\s+back|back)[:\s]+([a-zA-Z0-9]{5,35})/gi;
        let m;
        while ((m = explicitRegex.exec(cleanText)) !== null) {
          const candidate = m[1].toUpperCase();
          if (candidate.length >= 5 && /^[A-Z0-9]+$/.test(candidate) && !NOISE.has(candidate) && !/^\d+$/.test(candidate)) {
            codes.add(candidate);
          }
        }

        // Token scan
        const tokens = cleanText.split(/[\s,;:|!?()\[\]{}"'\\\/&=<>#+*~`]+/);
        for (const t of tokens) {
          const clean = t.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').toUpperCase();
          if (
            clean.length >= 5 &&
            clean.length <= 35 &&
            /^[A-Z0-9]+$/.test(clean) &&
            !NOISE.has(clean) &&
            !/^\d+$/.test(clean) &&
            !/^\d+([KkĐđ%]|TR|VND)$/i.test(clean) &&
            (/\d/.test(clean) || clean.length >= 8)
          ) {
            codes.add(clean);
          }
        }
        return Array.from(codes);
      }

      function extractLinks(rawText) {
        const regex = /https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:shopee\.vn|shp\.ee|s\.shopee\.vn)[^\s<>"'()]+/gi;
        return rawText.match(regex) || [];
      }

      function processMsg(node) {
        const text = (node.innerText || node.textContent || '').trim();
        if (!text) return;

        const groupName = getActiveChatName();
        const codes = extractCodes(text);
        const links = extractLinks(text);

        if (codes.length === 0 && links.length === 0) return;

        const hash = `${text.slice(0, 100)}`;
        if (processedHashes.has(hash)) return;
        processedHashes.add(hash);
        if (processedHashes.size > 500) {
          const first = processedHashes.values().next().value;
          processedHashes.delete(first);
        }

        const senderEl = node.closest('.chat-message')?.querySelector('.sender-name, .author-name') || node.querySelector('.sender-name');
        const senderName = senderEl ? (senderEl.innerText || '').trim() : 'Thành viên';

        if (window.onZaloBotMessage) {
          window.onZaloBotMessage({
            groupName: groupName || targetGroup,
            senderName,
            text,
            codes,
            links
          });
        }
      }

      const observer = new MutationObserver(mutations => {
        for (const m of mutations) {
          if (m.addedNodes) {
            m.addedNodes.forEach(node => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const msgs = node.querySelectorAll ? node.querySelectorAll('.chat-message, .msg-view, .chat-item, .card--text') : [];
                if (msgs.length > 0) msgs.forEach(processMsg);
                else if (node.classList?.contains('chat-message') || node.classList?.contains('msg-view')) processMsg(node);
              }
            });
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      document.querySelectorAll('.chat-message, .msg-view, .chat-item, .card--text').forEach(processMsg);
    }, config.targetGroup);

    log('Đã tích hợp bộ lắng nghe tin nhắn vào Zalo thành công!');
  } catch (e) {
    log(`Lỗi khi inject sniffer: ${e.message}`, 'WARN');
  }
}

/**
 * Mini Local HTTP Server for Dashboard integration
 */
function startLocalServer() {
  const port = config.localServerPort || 23232;
  const server = http.createServer(async (req, res) => {
    // Enable CORS for Chrome Extension Dashboard
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://localhost:${port}`);

    // GET /status
    if (req.method === 'GET' && parsedUrl.pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        online: true,
        running: isRunning,
        isLoggedIn: isZaloLoggedIn,
        targetGroup: config.targetGroup,
        stats,
        recentLogs: recentLogs.slice(-15)
      }));
      return;
    }

    // POST /toggle (Bật / Tắt chạy ngầm)
    if (req.method === 'POST' && parsedUrl.pathname === '/toggle') {
      isRunning = !isRunning;
      config.isRunning = isRunning;
      saveConfig();
      log(`Người dùng đã chuyển trạng thái chạy ngầm: ${isRunning ? 'BẬT' : 'TẮT'}`, 'ACTION');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, running: isRunning }));
      return;
    }

    // POST /update_cookies (Đồng bộ cookie Shopee từ extension)
    if (req.method === 'POST' && parsedUrl.pathname === '/update_cookies') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data && typeof data === 'object') {
            config.shopeeCookies = { ...config.shopeeCookies, ...data };
            saveConfig();
            log('Đã nhận và cập nhật Cookie Shopee thành công từ Dashboard!', 'SUCCESS');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Cookies updated' }));
            return;
          }
        } catch (e) {}
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      });
      return;
    }

    // POST /save_voucher (Lưu voucher trực tiếp bằng Node.js - 0% CORS)
    if (req.method === 'POST' && parsedUrl.pathname === '/save_voucher') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { code } = JSON.parse(body);
          if (code) {
            const saveResult = await saveVoucher(code);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(saveResult));
            return;
          }
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
          return;
        }
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing code' }));
      });
      return;
    }

    // Default 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  });

  server.listen(port, '127.0.0.1', () => {
    log(`Mini Server điều khiển chạy tại: http://127.0.0.1:${port}`);
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      log(`Cổng ${port} đang được sử dụng bởi một tiến trình Bot khác.`, 'WARN');
    }
  });
}

// -------------------------------------------------------------
// MAIN ENTRY POINT
// -------------------------------------------------------------
console.log('====================================================');
console.log('   SHOPEE VOUCHER SNIFFER - BOT CHẠY NGẦM 24/7     ');
console.log('====================================================');
startLocalServer();
startZaloClient().catch(err => {
  log(`Lỗi khởi động Bot: ${err.message}`, 'FATAL');
});
