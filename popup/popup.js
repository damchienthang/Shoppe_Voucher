import { extractVoucherCodes } from '../utils/parser.js';

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const userStatusEl = document.getElementById('user-status');
  const userNameEl = document.getElementById('user-name');
  const serverTimeEl = document.getElementById('server-time');
  const quickCodesInput = document.getElementById('quick-codes');
  const detectedCountEl = document.getElementById('detected-code-count');
  const clearInputBtn = document.getElementById('btn-clear-input');
  const startBatchBtn = document.getElementById('btn-start-batch');
  const progressBox = document.getElementById('quick-progress-box');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressStatusText = document.getElementById('progress-status-text');
  const progressPercent = document.getElementById('progress-percent');
  const resultsContainer = document.getElementById('quick-results-container');
  const resultsList = document.getElementById('quick-results-list');
  const btnOpenDashboard = document.getElementById('btn-open-dashboard');
  const btnViewWallet = document.getElementById('btn-view-wallet');
  const btnOpenScheduler = document.getElementById('btn-open-scheduler');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  // Page Tab Elements
  const pageVoucherCountEl = document.getElementById('page-voucher-count');
  const btnPageCollect = document.getElementById('btn-page-collect');
  const btnPageScroll = document.getElementById('btn-page-scroll');
  const pageActionMsg = document.getElementById('page-action-msg');

  // Theme Sync
  chrome.storage.local.get('dashboardTheme', ({ dashboardTheme }) => {
    if (dashboardTheme) {
      document.documentElement.setAttribute('data-theme', dashboardTheme);
    }
  });

  // Clock State
  let timeOffsetMs = 0;

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const targetTab = document.getElementById(btn.dataset.tab);
      if (targetTab) targetTab.classList.add('active');
      if (btn.dataset.tab === 'tab-page') {
        checkActiveTabVouchers();
      }
    });
  });

  // Open Dashboard
  const openDashboard = (initialTab = '') => {
    const url = initialTab ? `dashboard/dashboard.html#${initialTab}` : 'dashboard/dashboard.html';
    chrome.tabs.create({ url: chrome.runtime.getURL(url) });
  };

  btnOpenDashboard.addEventListener('click', () => openDashboard());
  btnViewWallet.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://shopee.vn/user/voucher-wallet' });
  });
  btnOpenScheduler.addEventListener('click', () => openDashboard('tab-scheduler'));

  // Initialize Login Check & Server Time
  initAuthAndClock();

  // Input parsing
  quickCodesInput.addEventListener('input', () => {
    const parsed = extractVoucherCodes(quickCodesInput.value);
    detectedCountEl.textContent = parsed.length;
    startBatchBtn.disabled = parsed.length === 0;
  });

  clearInputBtn.addEventListener('click', () => {
    quickCodesInput.value = '';
    detectedCountEl.textContent = '0';
    startBatchBtn.disabled = true;
    resultsContainer.classList.add('hidden');
    progressBox.classList.add('hidden');
    resultsList.innerHTML = '';
  });

  // Batch Save Trigger
  startBatchBtn.addEventListener('click', async () => {
    const parsed = extractVoucherCodes(quickCodesInput.value);
    if (parsed.length === 0) return;

    const codes = parsed.map(item => item.code);
    startBatchBtn.disabled = true;
    progressBox.classList.remove('hidden');
    resultsContainer.classList.remove('hidden');
    resultsList.innerHTML = '';
    progressBarFill.style.width = '0%';
    progressStatusText.textContent = `Đang bắt đầu lưu ${codes.length} mã...`;
    progressPercent.textContent = `0/${codes.length}`;

    // Get delay settings
    const { batchDelay = 1800 } = await chrome.storage.local.get('batchDelay');

    chrome.runtime.sendMessage({
      type: 'START_BATCH_SAVE',
      payload: {
        codes,
        delayMs: Number(batchDelay)
      }
    }, response => {
      startBatchBtn.disabled = false;
      if (response && response.error) {
        progressStatusText.textContent = response.error;
      }
    });
  });

  // Listen to Runtime messages (progress from background)
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'BATCH_PROGRESS') {
      const pct = Math.round((msg.current / msg.total) * 100);
      progressBarFill.style.width = `${pct}%`;
      progressPercent.textContent = `${msg.current}/${msg.total}`;
      progressStatusText.textContent = `Đang lưu: ${msg.currentCode}...`;
    }

    if (msg.type === 'VOUCHER_RESULT') {
      appendResultItem(msg.result);
    }

    if (msg.type === 'BATCH_COMPLETED') {
      progressBarFill.style.width = '100%';
      const alreadyCount = msg.summary.alreadySavedCount || 0;
      const newlySaved = Math.max(0, (msg.summary.successCount || 0) - alreadyCount);
      const parts = [];
      if (newlySaved > 0) parts.push(`${newlySaved} lưu mới`);
      if (alreadyCount > 0) parts.push(`${alreadyCount} đã có trong ví`);
      if (msg.summary.failCount > 0) parts.push(`${msg.summary.failCount} thất bại`);
      progressStatusText.textContent = `Hoàn thành (${msg.summary.total} mã): ${parts.join(', ') || '0 thành công'}`;
      startBatchBtn.disabled = false;
    }
  });

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function appendResultItem(res) {
    const isAlreadySaved = Boolean(res.alreadySaved) || res.status === 'already_saved';
    const statusClass = isAlreadySaved ? 'info' : (res.success ? 'success' : 'failed');
    const statusLabel = isAlreadySaved ? 'Đã có trong ví' : (res.success ? 'Thành công' : 'Thất bại');
    const item = document.createElement('div');
    item.className = 'res-item';
    item.innerHTML = `
      <div class="res-item-top">
        <span class="res-code">${escapeHtml(res.code)}</span>
        <span class="res-badge ${statusClass}">${statusLabel}</span>
      </div>
      ${res.message ? `<div class="res-msg ${statusClass}">${escapeHtml(res.message)}</div>` : ''}
    `;
    resultsList.prepend(item);
  }

  // Active Page Tab Actions
  async function checkActiveTabVouchers() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.includes('shopee.vn')) {
        chrome.tabs.sendMessage(tab.id, { type: 'PAGE_GET_VOUCHER_COUNT' }, res => {
          if (chrome.runtime.lastError) return; // content script not ready yet
          if (res && typeof res.count === 'number') {
            pageVoucherCountEl.textContent = res.count;
          }
        });
      } else {
        pageVoucherCountEl.textContent = '0 (Không phải Shopee)';
      }
    } catch (e) {
      pageVoucherCountEl.textContent = '0';
    }
  }

  btnPageCollect.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('shopee.vn')) {
      showPageMsg('Vui lòng mở một trang trên shopee.vn để quét voucher!', true);
      return;
    }

    showPageMsg('Đang gửi lệnh lưu voucher trên trang...');
    chrome.tabs.sendMessage(tab.id, { type: 'PAGE_COLLECT_ALL' }, res => {
      if (chrome.runtime.lastError) {
        showPageMsg('Trang chưa sẵn sàng, hãy tải lại trang Shopee!', true);
        return;
      }
      if (res) {
        showPageMsg(`Đã kích hoạt lưu ${res.count || 0} voucher trên trang!`);
        checkActiveTabVouchers();
      }
    });
  });

  btnPageScroll.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('shopee.vn')) {
      showPageMsg('Vui lòng mở một trang trên shopee.vn để quét!', true);
      return;
    }

    showPageMsg('Đang tự động cuộn trang & lưu mã...');
    chrome.tabs.sendMessage(tab.id, { type: 'PAGE_SCROLL_COLLECT' }, () => {
      if (chrome.runtime.lastError) {
        showPageMsg('Trang chưa sẵn sàng, hãy tải lại trang Shopee!', true);
        return;
      }
      showPageMsg('Đang thực thi quét toàn trang!');
    });
  });

  function showPageMsg(text, isError = false) {
    pageActionMsg.textContent = text;
    pageActionMsg.className = `action-alert ${isError ? 'error' : 'success'}`;
  }

  // Auth & Clock Init
  async function initAuthAndClock() {
    // Get server time offset
    chrome.runtime.sendMessage({ type: 'GET_SERVER_TIME' }, res => {
      if (res && typeof res.offsetMs === 'number') {
        timeOffsetMs = res.offsetMs;
      }
    });

    // Start live clock
    setInterval(() => {
      const now = new Date(Date.now() + timeOffsetMs);
      const hours = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      const secs = String(now.getSeconds()).padStart(2, '0');
      serverTimeEl.textContent = `${hours}:${mins}:${secs}`;
    }, 500);

    // Check Login status
    chrome.runtime.sendMessage({ type: 'CHECK_LOGIN' }, res => {
      if (res && res.isLoggedIn) {
        userStatusEl.className = 'user-pill online';
        userNameEl.textContent = res.username || 'Đã đăng nhập Shopee';
      } else {
        userStatusEl.className = 'user-pill offline';
        userNameEl.textContent = 'Chưa đăng nhập Shopee';
      }
    });
  }
});
