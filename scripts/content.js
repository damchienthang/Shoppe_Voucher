/**
 * Content Script for Shopee.vn
 * Injects a floating helper widget, auto-detects voucher buttons, and provides full page auto-claim.
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__shopee_voucher_autosaver_injected__) return;
  window.__shopee_voucher_autosaver_injected__ = true;

  // State
  let isScanning = false;
  let shouldStopScan = false;

  // Insert floating quick-action widget
  function injectFloatingWidget() {
    if (document.getElementById('sv-floating-widget')) return;

    const widget = document.createElement('div');
    widget.id = 'sv-floating-widget';
    widget.innerHTML = `
      <div class="sv-widget-container">
        <button id="sv-widget-toggle" class="sv-pulse" title="Shopee Voucher Auto-Saver">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
            <line x1="7" y1="7" x2="7.01" y2="7"></line>
          </svg>
        </button>

        <div id="sv-widget-panel" class="sv-panel-hidden">
          <div class="sv-panel-header">
            <div class="sv-brand">
              <span class="sv-logo-badge">S</span>
              <div>
                <div class="sv-title">Voucher Auto-Saver</div>
                <div class="sv-subtitle">Trợ lý săn mã Shopee</div>
              </div>
            </div>
            <button id="sv-panel-close" class="sv-icon-btn">&times;</button>
          </div>

          <div class="sv-panel-body">
            <div class="sv-stat-card">
              <div class="sv-stat-label">Voucher phát hiện trên trang</div>
              <div id="sv-detected-count" class="sv-stat-val">0</div>
            </div>

            <div class="sv-action-group">
              <button id="sv-btn-collect-all" class="sv-btn sv-btn-primary">
                Lưu toàn bộ trên trang
              </button>
              
              <button id="sv-btn-scroll-collect" class="sv-btn sv-btn-secondary">
                Tự cuộn & Quét toàn trang
              </button>

              <button id="sv-btn-open-dashboard" class="sv-btn sv-btn-outline">
                Mở Bảng Điều Khiển
              </button>
            </div>

            <div id="sv-scan-status" class="sv-scan-status sv-status-hidden">
              <div class="sv-spinner"></div>
              <span id="sv-status-text">Đang quét...</span>
            </div>
          </div>
        </div>
      </div>
    `;

    // Inject Styles
    const style = document.createElement('style');
    style.textContent = `
      #sv-floating-widget {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }
      .sv-widget-container {
        position: relative;
      }
      #sv-widget-toggle {
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: linear-gradient(135deg, #FF5722 0%, #EE4D2D 100%);
        color: white;
        border: none;
        box-shadow: 0 4px 18px rgba(238, 77, 45, 0.45);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s;
      }
      #sv-widget-toggle:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 24px rgba(238, 77, 45, 0.6);
      }
      .sv-pulse {
        animation: svPulse 2s infinite;
      }
      @keyframes svPulse {
        0% { box-shadow: 0 0 0 0 rgba(238, 77, 45, 0.6); }
        70% { box-shadow: 0 0 0 14px rgba(238, 77, 45, 0); }
        100% { box-shadow: 0 0 0 0 rgba(238, 77, 45, 0); }
      }
      #sv-widget-panel {
        position: absolute;
        bottom: 60px;
        right: 0;
        width: 320px;
        background: rgba(26, 26, 36, 0.96);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 16px;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
        color: #ffffff;
        overflow: hidden;
        transition: all 0.25s ease-in-out;
        transform-origin: bottom right;
      }
      .sv-panel-hidden {
        opacity: 0;
        transform: scale(0.85);
        pointer-events: none;
      }
      .sv-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.02);
      }
      .sv-brand {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .sv-logo-badge {
        font-size: 18px;
        background: rgba(238, 77, 45, 0.2);
        padding: 4px 6px;
        border-radius: 8px;
      }
      .sv-title {
        font-weight: 700;
        font-size: 14px;
        color: #fff;
      }
      .sv-subtitle {
        font-size: 11px;
        color: #9ca3af;
      }
      .sv-icon-btn {
        background: transparent;
        border: none;
        color: #9ca3af;
        font-size: 20px;
        cursor: pointer;
        line-height: 1;
        padding: 4px;
      }
      .sv-icon-btn:hover {
        color: #ffffff;
      }
      .sv-panel-body {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .sv-stat-card {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        padding: 10px 14px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .sv-stat-label {
        font-size: 12px;
        color: #d1d5db;
      }
      .sv-stat-val {
        font-size: 18px;
        font-weight: 700;
        color: #FF5722;
      }
      .sv-action-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .sv-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        border: none;
      }
      .sv-btn-primary {
        background: linear-gradient(135deg, #FF5722 0%, #EE4D2D 100%);
        color: white;
      }
      .sv-btn-primary:hover {
        filter: brightness(1.1);
        transform: translateY(-1px);
      }
      .sv-btn-secondary {
        background: rgba(255, 255, 255, 0.1);
        color: white;
      }
      .sv-btn-secondary:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      .sv-btn-outline {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #d1d5db;
      }
      .sv-btn-outline:hover {
        border-color: #FF5722;
        color: #FF5722;
      }
      .sv-scan-status {
        display: flex;
        align-items: center;
        gap: 10px;
        background: rgba(238, 77, 45, 0.15);
        border: 1px solid rgba(238, 77, 45, 0.3);
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 12px;
        color: #ff9178;
      }
      .sv-status-hidden {
        display: none;
      }
      .sv-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-top-color: #FF5722;
        border-radius: 50%;
        animation: svSpin 0.8s linear infinite;
      }
      @keyframes svSpin {
        to { transform: rotate(360deg); }
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(widget);

    // Event Listeners
    const toggleBtn = document.getElementById('sv-widget-toggle');
    const panel = document.getElementById('sv-widget-panel');
    const closeBtn = document.getElementById('sv-panel-close');
    const collectAllBtn = document.getElementById('sv-btn-collect-all');
    const scrollCollectBtn = document.getElementById('sv-btn-scroll-collect');
    const openDashBtn = document.getElementById('sv-btn-open-dashboard');

    makeDraggable(widget, toggleBtn, 'shopeeWidgetPos');

    toggleBtn.addEventListener('click', () => {
      panel.classList.toggle('sv-panel-hidden');
      updateDetectedCount();
    });

    closeBtn.addEventListener('click', () => {
      panel.classList.add('sv-panel-hidden');
    });

    collectAllBtn.addEventListener('click', () => {
      collectVisibleVouchers();
    });

    scrollCollectBtn.addEventListener('click', () => {
      if (isScanning) {
        shouldStopScan = true;
        setScanStatus('Đã dừng quét');
      } else {
        autoScrollAndCollect();
      }
    });

    openDashBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    });

    // Auto-detect count on page changes
    setInterval(updateDetectedCount, 2500);
  }

  function makeDraggable(container, handle, storageKey = 'shopeeWidgetPos') {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let hasMoved = false;

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        chrome.storage.local.get([storageKey], (res) => {
          if (res && res[storageKey]) {
            const { left, top } = res[storageKey];
            const maxLeft = Math.max(0, window.innerWidth - 60);
            const maxTop = Math.max(0, window.innerHeight - 60);
            const boundedLeft = Math.min(Math.max(10, left), maxLeft - 10);
            const boundedTop = Math.min(Math.max(10, top), maxTop - 10);
            container.style.bottom = 'auto';
            container.style.right = 'auto';
            container.style.left = `${boundedLeft}px`;
            container.style.top = `${boundedTop}px`;
          }
        });
      }
    } catch (e) {}

    handle.addEventListener('pointerdown', (e) => {
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;

      const rect = container.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      container.style.bottom = 'auto';
      container.style.right = 'auto';
      container.style.left = `${startLeft}px`;
      container.style.top = `${startTop}px`;

      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', (e) => {
      if (!isDragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMoved = true;
      }

      let newLeft = startLeft + dx;
      let newTop = startTop + dy;

      const maxLeft = Math.max(0, window.innerWidth - 60);
      const maxTop = Math.max(0, window.innerHeight - 60);
      newLeft = Math.min(Math.max(4, newLeft), maxLeft - 4);
      newTop = Math.min(Math.max(4, newTop), maxTop - 4);

      container.style.left = `${newLeft}px`;
      container.style.top = `${newTop}px`;
    });

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;

      try {
        handle.releasePointerCapture(e.pointerId);
      } catch (err) {}

      if (hasMoved) {
        e.stopPropagation();
        const rect = container.getBoundingClientRect();
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
            chrome.storage.local.set({
              [storageKey]: { left: Math.round(rect.left), top: Math.round(rect.top) }
            });
          }
        } catch (err) {}
      }
    };

    handle.addEventListener('pointerup', onPointerUp, true);
    handle.addEventListener('pointercancel', onPointerUp, true);

    handle.addEventListener('click', (e) => {
      if (hasMoved) {
        e.stopImmediatePropagation();
        e.preventDefault();
        hasMoved = false;
      }
    }, true);
  }

  /**
   * Dispatch full pointer & mouse event chain to trigger modern React / Vue event listeners reliably
   */
  function triggerRobustClick(element) {
    if (!element) return;
    try {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const mouseOpts = { bubbles: true, cancelable: true, view: window };
      element.dispatchEvent(new PointerEvent('pointerdown', mouseOpts));
      element.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
      element.dispatchEvent(new PointerEvent('pointerup', mouseOpts));
      element.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
      element.dispatchEvent(new MouseEvent('click', mouseOpts));
      if (typeof element.click === 'function') {
        element.click();
      }
    } catch (e) {
      try { element.click(); } catch (err) {}
    }
  }

  /**
   * Find claim buttons on Shopee landing and banner pages
   */
  function findVoucherButtons() {
    const buttons = [];
    const elements = document.querySelectorAll(
      'button, div[role="button"], span[role="button"], a, ' +
      '.shopee-button-outline, .voucher-card__button, .voucher-ticket-action, ' +
      '[class*="voucher"] button, [class*="claim"], [class*="collect"]'
    );

    const claimKeywords = [
      'lưu', 'lưu ngay', 'lưu mã', 'lưu voucher', 'lấy mã', 'lấy voucher',
      'nhận', 'nhận ngay', 'nhận mã', 'nhận voucher', 'thu thập', 'thu thập ngay',
      'lưu tất cả', 'nhận tất cả', 'claim', 'get voucher'
    ];

    const rejectKeywords = [
      'đã lưu', 'đã nhận', 'đã thu thập', 'hết lượt', 'hết mã', 'claimed', 'used',
      'lưu ý', 'lưu trữ', 'lưu ý khi', 'điều kiện', 'thể lệ', 'chi tiết', 'xem thêm'
    ];

    for (let el of elements) {
      if (el.closest('#sv-floating-widget')) continue;

      const rawText = (el.innerText || el.textContent || '').trim().toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      const title = (el.getAttribute('title') || '').trim().toLowerCase();
      const combinedText = `${rawText} ${ariaLabel} ${title}`.trim();

      if (!combinedText) continue;

      // Reject already claimed, out of stock, or info buttons (like "Lưu ý")
      const isRejected = rejectKeywords.some(rk => combinedText.includes(rk));
      if (isRejected) continue;

      // Match claim keywords with boundary check
      const isClaimText = claimKeywords.some(kw => {
        if (combinedText === kw) return true;
        const regex = new RegExp(`(^|\\s|[^a-z0-9àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ])${kw}($|\\s|[^a-z0-9àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ])`, 'i');
        return regex.test(combinedText);
      });

      const isDisabled = el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled');

      if (isClaimText && !isDisabled) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          buttons.push(el);
        }
      }
    }

    return buttons;
  }

  function updateDetectedCount() {
    const countEl = document.getElementById('sv-detected-count');
    if (countEl) {
      const btns = findVoucherButtons();
      countEl.textContent = btns.length;
    }
  }

  function setScanStatus(text, showSpinner = false) {
    const statusBox = document.getElementById('sv-scan-status');
    const statusText = document.getElementById('sv-status-text');
    const spinner = statusBox?.querySelector('.sv-spinner');

    if (!statusBox || !statusText) return;

    if (!text) {
      statusBox.classList.add('sv-status-hidden');
      return;
    }

    statusBox.classList.remove('sv-status-hidden');
    statusText.textContent = text;
    if (spinner) {
      spinner.style.display = showSpinner ? 'block' : 'none';
    }
  }

  /**
   * Collect all currently visible voucher buttons
   */
  async function collectVisibleVouchers() {
    const buttons = findVoucherButtons();
    if (buttons.length === 0) {
      setScanStatus('Không tìm thấy nút lưu nào!', false);
      setTimeout(() => setScanStatus(''), 3000);
      return 0;
    }

    setScanStatus(`Đang lưu ${buttons.length} voucher...`, true);
    let success = 0;

    for (let i = 0; i < buttons.length; i++) {
      try {
        const btn = buttons[i];
        triggerRobustClick(btn);
        success++;
        setScanStatus(`Đang lưu ${i + 1}/${buttons.length}...`, true);
        await new Promise(r => setTimeout(r, 900 + Math.floor(Math.random() * 500)));
      } catch (e) {
        console.warn('Click error:', e);
      }
    }

    setScanStatus(`✅ Đã bấm lưu ${success} voucher!`, false);
    setTimeout(() => {
      setScanStatus('');
      updateDetectedCount();
    }, 4000);
    return success;
  }

  /**
   * Automatically scroll down to bottom, loading all lazy voucher banners and collecting them
   */
  async function autoScrollAndCollect() {
    isScanning = true;
    shouldStopScan = false;
    const scrollBtn = document.getElementById('sv-btn-scroll-collect');
    if (scrollBtn) {
      scrollBtn.textContent = '⏹ Dừng quét trang';
    }

    setScanStatus('Đang cuộn trang để tìm voucher...', true);

    let totalClaimed = 0;
    const scrollStep = 450;
    const maxScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 2500);
    let currentScroll = 0;
    const clickedElements = new WeakSet();

    while (currentScroll < maxScroll && !shouldStopScan) {
      window.scrollBy({ top: scrollStep, behavior: 'smooth' });
      currentScroll += scrollStep;
      await new Promise(r => setTimeout(r, 300));

      const btns = findVoucherButtons();
      updateDetectedCount();

      if (btns.length > 0) {
        for (let btn of btns) {
          if (shouldStopScan) break;
          if (!clickedElements.has(btn)) {
            clickedElements.add(btn);
            triggerRobustClick(btn);
            totalClaimed++;
            setScanStatus(`Đã lưu ${totalClaimed} voucher...`, true);
            await new Promise(r => setTimeout(r, 900 + Math.floor(Math.random() * 500)));
          }
        }
      }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });

    isScanning = false;
    if (scrollBtn) {
      scrollBtn.textContent = 'Tự cuộn & Quét toàn trang';
    }

    setScanStatus(`Hoàn tất! Đã lưu tổng cộng ${totalClaimed} voucher.`, false);
    setTimeout(() => {
      setScanStatus('');
      updateDetectedCount();
    }, 4000);
  }

  let isAutoClaiming = false;

  /**
   * Unified auto-claim procedure optimized for Shopee SPA dynamic loading & lazy banners
   */
  async function startAutoClaimProcess(source = 'unknown') {
    if (isAutoClaiming) {
      console.log(`[Shopee Saver] Đang trong tiến trình lưu, bỏ qua kích hoạt từ ${source}`);
      return 0;
    }
    isAutoClaiming = true;
    console.log(`[Shopee Saver] 🚀 Bắt đầu tự động lưu voucher (kích hoạt từ: ${source})...`);
    setScanStatus('🚀 Đang quét và tự động lưu voucher...', true);

    let totalSaved = 0;
    const clickedElements = new WeakSet();

    const sweepAndClick = async () => {
      const btns = findVoucherButtons();
      let newlyClicked = 0;
      for (const btn of btns) {
        if (!clickedElements.has(btn)) {
          clickedElements.add(btn);
          triggerRobustClick(btn);
          newlyClicked++;
          totalSaved++;
          setScanStatus(`Đang lưu voucher (${totalSaved})... Đang chờ phản hồi Shopee`, true);

          // Human-safe pacing: wait 1200ms - 1800ms after each click to allow Shopee network response & toast to render
          await new Promise(r => setTimeout(r, 1200 + Math.floor(Math.random() * 500)));

          // Scan for feedback toast from Shopee
          const toastEls = Array.from(document.querySelectorAll('.shopee-alert-popup, .shopee-toast, div[role="alert"], [class*="toast" i], [class*="alert" i]'));
          for (const t of toastEls) {
            if (t.closest('#sv-floating-widget')) continue;
            const text = (t.innerText || t.textContent || '').trim();
            if (text && text.length > 3) {
              setScanStatus(`Shopee: "${text.slice(0, 45)}"`, true);
              break;
            }
          }
        }
      }
      return newlyClicked;
    };

    // Initial wait for dynamic SPA rendering (1.5s)
    await new Promise(r => setTimeout(r, 1500));

    // Phase 1: Initial sweep of visible vouchers
    await sweepAndClick();

    // Phase 2: Incremental calm scroll to reveal lazy-loaded voucher banners
    const scrollStep = 450;
    const maxScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 2500);
    let currentScroll = 0;

    while (currentScroll < maxScroll) {
      window.scrollBy({ top: scrollStep, behavior: 'smooth' });
      currentScroll += scrollStep;
      await new Promise(r => setTimeout(r, 600)); // Calm scroll pace
      await sweepAndClick();
    }

    // Final sweep at bottom
    await new Promise(r => setTimeout(r, 800));
    await sweepAndClick();

    // Scroll back to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    setScanStatus(totalSaved > 0 ? `✅ Đã lưu thành công ${totalSaved} voucher!` : 'Hoàn tất quét trang!', false);
    updateDetectedCount();

    // Give UI 2 seconds so notifications finish displaying clearly before closing
    await new Promise(r => setTimeout(r, 2000));

    // Notify background script that claim is completed
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'AUTO_CLAIM_FINISHED',
          count: totalSaved,
          url: window.location.href
        });
      }
    } catch (e) {}

    setTimeout(() => {
      setScanStatus('');
      isAutoClaiming = false;
    }, 4000);

    return totalSaved;
  }

  // Check if opened via Auto-Claim (from link or background trigger)
  function checkAutoClaimTrigger() {
    const hasHash = window.location.hash.includes('sv_autoclaim');
    const hasQuery = window.location.search.includes('sv_autoclaim');
    const hasSession = sessionStorage.getItem('sv_autoclaim') === 'true';
    const hasGlobal = window.__SV_AUTOCLAIM_TRIGGERED__ === true;

    if (hasHash || hasQuery || hasSession || hasGlobal) {
      try { sessionStorage.removeItem('sv_autoclaim'); } catch (e) {}
      startAutoClaimProcess(hasHash ? 'URL Hash' : hasQuery ? 'URL Query' : 'Auto Trigger');
    }
  }

  // Listen for CustomEvent dispatched via scripting.executeScript fallback
  window.addEventListener('sv-trigger-autoclaim', () => {
    startAutoClaimProcess('CustomEvent');
  });

  // Initialize on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectFloatingWidget();
      checkAutoClaimTrigger();
    });
  } else {
    injectFloatingWidget();
    checkAutoClaimTrigger();
  }

  /**
   * Fetch vouchers directly from Shopee page context (guaranteed native cookies & session)
   */
  async function fetchWalletFromPageContext() {
    const endpoints = [
      '/api/v4/voucher/get_user_vouchers?offset=0&limit=100&status=1',
      '/api/v4/voucher/get_user_vouchers_by_category?category_id=0&offset=0&limit=100',
      '/api/v2/voucher_wallet/get_user_vouchers?offset=0&limit=100&status=1'
    ];

    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, {
          method: 'GET',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'x-shopee-language': 'vi',
            'x-requested-with': 'XMLHttpRequest',
            'x-api-source': 'pc'
          },
          credentials: 'include'
        });

        if (res.ok) {
          const data = await res.json();
          let rawList = [];
          if (data && data.data) {
            if (Array.isArray(data.data.user_voucher_list)) rawList = data.data.user_voucher_list;
            else if (Array.isArray(data.data.vouchers)) rawList = data.data.vouchers;
            else if (Array.isArray(data.data.voucher_info_list)) rawList = data.data.voucher_info_list;
            else if (Array.isArray(data.data.list)) rawList = data.data.list;
            else if (Array.isArray(data.data)) rawList = data.data;
          }

          if (rawList && rawList.length > 0) {
            const normalized = rawList.map(v => {
              const info = v.voucher_info || v;
              return {
                voucher_code: v.voucher_code || info.voucher_code || v.code || 'VOUCHER',
                title: v.title || info.title || info.voucher_name || info.name || 'Mã giảm giá Shopee',
                min_spend: v.min_spend || info.min_spend || info.min_order_amount || '',
                discount_value: v.discount_value || info.discount_value || info.discount_percentage || '',
                end_time: v.end_time || info.end_time || info.expire_time || 0,
                shop_id: v.shop_id || info.shop_id || 0,
                shop_name: v.shop_name || info.shop_name || '',
                icon_url: v.icon_url || info.icon_url || '',
                usage_terms: v.usage_terms || info.usage_terms || ''
              };
            });

            // Cache to local storage
            chrome.storage.local.set({
              cachedWalletVouchers: normalized,
              walletLastSynced: Date.now()
            });

            return { vouchers: normalized, total: normalized.length, source: 'page_fetch' };
          }
        }
      } catch (err) {
        // Try next endpoint
      }
    }

    return { vouchers: [], total: 0 };
  }

  // If on user/voucher-wallet page, auto sync immediately
  if (window.location.href.includes('/user/voucher-wallet')) {
    setTimeout(fetchWalletFromPageContext, 1500);
  }

  /**
   * Get user info from page context
   */
  async function getUserInfoFromPage() {
    try {
      const res = await fetch('/api/v4/account/basic/get_account_info', {
        headers: { 'x-api-source': 'pc', 'x-requested-with': 'XMLHttpRequest' },
        credentials: 'include'
      });
      if (res.ok) {
        const json = await res.json();
        const info = json?.data || json;
        if (info && (info.username || info.userid || info.shopid || info.phone)) {
          return {
            isLoggedIn: true,
            username: info.username || (info.phone ? `Shopee (${info.phone})` : `User ${info.userid}`),
            avatar: info.avatar ? `https://cf.shopee.vn/file/${info.avatar}` : null,
            userId: info.userid || info.shopid || 'Shopee VN'
          };
        }
      }
    } catch (e) {}

    // Fallback: check username element in navbar
    try {
      const userEl = document.querySelector('.navbar__username, .shopee-avatar__placeholder, [href^="/user/account"]');
      if (userEl) {
        const name = (userEl.innerText || userEl.textContent || '').trim();
        if (name) {
          return { isLoggedIn: true, username: name, userId: 'Shopee VN' };
        }
      }
    } catch (e) {}

    return { isLoggedIn: false };
  }

  /**
   * Save a single voucher code inside the Shopee page context (same-origin, 100% no CORS)
   */
  async function saveVoucherFromPageContext(voucherCode) {
    const cleanCode = (voucherCode || '').trim().toUpperCase();
    if (!cleanCode) {
      return { success: false, code: cleanCode, errCode: -1, message: 'Mã không hợp lệ' };
    }

    try {
      const match = document.cookie.match(/csrftoken=([^;]+)/);
      const csrfToken = match ? match[1] : '';

      const sourceAttempts = [
        { apiSource: 'rn', callerSource: 'RN_SHOPEE', label: 'Shopee App RN' },
        { apiSource: 'app', callerSource: 'APP_SHOPEE', label: 'Shopee App' },
        { apiSource: 'pc', callerSource: 'MICROSITE_SHOPEE', label: 'Shopee Web' }
      ];

      let lastData = null;

      for (const attempt of sourceAttempts) {
        const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'x-shopee-language': 'vi',
          'x-requested-with': attempt.apiSource === 'pc' ? 'XMLHttpRequest' : 'com.shopee.vn',
          'x-api-source': attempt.apiSource,
          'referer': window.location.href || 'https://shopee.vn/user/voucher-wallet'
        };
        if (csrfToken) {
          headers['x-csrftoken'] = csrfToken;
        }

        try {
          const res = await fetch('/api/v2/voucher_wallet/save_voucher', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              voucher_code: cleanCode,
              need_user_voucher_status: true,
              caller_source: attempt.callerSource
            }),
            credentials: 'include'
          });

          const data = await res.json();
          lastData = data;

          if (data.error === 0) {
            return {
              success: true,
              code: cleanCode,
              errCode: 0,
              message: `Lưu thành công vào ví (${attempt.label})!`,
              voucherData: data.data
            };
          }

          if (data.error === 3 || data.error === 140003) {
            return {
              success: true,
              alreadySaved: true,
              code: cleanCode,
              errCode: data.error,
              message: 'Mã voucher đã có sẵn trong ví của bạn!',
              voucherData: data.data
            };
          }

          // Try active microsite v4 endpoint
          try {
            const resV4 = await fetch('/api/v4/microsite/save_voucher', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                voucher_code: cleanCode,
                caller_source: attempt.callerSource
              }),
              credentials: 'include'
            });
            const dataV4 = await resV4.json();
            if (dataV4 && dataV4.error === 0) {
              return {
                success: true,
                code: cleanCode,
                errCode: 0,
                message: `Lưu thành công vào ví (v4 ${attempt.label})!`,
                voucherData: dataV4.data
              };
            }
            if (dataV4 && (dataV4.error === 3 || dataV4.error === 140003)) {
              return {
                success: true,
                alreadySaved: true,
                code: cleanCode,
                errCode: dataV4.error,
                message: 'Mã voucher đã có sẵn trong ví của bạn!',
                voucherData: dataV4.data
              };
            }
          } catch (_) {}

          // Stop retrying on terminal non-recoverable errors (exhausted quota, already saved, invalid code, not started)
          if (
            data.error === 2 || data.error === 140002 ||
            data.error === 3 || data.error === 140003 ||
            data.error === 4 || data.error === 140004 ||
            data.error === 7
          ) {
            break;
          }

          // Small delay between fallback source attempts to avoid rate limiting
          await new Promise(r => setTimeout(r, 600 + Math.floor(Math.random() * 400)));
        } catch (_) {}
      }

      const data = lastData || { error: -1, message: 'Không thể kết nối' };

      const candidates = [
        data.data?.toast_message,
        data.data?.voucher_status_text,
        data.data?.user_voucher_status_text,
        data.data?.status_msg,
        data.data?.condition_msg,
        data.data?.ineligible_reason,
        data.data?.error_msg,
        data.data?.tooltip,
        data.data?.message,
        data.data?.msg,
        data.user_message,
        data.msg,
        data.message,
        data.error_msg
      ];
      const vietnameseRegex = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
      let rawShopeeMsg = '';
      for (const c of candidates) {
        if (typeof c === 'string' && c.trim() && vietnameseRegex.test(c)) {
          rawShopeeMsg = c.trim();
          break;
        }
      }
      if (!rawShopeeMsg) {
        const isGeneric = (str) => /^(not eligible(?: condition)?|error|failed|unknown error|system error|bad request)$/i.test(str.trim());
        for (const c of candidates) {
          if (typeof c === 'string' && c.trim() && !isGeneric(c)) {
            rawShopeeMsg = c.trim();
            break;
          }
        }
      }
      if (!rawShopeeMsg) {
        for (const c of candidates) {
          if (typeof c === 'string' && c.trim()) {
            rawShopeeMsg = c.trim();
            break;
          }
        }
      }

      // Always show Shopee's real message + error code — do NOT override with a generic message
      const errSuffix = (data.error && data.error !== 0) ? ` [mã lỗi: ${data.error}]` : '';
      const friendlyMsg = rawShopeeMsg
        ? `${rawShopeeMsg}${errSuffix}`
        : `Shopee từ chối lưu mã${errSuffix}`;
      return {
        success: false,
        code: cleanCode,
        errCode: data.error,
        message: friendlyMsg,
        rawShopeeMsg,
        rawError: data
      };
    } catch (err) {
      return {
        success: false,
        code: cleanCode,
        errCode: -999,
        message: `Lỗi kết nối trang: ${err.message}`
      };
    }
  }

  // Listen for runtime messages from Popup & Dashboard & Background
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type === 'START_AUTO_CLAIM') {
      startAutoClaimProcess(req.groupName || 'Background Signal').then(count => {
        sendResponse({ success: true, count });
      });
      return true;
    }
    if (req.type === 'PAGE_COLLECT_ALL') {
      collectVisibleVouchers().then(count => sendResponse({ count }));
      return true;
    }
    if (req.type === 'PAGE_SCROLL_COLLECT') {
      autoScrollAndCollect().then(() => sendResponse({ success: true }));
      return true;
    }
    if (req.type === 'PAGE_GET_VOUCHER_COUNT') {
      const count = findVoucherButtons().length;
      sendResponse({ count });
      return false;
    }
    if (req.type === 'PAGE_FETCH_WALLET_VOUCHERS') {
      fetchWalletFromPageContext().then(sendResponse);
      return true;
    }
    if (req.type === 'PAGE_GET_USER_INFO') {
      getUserInfoFromPage().then(sendResponse);
      return true;
    }
    if (req.type === 'PAGE_SAVE_VOUCHER_CODE') {
      saveVoucherFromPageContext(req.code).then(sendResponse);
      return true;
    }
  });

})();
