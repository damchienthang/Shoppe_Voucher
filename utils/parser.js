/**
 * Parser utility for extracting and normalizing Shopee voucher codes from text input
 */

// Noise words blacklist (English & Vietnamese transliterated/common words)
const NOISE_WORDS = new Set([
  'HTTP', 'HTTPS', 'SHOPEE', 'SHOPEEVN', 'SHOPPE', 'HTML', 'TRUE', 'FALSE', 'NULL',
  'UNDEFINED', 'ADMIN', 'ORDER', 'VOUCHER', 'DISCOUNT', 'PROMO', 'PROMOTION',
  'TIKTOK', 'LAZADA', 'VIETNAM', 'TIENG', 'KHUNG', 'THANG', 'NGAY', 'GIO',
  'FLASH', 'SALE', 'DEAL', 'GIAM', 'TOAN', 'SAN', 'FREESHIP', 'EXTRA', 'PLUS',
  'SHOPEEPAY', 'SPAYLATER', 'AFFILIATE', 'TELEGRAM', 'FACEBOOK', 'ZALO',
  'LINK', 'COPY', 'TRANG', 'CHU', 'CHUC', 'CAC', 'BAN', 'THANH', 'CONG',
  'DON', 'TU', 'TOI', 'DA', 'TAT', 'CA', 'HOT', 'SIEU', 'TONG', 'HOP',
  'CODE', 'SHOP', 'AP', 'DUNG', 'MA', 'GIAM', 'GIA', 'MA-GIAM-GIA', 'NHANH', 'VIP',
  'LONGHOUSE', 'LONGHOUSEE', 'ACCESSTRADE', 'SHORTEN', 'MASOFFER', 'ECONTENT',
  'BACK', 'SHOPEEVIP', 'SVIP', 'MAX', 'MIN', 'LUOT', 'LUU', 'TAI', 'CHECK', 'APP', 'WEB',
  'DANG', 'TREN', 'DUOI', 'CON', 'HET', 'TIEN', 'XEM', 'NGAY', 'VA', 'HOAC', 'CHO', 'VOI'
]);

// Strict official Shopee domains only (exclude 3rd party affiliates and other sites)
export const OFFICIAL_SHOPEE_DOMAINS_REGEX = /https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:shopee\.vn|shp\.ee|s\.shopee\.vn)[^\s<>"'()]+/gi;

// Competitor and 3rd-party affiliate domains / keywords to reject
export const NON_SHOPEE_DOMAINS_REGEX = /(longhousee|longhouse|lazada|tiktok|tiki|sendo|accesstrade|shorten\.asia|masoffer|bit\.ly|tinyurl)/i;

// Keywords indicating voucher/discount intent in message text
const VOUCHER_INTENT_KEYWORDS = [
  'voucher', 'mã', 'ma giam', 'mã giảm', 'giam gia', 'giảm giá',
  'freeship', 'hoan xu', 'hoàn xu', 'luu ma', 'lưu mã', 'nhan ma', 'nhận mã',
  'san ma', 'săn mã', 'khung gio', 'khung giờ', 'giam 50', 'giam 100', 'giảm 50', 'giảm 100',
  'back', 'back mã', 'back ma', 'mã back', 'ma back', 'nhả mã', 'nha ma', 'mở lại',
  'lưu', 'lấy mã', 'nhận', 'link', 'hot', 'săn', 'húp', 'áp', 'deal', 'sale',
  'thu thập', '0h', '9h', '12h', '15h', '18h', '21h'
];

/**
 * Remove Vietnamese accents/diacritics for clean noise matching
 */
export function removeVietnameseDiacritics(str) {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/**
 * Validates if a token is a legitimate voucher code
 * Must be at least 5 characters and contain NO special characters (alphanumeric [A-Z0-9] only)
 * @param {string} token 
 * @param {boolean} [isStandalone=false] - True if token is on its own line or explicitly labeled
 * @returns {boolean}
 */
/**
 * Algorithmic check: Is this token structured like a voucher code?
 * Zero hardcoded brand prefixes - uses structural format & linguistic entropy:
 * 1. Has both letters and digits (e.g. FA50K, LIVE99K, AFFV266, BM25K)
 * 2. Or has non-Vietnamese letters (F, J, W, Z) (e.g. AFFOTHE, AFFOMAY, NEWLOOK)
 * 3. Or has geminate/double consonants (e.g. FF, LL, SS, TT, BB, DD, KK, MM, NN, PP, RR, VV, XX, ZZ)
 * 4. Or length >= 8 (Vietnamese single words are <= 7 letters)
 * 5. Or marked as standalone / contextual voucher line (isContextual = true)
 */
export function isVoucherFormat(upper, isContextual = false) {
  if (isContextual) return true;

  // Has both letters and numbers (e.g. FA50K, LIVE99K, BM25K)
  if (/\d/.test(upper) && /[A-Z]/.test(upper)) return true;

  // Has non-Vietnamese letters (F, J, W, Z) (e.g. AFFOTHE, NEWLOOK, FLOW)
  if (/[FJWZ]/.test(upper)) return true;

  // Has double identical consonants (impossible in natural Vietnamese: FF, BB, TT, SS, etc.)
  if (/([BCDFGHJKLMNPQRSTVWXYZ])\1/i.test(upper)) return true;

  // Longer than any Vietnamese monosyllable (>= 8 chars)
  if (upper.length >= 8) return true;

  return false;
}

/**
 * Validates if a token is a legitimate voucher code
 * Must be at least 5 characters and contain NO special characters (alphanumeric [A-Z0-9] only)
 * @param {string} token 
 * @param {boolean} [isContextual=false] - True if token is on its own line or explicitly labeled
 * @returns {boolean}
 */
export function isValidVoucherCode(token, isContextual = false) {
  if (!token || typeof token !== 'string') return false;
  const upper = token.toUpperCase().trim();
  const unaccented = removeVietnameseDiacritics(upper);

  // Length constraint: must be at least 5 characters
  if (upper.length < 5 || upper.length > 35) return false;

  // Must only contain letters and numbers, NO special characters (no -, _, ., etc.)
  if (!/^[A-Z0-9]+$/.test(upper)) return false;

  // Reject noise words (both accented and unaccented)
  if (NOISE_WORDS.has(upper) || NOISE_WORDS.has(unaccented)) return false;

  // Reject pure numbers like phone numbers or timestamps
  if (/^\d+$/.test(upper)) return false;

  // Reject currency/discount amounts like 200K, 50K, 0Đ, 25%, 50%
  if (/^\d+([KkĐđ%]|TR|VND)$/i.test(upper)) return false;

  // Reject single char repetition (e.g. AAAAA)
  if (/^(.)\1+$/.test(upper)) return false;

  return isVoucherFormat(upper, isContextual);
}

/**
 * Extract clean voucher codes from any raw text
 * Automatically strips URLs, detects explicit "Mã <CODE>" labels, and rejects natural language noise
 * Enforces >= 5 alphanumeric characters with NO special characters
 * @param {string} text - Raw input text
 * @returns {Array<{code: string, raw: string}>}
 */
export function extractVoucherCodes(text) {
  if (!text || typeof text !== 'string') return [];

  const foundCodes = new Set();
  const results = [];

  // 1. Extract voucher codes directly embedded in URL query parameters (e.g. ?voucher=FA50K or ?code=HSBACKTOSCHOOL0409)
  const urlVoucherRegex = /[?&](?:voucher|voucher_code|voucherCode|code|evoucher|coupon|coupon_code|promo_code|promocode)=([a-zA-Z0-9]{5,35})/gi;
  let urlM;
  while ((urlM = urlVoucherRegex.exec(text)) !== null) {
    const code = urlM[1].toUpperCase();
    if (isValidVoucherCode(code, true) && !foundCodes.has(code)) {
      foundCodes.add(code);
      results.push({ code, raw: urlM[1] });
    }
  }

  // 2. Strip all URLs from text before extracting natural codes so domain names and link slugs are ignored
  const cleanText = text.replace(/https?:\/\/[^\s<>"'()]+/gi, ' ');

  // 3. Explicit pattern matching: Mã / Code / Nhập / Lưu / Dùng / Voucher / Back / Back Mã <CODE>
  const explicitRegex = /(?:mã(?:\s+(?:voucher|giảm|back|sale|live|sàn|shop|đơn))?|code|nhập|nhap|lưu|luu|dùng|dung|voucher|coupon|back(?:\s+mã)?)[:\s]+([a-zA-Z0-9]{5,35})/gi;
  let m;
  while ((m = explicitRegex.exec(cleanText)) !== null) {
    const candidate = m[1].toUpperCase();
    if (isValidVoucherCode(candidate, true) && !foundCodes.has(candidate)) {
      foundCodes.add(candidate);
      results.push({ code: candidate, raw: m[1] });
    }
  }

  // 4. Structural discount clause pattern anywhere in line: <CODE> [giảm|giam|sale|off|tối đa|toi da|max|min|được|duoc] <AMOUNT>
  const discountClauseRegex = /\b([a-zA-Z0-9]{5,35})\s+(?:giảm|giam|sale|off|tối\s+đa|toi\s+da|max|min|được|duoc)\s*[:\s]*\s*\d+/gim;
  let dm;
  while ((dm = discountClauseRegex.exec(cleanText)) !== null) {
    const candidate = dm[1].toUpperCase();
    if (isValidVoucherCode(candidate, true) && !foundCodes.has(candidate)) {
      foundCodes.add(candidate);
      results.push({ code: candidate, raw: dm[1] });
    }
  }

  // 5. Bullet list item preceding discount
  const bulletLineRegex = /^[►•\-*+✔👉🔥⚡\s]*(?:[0-9]+[.)]\s*)?([a-zA-Z0-9]{5,35})\b(?=.*(?:giảm|giam|\d+\s*[KkĐđ%]|đơn|don))/gim;
  let bm;
  while ((bm = bulletLineRegex.exec(cleanText)) !== null) {
    const candidate = bm[1].toUpperCase();
    if (isValidVoucherCode(candidate, true) && !foundCodes.has(candidate)) {
      foundCodes.add(candidate);
      results.push({ code: candidate, raw: dm ? dm[1] : bm[1] });
    }
  }

  // 5. Scan lines and tokens
  const lines = cleanText.split(/[\r\n]+/);

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const isSingleWord = !/\s/.test(trimmedLine);
    const directCode = trimmedLine.toUpperCase();
    if (isValidVoucherCode(directCode, isSingleWord)) {
      if (!foundCodes.has(directCode)) {
        foundCodes.add(directCode);
        results.push({ code: directCode, raw: trimmedLine });
        continue;
      }
    }

    const tokens = trimmedLine.split(/[\s,;:|!?()\[\]{}"'\\\/&=<>#+*~`►•✔👉🔥⚡]+/);

    for (const token of tokens) {
      const cleanToken = token.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').toUpperCase();
      if (isValidVoucherCode(cleanToken, isSingleWord)) {
        if (!foundCodes.has(cleanToken)) {
          foundCodes.add(cleanToken);
          results.push({ code: cleanToken, raw: token });
        }
      }
    }
  }

  return results;
}

/**
 * Check if a URL strictly belongs to official Shopee and is voucher-related
 * @param {string} url 
 * @param {string} [contextText] 
 * @returns {boolean}
 */
export function isOfficialShopeeAndVoucherRelated(url, contextText = '', isTargetGroup = false) {
  if (!url || typeof url !== 'string') return false;

  const lowerUrl = url.toLowerCase();

  // 1. Must be from official Shopee domains
  const isOfficialShopeeDomain =
    lowerUrl.includes('shopee.vn') ||
    lowerUrl.includes('shp.ee') ||
    lowerUrl.includes('s.shopee.vn');

  if (!isOfficialShopeeDomain) {
    return false;
  }

  // 2. Reject 3rd party affiliates or competitor domains
  if (NON_SHOPEE_DOMAINS_REGEX.test(lowerUrl)) {
    return false;
  }

  // 3. Official voucher and campaign landing pages
  if (
    lowerUrl.includes('shopee.vn/m/') ||
    lowerUrl.includes('/voucher-wallet') ||
    lowerUrl.includes('voucher=') ||
    lowerUrl.includes('voucher_code=') ||
    lowerUrl.includes('evoucher=') ||
    lowerUrl.includes('promotion=') ||
    lowerUrl.includes('shopee.vn/universal-link')
  ) {
    return true;
  }

  // 4. Official Shopee shortlinks (s.shopee.vn / shp.ee)
  if (lowerUrl.includes('s.shopee.vn/') || lowerUrl.includes('shp.ee/')) {
    // In target voucher group context, all official shortlinks are voucher-related
    if (isTargetGroup) return true;

    const lowerContext = (contextText || '').toLowerCase();
    const hasVoucherIntent = VOUCHER_INTENT_KEYWORDS.some(kw => lowerContext.includes(kw));
    const hasCodes = extractVoucherCodes(contextText).length > 0;
    const isOnlyLink = !contextText.trim() || contextText.trim().toLowerCase() === lowerUrl;
    return hasVoucherIntent || hasCodes || isOnlyLink;
  }

  // 5. Product links: only accept if context explicitly mentions vouchers
  const isProductLink = /shopee\.vn\/.*-i\.\d+\.\d+/i.test(url);
  if (isProductLink) {
    const lowerContext = (contextText || '').toLowerCase();
    return VOUCHER_INTENT_KEYWORDS.some(kw => lowerContext.includes(kw));
  }

  return false;
}

/**
 * Strictly check if a message belongs to Shopee and should be logged/processed
 * Drops any messages containing other domains like longhousee, lazada, etc.
 * @param {string} text - Message text
 * @param {string[]} [extractedShopeeLinks] - Any official Shopee links extracted
 * @param {boolean} [isTargetGroupContext=false] - True if message is inside target group [23] LONGHOUSEE
 * @returns {boolean}
 */
export function isShopeeMessage(text = '', extractedShopeeLinks = [], isTargetGroupContext = false) {
  if (!text || typeof text !== 'string') return false;

  const lowerText = text.toLowerCase();

  // 1. If text contains non-Shopee domains (e.g. longhousee, longhouse, lazada, tiktok, etc.)
  // and does NOT have an official Shopee link, REJECT immediately!
  const hasNonShopeeDomain = NON_SHOPEE_DOMAINS_REGEX.test(lowerText);
  const hasOfficialShopeeLink = extractedShopeeLinks && extractedShopeeLinks.length > 0;

  if (hasNonShopeeDomain && !hasOfficialShopeeLink) {
    return false;
  }

  // 2. Extract any generic URL in the text to see if foreign links exist
  const anyUrlRegex = /https?:\/\/[^\s<>"'()]+/gi;
  const allUrls = text.match(anyUrlRegex) || [];

  if (allUrls.length > 0) {
    const hasAnyShopeeUrl = allUrls.some(u => /shopee\.vn|shp\.ee|s\.shopee\.vn/i.test(u));
    if (!hasAnyShopeeUrl) {
      // If URLs exist but none are official Shopee, permit if message has legitimate voucher codes & voucher intent, and no blacklisted non-Shopee domain
      const codes = extractVoucherCodes(text);
      const hasVoucherIntent = VOUCHER_INTENT_KEYWORDS.some(kw => lowerText.includes(kw));
      if (codes.length === 0 || !hasVoucherIntent || hasNonShopeeDomain) {
        return false;
      }
    }
  }

  // 3. If there are valid official Shopee voucher links -> ACCEPT!
  if (hasOfficialShopeeLink) {
    return true;
  }

  const mentionsShopee = /shopee|shoppe|shopeepay|spaylater/i.test(lowerText);
  const codes = extractVoucherCodes(text);
  const hasVoucherIntent = VOUCHER_INTENT_KEYWORDS.some(kw => lowerText.includes(kw));

  // 4. In target group [23] LONGHOUSEE: accept if message contains voucher codes, voucher intent or Shopee
  if (isTargetGroupContext) {
    return (codes.length > 0 || hasVoucherIntent || mentionsShopee) && !hasNonShopeeDomain;
  }

  // 5. Outside target group, message without links must explicitly mention Shopee / Shoppe to be logged
  if (!mentionsShopee) {
    return false;
  }

  return (codes.length > 0 || hasVoucherIntent) && !hasNonShopeeDomain;
}

/**
 * Check if the active Zalo chat group matches the configured target group (default: [23] LONGHOUSEE)
 * @param {string} groupName 
 * @param {string} [targetFilter='[23] LONGHOUSEE'] 
 * @returns {boolean}
 */
export function isTargetZaloGroup(groupName, targetFilter = '[23] LONGHOUSEE') {
  if (!groupName || typeof groupName !== 'string') return false;
  const target = (targetFilter || '[23] LONGHOUSEE').trim().toLowerCase();
  const current = groupName.trim().toLowerCase();

  if (target === 'all' || target === '*') return true;
  if (current.includes(target) || target.includes(current)) return true;

  const has23 = current.includes('23');
  const hasLonghousee = current.includes('longhousee') || current.includes('longhouse');
  if (has23 && hasLonghousee) return true;

  const normCurrent = current.replace(/[^a-z0-9]/g, '');
  const normTarget = target.replace(/[^a-z0-9]/g, '');
  if (normCurrent && normTarget && (normCurrent.includes(normTarget) || normTarget.includes(normCurrent))) {
    return true;
  }

  return false;
}

/**
 * Recursively extracts any human-readable message from Shopee's response object
 * Prioritizes actual Vietnamese user-facing messages over generic English backend placeholders
 * @param {any} data 
 * @returns {string}
 */
export function extractShopeeMessage(data) {
  if (!data || typeof data !== 'object') return '';

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
    data.data?.reason,
    data.data?.display_msg,
    data.data?.alert,
    data.data?.text,
    data.data?.toast,
    data.user_message,
    data.dom_error_msg,
    data.msg,
    data.message,
    data.error_description,
    data.error_msg,
    data.warning_msg
  ];

  // 1. First priority: Any candidate containing actual Vietnamese characters
  const vietnameseRegex = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && vietnameseRegex.test(c)) {
      return c.trim();
    }
  }

  // 2. Second priority: Non-generic English candidates
  const isGeneric = (str) => /^(not eligible(?: condition)?|error|failed|unknown error|system error|bad request)$/i.test(str.trim());
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && !isGeneric(c)) {
      return c.trim();
    }
  }

  // 3. Fallback: Any non-empty candidate
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      return c.trim();
    }
  }

  return '';
}

/**
 * Formats error codes from Shopee API into user-friendly Vietnamese messages
 * Explains exact reasons why a voucher could not be saved
 * @param {number|string} errCode 
 * @param {string} [customMsg]
 * @returns {string}
 */
export function formatShopeeError(errCode, customMsg = '') {
  let code = Number(errCode);
  // Normalize Shopee 1400xx error codes (140001 -> 1, 140002 -> 2, 140003 -> 3, 140004 -> 4, etc.)
  if (code > 140000 && code < 140100) {
    code = code - 140000;
  }

  const trimmed = String(customMsg || '').trim();
  const isGenericMessage = !trimmed || /^(not eligible(?: condition)?|error|failed|unknown error|system error)$/i.test(trimmed);

  // 1. Prefer Shopee's own human-readable message if present and not a generic placeholder.
  if (trimmed && !isGenericMessage) {
    const suffix = (code !== 0 && !isNaN(code)) ? ` [mã lỗi Shopee: ${code}]` : '';
    return `${trimmed}${suffix}`;
  }

  // 2. Numeric error code inspection (only reached when Shopee returned NO message text)
  switch (code) {
    case 0:
      return 'Lưu thành công vào ví!';
    case 1:
      return 'Voucher này không hợp lệ hoặc không tồn tại [lỗi 1]';
    case 2:
      return 'Mã giảm giá đã hết lượt sử dụng / hết ngân sách [lỗi 2]';
    case 3:
      return 'Bạn đã lưu mã giảm giá này vào ví rồi [lỗi 3]';
    case 4:
      return 'Rất tiếc! Voucher này không hợp lệ hoặc không còn hiệu lực [lỗi 4]';
    case 5:
      return 'Mã voucher đã hết hạn sử dụng [lỗi 5]';
    case 6:
      return 'Mã chỉ áp dụng cho tài khoản đủ điều kiện ưu đãi [lỗi 6]';
    case 7:
      return 'Chưa đến khung giờ mở mã voucher này [lỗi 7]';
    case 8:
      return 'Mã chỉ áp dụng khi thanh toán qua ShopeePay / SPayLater [lỗi 8]';
    case 9:
      return 'Số lượt lưu mã của bạn trong ngày đã đạt giới hạn [lỗi 9]';
    case 10:
      return 'Hệ thống Shopee đang quá tải, vui lòng thử lại sau [lỗi 10]';
    case 140000:
    case 401:
    case 403:
      return 'Lỗi xác thực phiên đăng nhập (vui lòng đăng nhập lại Shopee)';
    case -1:
      return 'Lỗi mạng hoặc không thể kết nối tới máy chủ Shopee';
    default:
      if (trimmed && !isGenericMessage) {
        return trimmed;
      }
      return 'Rất tiếc! Voucher này không hợp lệ hoặc không còn hiệu lực.';
  }
}
