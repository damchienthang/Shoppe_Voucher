import {
  saveVoucherByCode,
  claimVoucherPromotion,
  checkLoginStatus,
  getShopeeServerTime,
  getUserVouchers,
  extractBannerSlug,
  fetchBannerCollections,
  queryCollectionsVouchers,
  claimBannerVoucher
} from './utils/shopee-api.js';

import {
  formatShopeeError,
  extractShopeeMessage,
  isShopeeMessage,
  isTargetZaloGroup,
  isAlreadySavedResult,
  normalizeSaveResult
} from './utils/parser.js';
import { createVoucherQueue } from './utils/voucher-queue.js';

// Keep track of active tasks & precise timers
let activeBatchTask = null;
let scheduledTimers = new Map();
const activeAutoClaimTabs = new Map();
let zaloQueueDelayMs = 6000;
let zaloVoucherQueue = null;
let zaloQueueInitPromise = null;

function getAllShopeeCookies() {
  return new Promise((resolve, reject) => {
    if (!chrome.cookies?.getAll) {
      reject(new Error('Quyền đọc cookie Shopee chưa khả dụng trong extension.'));
      return;
    }

    chrome.cookies.getAll({ url: 'https://shopee.vn/' }, cookies => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(cookies || []);
    });
  });
}

/**
 * Setup declarativeNetRequest rules to bypass CORS preflight and inject authentic Shopee headers
 */
async function setupDeclarativeNetRequestRules() {
  if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) {
    return;
  }
  try {
    const extOrigin = `chrome-extension://${chrome.runtime.id}`;
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1001, 1002],
      addRules: [
        {
          id: 1001,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'Access-Control-Allow-Origin', operation: 'set', value: extOrigin },
              { header: 'Access-Control-Allow-Credentials', operation: 'set', value: 'true' },
              { header: 'Access-Control-Allow-Headers', operation: 'set', value: '*' },
              { header: 'Access-Control-Allow-Methods', operation: 'set', value: 'GET, POST, OPTIONS, PUT, DELETE' }
            ]
          },
          condition: {
            urlFilter: '||shopee.vn/',
            resourceTypes: ['xmlhttprequest']
          }
        },
        {
          id: 1002,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Origin', operation: 'set', value: 'https://shopee.vn' },
              { header: 'Referer', operation: 'set', value: 'https://shopee.vn/user/voucher-wallet' }
            ]
          },
          condition: {
            urlFilter: '||shopee.vn/',
            resourceTypes: ['xmlhttprequest']
          }
        }
      ]
    });
    console.log('[Shopee Saver] declarativeNetRequest CORS rules registered successfully.');
  } catch (err) {
    console.warn('[Shopee Saver] Failed to register declarativeNetRequest rules:', err);
  }
}

/**
 * Re-inject Zalo content script into existing chat.zalo.me tabs on extension reload
 */
async function reinjectZaloTabs() {
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.scripting) {
      const tabs = await chrome.tabs.query({ url: '*://chat.zalo.me/*' }).catch(() => []);
      for (const tab of tabs) {
        if (tab && tab.id) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['zalo-content.js']
          }).catch(() => {});
        }
      }
    }
  } catch (_) {}
}

// Only run on install/update/startup — not redundantly on every SW activation
if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    setupDeclarativeNetRequestRules();
    cleanupShopeeTabs();
    reinjectZaloTabs();
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    setupDeclarativeNetRequestRules();
    cleanupShopeeTabs();
    reinjectZaloTabs();
  });
}

// State for temporary Shopee tab management
let tempShopeeTabId = null;
let creatingShopeeTabPromise = null;
let tempTabCloseTimeout = null;

/**
 * Schedule closing the temporary Shopee tab after a delay.
 * Prevents tab spam and leaves sufficient time for consecutive voucher saves.
 */
function scheduleCloseTempShopeeTab(delayMs = 2500) {
  if (tempTabCloseTimeout) {
    clearTimeout(tempTabCloseTimeout);
    tempTabCloseTimeout = null;
  }
  tempTabCloseTimeout = setTimeout(async () => {
    await closeTempShopeeTab();
  }, delayMs);
}

/**
 * Immediately close the temporary Shopee tab created by the extension.
 * Never closes user-opened tabs.
 */
async function closeTempShopeeTab() {
  if (tempTabCloseTimeout) {
    clearTimeout(tempTabCloseTimeout);
    tempTabCloseTimeout = null;
  }

  if (tempShopeeTabId !== null) {
    const idToClose = tempShopeeTabId;
    tempShopeeTabId = null;
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        await chrome.tabs.remove(idToClose);
        console.log(`[Shopee Saver] Đã tự động đóng tab Shopee tạm thời #${idToClose}`);
      }
    } catch (e) {
      // Tab may have already been closed by user
    }
  }
}

/**
 * Clean up existing duplicate background/pinned Shopee tabs on extension startup/load.
 * Unpins any tab and closes duplicate background wallet tabs.
 */
async function cleanupShopeeTabs() {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;
    const allTabs = await chrome.tabs.query({}).catch(() => []);
    const shopeeTabs = allTabs.filter(t => t.url && t.url.includes('shopee.vn'));

    // If any Shopee tab was previously pinned, unpin it
    for (const tab of shopeeTabs) {
      if (tab.pinned) {
        chrome.tabs.update(tab.id, { pinned: false }).catch(() => { });
      }
    }

    // If there are multiple inactive voucher-wallet tabs, close extra duplicates
    const walletTabs = shopeeTabs.filter(t => t.url && t.url.includes('voucher-wallet') && !t.active);
    if (walletTabs.length > 1) {
      // Keep only one, close the rest
      for (let i = 1; i < walletTabs.length; i++) {
        chrome.tabs.remove(walletTabs[i].id).catch(() => { });
      }
    }
  } catch (e) {
    console.warn('[Shopee Saver] cleanupShopeeTabs error:', e);
  }
}

// Track tab closures to avoid stale tempShopeeTabId
if (typeof chrome !== 'undefined' && chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener(tabId => {
    if (tabId === tempShopeeTabId) {
      tempShopeeTabId = null;
    }
  });
}

/**
 * Acquire a Shopee tab safely without pinning or duplicating tabs.
 * 1. Reuses user's already open Shopee tabs (isTemporary: false - never closed by extension).
 * 2. If no user tab exists, reuses or creates a SINGLE background tab (isTemporary: true - auto-closed after check).
 * 3. Uses mutex lock (creatingShopeeTabPromise) to prevent simultaneous multiple tab creations.
 */
async function acquireShopeeTab() {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs) return null;

    // Cancel pending auto-close since the tab is needed now
    if (tempTabCloseTimeout) {
      clearTimeout(tempTabCloseTimeout);
      tempTabCloseTimeout = null;
    }

    // 1. Check if user already has an active or open Shopee tab
    const allTabs = await chrome.tabs.query({}).catch(() => []);
    const userShopeeTabs = allTabs.filter(t => t.url && t.url.includes('shopee.vn') && t.id !== tempShopeeTabId);
    if (userShopeeTabs.length > 0) {
      const walletTab = userShopeeTabs.find(t => t.url.includes('voucher-wallet'));
      return { tab: walletTab || userShopeeTabs[0], isTemporary: false };
    }

    // 2. Check if our existing temporary tab is still alive
    if (tempShopeeTabId !== null) {
      try {
        const existingTab = await chrome.tabs.get(tempShopeeTabId);
        if (existingTab && existingTab.url && existingTab.url.includes('shopee.vn')) {
          return { tab: existingTab, isTemporary: true };
        }
      } catch (e) {
        tempShopeeTabId = null;
      }
    }

    // 3. Mutex: If a tab is already being created, await it to prevent race conditions
    if (creatingShopeeTabPromise) {
      return await creatingShopeeTabPromise;
    }

    // 4. Create a single silent background tab (NEVER PINNED: pinned = false)
    creatingShopeeTabPromise = (async () => {
      try {
        const newTab = await chrome.tabs.create({
          url: 'https://shopee.vn/user/voucher-wallet',
          active: false,
          pinned: false // TUYỆT ĐỐI KHÔNG GHIM THẺ
        });

        tempShopeeTabId = newTab.id;

        // Wait until tab completes loading (timeout 6s)
        await new Promise(resolve => {
          let done = false;
          const cleanup = () => {
            if (!done) {
              done = true;
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          const listener = (tabId, changeInfo) => {
            if (tabId === newTab.id && changeInfo.status === 'complete') {
              cleanup();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(cleanup, 6000);
        });

        // Re-fetch tab details after load
        const readyTab = await chrome.tabs.get(newTab.id).catch(() => newTab);
        return { tab: readyTab, isTemporary: true };
      } finally {
        creatingShopeeTabPromise = null;
      }
    })();

    return await creatingShopeeTabPromise;
  } catch (e) {
    console.warn('[Shopee Saver] acquireShopeeTab error:', e);
    return null;
  }
}

/**
 * Injected and executed directly in Shopee tab context (100% same-origin, zero CORS, native session)
 */
async function executeSaveVoucherInPage(voucherCode) {
  try {
    const cleanCode = (voucherCode || '').trim().toUpperCase();

    // 1. If currently on voucher-wallet page or modal with a real voucher input, try UI input & button save
    try {
      // Helper: Strictly detect and reject any search bar element or search container
      const isSearchBarElement = (el) => {
        if (!el) return false;
        try {
          const className = (typeof el.className === 'string' ? el.className : '').toLowerCase();
          const id = (el.id || '').toLowerCase();
          const name = (el.name || '').toLowerCase();
          const type = (el.type || '').toLowerCase();
          const role = (el.getAttribute('role') || '').toLowerCase();

          if (type === 'search' || role === 'searchbox' || name === 'search' || name === 'keyword' || name === 'q') {
            return true;
          }
          if (className.includes('search') || id.includes('search')) {
            return true;
          }

          // Check parent containers: header, nav, search forms, searchbar wrappers
          if (el.closest('header, nav, .shopee-top, .shopee-searchbar, .shopee-searchbar-input, form[role="search"], [class*="searchbar" i], [class*="search-bar" i], [class*="searchbox" i]')) {
            return true;
          }
        } catch (e) { }
        return false;
      };

      // Helper: Find the TRUE voucher input (Chỗ lưu mã), strictly excluding search bars
      const findRealVoucherInput = () => {
        // Strategy A: Inside voucher wallet container or voucher modal/popup
        const voucherContainers = document.querySelectorAll(
          '.voucher-wallet, [class*="voucher-wallet" i], [class*="voucher_wallet" i], ' +
          '[class*="voucher-input" i], [class*="voucher_input" i], ' +
          '[role="dialog"], .shopee-popup, .shopee-modal, [class*="dialog" i], [class*="modal" i], ' +
          '.user-page-brief, [class*="user-voucher" i], [class*="voucher-card" i]'
        );

        for (const container of voucherContainers) {
          if (isSearchBarElement(container)) continue;
          const inputs = container.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"])');
          for (const input of inputs) {
            if (!isSearchBarElement(input)) {
              const rect = input.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return input;
              }
            }
          }
        }

        // Strategy B: Search globally if on voucher-wallet, cart, or checkout
        const isVoucherPage = window.location.href.includes('voucher-wallet') ||
          window.location.pathname.includes('/cart') ||
          window.location.pathname.includes('/checkout');

        if (isVoucherPage) {
          const allInputs = document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"])');
          for (const input of allInputs) {
            if (isSearchBarElement(input)) continue;
            const rect = input.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;

            const placeholder = (input.placeholder || '').toLowerCase();
            const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
            const combined = `${placeholder} ${ariaLabel}`;

            if (combined.includes('voucher') || combined.includes('mã giảm') || combined.includes('mã shopee') || combined.includes('nhập mã')) {
              return input;
            }

            // On voucher-wallet specifically, any non-search input in main content is the voucher input
            if (window.location.href.includes('voucher-wallet') && !input.closest('header, nav, .shopee-top')) {
              return input;
            }
          }
        }

        // Strategy C: Any visible input that has an adjacent or sibling Save button (Lưu / Áp dụng)
        const allVisibleInputs = document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"])');
        for (const input of allVisibleInputs) {
          if (isSearchBarElement(input)) continue;
          const rect = input.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

          // Check if parent container (up to 4 levels) contains a Save button
          let p = input.parentElement;
          for (let i = 0; i < 4 && p; i++) {
            const btns = Array.from(p.querySelectorAll('button, [role="button"], input[type="submit"]'));
            const hasSaveBtn = btns.some(b => {
              if (isSearchBarElement(b)) return false;
              const t = (b.innerText || b.textContent || b.value || '').trim().toLowerCase();
              return t === 'lưu' || t === 'áp dụng' || t.startsWith('lưu') || t.startsWith('áp dụng') || t === 'save' || t === 'apply';
            });
            if (hasSaveBtn) {
              return input;
            }
            p = p.parentElement;
          }

          const placeholder = (input.placeholder || '').toLowerCase();
          const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
          const combined = `${placeholder} ${ariaLabel}`;
          if (combined.includes('voucher') || combined.includes('mã') || combined.includes('coupon') || combined.includes('promo')) {
            return input;
          }
        }

        return null;
      };

      // Helper: Find save button for the voucher input (never search button)
      const findSaveButton = (inputEl) => {
        if (!inputEl) return null;

        // Strategy 1: Search in parent containers (climbing up to 5 levels)
        let curr = inputEl.parentElement;
        for (let i = 0; i < 5 && curr; i++) {
          const btns = Array.from(curr.querySelectorAll('button, [role="button"], input[type="submit"]'));
          const matched = btns.find(b => {
            if (isSearchBarElement(b)) return false;
            const t = (b.innerText || b.textContent || b.value || '').trim().toLowerCase();
            return t === 'lưu' || t === 'áp dụng' || t.startsWith('lưu') || t.startsWith('áp dụng') || t === 'save' || t === 'apply' || t === 'claim';
          });
          if (matched) return matched;
          curr = curr.parentElement;
        }

        // Strategy 2: Search inside surrounding form or modal
        const container = inputEl.closest('form, .voucher-wallet, [role="dialog"], .shopee-popup, .shopee-modal, [class*="voucher" i], [class*="modal" i]');
        if (container) {
          const localBtns = Array.from(container.querySelectorAll('button, [role="button"], input[type="submit"]'));
          const matched = localBtns.find(b => {
            if (isSearchBarElement(b)) return false;
            const t = (b.innerText || b.textContent || b.value || '').trim().toLowerCase();
            return t === 'lưu' || t === 'áp dụng' || t.startsWith('lưu') || t.startsWith('áp dụng') || t === 'save' || t === 'apply' || t === 'claim';
          });
          if (matched) return matched;
        }

        // Strategy 3: Global buttons with exact "Lưu" or "Áp dụng"
        const allBtns = Array.from(document.querySelectorAll('button, [role="button"]')).filter(b => {
          if (isSearchBarElement(b)) return false;
          const rect = b.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          const t = (b.innerText || b.textContent || b.value || '').trim().toLowerCase();
          return t === 'lưu' || t === 'áp dụng' || t.startsWith('lưu') || t.startsWith('áp dụng') || t === 'save' || t === 'claim';
        });

        return allBtns[0] || null;
      };

      // Helper: Set React input value properly so React synthetic events sync cleanly
      const setReactValue = (input, val) => {
        try {
          input.focus();

          // Clear React 16+ value tracker so React detects the update
          if (input._valueTracker) {
            input._valueTracker.setValue('');
          }

          const proto = window.HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc && desc.set) {
            desc.set.call(input, val);
          } else {
            input.value = val;
          }
        } catch (e) {
          input.value = val;
        }

        try {
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: val }));
        } catch (_) {}
        input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      };

      const voucherInput = findRealVoucherInput();
      if (voucherInput) {
        voucherInput.focus();
        setReactValue(voucherInput, cleanCode);

        // Allow React state loop to validate and re-render Save button as enabled (300ms)
        await new Promise(r => setTimeout(r, 300));

        let saveBtn = findSaveButton(voucherInput);
        if (saveBtn && (saveBtn.disabled || saveBtn.getAttribute('aria-disabled') === 'true')) {
          await new Promise(r => setTimeout(r, 200));
          saveBtn = findSaveButton(voucherInput) || saveBtn;
        }

        if (saveBtn) {
          if (saveBtn.disabled) {
            saveBtn.disabled = false;
            saveBtn.removeAttribute('disabled');
            saveBtn.setAttribute('aria-disabled', 'false');
          }
          saveBtn.focus();
          saveBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
          saveBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          saveBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          saveBtn.click();
          saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        }

        // Trigger Enter key on input as reliable fallback
        voucherInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        voucherInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        voucherInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

        // ─────────────────────────────────────────────────────────────
        // Safe Human Tempo: Poll for in-page Shopee toast/modal notification
        // Give Shopee server 1.5s - 2.5s to respond and display official feedback
        // ─────────────────────────────────────────────────────────────
        let capturedToast = null;
        const toastStart = Date.now();
        const negativeFailurePatterns = [
          /không\s+thành\s+công/i,
          /chưa\s+thành\s+công/i,
          /thất\s+bại/i,
          /không\s+thể\s+(?:lưu|nhận|áp\s+dụng)/i,
          /chưa\s+thể\s+(?:lưu|nhận|áp\s+dụng)/i,
          /không\s+đủ\s+điều\s+kiện/i,
          /không\s+hợp\s+lệ/i,
          /không\s+tồn\s+tại/i,
          /không\s+còn\s+hiệu\s+lực/i,
          /rất\s+tiếc/i,
          /tiếc\s+quá/i,
          /hết\s+(?:lượt|mã|hạn|ngân\s+sách|suất)/i,
          /đã\s+(?:nhận|lưu|dùng|sử\s+dụng)\s+hết/i,
          /đã\s+được\s+(?:nhận|lưu|sử\s+dụng)\s+hết/i,
          /đạt\s+giới\s+hạn/i,
          /chưa\s+(?:đến|tới)\s+(?:giờ|khung\s+giờ|thời\s+gian)/i,
          /chưa\s+(?:mở|bắt\s+đầu|có\s+hiệu\s+lực)/i,
          /nhập\s+sai/i,
          /sai\s+mã/i,
          /vui\s+lòng\s+đăng\s+nhập/i,
          /quá\s+tải/i
        ];
        const alreadySavedPatterns = [
          /bạn\s+đã\s+(?:lưu|nhận)\s+(?:mã|voucher)/i,
          /đã\s+(?:có|tồn\s+tại)\s+(?:sẵn\s+)?trong\s+ví/i,
          /đã\s+lưu\s+(?:mã\s+này\s+)?(?:vào\s+ví\s+)?rồi/i,
          /đã\s+thu\s+thập\s+(?:trước\s+đó|rồi)/i,
          /already\s+(?:claimed|saved|collected)/i
        ];
        const newSuccessPatterns = [
          /lưu\s+(?:mã|voucher)?\s*thành\s+công/i,
          /nhận\s+(?:mã|voucher)?\s*thành\s+công/i,
          /đã\s+lưu\s+(?:thành\s+công\s+)?vào\s+ví/i,
          /thêm\s+vào\s+ví\s+thành\s+công/i,
          /thu\s+thập\s+thành\s+công/i,
          /^đã\s+lưu\s*!?$/i,
          /^lưu\s+thành\s+công\s*!?$/i
        ];

        while (Date.now() - toastStart < 2600) {
          const toastSelectors = [
            '.shopee-alert-popup',
            '.shopee-toast',
            '.shopee-popup__content',
            '.shopee-modal__content',
            'div[role="alert"]',
            '[class*="toast" i]',
            '[class*="alert-popup" i]',
            '[class*="voucher-status" i]',
            '[class*="error-msg" i]'
          ];
          const toastEls = Array.from(document.querySelectorAll(toastSelectors.join(',')));
          for (const t of toastEls) {
            if (t.closest('#sv-floating-widget') || t.closest('#sv-toast-container')) continue;
            const rect = t.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const rawText = (t.innerText || t.textContent || '').trim();
            if (rawText && rawText.length >= 4 && rawText.length <= 200) {
              const lower = rawText.toLowerCase();
              const isQuotaExhausted =
                /hết\s+(?:lượt|mã|ngân\s+sách|suất)/i.test(lower) ||
                /đã\s+(?:nhận|lưu|dùng|sử\s+dụng)\s+hết/i.test(lower) ||
                /đã\s+được\s+(?:nhận|lưu|sử\s+dụng)\s+hết/i.test(lower);

              if (isQuotaExhausted) {
                capturedToast = { text: rawText, errorCode: 2 };
                break;
              }
              if (alreadySavedPatterns.some(re => re.test(lower))) {
                capturedToast = { text: rawText, errorCode: 3 };
                break;
              }
              if (negativeFailurePatterns.some(re => re.test(lower))) {
                let errorCode = 4;
                if (/chưa\s+(?:đến|tới|mở|bắt\s+đầu)|khung\s+giờ/i.test(lower)) errorCode = 7;
                else if (/không\s+tồn\s+tại|nhập\s+sai|sai\s+mã/i.test(lower)) errorCode = 1;
                else if (/hết\s+hạn/i.test(lower)) errorCode = 5;
                else if (/đăng\s+nhập/i.test(lower)) errorCode = 140000;
                capturedToast = { text: rawText, errorCode };
                break;
              }
              if (newSuccessPatterns.some(re => re.test(lower))) {
                capturedToast = { text: rawText, errorCode: 0 };
                break;
              }
            }
          }
          if (capturedToast) break;
          await new Promise(r => setTimeout(r, 200));
        }

        if (capturedToast) {
          return {
            ok: true,
            data: {
              error: capturedToast.errorCode,
              message: capturedToast.text,
              toast_message: capturedToast.text,
              from_dom_toast: true
            }
          };
        }
      }
    } catch (uiErr) {
      console.warn('UI input sync attempt:', uiErr);
    }

    // 2. Fetch directly via Shopee API with Mobile App simulation (rn -> app -> pc)
    const match = document.cookie.match(/csrftoken=([^;]+)/);
    const csrfToken = match ? match[1] : '';

    const sourceConfigs = [
      { apiSource: 'rn', callerSource: 'RN_SHOPEE' },
      { apiSource: 'app', callerSource: 'APP_SHOPEE' },
      { apiSource: 'pc', callerSource: 'MICROSITE_SHOPEE' }
    ];

    let lastData = null;

    for (const config of sourceConfigs) {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-shopee-language': 'vi',
        'x-requested-with': config.apiSource === 'pc' ? 'XMLHttpRequest' : 'com.shopee.vn',
        'x-api-source': config.apiSource
      };
      if (csrfToken) {
        headers['x-csrftoken'] = csrfToken;
      }

      try {
        let res = await fetch('https://shopee.vn/api/v2/voucher_wallet/save_voucher', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            voucher_code: cleanCode,
            need_user_voucher_status: true,
            caller_source: config.callerSource
          }),
          credentials: 'include'
        });

        const data = await res.json();
        lastData = data;

        if (data.error === 0 || data.error === 3 || data.error === 140003) {
          return { ok: true, data };
        }

        // Try active microsite v4 endpoint with simulated mobile source
        try {
          const resV4 = await fetch('https://shopee.vn/api/v4/microsite/save_voucher', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              voucher_code: cleanCode,
              caller_source: config.callerSource
            }),
            credentials: 'include'
          });
          const dataV4 = await resV4.json();
          if (dataV4 && (dataV4.error === 0 || dataV4.error === 3 || dataV4.error === 140003)) {
            return { ok: true, data: dataV4 };
          }
        } catch (_) {}

        // Stop retrying on terminal non-recoverable errors (exhausted quota, invalid code, not started)
        if (
          data.error === 2 || data.error === 140002 ||
          data.error === 4 || data.error === 140004 ||
          data.error === 7
        ) {
          break;
        }

        // Small delay between fallback source attempts to avoid rate limiting
        await new Promise(r => setTimeout(r, 600 + Math.floor(Math.random() * 400)));
      } catch (reqErr) {
        // Continue to next source config
      }
    }

    if (lastData) {
      return { ok: true, data: lastData };
    }

    return { ok: false, error: 'Không nhận được phản hồi từ máy chủ Shopee' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Smart Save Voucher:
 * 1. Prioritizes tab injection via chrome.scripting (100% same-origin, zero CORS, native session cookies)
 * 2. Checks local Bot server if running (100% no CORS, direct Puppeteer Node.js)
 * 3. Falls back to direct Service Worker fetch
 */
async function smartSaveVoucher(code) {
  const cleanCode = (code || '').trim().toUpperCase();
  if (!cleanCode) {
    return { success: false, code: cleanCode, errCode: -1, message: 'Mã voucher không hợp lệ' };
  }

  // 1. Fast Path A: If user already has an open Shopee tab, execute directly in tab (50ms)
  try {
    if (typeof chrome !== 'undefined' && chrome.scripting && chrome.tabs) {
      const allTabs = await chrome.tabs.query({}).catch(() => []);
      const userShopeeTabs = allTabs.filter(t => t.url && t.url.includes('shopee.vn'));
      const targetTab = userShopeeTabs.length > 0
        ? (userShopeeTabs.find(t => t.url.includes('voucher-wallet')) || userShopeeTabs[0])
        : null;

      if (targetTab && targetTab.id) {
        console.log(`[Shopee Saver] Đang gửi mã [${cleanCode}] vào Tab Shopee #${targetTab.id}...`);
        const results = await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          func: executeSaveVoucherInPage,
          args: [cleanCode]
        });

        if (results && results[0] && results[0].result) {
          const pageRes = results[0].result;
          if (pageRes.ok && pageRes.data) {
            const normalized = normalizeSaveResult(cleanCode, pageRes.data);
            console.log(`[Shopee Saver] Tab phản hồi kết quả lưu [${cleanCode}] (${normalized.status}): "${normalized.message}"`);
            return normalized;
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Shopee Saver] Tab executeScript error, fallback to direct API:', e);
  }

  // 2. Fast Path B: Direct Service Worker fetch via cookies (80ms - no waiting for tab creation!)
  const res = await saveVoucherByCode(cleanCode);
  if (res.success || res.alreadySaved) {
    return res;
  }

  // 3. Try Local Bot Server if running
  try {
    const botRes = await fetch('http://127.0.0.1:23232/save_voucher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: cleanCode }),
      signal: AbortSignal.timeout(1500)
    });
    if (botRes.ok) {
      const botData = await botRes.json();
      if (botData && typeof botData.success === 'boolean') {
        return normalizeSaveResult(cleanCode, {
          error: botData.errCode ?? (botData.success ? 0 : -1),
          message: botData.message,
          data: botData.voucherData
        });
      }
    }
  } catch (botErr) {
    // Bot server not running, continue
  }

  return res;
}

/**
 * Broadcast message to popup, dashboard, or active tabs
 */
function broadcast(msg) {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {
      // Ignore if no listener is currently open
    });
  } catch (e) {
    // Ignore error
  }
}

/**
 * Save history log item into chrome.storage.local
 */
async function appendHistory(historyItem) {
  try {
    const { voucherHistory = [] } = await chrome.storage.local.get('voucherHistory');
    voucherHistory.unshift(historyItem);
    if (voucherHistory.length > 100) {
      voucherHistory.length = 100;
    }
    await chrome.storage.local.set({ voucherHistory });
  } catch (err) {
    console.error('Failed to append history:', err);
  }
}

/**
 * Append Zalo message item to live stream
 */
async function appendZaloStream(item) {
  try {
    const { zaloStream = [] } = await chrome.storage.local.get('zaloStream');
    zaloStream.unshift(item);
    if (zaloStream.length > 60) {
      zaloStream.length = 60;
    }
    await chrome.storage.local.set({ zaloStream });
    broadcast({ type: 'ZALO_STREAM_UPDATE', stream: zaloStream, newItem: item });
  } catch (err) {
    console.error('Failed to append zalo stream:', err);
  }
}

/**
 * Update a single voucher's saved result inside stored zaloStream so Dashboard Live Feed reflects live slow-queue progress
 */
async function updateZaloStreamResult(messageId, code, resultObj) {
  try {
    const { zaloStream = [] } = await chrome.storage.local.get('zaloStream');
    let modified = false;
    for (const item of zaloStream) {
      if (messageId && item.id !== messageId) continue;
      if (!Array.isArray(item.results)) item.results = [];
      const existing = item.results.find(r => r.code === code);
      if (existing) {
        Object.assign(existing, resultObj);
        modified = true;
      } else if (Array.isArray(item.codes) && item.codes.includes(code)) {
        item.results.push({ code, ...resultObj });
        modified = true;
      }
      if (messageId) break;
    }
    if (modified) {
      await chrome.storage.local.set({ zaloStream });
      broadcast({ type: 'ZALO_STREAM_UPDATE', stream: zaloStream });
    }
  } catch (err) {
    console.error('Failed to update zalo stream result:', err);
  }
}

/**
 * Lazily initialize the persistent serialized slow voucher queue for high-volume Zalo groups
 */
async function getZaloVoucherQueue() {
  if (zaloVoucherQueue) return zaloVoucherQueue;
  if (!zaloQueueInitPromise) {
    zaloQueueInitPromise = (async () => {
      const stored = await chrome.storage.local.get(['zaloSeenCodes', 'zaloQueueDelayMs']);
      const savedDelay = Number(stored.zaloQueueDelayMs);
      if (Number.isFinite(savedDelay) && savedDelay >= 3000) {
        zaloQueueDelayMs = savedDelay;
      }

      zaloVoucherQueue = createVoucherQueue({
        initialSeenMap: stored.zaloSeenCodes || {},
        getDelayMs: () => zaloQueueDelayMs,
        jitterMs: 2500,
        resetDebounceMs: 120000,
        savedResetCooldownMs: 900000,
        saveFn: async (code) => {
          return await smartSaveVoucher(code);
        },
        onUpdate: (snapshot) => {
          broadcast({ type: 'ZALO_QUEUE_UPDATE', queue: snapshot });
        },
        onPersistSeen: (seenObj) => {
          chrome.storage.local.set({ zaloSeenCodes: seenObj }).catch(() => {});
        },
        onItemDone: async (completedItem) => {
          await appendHistory({
            code: completedItem.code,
            status: completedItem.alreadySaved ? 'ALREADY_SAVED' : (completedItem.success ? 'SUCCESS' : 'FAILED'),
            message: `(Hàng đợi Zalo [${completedItem.groupName}]): ${completedItem.message}`,
            time: new Date().toLocaleTimeString('vi-VN'),
            date: new Date().toLocaleDateString('vi-VN')
          });

          await updateZaloStreamResult(completedItem.messageId, completedItem.code, {
            success: completedItem.success,
            alreadySaved: completedItem.alreadySaved,
            status: completedItem.status,
            message: completedItem.message,
            triggerLabel: completedItem.triggerLabel
          });
        }
      });

      return zaloVoucherQueue;
    })();
  }
  return zaloQueueInitPromise;
}

/**
 * Process incoming NEW Zalo detected message:
 * - Strictly skips back-voucher links (never auto-opens tabs for links).
 * - Filters codes through serialized slow VoucherQueueManager (only NEW or RESET codes).
 * - Saves strictly one code at a time at a slow, anti-bot-safe pace.
 */
async function handleZaloMessage(payload) {
  const { id, codes = [], links = [], groupName = 'Zalo Group', text = '' } = payload;
  const {
    enableZaloSniffer = true,
    autoClaimZaloCodes = true,
    zaloTargetGroup = '[23] LONGHOUSEE'
  } = await chrome.storage.local.get(['enableZaloSniffer', 'autoClaimZaloCodes', 'zaloTargetGroup']);

  if (!enableZaloSniffer) return;

  // Strict check 0: Only process messages from target group ([23] LONGHOUSEE)
  if (!isTargetZaloGroup(groupName, zaloTargetGroup)) {
    console.log(`[Shopee Voucher Sniffer] Bỏ qua tin nhắn vì không thuộc nhóm mục tiêu ${zaloTargetGroup}: [${groupName}]`);
    return;
  }

  // Strict check 1: Only process authentic Shopee messages (drop longhousee & non-Shopee domains)
  if (!isShopeeMessage(text, links, true)) {
    console.log(`[Shopee Voucher Sniffer] Bỏ qua tin nhắn không thuộc Shopee: ${text.slice(0, 60)}`);
    return;
  }

  // Strict check 2: Skip link-only back-voucher messages (focus solely on text voucher codes)
  if (!codes || codes.length === 0) {
    return;
  }

  const queue = await getZaloVoucherQueue();
  const messageId = id || `zalo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const results = [];
  if (autoClaimZaloCodes) {
    const { enqueued, skipped } = queue.enqueueFromMessage({
      codes,
      text,
      groupName,
      senderName: payload.senderName || 'Thành viên',
      messageId,
      timestamp: payload.timestamp || Date.now()
    });

    for (const item of enqueued) {
      results.push({
        code: item.code,
        success: false,
        alreadySaved: false,
        status: 'queued',
        triggerLabel: item.triggerLabel,
        message: `Trong hàng đợi (${item.triggerLabel})`
      });
    }
    for (const sk of skipped) {
      results.push({
        code: sk.code,
        success: false,
        alreadySaved: false,
        status: 'skipped',
        message: sk.reason === 'in_queue' ? 'Đang chờ trong hàng đợi' : 'Mã cũ / trùng — bỏ qua'
      });
    }

    // Only log to live feed if at least one new/reset code was accepted, avoiding flood from duplicate spam
    if (enqueued.length === 0) {
      console.log(`[Shopee Queue] Bỏ qua tin nhắn trùng lặp hoàn toàn (${skipped.length} mã cũ).`);
      return;
    }
  } else {
    for (const code of codes) {
      results.push({
        code,
        success: false,
        alreadySaved: false,
        status: 'skipped',
        message: 'Đã tắt tự động lưu mã'
      });
    }
  }

  // Save to live stream log (without auto-opening any links)
  await appendZaloStream({
    ...payload,
    id: messageId,
    links: [],
    results,
    savedAt: Date.now()
  });
}

/**
 * Run a batch voucher save task
 */
async function runBatchSave({ codes, delayMs = 1800, isScheduled = false }) {
  if (activeBatchTask && !activeBatchTask.isFinished) {
    return { error: 'Đang có một tiến trình lưu mã đang chạy!' };
  }

  activeBatchTask = {
    total: codes.length,
    current: 0,
    successCount: 0,
    alreadySavedCount: 0,
    failCount: 0,
    results: [],
    isCancelled: false,
    isFinished: false,
    startTime: Date.now()
  };

  broadcast({
    type: 'BATCH_STARTED',
    total: codes.length,
    isScheduled
  });

  for (let i = 0; i < codes.length; i++) {
    if (activeBatchTask.isCancelled) {
      break;
    }

    const code = codes[i];
    activeBatchTask.current = i + 1;

    broadcast({
      type: 'BATCH_PROGRESS',
      current: i + 1,
      total: codes.length,
      currentCode: code
    });

    const res = await smartSaveVoucher(code);
    const friendlyMsg = res.message;
    const isAlreadySaved = Boolean(res.alreadySaved) || res.status === 'already_saved';
    const isSuccess = Boolean(res.success) || isAlreadySaved;
    const status = res.status || (isAlreadySaved ? 'already_saved' : isSuccess ? 'success' : 'failed');
    const resultItem = {
      code,
      success: isSuccess,
      alreadySaved: isAlreadySaved,
      status,
      errCode: res.errCode,
      message: friendlyMsg,
      voucherTitle: res.voucherTitle || '',
      timestamp: Date.now()
    };

    if (isSuccess) {
      activeBatchTask.successCount++;
      if (isAlreadySaved) activeBatchTask.alreadySavedCount++;
    } else {
      activeBatchTask.failCount++;
    }

    activeBatchTask.results.push(resultItem);

    broadcast({
      type: 'VOUCHER_RESULT',
      result: resultItem,
      current: i + 1,
      total: codes.length
    });

    await appendHistory({
      code,
      status: isAlreadySaved ? 'ALREADY_SAVED' : isSuccess ? 'SUCCESS' : 'FAILED',
      message: friendlyMsg,
      time: new Date().toLocaleTimeString('vi-VN'),
      date: new Date().toLocaleDateString('vi-VN')
    });

    if (i < codes.length - 1 && delayMs > 0) {
      // Add random jitter to mimic natural human pacing and bypass bot pattern recognition
      const jitterDelay = Math.max(1000, delayMs + Math.floor(Math.random() * 600 - 300));
      await new Promise(r => setTimeout(r, jitterDelay));
    }
  }

  activeBatchTask.isFinished = true;
  const summary = {
    total: activeBatchTask.total,
    successCount: activeBatchTask.successCount,
    alreadySavedCount: activeBatchTask.alreadySavedCount,
    failCount: activeBatchTask.failCount,
    results: activeBatchTask.results,
    durationMs: Date.now() - activeBatchTask.startTime
  };

  // Close temporary Shopee tab if one was opened for the batch
  await closeTempShopeeTab();

  broadcast({
    type: 'BATCH_COMPLETED',
    summary
  });

  return summary;
}

// ==========================================
// BANNER REALTIME WATCHER (MODES 1 & 2)
// Chế độ 1: Dải Giờ Vàng (Smart Window) - Canh liên tục từ trước giờ G đến 15-30 phút sau
// Chế độ 2: Canh Ngẫu Nhiên 24/7 (Continuous) - Polling API ngầm 3s - 5s bắt mã back ngẫu nhiên
// ==========================================

const bannerWatchState = {
  isRunning: false,
  mode: 'CONTINUOUS', // 'CONTINUOUS' or 'WINDOW'
  url: 'https://shopee.vn/m/goi-ShopeeVIP',
  slug: 'goi-ShopeeVIP',
  intervalMs: 3000,
  targetTime: null, // ms timestamp for WINDOW mode
  windowDurationMins: 30, // duration in minutes
  windowEndTime: null, // calculated window end timestamp
  claimedPromoIds: new Set(),
  failedClaimCounts: new Map(), // promotionId -> consecutive failure count
  previousVoucherStates: new Map(), // promotionId -> { fullyClaimed, percentageClaimed } from last cycle
  collections: [],
  checkCount: 0,
  successCount: 0,
  lastCheckTime: 0,
  lastStatusText: '',
  timerId: null,
  logs: []
};

function addBannerWatchLog(text, level = 'info') {
  const timeStr = new Date().toLocaleTimeString('vi-VN');
  const entry = { time: timeStr, text, level, timestamp: Date.now() };
  bannerWatchState.logs.unshift(entry);
  if (bannerWatchState.logs.length > 50) bannerWatchState.logs.length = 50;
  bannerWatchState.lastStatusText = text;
  broadcast({
    type: 'BANNER_WATCH_LOG',
    entry,
    state: getBannerWatchSummary()
  });
}

function getBannerWatchSummary() {
  return {
    isRunning: bannerWatchState.isRunning,
    mode: bannerWatchState.mode,
    url: bannerWatchState.url,
    slug: bannerWatchState.slug,
    intervalMs: bannerWatchState.intervalMs,
    targetTime: bannerWatchState.targetTime,
    windowDurationMins: bannerWatchState.windowDurationMins,
    windowEndTime: bannerWatchState.windowEndTime,
    collectionsCount: bannerWatchState.collections.length,
    checkCount: bannerWatchState.checkCount,
    successCount: bannerWatchState.successCount,
    lastCheckTime: bannerWatchState.lastCheckTime,
    lastStatusText: bannerWatchState.lastStatusText,
    claimedCount: bannerWatchState.claimedPromoIds.size
  };
}

async function startBannerWatch(config = {}) {
  if (bannerWatchState.isRunning) {
    stopBannerWatch();
  }

  const {
    url = 'https://shopee.vn/m/goi-ShopeeVIP',
    mode = 'CONTINUOUS',
    intervalMs = 3000,
    targetTime = null,
    windowDurationMins = 30
  } = config;

  const slug = extractBannerSlug(url);
  bannerWatchState.isRunning = true;
  bannerWatchState.mode = mode;
  bannerWatchState.url = url;
  bannerWatchState.slug = slug;
  bannerWatchState.intervalMs = Math.max(1000, Number(intervalMs) || 3000);
  bannerWatchState.targetTime = targetTime ? Number(targetTime) : null;
  bannerWatchState.windowDurationMins = Number(windowDurationMins) || 30;
  bannerWatchState.windowEndTime = targetTime ? (Number(targetTime) + bannerWatchState.windowDurationMins * 60 * 1000) : null;
  bannerWatchState.checkCount = 0;
  bannerWatchState.successCount = 0;
  bannerWatchState.claimedPromoIds = new Set();
  bannerWatchState.failedClaimCounts = new Map();
  bannerWatchState.previousVoucherStates = new Map();
  bannerWatchState.logs = [];

  const modeLabel = mode === 'WINDOW'
    ? `Dải Giờ Vàng (Khung ${new Date(targetTime).toLocaleTimeString('vi-VN')} + ${bannerWatchState.windowDurationMins} phút)`
    : 'Canh Ngẫu Nhiên 24/7 (Thời gian thực)';

  addBannerWatchLog(`🚀 Bắt đầu canh mã: ${modeLabel} trên banner [${slug}]`, 'info');

  // Fetch collections from banner page
  addBannerWatchLog(`Đang tải cấu trúc voucher từ ${slug}...`, 'info');
  const bannerInfo = await fetchBannerCollections(slug);
  if (bannerInfo.collections && bannerInfo.collections.length > 0) {
    bannerWatchState.collections = bannerInfo.collections;
    addBannerWatchLog(`✓ Đã nạp ${bannerInfo.collections.length} nguồn dữ liệu voucher từ banner`, 'success');
  } else {
    addBannerWatchLog(`Cảnh báo: Chưa tìm thấy nguồn dữ liệu voucher trên banner (sẽ thử tải lại khi quét)`, 'warning');
  }

  broadcast({
    type: 'BANNER_WATCH_STATUS',
    state: getBannerWatchSummary()
  });

  // Schedule first cycle
  runBannerWatchCycle();
  return { success: true, state: getBannerWatchSummary() };
}

function stopBannerWatch() {
  if (bannerWatchState.timerId) {
    clearTimeout(bannerWatchState.timerId);
    bannerWatchState.timerId = null;
  }
  bannerWatchState.isRunning = false;
  addBannerWatchLog('⏹ Đã dừng tiến trình canh mã banner.', 'info');
  broadcast({
    type: 'BANNER_WATCH_STATUS',
    state: getBannerWatchSummary()
  });
  return { success: true, status: 'stopped' };
}

/**
 * Injected into Shopee tab to query voucher collections with native cookies and 0 CORS
 */
async function executeCheckBannerCollectionsInPage(collectionsReqList, slug = 'goi-ShopeeVIP') {
  try {
    const payload = JSON.stringify({
      voucher_collection_request_list: collectionsReqList
    });

    const match = document.cookie.match(/csrftoken=([^;]+)/);
    const csrfToken = match ? match[1] : '';

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-shopee-language': 'vi',
      'x-requested-with': 'XMLHttpRequest',
      'x-api-source': 'pc',
      'referer': `https://shopee.vn/m/${slug}`
    };
    if (csrfToken) headers['x-csrftoken'] = csrfToken;

    let res = await fetch('https://shopee.vn/api/v1/microsite/get_vouchers_by_collections', {
      method: 'POST',
      headers,
      body: payload,
      credentials: 'include'
    });

    if (!res.ok) {
      res = await fetch('https://shopee.vn/api/v4/pagebuilder/get_vouchers_by_collections', {
        method: 'POST',
        headers,
        body: payload,
        credentials: 'include'
      });
    }

    const json = await res.json();
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Injected into Shopee tab to claim banner voucher directly with native cookies and 0 CORS
 */
async function executeClaimBannerVoucherInPage(promotionId, signature = '', voucherCode = '', slug = 'goi-ShopeeVIP') {
  try {
    const cleanCode = (voucherCode || '').trim().toUpperCase();
    const match = document.cookie.match(/csrftoken=([^;]+)/);
    const csrfToken = match ? match[1] : '';

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-shopee-language': 'vi',
      'x-requested-with': 'XMLHttpRequest',
      'x-api-source': 'pc',
      'referer': `https://shopee.vn/m/${slug}`
    };
    if (csrfToken) headers['x-csrftoken'] = csrfToken;

    let res = await fetch('https://shopee.vn/api/v2/voucher_wallet/save_voucher', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        voucher_code: cleanCode || undefined,
        voucher_promotionid: Number(promotionId),
        signature: signature || undefined,
        signature_source: '0',
        caller_source: 'MICROSITE_SHOPEE'
      }),
      credentials: 'include'
    });

    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function smartQueryBannerVouchers(collectionsReqList, slug = 'goi-ShopeeVIP') {
  if (!collectionsReqList || !collectionsReqList.length) {
    return { vouchers: [], backVouchers: [] };
  }

  // 1. Try in-page query via open Shopee tab (100% same-origin, full cookies)
  try {
    if (typeof chrome !== 'undefined' && chrome.scripting) {
      const tabInfo = await acquireShopeeTab();
      const tab = tabInfo ? tabInfo.tab : null;
      if (tab && tab.id) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: executeCheckBannerCollectionsInPage,
          args: [collectionsReqList, slug]
        });

        if (results && results[0] && results[0].result) {
          const pageRes = results[0].result;
          if (pageRes.ok && pageRes.data) {
            const json = pageRes.data;
            if (json.is_login === false || json.error === 90309999) {
              return { vouchers: [], backVouchers: [], isLoginRequired: true, error: 'Chưa đăng nhập Shopee' };
            }

            const collectionsData = json.data || [];
            const allVouchers = [];
            const backVouchers = [];

            if (Array.isArray(collectionsData)) {
              for (const col of collectionsData) {
                const list = col.vouchers || [];
                for (const item of list) {
                  const v = item.voucher || {};
                  const idInfo = v.voucher_identifier || {};
                  const promoId = idInfo.promotion_id ? String(idInfo.promotion_id) : null;
                  const code = idInfo.voucher_code || null;
                  const signature = idInfo.signature || '';
                  const quota = v.quota_info || {};
                  const ui = v.ui_info || {};

                  const percentageClaimed = quota.percentage_claimed != null ? Number(quota.percentage_claimed) : null;
                  const fullyClaimed = Boolean(quota.fully_claimed);
                  const fullyRedeemed = Boolean(quota.fully_redeemed);
                  const disabled = Boolean(quota.disabled);

                  const isAvailable = !fullyClaimed && !disabled && (percentageClaimed === null || percentageClaimed < 100);

                  const parsed = {
                    promotionId: promoId,
                    voucherCode: code,
                    signature,
                    title: ui.title || (code ? `Mã ${code}` : `Voucher #${promoId}`),
                    percentageClaimed: percentageClaimed != null ? percentageClaimed : 0,
                    fullyClaimed,
                    fullyRedeemed,
                    disabled,
                    isAvailable
                  };

                  allVouchers.push(parsed);
                  if (isAvailable && promoId) {
                    backVouchers.push(parsed);
                  }
                }
              }

              return { vouchers: allVouchers, backVouchers };
            }
          }
        }
      }
    }
  } catch (tabErr) {
    console.warn('[Banner Watcher] Tab query fallback:', tabErr);
  }

  // 2. Direct Service Worker fetch fallback
  return await queryCollectionsVouchers(collectionsReqList, slug);
}

async function smartClaimBannerVoucher(promotionId, signature = '', voucherCode = '', slug = 'goi-ShopeeVIP') {
  // 1. Try in-page claim via Shopee tab first
  try {
    if (typeof chrome !== 'undefined' && chrome.scripting) {
      const tabInfo = await acquireShopeeTab();
      const tab = tabInfo ? tabInfo.tab : null;
      if (tab && tab.id) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: executeClaimBannerVoucherInPage,
          args: [promotionId, signature, voucherCode, slug]
        });

        if (results && results[0] && results[0].result) {
          const pageRes = results[0].result;
          if (pageRes.ok && pageRes.data) {
            const data = pageRes.data;

            // If captured directly from DOM toast notification, respect Shopee's official UI feedback 100%!
            if (data.from_dom_toast && data.message) {
              const isSuccess = data.error === 0 || data.error === 3;
              const targetCode = voucherCode || `PROMO_${promotionId}`;
              console.log(`[Shopee Saver] Bắt được thông báo Shopee trên màn hình [${targetCode}]: "${data.message}"`);
              return {
                success: isSuccess,
                alreadySaved: data.error === 3,
                code: targetCode,
                errCode: data.error,
                message: data.message,
                voucherData: data
              };
            }

            if (data.error === 0) {
              return { success: true, message: 'Lưu voucher thành công vào ví!', code: voucherCode || `PROMO_${promotionId}` };
            }
            const msg = formatShopeeError(data.error, extractShopeeMessage(data));
            console.warn(`[Banner Watcher] Tab claim rejected, trying direct API fallback: ${msg}`);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Banner Watcher] Tab claim error:', e);
  }

  // 2. Direct Service Worker fetch fallback
  return await claimBannerVoucher(promotionId, signature, voucherCode);
}

async function runBannerWatchCycle() {
  if (!bannerWatchState.isRunning) return;

  const now = Date.now();

  // Mode: WINDOW (Smart Window) timing handling
  if (bannerWatchState.mode === 'WINDOW' && bannerWatchState.targetTime) {
    const startWindow = bannerWatchState.targetTime - 4000; // start polling 4s before target time
    const endWindow = bannerWatchState.windowEndTime;

    if (now < startWindow) {
      const waitMs = startWindow - now;
      const targetTimeStr = new Date(bannerWatchState.targetTime).toLocaleTimeString('vi-VN');
      addBannerWatchLog(`⏳ Đang đếm ngược đến giờ G (${targetTimeStr}) - còn ${Math.ceil(waitMs / 1000)}s...`);
      const nextDelay = waitMs > 10000 ? 5000 : Math.max(500, waitMs);
      bannerWatchState.timerId = setTimeout(runBannerWatchCycle, nextDelay);
      return;
    }

    if (now > endWindow) {
      addBannerWatchLog(`🏁 Đã hoàn thành Dải Giờ Vàng (${bannerWatchState.windowDurationMins} phút). Săn được ${bannerWatchState.successCount} voucher.`);
      stopBannerWatch();
      return;
    }
  }

  // Ensure collections are loaded
  if (!bannerWatchState.collections || bannerWatchState.collections.length === 0) {
    const bannerInfo = await fetchBannerCollections(bannerWatchState.slug);
    if (bannerInfo.collections && bannerInfo.collections.length > 0) {
      bannerWatchState.collections = bannerInfo.collections;
      addBannerWatchLog(`✓ Đã nạp ${bannerInfo.collections.length} nhóm voucher từ ${bannerWatchState.slug}`);
    }
  }

  bannerWatchState.checkCount++;
  bannerWatchState.lastCheckTime = now;

  try {
    const res = await smartQueryBannerVouchers(bannerWatchState.collections, bannerWatchState.slug);
    const vouchers = res.vouchers || [];

    if (res.isLoginRequired) {
      // Suppress repeated login warnings — only log every 5 checks to avoid spam
      if (bannerWatchState.checkCount % 5 === 1) {
        addBannerWatchLog('⚠️ Chưa nhận diện phiên đăng nhập Shopee! Hãy mở shopee.vn và đăng nhập tài khoản.', 'warning');
      }
    } else if (vouchers.length > 0) {
      // Detect TRUE back events: voucher was fully_claimed in previous cycle, now has slots again
      const backVouchers = [];
      const firstScan = bannerWatchState.previousVoucherStates.size === 0;

      for (const v of vouchers) {
        if (!v.promotionId) continue;
        if (bannerWatchState.claimedPromoIds.has(v.promotionId)) continue;

        const prev = bannerWatchState.previousVoucherStates.get(v.promotionId);
        const wasFullyClaimed = prev ? (prev.fullyClaimed || prev.percentageClaimed >= 100) : false;
        const hasFailedClaim = bannerWatchState.failedClaimCounts.has(v.promotionId);
        const isNowAvailable = !v.fullyClaimed && !v.disabled && (v.percentageClaimed === null || v.percentageClaimed < 100);

        if (isNowAvailable) {
          if (firstScan || hasFailedClaim) {
            // On first scan: try to claim any available voucher
            backVouchers.push(v);
          } else if (wasFullyClaimed) {
            // On subsequent scans: only claim if THIS is a fresh back event
            backVouchers.push(v);
            addBannerWatchLog(`🔄 PHÁT HIỆN BACK MÃ: [${v.title}] (${v.percentageClaimed ?? 0}% đã nhận - vừa có lượt trở lại!)`, 'success');
          }
          // Otherwise it was already available and has not failed yet, so wait for a true back event.
        }

        // Update previous state for next cycle
        bannerWatchState.previousVoucherStates.set(v.promotionId, {
          fullyClaimed: v.fullyClaimed,
          percentageClaimed: v.percentageClaimed
        });
      }

      const totalVouchers = vouchers.length;
      const fullyClaimedCount = vouchers.filter(v => v.fullyClaimed || v.percentageClaimed >= 100).length;
      const partialCount = vouchers.filter(v => !v.fullyClaimed && !v.disabled && v.percentageClaimed < 100 && v.percentageClaimed > 0).length;

      if (backVouchers.length === 0) {
        // Log a compact status: show percentage breakdown
        const statusParts = [];
        if (fullyClaimedCount === totalVouchers) {
          statusParts.push('Hết lượt (100%) - Chờ nhả mã...');
        } else if (partialCount > 0) {
          const pcts = vouchers
            .filter(v => !v.fullyClaimed && v.percentageClaimed > 0 && v.percentageClaimed < 100)
            .map(v => `${Math.round(v.percentageClaimed)}%`)
            .join(', ');
          statusParts.push(`Có voucher chưa hết lượt (${pcts} đã nhận) - đang theo dõi back mã...`);
        } else {
          statusParts.push(`${totalVouchers} voucher đang quét`);
        }
        if (bannerWatchState.checkCount % 3 === 1) {
          addBannerWatchLog(`[Lần #${bannerWatchState.checkCount}] ${statusParts.join(' | ')}`);
        }
      } else {
        if (!firstScan) {
          // Already logged individual back events above
        } else {
          addBannerWatchLog(`🔥 Quét lần đầu: ${backVouchers.length} mã có sẵn lượt — tiến hành lưu...`, 'success');
        }

        for (const v of backVouchers) {
          if (bannerWatchState.claimedPromoIds.has(v.promotionId)) continue;

          addBannerWatchLog(`⚡ Đang lưu: [${v.title}] (${v.percentageClaimed ?? 0}% đã nhận, Promo: ${v.promotionId})...`);
          const claimRes = await smartClaimBannerVoucher(v.promotionId, v.signature, v.voucherCode, bannerWatchState.slug);

          if (claimRes.success) {
            bannerWatchState.claimedPromoIds.add(v.promotionId);
            bannerWatchState.failedClaimCounts.delete(v.promotionId);
            bannerWatchState.successCount++;

            addBannerWatchLog(`🎉 ✅ LƯU THÀNH CÔNG: [${v.title}] vào ví Shopee!`, 'success');

            await appendHistory({
              code: v.voucherCode || `PROMO_${v.promotionId}`,
              status: 'SUCCESS',
              message: `Mã back từ banner [${bannerWatchState.slug}]: ${v.title}`,
              time: new Date().toLocaleTimeString('vi-VN'),
              date: new Date().toLocaleDateString('vi-VN')
            });

            broadcast({
              type: 'BANNER_VOUCHER_SAVED',
              voucher: v,
              state: getBannerWatchSummary()
            });
          } else {
            // Track consecutive failures
            const prevFails = bannerWatchState.failedClaimCounts.get(v.promotionId) || 0;
            const newFails = prevFails + 1;
            bannerWatchState.failedClaimCounts.set(v.promotionId, newFails);

            const errDetail = claimRes.errCode ? ` [mã lỗi: ${claimRes.errCode}]` : '';
            addBannerWatchLog(`Lưu [${v.title}] thất bại (lần ${newFails}): ${claimRes.message}${errDetail}`, 'warning');

            // Only stop retrying when Shopee confirms this account already has the voucher (error 3 / 140003).
            // Error 4 is invalid/ineligible and must NOT be treated as already saved.
            const isAlreadySaved = isAlreadySavedResult(claimRes.errCode, claimRes.message);

            if (isAlreadySaved) {
              bannerWatchState.claimedPromoIds.add(v.promotionId);
              addBannerWatchLog(`Bỏ qua [${v.title}] vì Shopee xác nhận mã đã có trong ví.`, 'warning');
            }
          }
        }
      }
    } else if (bannerWatchState.collections.length > 0) {
      // API returned 0 vouchers despite having collections — usually means tab is not ready yet
      addBannerWatchLog(`[Lần #${bannerWatchState.checkCount}] Đang kết nối API Shopee... (${bannerWatchState.collections.length} nhóm voucher)`);
    } else {
      addBannerWatchLog(`[Lần #${bannerWatchState.checkCount}] Đang tải danh sách voucher từ banner [${bannerWatchState.slug}]...`);
    }
  } catch (err) {
    addBannerWatchLog(`Lỗi quét mã: ${err.message}`, 'error');
  }

  // Calculate next interval
  let nextInterval = bannerWatchState.intervalMs;
  if (bannerWatchState.mode === 'WINDOW') {
    // Faster polling during active window (e.g. 2s)
    nextInterval = Math.min(2000, bannerWatchState.intervalMs);
  }

  if (bannerWatchState.isRunning) {
    bannerWatchState.timerId = setTimeout(runBannerWatchCycle, nextInterval);
  }
}

// Listen for messages from UI / Content Scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { type, payload } = request;

  switch (type) {
    case 'CHECK_LOGIN':
      checkLoginStatus().then(sendResponse);
      return true;

    case 'GET_SERVER_TIME':
      getShopeeServerTime().then(sendResponse);
      return true;

    case 'SAVE_SINGLE_VOUCHER':
      smartSaveVoucher(payload.code).then(async res => {
        const isSuccess = res.success || res.alreadySaved;
        await appendHistory({
          code: payload.code,
          status: res.alreadySaved ? 'ALREADY_SAVED' : (isSuccess ? 'SUCCESS' : 'FAILED'),
          message: res.message,
          time: new Date().toLocaleTimeString('vi-VN'),
          date: new Date().toLocaleDateString('vi-VN')
        });
        sendResponse(res);
      });
      return true;

    case 'START_BATCH_SAVE':
      runBatchSave(payload).then(sendResponse);
      return true;

    case 'STOP_BATCH_SAVE':
      if (activeBatchTask) {
        activeBatchTask.isCancelled = true;
        activeBatchTask.isFinished = true;
      }
      closeTempShopeeTab();
      sendResponse({ status: 'stopped' });
      return false;

    case 'GET_BATCH_STATUS':
      sendResponse({ activeBatchTask });
      return false;

    case 'CLAIM_PROMOTION':
      claimVoucherPromotion(payload.voucherPromotionId, payload.signature).then(sendResponse);
      return true;

    case 'GET_USER_VOUCHERS':
      getUserVouchers(payload?.limit || 100, payload?.offset || 0).then(async res => {
        if (res && res.vouchers && res.vouchers.length > 0) {
          sendResponse(res);
          return;
        }

        // Fallback 1: Query any open Shopee tab or acquire single tab
        try {
          const tabInfo = await acquireShopeeTab();
          const targetTab = tabInfo ? tabInfo.tab : null;
          if (targetTab && targetTab.id) {
            try {
              const tabRes = await new Promise((resolve) => {
                chrome.tabs.sendMessage(targetTab.id, { type: 'PAGE_FETCH_WALLET_VOUCHERS' }, res => {
                  if (chrome.runtime.lastError) { resolve(null); return; }
                  resolve(res);
                });
              });
              if (tabInfo.isTemporary) {
                scheduleCloseTempShopeeTab(1500);
              }
              if (tabRes && tabRes.vouchers && tabRes.vouchers.length > 0) {
                sendResponse({ ...tabRes, isLoggedIn: true });
                return;
              }
            } catch (e) {
              if (tabInfo.isTemporary) {
                scheduleCloseTempShopeeTab(1000);
              }
            }
          }
        } catch (e) { }

        // Fallback 2: Check cached vouchers in storage
        const { cachedWalletVouchers = [] } = await chrome.storage.local.get('cachedWalletVouchers');
        if (cachedWalletVouchers.length > 0) {
          sendResponse({ vouchers: cachedWalletVouchers, total: cachedWalletVouchers.length, isLoggedIn: true, isCached: true });
          return;
        }

        sendResponse(res);
      });
      return true;

    case 'ZALO_MESSAGE_DETECTED':
      handleZaloMessage(payload);
      sendResponse({ received: true });
      return false;

    case 'AUTO_CLAIM_FINISHED': {
      const tabId = sender?.tab?.id;
      const count = payload?.count || request?.count || 0;
      console.log(`[Auto-Claim Link] Tab #${tabId} đã hoàn tất lưu voucher: ${count} mã`);
      if (tabId && activeAutoClaimTabs.has(tabId)) {
        activeAutoClaimTabs.delete(tabId);
        setTimeout(() => {
          chrome.tabs.remove(tabId).catch(() => { });
          console.log(`[Auto-Claim Link] Đã đóng tab #${tabId} sau khi hoàn tất.`);
        }, 1200);
      }
      sendResponse({ received: true });
      return false;
    }

    case 'SCHEDULE_HUNT': {
      const { targetTimestamp, codes, delayMs, leadTimeMs = 50 } = payload;
      const targetTime = targetTimestamp - leadTimeMs;
      const delayUntilRun = targetTime - Date.now();

      if (delayUntilRun <= 0) {
        runBatchSave({ codes, delayMs, isScheduled: true });
        sendResponse({ success: true, message: 'Đã kích hoạt ngay lập tức!' });
        return false;
      }

      chrome.alarms.clear('voucher_hunt_alarm');
      if (scheduledTimers.has('hunt')) {
        clearTimeout(scheduledTimers.get('hunt'));
      }

      chrome.alarms.create('voucher_hunt_alarm', {
        when: targetTime
      });

      const timerId = setTimeout(() => {
        runBatchSave({ codes, delayMs, isScheduled: true });
        scheduledTimers.delete('hunt');
      }, delayUntilRun);

      scheduledTimers.set('hunt', timerId);

      chrome.storage.local.set({
        activeSchedule: {
          targetTimestamp,
          leadTimeMs,
          codes,
          delayMs,
          createdAt: Date.now()
        }
      });

      sendResponse({
        success: true,
        message: `Đã hẹn giờ săn lúc ${new Date(targetTimestamp).toLocaleTimeString('vi-VN')}`,
        delayUntilRun
      });
      return false;
    }

    case 'CANCEL_SCHEDULE': {
      chrome.alarms.clear('voucher_hunt_alarm');
      if (scheduledTimers.has('hunt')) {
        clearTimeout(scheduledTimers.get('hunt'));
        scheduledTimers.delete('hunt');
      }
      chrome.storage.local.remove('activeSchedule');
      sendResponse({ success: true, message: 'Đã hủy lịch hẹn săn voucher!' });
      return false;
    }

    case 'OPEN_DASHBOARD':
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
      sendResponse({ success: true });
      return false;

    case 'ENSURE_ZALO_TAB':
      ensureZaloBackgroundTab().then(sendResponse);
      return true;

    case 'CLOSE_ZALO_TAB':
      closeZaloBackgroundTab().then(sendResponse);
      return true;

    case 'CHECK_ZALO_TAB':
      chrome.tabs.query({ url: '*://chat.zalo.me/*' }).then(tabs => {
        sendResponse({ hasZaloTab: tabs && tabs.length > 0 });
      });
      return true;

    case 'GET_SHOPEE_COOKIES':
      // Return Shopee cookies to dashboard/popup safely from background context (no CORS)
      getAllShopeeCookies().then(cookies => {
        const spcU = cookies.find(c => c.name === 'SPC_U')?.value || '';
        const spcEc = cookies.find(c => c.name === 'SPC_EC')?.value || '';
        const csrf = cookies.find(c => c.name === 'csrftoken')?.value || '';
        sendResponse({ spcU, spcEc, csrf, allCookies: cookies });
      });
      return true;

    case 'START_BANNER_WATCH':
      startBannerWatch(payload).then(sendResponse);
      return true;

    case 'STOP_BANNER_WATCH':
      sendResponse(stopBannerWatch());
      return false;

    case 'GET_BANNER_WATCH_STATUS':
      sendResponse(getBannerWatchSummary());
      return false;

    case 'GET_ZALO_QUEUE_STATUS':
      getZaloVoucherQueue().then(q => sendResponse({ success: true, queue: q.getSnapshot() }));
      return true;

    case 'ZALO_QUEUE_PAUSE':
      getZaloVoucherQueue().then(q => {
        q.pause();
        sendResponse({ success: true, queue: q.getSnapshot() });
      });
      return true;

    case 'ZALO_QUEUE_RESUME':
      getZaloVoucherQueue().then(q => {
        q.resume();
        sendResponse({ success: true, queue: q.getSnapshot() });
      });
      return true;

    case 'ZALO_QUEUE_CLEAR':
      getZaloVoucherQueue().then(q => {
        q.clearPending();
        sendResponse({ success: true, queue: q.getSnapshot() });
      });
      return true;

    case 'ZALO_QUEUE_RESET_MEMORY':
      getZaloVoucherQueue().then(q => {
        q.resetSeenMemory();
        sendResponse({ success: true, queue: q.getSnapshot() });
      });
      return true;

    case 'ZALO_QUEUE_SET_DELAY': {
      const nextDelay = Math.max(3000, Number(payload?.delayMs) || 6000);
      zaloQueueDelayMs = nextDelay;
      chrome.storage.local.set({ zaloQueueDelayMs: nextDelay }).catch(() => {});
      getZaloVoucherQueue().then(q => {
        q.setDelayMs(nextDelay);
        sendResponse({ success: true, queue: q.getSnapshot() });
      });
      return true;
    }

    case 'FETCH_BANNER_INFO':
      fetchBannerCollections(payload?.url || 'goi-ShopeeVIP').then(sendResponse);
      return true;

    default:
      sendResponse({ error: 'Unknown message type' });
      return false;
  }
});

async function ensureZaloBackgroundTab() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://chat.zalo.me/*' });
    if (tabs && tabs.length > 0) {
      return { success: true, alreadyOpen: true };
    }
    const tab = await chrome.tabs.create({
      url: 'https://chat.zalo.me',
      active: false,
      pinned: true
    });
    return { success: true, tabId: tab.id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function closeZaloBackgroundTab() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://chat.zalo.me/*' });
    for (const tab of tabs) {
      await chrome.tabs.remove(tab.id).catch(() => { });
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Chrome Alarm Handler
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'voucher_hunt_alarm') {
    const { activeSchedule } = await chrome.storage.local.get('activeSchedule');
    if (activeSchedule && activeSchedule.codes && activeSchedule.codes.length > 0) {
      runBatchSave({
        codes: activeSchedule.codes,
        delayMs: activeSchedule.delayMs || 300,
        isScheduled: true
      });
      chrome.storage.local.remove('activeSchedule');
    }
  }
});
