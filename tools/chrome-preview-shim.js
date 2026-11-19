/**
 * Browser Preview Compatibility Shim for Chrome Extension APIs.
 * Activates ONLY when opened outside an unpacked Chrome Extension (e.g. local dev server preview).
 * In a real Chrome Extension environment, chrome.runtime.id exists and this shim exits immediately.
 */
import { normalizeSaveResult } from '../utils/parser.js';

(function initPreviewShim() {
  const isRealExtension =
    typeof window.chrome !== 'undefined' &&
    window.chrome.runtime &&
    typeof window.chrome.runtime.id === 'string' &&
    window.chrome.runtime.id.length > 0;

  if (isRealExtension) return;

  window.__SHOPEE_PREVIEW_MODE__ = true;
  const STORAGE_PREFIX = 'sv_preview_store_';
  const runtimeListeners = [];
  const storageListeners = [];

  const DEFAULT_ZALO_STREAM = [
    {
      id: 'demo_zalo_1',
      groupName: '[23] LONGHOUSEE',
      senderName: 'Admin Săn Sale',
      text: '⏰ 12:00:05: Back Mã SHOPEE50K giảm 50K đơn từ 250K toàn sàn. Lưu nhanh tại https://s.shopee.vn/70JKmob0V7',
      codes: ['SHOPEE50K', 'SAVEDVIP99'],
      links: ['https://s.shopee.vn/70JKmob0V7'],
      results: [
        { code: 'SHOPEE50K', success: true, alreadySaved: false, status: 'success', message: 'Lưu thành công vào ví!' },
        { code: 'SAVEDVIP99', success: true, alreadySaved: true, status: 'already_saved', message: 'Mã voucher đã có sẵn trong ví của bạn!' }
      ],
      timeStr: '12:00:05',
      timestamp: Date.now() - 120000
    },
    {
      id: 'demo_zalo_2',
      groupName: '[23] LONGHOUSEE',
      senderName: 'Bot Báo Mã',
      text: 'Back mã HETLUOT99 giảm 100K/500K ShopeeVIP — số lượng có hạn!',
      codes: ['HETLUOT99'],
      links: [],
      results: [
        { code: 'HETLUOT99', success: false, alreadySaved: false, status: 'failed', message: 'Mã giảm giá đã hết lượt sử dụng / hết ngân sách [lỗi 2]' }
      ],
      timeStr: '11:58:42',
      timestamp: Date.now() - 240000
    }
  ];

  function readStorageKey(key) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      if (raw !== null) return JSON.parse(raw);
    } catch (_) {}
    if (key === 'zaloStream') return DEFAULT_ZALO_STREAM;
    return undefined;
  }

  function writeStorageKey(key, value) {
    const oldValue = readStorageKey(key);
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    } catch (_) {}
    const change = { [key]: { oldValue, newValue: value } };
    storageListeners.forEach((fn) => {
      try { fn(change, 'local'); } catch (_) {}
    });
  }

  function removeStorageKey(key) {
    try {
      localStorage.removeItem(STORAGE_PREFIX + key);
    } catch (_) {}
  }

  function emitRuntimeMessage(msg) {
    runtimeListeners.forEach((fn) => {
      try { fn(msg, {}, () => {}); } catch (_) {}
    });
  }

  function simulateShopeeResponse(code) {
    const upper = String(code || '').trim().toUpperCase();
    if (/SAVED|EXIST|DACO|VIP99/i.test(upper)) {
      return normalizeSaveResult(upper, { error: 140003 }, 'Shopee App RN');
    }
    if (/HET|EXPIRED|OUT|FULL/i.test(upper)) {
      return normalizeSaveResult(upper, { error: 140002 }, 'Shopee App RN');
    }
    if (/CHUA|WAIT|0H|LATER/i.test(upper)) {
      return normalizeSaveResult(upper, { error: 7 }, 'Shopee App RN');
    }
    if (/INVALID|SAI|BAD|ERR|FAIL/i.test(upper)) {
      return normalizeSaveResult(upper, { error: 4, error_msg: 'not eligible condition' }, 'Shopee App RN');
    }
    return normalizeSaveResult(
      upper,
      { error: 0, data: { title: `Ưu đãi Shopee (${upper})` } },
      'Shopee App RN'
    );
  }

  let activeBatchCancelled = false;
  let bannerState = {
    isRunning: false,
    mode: 'WINDOW',
    url: 'https://shopee.vn/m/goi-ShopeeVIP',
    slug: 'goi-ShopeeVIP',
    collectionsCount: 3,
    checkCount: 0,
    successCount: 0,
    lastStatusText: 'Đang chờ bắt đầu...'
  };
  let bannerTimer = null;

  async function runPreviewBatch({ codes = [], delayMs = 1200 }) {
    activeBatchCancelled = false;
    const stepDelay = Math.min(450, Math.max(180, Math.round(delayMs / 5)));

    emitRuntimeMessage({ type: 'BATCH_STARTED', total: codes.length });

    let successCount = 0;
    let alreadySavedCount = 0;
    let failCount = 0;
    const results = [];

    for (let i = 0; i < codes.length; i++) {
      if (activeBatchCancelled) break;
      const code = codes[i];

      emitRuntimeMessage({
        type: 'BATCH_PROGRESS',
        current: i + 1,
        total: codes.length,
        currentCode: code
      });

      await new Promise((r) => setTimeout(r, stepDelay));
      if (activeBatchCancelled) break;

      const res = simulateShopeeResponse(code);
      const item = {
        ...res,
        timestamp: Date.now()
      };

      if (res.status === 'success') {
        successCount++;
      } else if (res.status === 'already_saved') {
        successCount++;
        alreadySavedCount++;
      } else {
        failCount++;
      }

      results.push(item);

      emitRuntimeMessage({
        type: 'VOUCHER_RESULT',
        result: item,
        current: i + 1,
        total: codes.length
      });
    }

    const summary = {
      total: codes.length,
      successCount,
      alreadySavedCount,
      failCount,
      results
    };

    emitRuntimeMessage({ type: 'BATCH_COMPLETED', summary });
    return summary;
  }

  window.chrome = {
    runtime: {
      id: '',
      lastError: null,
      getURL: (p) => (p && p.startsWith('/') ? p : `/${p || ''}`),
      onMessage: {
        addListener: (fn) => runtimeListeners.push(fn)
      },
      sendMessage: (req, cb) => {
        const respond = (val) => {
          if (typeof cb === 'function') setTimeout(() => cb(val), 10);
        };

        switch (req?.type) {
          case 'CHECK_LOGIN':
            respond({
              isLoggedIn: true,
              username: 'shopee_hunter_vn',
              userId: '88421095',
              avatar: '../assets/icon48.png'
            });
            return;

          case 'GET_SERVER_TIME':
            respond({ serverTime: Date.now(), localTime: Date.now(), offsetMs: 12 });
            return;

          case 'START_BATCH_SAVE':
            runPreviewBatch(req.payload || {}).then(respond);
            return;

          case 'STOP_BATCH_SAVE':
            activeBatchCancelled = true;
            respond({ status: 'stopped' });
            return;

          case 'CHECK_ZALO_TAB':
            respond({ hasZaloTab: Boolean(readStorageKey('previewZaloTabOpen')) });
            return;

          case 'ENSURE_ZALO_TAB':
            writeStorageKey('previewZaloTabOpen', true);
            respond({ success: true });
            return;

          case 'CLOSE_ZALO_TAB':
            writeStorageKey('previewZaloTabOpen', false);
            respond({ success: true });
            return;

          case 'SCHEDULE_HUNT':
            writeStorageKey('activeSchedule', {
              ...(req.payload || {}),
              createdAt: Date.now()
            });
            respond({ success: true, message: 'Đã kích hoạt hẹn giờ săn mã!' });
            return;

          case 'CANCEL_SCHEDULE':
            removeStorageKey('activeSchedule');
            respond({ success: true });
            return;

          case 'FETCH_BANNER_INFO':
            respond({
              slug: 'goi-ShopeeVIP',
              collections: [
                { collection_id: '101' },
                { collection_id: '102' },
                { collection_id: '103' }
              ]
            });
            return;

          case 'START_BANNER_WATCH':
            bannerState = {
              ...bannerState,
              ...(req.payload || {}),
              isRunning: true,
              checkCount: 1,
              collectionsCount: 3,
              lastStatusText: 'Đang rà soát API Shopee theo thời gian thực...'
            };
            respond({ success: true, state: bannerState });
            emitRuntimeMessage({
              type: 'BANNER_WATCH_LOG',
              entry: {
                time: new Date().toLocaleTimeString('vi-VN'),
                text: 'Đã nạp 3 nguồn dữ liệu voucher từ banner [goi-ShopeeVIP]. Đang theo dõi mã back...',
                level: 'success'
              },
              state: bannerState
            });
            if (bannerTimer) clearInterval(bannerTimer);
            bannerTimer = setInterval(() => {
              if (!bannerState.isRunning) return;
              bannerState.checkCount += 1;
              emitRuntimeMessage({
                type: 'BANNER_WATCH_LOG',
                entry: {
                  time: new Date().toLocaleTimeString('vi-VN'),
                  text: `[Lần #${bannerState.checkCount}] Đang theo dõi quota 3 nhóm voucher (chờ lượt back mã)...`,
                  level: 'info'
                },
                state: bannerState
              });
            }, 3000);
            return;

          case 'STOP_BANNER_WATCH':
            bannerState.isRunning = false;
            if (bannerTimer) {
              clearInterval(bannerTimer);
              bannerTimer = null;
            }
            emitRuntimeMessage({ type: 'BANNER_WATCH_STATUS', state: bannerState });
            respond({ success: true, status: 'stopped' });
            return;

          case 'GET_BANNER_WATCH_STATUS':
            respond(bannerState);
            return;

          case 'OPEN_DASHBOARD':
            window.location.href = '/dashboard/dashboard.html';
            respond({ success: true });
            return;

          default:
            respond({ success: true });
        }
      }
    },
    storage: {
      local: {
        get: (keys, cb) => {
          const result = {};
          const keyList = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
          keyList.forEach((k) => {
            const val = readStorageKey(k);
            if (val !== undefined) result[k] = val;
          });
          if (typeof cb === 'function') cb(result);
          return Promise.resolve(result);
        },
        set: (obj, cb) => {
          Object.entries(obj || {}).forEach(([k, v]) => writeStorageKey(k, v));
          if (typeof cb === 'function') cb();
          return Promise.resolve();
        },
        remove: (keys, cb) => {
          const keyList = Array.isArray(keys) ? keys : [keys];
          keyList.forEach(removeStorageKey);
          if (typeof cb === 'function') cb();
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener: (fn) => storageListeners.push(fn)
      }
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://shopee.vn/m/ma-giam-gia', active: true }],
      create: async ({ url }) => {
        if (url && !url.startsWith('http')) {
          window.location.href = url;
        }
        return { id: 2, url };
      },
      sendMessage: (tabId, req, cb) => {
        if (req?.type === 'PAGE_GET_VOUCHER_COUNT') {
          if (cb) cb({ count: 6 });
        } else if (req?.type === 'PAGE_COLLECT_ALL') {
          if (cb) cb({ count: 6 });
        } else if (req?.type === 'PAGE_SCROLL_COLLECT') {
          if (cb) cb({ success: true });
        }
      }
    }
  };
})();
