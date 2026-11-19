/**
 * Shopee VN API Client for Chrome Extension
 * Handles voucher saving, promotion claiming, wallet querying, and server time synchronization.
 */

import { formatShopeeError, extractShopeeMessage, normalizeSaveResult } from './parser.js';

const SHOPEE_DOMAIN = 'https://shopee.vn';

/**
 * Get all cookies for shopee.vn (both from direct URL and wildcard domain)
 * @returns {Promise<chrome.cookies.Cookie[]>}
 */
export async function getAllShopeeCookies() {
  try {
    if (typeof chrome !== 'undefined' && chrome.cookies) {
      const list1 = await chrome.cookies.getAll({ url: SHOPEE_DOMAIN }).catch(() => []);
      const list2 = await chrome.cookies.getAll({ domain: 'shopee.vn' }).catch(() => []);
      const map = new Map();
      [...list1, ...list2].forEach(c => map.set(c.name, c));
      return Array.from(map.values());
    }
  } catch (e) {
    console.warn('Error getting shopee cookies:', e);
  }
  return [];
}

/**
 * Helper to get a cookie value for shopee.vn
 * @param {string} name 
 * @returns {Promise<string|null>}
 */
export async function getCookie(name) {
  try {
    if (typeof chrome !== 'undefined' && chrome.cookies) {
      const all = await getAllShopeeCookies();
      const match = all.find(c => c.name === name);
      return match ? match.value : null;
    }
  } catch (e) {
    console.warn(`Error getting cookie ${name}:`, e);
  }
  return null;
}

/**
 * Get the current CSRF token from Shopee cookies
 * @returns {Promise<string>}
 */
export async function getCsrfToken() {
  const token = await getCookie('csrftoken');
  return token || '';
}

/**
 * Check if the user is currently logged in to Shopee
 * Checks cookies (SPC_U, SPC_EC, shopee_token) and open tab native context
 * @returns {Promise<{isLoggedIn: boolean, username?: string, avatar?: string, userId?: number|string}>}
 */
export async function checkLoginStatus() {
  try {
    // 1. Inspect Cookies first
    const allCookies = await getAllShopeeCookies();
    const spcU = allCookies.find(c => c.name === 'SPC_U');
    const spcEc = allCookies.find(c => c.name === 'SPC_EC');
    const shopeeToken = allCookies.find(c => c.name === 'shopee_token');
    const csrfToken = allCookies.find(c => c.name === 'csrftoken')?.value || '';

    const hasValidUid = spcU && spcU.value && spcU.value !== '-' && spcU.value !== '0';
    const hasLoginCookie = hasValidUid || (spcEc && spcEc.value) || (shopeeToken && shopeeToken.value);

    // 2. Try querying open Shopee tab first (native session cookies guaranteed)
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        const shopeeTabs = await chrome.tabs.query({ url: '*://*.shopee.vn/*' });
        if (shopeeTabs && shopeeTabs.length > 0) {
          for (const tab of shopeeTabs) {
            try {
              const tabRes = await new Promise((resolve) => {
                chrome.tabs.sendMessage(tab.id, { type: 'PAGE_GET_USER_INFO' }, res => {
                  if (chrome.runtime.lastError) { resolve(null); return; }
                  resolve(res);
                });
              });
              if (tabRes && tabRes.isLoggedIn) {
                return tabRes;
              }
            } catch (e) {}
          }
        }
      }
    } catch (e) {}

    // 3. Try primary account info endpoint using CORS-safe headers
    // Note: Do NOT include 'x-requested-with' or 'x-api-source' in direct Service Worker / Extension fetch 
    // because Shopee's preflight (OPTIONS) rejects custom headers without Access-Control-Allow-Headers.
    const safeHeaders = {
      'Accept': 'application/json'
    };
    if (csrfToken) safeHeaders['x-csrftoken'] = csrfToken;

    const endpoints = [
      `${SHOPEE_DOMAIN}/api/v4/account/basic/get_account_info`,
      `${SHOPEE_DOMAIN}/api/v2/user/profile/get`
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: safeHeaders,
          credentials: 'include'
        });

        if (res.ok) {
          const data = await res.json();
          const info = data?.data || data;
          if (info && (info.username || info.userid || info.shopid || info.phone)) {
            return {
              isLoggedIn: true,
              username: info.username || (info.phone ? `Shopee (${info.phone})` : `User ${info.userid || ''}`),
              avatar: info.avatar ? `https://cf.shopee.vn/file/${info.avatar}` : null,
              userId: info.userid || info.shopid || (spcU ? spcU.value : 'Shopee VN')
            };
          }
        }
      } catch (e) {}
    }

    // 4. Cookie fallback: if SPC_U or SPC_EC is present, user is 100% authenticated
    if (hasLoginCookie) {
      const uid = hasValidUid ? spcU.value : 'Đã đăng nhập';
      return {
        isLoggedIn: true,
        username: `Tài khoản Shopee (${uid})`,
        userId: uid
      };
    }

    return { isLoggedIn: false };
  } catch (err) {
    console.error('Check login error:', err);
    return { isLoggedIn: false };
  }
}

/**
 * Fetch official server time from Shopee and calculate local clock offset
 * Reads the official HTTP 'date' header from Shopee.vn response
 * @returns {Promise<{serverTime: number, localTime: number, offsetMs: number}>}
 */
export async function getShopeeServerTime() {
  const startSend = Date.now();
  try {
    // 1. Fetch Shopee domain with HEAD request (fastest, lightweight, 100% returns official server Date header)
    const headRes = await fetch(`${SHOPEE_DOMAIN}?_t=${startSend}`, {
      method: 'HEAD',
      cache: 'no-store'
    });
    const receiveTime = Date.now();
    const roundTrip = (receiveTime - startSend) / 2;

    const dateHeader = headRes.headers.get('date');
    if (dateHeader) {
      const serverTimeParsed = new Date(dateHeader).getTime();
      if (!isNaN(serverTimeParsed) && serverTimeParsed > 0) {
        const accurateServerTime = serverTimeParsed + Math.round(roundTrip);
        return {
          serverTime: accurateServerTime,
          localTime: receiveTime,
          offsetMs: accurateServerTime - receiveTime
        };
      }
    }
  } catch (err) {
    console.warn('Server time fetch via HEAD date header failed, using fallback:', err);
  }

  return {
    serverTime: Date.now(),
    localTime: Date.now(),
    offsetMs: 0
  };
}

/**
 * Save a single voucher code into Shopee user wallet
 * @param {string} voucherCode 
 * @returns {Promise<{success: boolean, code: string, errCode: number, message: string, voucherData?: any}>}
 */
export async function saveVoucherByCode(voucherCode) {
  const cleanCode = voucherCode.trim().toUpperCase();
  const csrfToken = await getCsrfToken();

  // Multi-tier source simulation: Prioritize Mobile App (React Native & Native App) to bypass PC account filters
  const sourceAttempts = [
    { apiSource: 'rn', callerSource: 'RN_SHOPEE', label: 'Shopee App RN' },
    { apiSource: 'app', callerSource: 'APP_SHOPEE', label: 'Shopee App' },
    { apiSource: 'pc', callerSource: 'MICROSITE_SHOPEE', label: 'Shopee Web' }
  ];

  let lastErrorData = null;

  for (const attempt of sourceAttempts) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-shopee-language': 'vi',
      'x-requested-with': attempt.apiSource === 'pc' ? 'XMLHttpRequest' : 'com.shopee.vn',
      'x-api-source': attempt.apiSource
    };
    if (csrfToken) {
      headers['x-csrftoken'] = csrfToken;
    }

    try {
      // 1. Try saving via v2 endpoint with simulated mobile source
      let res;
      try {
        res = await fetch(`${SHOPEE_DOMAIN}/api/v2/voucher_wallet/save_voucher`, {
          method: 'POST',
          headers,
          referrer: 'https://shopee.vn/user/voucher-wallet',
          referrerPolicy: 'strict-origin-when-cross-origin',
          body: JSON.stringify({
            voucher_code: cleanCode,
            need_user_voucher_status: true,
            caller_source: attempt.callerSource
          }),
          credentials: 'include'
        });
      } catch (corsErr) {
        res = await fetch(`${SHOPEE_DOMAIN}/api/v2/voucher_wallet/save_voucher`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          referrer: 'https://shopee.vn/user/voucher-wallet',
          referrerPolicy: 'strict-origin-when-cross-origin',
          body: JSON.stringify({
            voucher_code: cleanCode,
            need_user_voucher_status: true,
            caller_source: attempt.callerSource
          }),
          credentials: 'include'
        });
      }

      const data = await res.json();
      lastErrorData = data;

      if (data.error === 0 || data.error === 3 || data.error === 140003) {
        return normalizeSaveResult(cleanCode, data, attempt.label);
      }

      // 2. Try active v4 microsite endpoint with simulated mobile source
      const v4Result = await trySaveVoucherMicrositeV4(cleanCode, headers, attempt.callerSource);
      if (v4Result && (v4Result.success || v4Result.alreadySaved)) {
        return v4Result;
      }

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
    } catch (err) {
      // Continue to next attempt
    }
  }

  if (lastErrorData) {
    const normalized = normalizeSaveResult(cleanCode, lastErrorData);
    console.log(`[Shopee Voucher Saver] Phản hồi khi lưu [${cleanCode}] (${normalized.status}): "${normalized.message}"`);
    return normalized;
  }

  return {
    success: false,
    alreadySaved: false,
    status: 'failed',
    code: cleanCode,
    errCode: -1,
    message: 'Không thể kết nối tới máy chủ Shopee (đã thử cả Mobile App & Web)'
  };
}

/**
 * Fallback to active v4 microsite endpoint for voucher save with mobile source
 */
async function trySaveVoucherMicrositeV4(voucherCode, headers, callerSource = 'RN_SHOPEE') {
  try {
    const res = await fetch(`${SHOPEE_DOMAIN}/api/v4/microsite/save_voucher`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        voucher_code: voucherCode,
        caller_source: callerSource
      }),
      credentials: 'include'
    });
    const data = await res.json();
    if (data.error === 0 || data.error === 3 || data.error === 140003) {
      return normalizeSaveResult(voucherCode, data, 'v4 Mobile');
    }
  } catch (e) {
    // Ignore fallback error
  }
  return null;
}

/**
 * Claim voucher promotion (from banner / campaign button / promotion id)
 * @param {number|string} voucherPromotionId 
 * @param {string} [signature] 
 * @returns {Promise<{success: boolean, errCode: number, message: string}>}
 */
export async function claimVoucherPromotion(voucherPromotionId, signature = '') {
  const csrfToken = await getCsrfToken();
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-shopee-language': 'vi',
    'x-requested-with': 'XMLHttpRequest',
    'x-api-source': 'pc'
  };
  if (csrfToken) headers['x-csrftoken'] = csrfToken;

  try {
    let res;
    try {
      res = await fetch(`${SHOPEE_DOMAIN}/api/v2/voucher_wallet/save_voucher`, {
        method: 'POST',
        headers,
        referrer: 'https://shopee.vn/user/voucher-wallet',
        referrerPolicy: 'strict-origin-when-cross-origin',
        body: JSON.stringify({
          voucher_promotion_id: Number(voucherPromotionId),
          signature: signature || undefined
        }),
        credentials: 'include'
      });
    } catch (corsErr) {
      res = await fetch(`${SHOPEE_DOMAIN}/api/v2/voucher_wallet/save_voucher`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        referrer: 'https://shopee.vn/user/voucher-wallet',
        referrerPolicy: 'strict-origin-when-cross-origin',
        body: JSON.stringify({
          voucher_promotion_id: Number(voucherPromotionId),
          signature: signature || undefined
        }),
        credentials: 'include'
      });
    }

    const data = await res.json();
    return normalizeSaveResult(`PROMO_${voucherPromotionId}`, data);
  } catch (err) {
    return {
      success: false,
      alreadySaved: false,
      status: 'failed',
      errCode: -1,
      message: `Lỗi kết nối tới Shopee: ${err.message}`
    };
  }
}

/**
 * Normalize voucher object from various Shopee API structures
 */
function normalizeVoucherItem(v) {
  if (!v) return null;
  const info = v.voucher_info || v;

  const voucherCode = v.voucher_code || info.voucher_code || v.voucher_code_str || v.code || (info.discount_value ? `VC_${info.discount_value}` : 'VOUCHER');
  const title = v.title || info.title || info.voucher_name || info.name || 'Mã giảm giá Shopee';
  const minSpend = v.min_spend || info.min_spend || info.min_order_amount || info.min_spend_str || '';
  const discountValue = v.discount_value || info.discount_value || info.discount_percentage || '';
  const endTime = v.end_time || info.end_time || info.expire_time || info.end_timestamp || 0;
  const shopId = v.shop_id || info.shop_id || 0;
  const shopName = v.shop_name || info.shop_name || '';
  const iconUrl = v.icon_url || info.icon_url || '';
  const usageTerms = v.usage_terms || info.usage_terms || '';

  return {
    voucher_code: voucherCode,
    title,
    min_spend: minSpend,
    discount_value: discountValue,
    end_time: endTime,
    shop_id: shopId,
    shop_name: shopName,
    icon_url: iconUrl,
    usage_terms: usageTerms,
    raw: v
  };
}

/**
 * Fetch all vouchers in user's wallet using multiple fallback API endpoints
 * @param {number} [limit=100]
 * @param {number} [offset=0]
 * @returns {Promise<{vouchers: Array<any>, total: number, isLoggedIn: boolean}>}
 */
export async function getUserVouchers(limit = 100, offset = 0) {
  const csrfToken = await getCsrfToken();
  const headers = {
    'Accept': 'application/json, text/plain, */*'
  };
  if (csrfToken) {
    headers['x-csrftoken'] = csrfToken;
  }

  // Endpoints chain
  const endpoints = [
    `${SHOPEE_DOMAIN}/api/v4/voucher/get_user_vouchers?offset=${offset}&limit=${limit}&status=1`,
    `${SHOPEE_DOMAIN}/api/v4/voucher/get_user_vouchers_by_category?category_id=0&offset=${offset}&limit=${limit}`,
    `${SHOPEE_DOMAIN}/api/v2/voucher_wallet/get_user_vouchers?offset=${offset}&limit=${limit}&status=1`,
    `${SHOPEE_DOMAIN}/api/v1/voucher/user_vouchers?status=1`
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        credentials: 'include'
      });

      if (res.ok) {
        const data = await res.json();
        let rawList = [];

        if (data && data.data) {
          if (Array.isArray(data.data.user_voucher_list)) rawList = data.data.user_voucher_list;
          else if (Array.isArray(data.data.vouchers)) rawList = data.data.vouchers;
          else if (Array.isArray(data.data.voucher_info_list)) rawList = data.data.voucher_info_list;
          else if (Array.isArray(data.data.voucher_list)) rawList = data.data.voucher_list;
          else if (Array.isArray(data.data.list)) rawList = data.data.list;
          else if (Array.isArray(data.data)) rawList = data.data;
        } else if (Array.isArray(data.user_voucher_list)) {
          rawList = data.user_voucher_list;
        }

        if (rawList && rawList.length > 0) {
          const normalized = rawList.map(normalizeVoucherItem).filter(Boolean);
          return {
            vouchers: normalized,
            total: data.data?.total_count || normalized.length,
            isLoggedIn: true
          };
        }
      }
    } catch (err) {
      console.warn(`Fetch voucher failed for ${url}:`, err);
    }
  }

  // Check login state to inform user
  const loginState = await checkLoginStatus();
  return {
    vouchers: [],
    total: 0,
    isLoggedIn: loginState.isLoggedIn
  };
}

/**
 * Extract banner / microsite slug from URL or path
 * Handles:
 * - https://shopee.vn/m/goi-ShopeeVIP -> goi-ShopeeVIP
 * - /m/goi-ShopeeVIP -> goi-ShopeeVIP
 * - goi-ShopeeVIP -> goi-ShopeeVIP
 * @param {string} urlOrSlug
 * @returns {string}
 */
export function extractBannerSlug(urlOrSlug) {
  if (!urlOrSlug || typeof urlOrSlug !== 'string') return 'goi-ShopeeVIP';
  const clean = urlOrSlug.trim();
  try {
    const parsed = new URL(clean.startsWith('http') ? clean : `https://shopee.vn/${clean.replace(/^\/+/, '')}`);
    const pathname = parsed.pathname;
    const match = pathname.match(/^\/(?:m|p|ps)\/([^/#?]+)/i);
    if (match && match[1]) return decodeURIComponent(match[1]);
    const slugMatch = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    if (slugMatch) return decodeURIComponent(slugMatch.replace(/^(?:m|p|ps)\//i, ''));
  } catch (e) {
    const match = clean.match(/(?:^|\/)(?:m|p|ps)\/([^/#?]+)/i);
    if (match && match[1]) return decodeURIComponent(match[1]);
  }
  return clean.replace(/^[/#?]+/, '').replace(/^m\//i, '');
}

/**
 * Fetch banner page schema and extract all voucher collection definitions
 * @param {string} pageUrlOrSlug 
 * @returns {Promise<{slug: string, collections: Array<any>, pageTitle?: string}>}
 */
export async function fetchBannerCollections(pageUrlOrSlug) {
  const slug = extractBannerSlug(pageUrlOrSlug);
  const targetUrl = `${SHOPEE_DOMAIN}/api/v4/pagebuilder/get_csr_page?page_url=${encodeURIComponent(slug)}&platform=4`;

  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Referer': `${SHOPEE_DOMAIN}/m/${slug}`
      },
      credentials: 'include'
    });

    if (!res.ok) {
      return { slug, collections: [], error: `HTTP ${res.status}` };
    }

    const json = await res.json();
    if (json.error !== 0 || !json.data) {
      return { slug, collections: [], error: json.error_msg || 'Không lấy được dữ liệu trang' };
    }

    const collections = [];
    const seenCollectionIds = new Set();

    // Helper to recursively inspect objects for voucher_collection_id
    function extractCollections(obj) {
      if (!obj || typeof obj !== 'object') return;

      // Check if component has properties with voucher_collection_id
      if (obj.properties && typeof obj.properties === 'string') {
        try {
          const props = JSON.parse(obj.properties);
          if (Array.isArray(props)) {
            props.forEach(p => {
              const val = p.value;
              if (val && typeof val === 'object') {
                const colId = val.voucher_collection_id || val.collection_id;
                if (colId && !seenCollectionIds.has(String(colId))) {
                  seenCollectionIds.add(String(colId));
                  collections.push({
                    collection_id: String(colId),
                    component_type: Number(obj.biz_component_id) || 51,
                    component_id: String(obj.fe_id || obj.id || ''),
                    limit: 20,
                    offset: 0,
                    microsite_id: null,
                    number_of_vouchers_per_row: 2
                  });
                }
              }
            });
          }
        } catch (e) {}
      }

      // Check direct property voucher_collection_id
      const directColId = obj.voucher_collection_id || obj.collection_id;
      if (directColId && typeof directColId === 'string' && /^\d+$/.test(directColId)) {
        if (!seenCollectionIds.has(String(directColId))) {
          seenCollectionIds.add(String(directColId));
          collections.push({
            collection_id: String(directColId),
            component_type: Number(obj.biz_component_id) || 51,
            component_id: String(obj.fe_id || obj.id || ''),
            limit: 20,
            offset: 0,
            microsite_id: null,
            number_of_vouchers_per_row: 2
          });
        }
      }

      for (const k of Object.keys(obj)) {
        if (typeof obj[k] === 'object') {
          extractCollections(obj[k]);
        }
      }
    }

    extractCollections(json.data);
    if (json.layout) {
      extractCollections(json.layout);
    }

    return {
      slug,
      collections,
      pageTitle: json.data?.meta?.title || slug
    };
  } catch (err) {
    console.error(`fetchBannerCollections error for ${slug}:`, err);
    return { slug, collections: [], error: err.message };
  }
}

/**
 * Query real-time voucher status from collections to detect random restocks (back mã)
 * @param {Array<any>} collectionsReqList
 * @param {string} [slug]
 * @returns {Promise<{vouchers: Array<any>, backVouchers: Array<any>, error?: string, isLoginRequired?: boolean}>}
 */
export async function queryCollectionsVouchers(collectionsReqList, slug = 'goi-ShopeeVIP') {
  if (!collectionsReqList || !collectionsReqList.length) {
    return { vouchers: [], backVouchers: [] };
  }

  const payload = JSON.stringify({
    voucher_collection_request_list: collectionsReqList
  });

  const csrfToken = await getCsrfToken();
  const safeHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (csrfToken) safeHeaders['x-csrftoken'] = csrfToken;

  const endpoints = [
    `${SHOPEE_DOMAIN}/api/v1/microsite/get_vouchers_by_collections`,
    `${SHOPEE_DOMAIN}/api/v4/pagebuilder/get_vouchers_by_collections`
  ];

  for (const url of endpoints) {
    try {
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: safeHeaders,
          body: payload,
          credentials: 'include'
        });
      } catch (corsErr) {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: payload,
          credentials: 'include'
        });
      }

      if (res.ok) {
        const json = await res.json();
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

              // Back-status determination:
              // Voucher is available to claim if it is not fully claimed and percentage claimed is less than 100%
              const isAvailable = !fullyClaimed && !disabled && (percentageClaimed === null || percentageClaimed < 100);

              const parsedVoucher = {
                promotionId: promoId,
                voucherCode: code,
                signature,
                title: ui.title || (code ? `Mã ${code}` : `Voucher #${promoId}`),
                percentageClaimed: percentageClaimed != null ? percentageClaimed : 0,
                fullyClaimed,
                fullyRedeemed,
                disabled,
                isAvailable,
                raw: item
              };

              allVouchers.push(parsedVoucher);
              if (isAvailable && promoId) {
                backVouchers.push(parsedVoucher);
              }
            }
          }

          return { vouchers: allVouchers, backVouchers };
        }
      }
    } catch (e) {
      console.warn(`Query vouchers error on ${url}:`, e);
    }
  }

  return { vouchers: [], backVouchers: [], error: 'Không thể kết nối API voucher' };
}

/**
 * Claim voucher directly from banner promotion ID & signature
 * @param {string|number} promotionId 
 * @param {string} [signature] 
 * @param {string} [voucherCode] 
 * @returns {Promise<{success: boolean, message: string, errCode: number, voucherData?: any}>}
 */
export async function claimBannerVoucher(promotionId, signature = '', voucherCode = '') {
  const cleanCode = (voucherCode || '').trim().toUpperCase();
  const csrfToken = await getCsrfToken();

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-shopee-language': 'vi',
    'x-requested-with': 'XMLHttpRequest',
    'x-api-source': 'pc',
    'Referer': `${SHOPEE_DOMAIN}/m/goi-ShopeeVIP`
  };
  if (csrfToken) headers['x-csrftoken'] = csrfToken;

  const bodyData = {
    voucher_code: cleanCode || undefined,
    voucher_promotionid: Number(promotionId),
    signature: signature || undefined,
    signature_source: '0',
    caller_source: 'MICROSITE_SHOPEE'
  };

  const endpoints = [
    `${SHOPEE_DOMAIN}/api/v2/voucher_wallet/save_voucher`,
    `${SHOPEE_DOMAIN}/api/v4/microsite/save_voucher`
  ];

  for (const url of endpoints) {
    try {
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(bodyData),
          credentials: 'include'
        });
      } catch (corsErr) {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify(bodyData),
          credentials: 'include'
        });
      }

      if (res.ok) {
        const data = await res.json();
        const targetCode = cleanCode || `PROMO_${promotionId}`;
        if (data.error === 0 || data.error === 3 || data.error === 140003) {
          return normalizeSaveResult(targetCode, data);
        }

        // If specific error, return directly
        if (data.error !== 140000 && data.error !== -1) {
          return normalizeSaveResult(targetCode, data);
        }
      }
    } catch (e) {
      console.warn(`claimBannerVoucher error on ${url}:`, e);
    }
  }

  // If voucherCode is provided, fallback to direct code save
  if (cleanCode) {
    return await saveVoucherByCode(cleanCode);
  }

  return {
    success: false,
    code: `PROMO_${promotionId}`,
    errCode: -1,
    message: 'Không thể nhận voucher từ banner'
  };
}

