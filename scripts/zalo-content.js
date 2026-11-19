/**
 * Content Script for Zalo Web (chat.zalo.me)
 * Real-time listener for incoming messages containing Shopee voucher codes and official Shopee voucher links.
 * Strictly limited to target group: [23] LONGHOUSEE (ignores all other personal/group chats).
 * Excludes any messages from non-Shopee domains.
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__shopee_zalo_sniffer_injected__) return;
  window.__shopee_zalo_sniffer_injected__ = true;

  // Processed messages cache & new-message-only session tracking
  const processedMessageHashes = new Set();
  const MSG_SELECTOR = '.chat-message, .msg-view, .chat-item, .card--text, .chat-bubble';
  let isSnifferEnabled = true;
  let targetGroupFilter = '[23] LONGHOUSEE';
  let activeTrackedGroup = '';
  let sessionStartedAt = Date.now();
  let sessionReadyAt = Date.now() + 2500;

  // Helper to safely check if extension context is still valid
  function isExtensionValid() {
    return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
  }

  // Strict Official Shopee Domain Regex (Matches official shopee.vn, shp.ee, s.shopee.vn with or without http/https)
  const OFFICIAL_SHOPEE_LINK_REGEX = /(?:https?:\/\/)?(?:[a-zA-Z0-9_-]+\.)*(?:shopee\.vn|shp\.ee|s\.shopee\.vn)[^\s<>"'()]+/gi;

  // Third-party / Competitor domains to strictly reject (domain level)
  const NON_SHOPEE_DOMAINS_REGEX = /(?:https?:\/\/|[a-z0-9.-]+\.)(lazada\.|tiktok\.|tiki\.vn|sendo\.vn|accesstrade\.|shorten\.asia|masoffer\.|bit\.ly|tinyurl\.com|longhousee\.com|longhouse\.vn)/i;

  const NOISE_WORDS = new Set([
    'HTTP', 'HTTPS', 'SHOPEE', 'SHOPEEVN', 'SHOPPE', 'HTML', 'TRUE', 'FALSE', 'NULL',
    'TIKTOK', 'LAZADA', 'VIETNAM', 'ZALO', 'ADMIN', 'LINK', 'COPY', 'GROUP',
    'MA-GIAM-GIA', 'NHANH', 'VIP', 'LONGHOUSE', 'LONGHOUSEE', 'ACCESSTRADE', 'SHORTEN',
    'BACK', 'SHOPEEVIP', 'SVIP', 'MAX', 'MIN', 'LUOT', 'LƯU', 'LUU', 'TAI', 'TẠI',
    'GIAM', 'GIẢM', 'DUNG', 'DÙNG', 'DON', 'ĐƠN', 'TIEN', 'TIỀN', 'CHECK', 'APP', 'WEB'
  ]);

  const VOUCHER_INTENT_KEYWORDS = [
    'voucher', 'mã', 'ma giam', 'mã giảm', 'giam gia', 'giảm giá',
    'freeship', 'hoan xu', 'hoàn xu', 'luu ma', 'lưu mã', 'nhan ma', 'nhận mã',
    'san ma', 'săn mã', 'khung gio', 'khung giờ', 'sale',
    'back', 'back mã', 'back ma', 'mã back', 'ma back', 'lưu tại', 'luu tai', 'mã lưu tại', 'nhả mã', 'nha ma', 'mở lại',
    'lưu', 'lấy mã', 'nhận', 'link', 'hot', 'săn', 'húp', 'áp', 'deal', 'thu thập',
    '0h', '9h', '12h', '15h', '18h', '21h'
  ];

  /**
   * Deterministic hash for message deduplication (based on content, not timestamp)
   */
  function hashMessage(sender, text) {
    return `${sender || ''}_${(text || '').slice(0, 120).trim()}`;
  }

  /**
   * Get current active Zalo chat group/contact name
   */
  function getActiveChatName() {
    try {
      // 1. Check Header selectors in main chat view
      const headerSelectors = [
        '#header-chat-title',
        '[data-id="header-chat-title"]',
        '.header-title',
        '.header-chat-name',
        '.conv-header__title',
        '.chat-title',
        '.chat-box__header__title',
        '.chat-info__name',
        '.card--title',
        '.header-chat__title',
        '[data-translate-inner="chat_title"]'
      ];
      for (const sel of headerSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const text = (el.innerText || el.textContent || '').trim();
          if (text) return text;
        }
      }

      // 2. Check Active item in conversation sidebar
      const activeItemSelectors = [
        '.conv-item.active',
        '.conversation-item.active',
        '.chat-item.active',
        '[data-active="true"]',
        '.conv-item--active',
        '.selected.conv-item'
      ];
      for (const sel of activeItemSelectors) {
        const item = document.querySelector(sel);
        if (item) {
          const nameEl = item.querySelector('.conv-item__name, .conv-item__title, .name, .truncate, .title');
          const text = (nameEl ? nameEl.innerText || nameEl.textContent : item.innerText) || '';
          const clean = text.split(/[\r\n]+/)[0].trim();
          if (clean) return clean;
        }
      }

      // 3. Check document title (Zalo Web sets title to chat name)
      const docTitle = (document.title || '').trim();
      if (docTitle && !docTitle.startsWith('Zalo Web') && !docTitle.includes('Đăng nhập')) {
        const cleanTitle = docTitle.replace(/\s*-\s*Zalo\s*Web/i, '').replace(/^\(\d+\)\s*/, '').trim();
        if (cleanTitle) return cleanTitle;
      }
    } catch (e) {
      // Ignore
    }
    return '';
  }

  /**
   * Check if the active Zalo group matches the target group ([23] LONGHOUSEE)
   */
  function isTargetGroup(groupName) {
    if (!groupName) {
      // If groupName couldn't be extracted, check if document.title or any visible header matches
      const docTitle = document.title || '';
      if (docTitle.includes('23') && (docTitle.toLowerCase().includes('longhousee') || docTitle.toLowerCase().includes('longhouse'))) {
        return true;
      }
      return false;
    }

    const target = (targetGroupFilter || '[23] LONGHOUSEE').trim().toLowerCase();
    const current = groupName.trim().toLowerCase();

    if (target === 'all' || target === '*') return true;
    if (current.includes(target) || target.includes(current)) return true;

    // Check if both '23' and 'longhousee' exist in group name
    const has23 = current.includes('23');
    const hasLonghousee = current.includes('longhousee') || current.includes('longhouse');
    if (has23 && hasLonghousee) return true;

    // Match alphanumeric stripped
    const normCurrent = current.replace(/[^a-z0-9]/g, '');
    const normTarget = target.replace(/[^a-z0-9]/g, '');
    if (normCurrent && normTarget && (normCurrent.includes(normTarget) || normTarget.includes(normCurrent))) {
      return true;
    }

    return false;
  }

  /**
   * Check if a Shopee link is voucher-related
   */
  function isVoucherRelatedLink(url, contextText = '') {
    if (!url) return false;
    const lowerUrl = url.toLowerCase();

    // 1. Direct Voucher / Campaign Landing Page
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

    // 2. Shortlinks (s.shopee.vn / shp.ee)
    if (lowerUrl.includes('s.shopee.vn/') || lowerUrl.includes('shp.ee/')) {
      // If message is in target group [23] LONGHOUSEE, accept all official shortlinks
      if (isTargetGroup(getActiveChatName())) {
        return true;
      }
      const lowerContext = (contextText || '').toLowerCase();
      const hasVoucherIntent = VOUCHER_INTENT_KEYWORDS.some(kw => lowerContext.includes(kw));
      const hasCodes = extractVoucherCodesFromText(contextText).length > 0;
      const isOnlyLink = !contextText.trim() || contextText.trim().toLowerCase() === lowerUrl;
      return hasVoucherIntent || hasCodes || isOnlyLink;
    }

    // 3. Regular product links without voucher keywords -> REJECT
    const isProductLink = /shopee\.vn\/.*-i\.\d+\.\d+/i.test(url);
    if (isProductLink) {
      const lowerContext = (contextText || '').toLowerCase();
      return VOUCHER_INTENT_KEYWORDS.some(kw => lowerContext.includes(kw));
    }

    return false;
  }

  /**
   * Extract ONLY official Shopee links that are voucher-related
   */
  function extractOfficialVoucherLinks(element, rawText) {
    const rawLinks = new Set();

    // 1. Regex match in raw text (Shopee domains with or without http/https)
    const textMatches = rawText.match(OFFICIAL_SHOPEE_LINK_REGEX);
    if (textMatches) {
      textMatches.forEach(l => {
        let clean = l.trim().replace(/[.,;!?)]+$/, '');
        if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
          clean = 'https://' + clean;
        }
        rawLinks.add(clean);
      });
    }

    // 2. DOM <a> tags & data attributes inside message
    if (element && element.querySelectorAll) {
      const linkNodes = element.querySelectorAll('a[href], [data-href], [data-url], [data-preview-url]');
      linkNodes.forEach(node => {
        const href = node.href || node.getAttribute('data-href') || node.getAttribute('data-url') || node.getAttribute('data-preview-url') || '';
        if (/(?:shopee\.vn|shp\.ee|s\.shopee\.vn)/i.test(href)) {
          let clean = href.trim().replace(/[.,;!?)]+$/, '');
          if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
            clean = 'https://' + clean;
          }
          rawLinks.add(clean);
        }
      });
    }

    // Filter to keep only voucher-related links
    const voucherLinks = [];
    rawLinks.forEach(link => {
      if (isVoucherRelatedLink(link, rawText)) {
        voucherLinks.push(link);
      }
    });

    return voucherLinks;
  }

  /**
   * Algorithmic check: Is this token structured like a voucher code?
   * Zero hardcoded brand prefixes - uses structural format & linguistic entropy:
   * 1. Has both letters and digits (e.g. FA50K, LIVE99K, AFFV266, BM25K)
   * 2. Or has non-Vietnamese letters (F, J, W, Z) (e.g. AFFOTHE, AFFOMAY, NEWLOOK)
   * 3. Or has geminate/double consonants (e.g. FF, LL, SS, TT, BB, DD, KK, MM, NN, PP, RR, VV, XX, ZZ)
   * 4. Or length >= 8 (Vietnamese single words are <= 7 letters)
   * 5. Or marked as standalone / contextual voucher line (isContextual = true)
   */
  function isVoucherFormat(upper, isContextual = false) {
    if (isContextual) return true;
    if (/\d/.test(upper) && /[A-Z]/.test(upper)) return true;
    if (/[FJWZ]/.test(upper)) return true;
    if (/([BCDFGHJKLMNPQRSTVWXYZ])\1/i.test(upper)) return true;
    if (upper.length >= 8) return true;
    return false;
  }

  /**
   * Extract potential voucher codes from text using smart heuristics
   */
  function extractVoucherCodesFromText(text) {
    if (!text) return [];
    const codes = new Set();

    // 1. Strip URLs first so links like https://s.shopee.vn/70JKmob0V7 do not get tokenized into fake codes
    const cleanText = text.replace(/https?:\/\/[^\s<>"'()]+/gi, ' ');

    // 2. Explicit pattern matching: Mã / Code / Nhập / Lưu / Dùng / Voucher / Back / Back Mã <CODE>
    const explicitRegex = /(?:mã(?:\s+(?:voucher|giảm|back|sale|live|sàn|shop|đơn))?|code|nhập|nhap|lưu|luu|dùng|dung|voucher|coupon|back(?:\s+mã)?)[:\s]+([a-zA-Z0-9]{5,35})/gi;
    let m;
    while ((m = explicitRegex.exec(cleanText)) !== null) {
      const candidate = m[1].toUpperCase();
      if (
        candidate.length >= 5 &&
        candidate.length <= 35 &&
        /^[A-Z0-9]+$/.test(candidate) &&
        !NOISE_WORDS.has(candidate) &&
        !/^\d+$/.test(candidate) &&
        !/^\d+([KkĐđ%]|TR|VND)$/i.test(candidate)
      ) {
        codes.add(candidate);
      }
    }

    // 3. Structural discount clause pattern anywhere in line: <CODE> [giảm|giam|sale|off|tối đa|toi da|max|min|được|duoc] <AMOUNT>
    const discountClauseRegex = /\b([a-zA-Z0-9]{5,35})\s+(?:giảm|giam|sale|off|tối\s+đa|toi\s+da|max|min|được|duoc)\s*[:\s]*\s*\d+/gim;
    let dm;
    while ((dm = discountClauseRegex.exec(cleanText)) !== null) {
      const candidate = dm[1].toUpperCase();
      if (
        candidate.length >= 5 &&
        candidate.length <= 35 &&
        /^[A-Z0-9]+$/.test(candidate) &&
        !NOISE_WORDS.has(candidate) &&
        !/^\d+$/.test(candidate) &&
        !/^\d+([KkĐđ%]|TR|VND)$/i.test(candidate)
      ) {
        codes.add(candidate);
      }
    }

    // 4. Bullet line item preceding discount
    const bulletLineRegex = /^[►•\-*+✔👉🔥⚡\s]*(?:[0-9]+[.)]\s*)?([a-zA-Z0-9]{5,35})\b(?=.*(?:giảm|giam|\d+\s*[KkĐđ%]|đơn|don))/gim;
    let bm;
    while ((bm = bulletLineRegex.exec(cleanText)) !== null) {
      const candidate = bm[1].toUpperCase();
      if (
        candidate.length >= 5 &&
        candidate.length <= 35 &&
        /^[A-Z0-9]+$/.test(candidate) &&
        !NOISE_WORDS.has(candidate) &&
        !/^\d+$/.test(candidate) &&
        !/^\d+([KkĐđ%]|TR|VND)$/i.test(candidate)
      ) {
        codes.add(candidate);
      }
    }

    // 5. Tokenize remaining words and check with isVoucherFormat
    const tokens = cleanText.split(/[\s,;:|!?()\[\]{}"'\\\/&=<>#+*~`►•✔👉🔥⚡]+/);

    for (const token of tokens) {
      const clean = token.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').toUpperCase();
      if (
        clean.length >= 5 &&
        clean.length <= 35 &&
        /^[A-Z0-9]+$/.test(clean) && // No special characters
        !NOISE_WORDS.has(clean) &&
        !/^\d+$/.test(clean) &&
        !/^\d+([KkĐđ%]|TR|VND)$/i.test(clean) && // Reject amounts
        isVoucherFormat(clean) // Algorithmic format detection (no hardcoded prefixes!)
      ) {
        codes.add(clean);
      }
    }
    return Array.from(codes);
  }

  /**
   * Strictly verify if this message is authentic Shopee
   * Excludes any messages containing foreign domains
   */
  function isStrictShopeeMessage(textContent, shopeeLinks) {
    const lowerText = textContent.toLowerCase();

    // 1. Check for foreign/blacklisted domains (e.g. lazada, tiktok, etc.)
    const hasForeignDomain = NON_SHOPEE_DOMAINS_REGEX.test(lowerText);
    const hasShopeeLinks = shopeeLinks && shopeeLinks.length > 0;

    // If message contains foreign domains and has NO official Shopee link -> REJECT immediately!
    if (hasForeignDomain && !hasShopeeLinks) {
      return false;
    }

    // 2. Check all URLs in the message
    const anyUrlRegex = /https?:\/\/[^\s<>"'()]+/gi;
    const allUrls = textContent.match(anyUrlRegex) || [];
    if (allUrls.length > 0) {
      const hasAnyShopeeUrl = allUrls.some(u => /shopee\.vn|shp\.ee|s\.shopee\.vn/i.test(u));
      if (!hasAnyShopeeUrl) {
        // If URLs exist but none are official Shopee, permit if message has legitimate voucher codes & voucher intent
        const codes = extractVoucherCodesFromText(textContent);
        const hasVoucherIntent = VOUCHER_INTENT_KEYWORDS.some(kw => lowerText.includes(kw));
        if (codes.length === 0 || !hasVoucherIntent || hasForeignDomain) {
          return false;
        }
      }
    }

    // 3. If there are valid official Shopee voucher links -> ACCEPT
    if (hasShopeeLinks) {
      return true;
    }

    // 4. If no links at all: accept if message has valid voucher codes, mentions Shopee, or has voucher intent
    const mentionsShopee = /shopee|shoppe|shopeepay|spaylater/i.test(lowerText);
    const codes = extractVoucherCodesFromText(textContent);
    const hasVoucherIntent = VOUCHER_INTENT_KEYWORDS.some(kw => lowerText.includes(kw));

    if (!mentionsShopee && codes.length === 0 && !hasVoucherIntent) {
      return false;
    }

    return (codes.length > 0 || hasVoucherIntent || mentionsShopee) && !hasForeignDomain;
  }

  /**
   * Silently marks all currently rendered messages as historical baseline
   * so opening Zalo or switching into the target group NEVER re-triggers old messages.
   */
  function markExistingMessagesAsBaseline(groupName) {
    activeTrackedGroup = groupName || '';
    sessionStartedAt = Date.now();
    sessionReadyAt = sessionStartedAt + 2500;

    const existing = document.querySelectorAll(MSG_SELECTOR);
    existing.forEach(el => {
      el.setAttribute('data-sv-processed', 'baseline');
      const txt = (el.innerText || el.textContent || '').trim();
      if (txt) {
        const senderEl = el.closest('.chat-message')?.querySelector('.sender-name, .author-name, .chat-item__sender')
          || el.querySelector('.sender-name');
        const sender = senderEl ? (senderEl.innerText || '').trim() : 'Thành viên';
        processedMessageHashes.add(hashMessage(sender, txt));
      }
    });
  }

  /**
   * Checks if a newly inserted DOM node is actually an old historical message
   * loaded by scrolling up or displaying a clock time older than session open.
   */
  function isHistoricalOrPrependedMessage(msgEl, textContent) {
    // 1. Still inside initial group-open warmup window -> always baseline
    if (Date.now() < sessionReadyAt) {
      return true;
    }

    // 2. If user scrolled up, Zalo prepends older messages ABOVE already-processed messages.
    // If any already-processed message appears AFTER msgEl in DOM order, msgEl is older history.
    const processedNodes = document.querySelectorAll('[data-sv-processed]');
    if (processedNodes.length > 0) {
      const lastProcessed = processedNodes[processedNodes.length - 1];
      if (lastProcessed && lastProcessed !== msgEl) {
        const pos = msgEl.compareDocumentPosition(lastProcessed);
        const lastIsAfterMsg = Boolean(pos & Node.DOCUMENT_POSITION_FOLLOWING);
        if (lastIsAfterMsg && !msgEl.contains(lastProcessed) && !lastProcessed.contains(msgEl)) {
          return true;
        }
      }
    }

    // 3. Explicit old-date markers inside Zalo message bubbles (e.g., "Hôm qua", "12/05/2026")
    if (/\b(hôm qua|hom qua)\b/i.test(textContent)) {
      return true;
    }

    // 4. Visible Zalo time element (e.g., "09:15") clearly older than when user opened the group
    const timeEl = msgEl.querySelector('.card-send-time__sendTime, .msg-time, .message-time, [data-id="txt_msg_time"]');
    if (timeEl) {
      const timeTxt = (timeEl.innerText || timeEl.textContent || '').trim();
      const hm = timeTxt.match(/^(\d{1,2}):(\d{2})$/);
      if (hm) {
        const msgDate = new Date(sessionStartedAt);
        msgDate.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
        // Allow 2 minutes clock skew; ignore anything clearly sent before opening Zalo
        if (msgDate.getTime() < sessionStartedAt - 120000) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Process a single newly arriving message element in Zalo.
   * Strictly skips old messages on open/scroll-up and ignores link-only back-voucher messages.
   */
  function processMessageElement(msgEl) {
    if (!isSnifferEnabled || !isExtensionValid()) return;
    if (!msgEl || msgEl.hasAttribute('data-sv-processed')) return;

    // Strict Filter 0: MUST be inside target group [23] LONGHOUSEE
    const currentGroupName = getActiveChatName();
    if (!isTargetGroup(currentGroupName)) {
      activeTrackedGroup = '';
      return;
    }

    // Detect fresh entry / switch into target group -> seed existing chat history as baseline!
    if (activeTrackedGroup !== currentGroupName) {
      markExistingMessagesAsBaseline(currentGroupName);
      return;
    }

    const textContent = (msgEl.innerText || msgEl.textContent || '').trim();
    if (!textContent) return;

    // Guard against old messages during warmup, scroll-up pagination, or past timestamps
    if (isHistoricalOrPrependedMessage(msgEl, textContent)) {
      msgEl.setAttribute('data-sv-processed', 'baseline');
      const senderElOld = msgEl.closest('.chat-message')?.querySelector('.sender-name, .author-name, .chat-item__sender')
        || msgEl.querySelector('.sender-name');
      const senderOld = senderElOld ? (senderElOld.innerText || '').trim() : 'Thành viên';
      processedMessageHashes.add(hashMessage(senderOld, textContent));
      return;
    }

    msgEl.setAttribute('data-sv-processed', 'true');

    // Strict Filter 1: Verify message belongs to Shopee (reject longhousee & other domains)
    const shopeeLinks = extractOfficialVoucherLinks(msgEl, textContent);
    if (!isStrictShopeeMessage(textContent, shopeeLinks)) {
      return;
    }

    // Strict Filter 2: Extract text voucher codes ONLY (do NOT chase back-voucher links!)
    const voucherCodes = extractVoucherCodesFromText(textContent);
    if (voucherCodes.length === 0) {
      return;
    }

    const senderEl = msgEl.closest('.chat-message')?.querySelector('.sender-name, .author-name, .chat-item__sender')
      || msgEl.querySelector('.sender-name');
    const senderName = senderEl ? (senderEl.innerText || '').trim() : 'Thành viên';
    const groupName = currentGroupName || targetGroupFilter;

    // Deduplication check on identical raw message
    const msgHash = hashMessage(senderName, textContent);
    if (processedMessageHashes.has(msgHash)) return;
    processedMessageHashes.add(msgHash);

    if (processedMessageHashes.size > 600) {
      const first = processedMessageHashes.values().next().value;
      processedMessageHashes.delete(first);
    }

    console.log(`[Shopee Voucher Sniffer] Tin mới có ${voucherCodes.length} mã từ [${groupName}]:`, voucherCodes);
    updateWidgetStatus(`Đưa ${voucherCodes.length} mã mới vào hàng đợi lưu chậm`);

    try {
      if (isExtensionValid()) {
        chrome.runtime.sendMessage({
          type: 'ZALO_MESSAGE_DETECTED',
          payload: {
            id: `zalo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            groupName,
            senderName,
            text: textContent,
            links: [],
            codes: voucherCodes,
            timestamp: Date.now(),
            timeStr: new Date().toLocaleTimeString('vi-VN')
          }
        }, () => {
          if (chrome.runtime.lastError) {
            // Ignore benign disconnects
          }
        });
      }
    } catch (e) {
      // Ignore extension context errors
    }
  }

  /**
   * Set up MutationObserver to watch ONLY newly arriving Zalo messages.
   * Existing messages already in chat when Zalo opens are marked as baseline and ignored.
   */
  function setupMessageObserver() {
    // 1. Mark all currently loaded messages as historical baseline (never capture old messages!)
    markExistingMessagesAsBaseline(getActiveChatName());

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.addedNodes && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const messages = node.querySelectorAll ? node.querySelectorAll(MSG_SELECTOR) : [];
              if (messages.length > 0) {
                messages.forEach(processMessageElement);
              } else if (node.matches && node.matches(MSG_SELECTOR)) {
                processMessageElement(node);
              }
            } else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
              const msgParent = node.parentElement.closest(MSG_SELECTOR);
              if (msgParent) processMessageElement(msgParent);
            }
          });
        } else if (mutation.type === 'characterData' && mutation.target?.parentElement) {
          const msgParent = mutation.target.parentElement.closest(MSG_SELECTOR);
          if (msgParent) processMessageElement(msgParent);
        }
      }
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    // Watch for group switches and catch newly mounted message nodes after warmup
    setInterval(() => {
      if (!isSnifferEnabled || !isExtensionValid()) return;
      const currentGroup = getActiveChatName();
      if (!isTargetGroup(currentGroup)) {
        activeTrackedGroup = '';
        return;
      }
      if (activeTrackedGroup !== currentGroup) {
        markExistingMessagesAsBaseline(currentGroup);
        return;
      }
      // During warmup window, keep absorbing late-rendered historical DOM nodes silently
      if (Date.now() < sessionReadyAt) {
        const warmNodes = document.querySelectorAll(
          '.chat-message:not([data-sv-processed]), .msg-view:not([data-sv-processed]), .card--text:not([data-sv-processed]), .chat-item:not([data-sv-processed])'
        );
        warmNodes.forEach(el => el.setAttribute('data-sv-processed', 'baseline'));
        return;
      }
      const unread = document.querySelectorAll(
        '.chat-message:not([data-sv-processed]), .msg-view:not([data-sv-processed]), .card--text:not([data-sv-processed]), .chat-item:not([data-sv-processed])'
      );
      for (const el of unread) {
        processMessageElement(el);
      }
    }, 350);
  }

  function injectZaloWidget() {
    const existingBadge = document.getElementById('sv-zalo-badge');
    if (existingBadge) {
      if (!existingBadge.querySelector('#sv-z-close-badge')) {
        existingBadge.remove(); // Force upgrade outdated badge to include close button!
      } else {
        return;
      }
    }

    const badge = document.createElement('div');
    badge.id = 'sv-zalo-badge';
    badge.innerHTML = `
      <div class="sv-z-icon">V</div>
      <div class="sv-z-content">
        <div class="sv-z-title">VauS</div>
        <div id="sv-z-status" class="sv-z-status">Đang theo dõi nhóm: ${targetGroupFilter}</div>
      </div>
      <button id="sv-z-open-dash" title="Mở Bảng Điều Khiển">Cài đặt</button>
      <button id="sv-z-close-badge" title="Đóng thanh tiện ích này (ẩn đi khi không cần)" aria-label="Đóng">&#x2715;</button>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #sv-zalo-badge {
        position: fixed;
        bottom: 16px;
        left: 80px;
        z-index: 999999;
        display: flex;
        align-items: center;
        gap: 10px;
        background: #FFFFFF;
        border: 1px solid #E8E8E8;
        border-left: 4px solid #EE4D2D;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
        padding: 8px 12px;
        border-radius: 6px;
        color: #222222;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        user-select: none;
        cursor: grab;
        touch-action: none;
        transition: box-shadow 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
      }
      #sv-zalo-badge:hover {
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
      }
      #sv-zalo-badge.sv-dragging {
        cursor: grabbing !important;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.25) !important;
        opacity: 0.95;
      }
      .sv-z-icon {
        width: 22px;
        height: 22px;
        background: #EE4D2D;
        color: #FFFFFF;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 700;
        pointer-events: none;
      }
      .sv-z-title {
        font-weight: 700;
        font-size: 12px;
        color: #EE4D2D;
        pointer-events: none;
      }
      .sv-z-status {
        font-size: 11px;
        color: #555555;
        pointer-events: none;
      }
      #sv-z-open-dash {
        background: #F5F5F5;
        border: 1px solid #D9D9D9;
        color: #333333;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        padding: 4px 8px;
        transition: all 0.2s;
        white-space: nowrap;
      }
      #sv-z-open-dash:hover {
        background: #EE4D2D;
        color: #FFFFFF;
        border-color: #EE4D2D;
      }
      #sv-z-close-badge {
        background: #F3F4F6 !important;
        border: 1px solid #E5E7EB !important;
        color: #6B7280 !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        line-height: 1 !important;
        cursor: pointer !important;
        width: 22px !important;
        height: 22px !important;
        min-width: 22px !important;
        padding: 0 !important;
        margin-left: 4px !important;
        border-radius: 50% !important;
        transition: all 0.15s ease !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        user-select: none !important;
      }
      #sv-z-close-badge:hover {
        background: #FEE2E2 !important;
        border-color: #FCA5A5 !important;
        color: #EF4444 !important;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(badge);

    // Make badge smoothly draggable across screen
    makeDraggable(badge, 'zaloBadgePos');

    document.getElementById('sv-z-open-dash').addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        if (isExtensionValid()) {
          chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' }, () => {
            if (chrome.runtime.lastError) {}
          });
        }
      } catch (e) {}
    });

    const closeBtn = document.getElementById('sv-z-close-badge');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        badge.style.opacity = '0';
        badge.style.transform = 'scale(0.85)';
        setTimeout(() => badge.remove(), 200);

        try {
          if (isExtensionValid()) {
            chrome.storage.local.set({ showZaloWidget: false });
          }
        } catch (err) {}
      });
    }

    // Check active chat group periodically and update badge status
    setInterval(() => {
      if (!isExtensionValid()) return;
      const activeName = getActiveChatName();
      const statusEl = document.getElementById('sv-z-status');
      if (statusEl) {
        if (isTargetGroup(activeName)) {
          statusEl.textContent = `Đang theo dõi nhóm: ${targetGroupFilter}`;
          statusEl.style.color = '#26AA99';
        } else if (activeName) {
          statusEl.textContent = `Tạm dừng (Chỉ theo dõi nhóm ${targetGroupFilter})`;
          statusEl.style.color = '#888888';
        }
      }
    }, 2000);
  }

  /**
   * Make any element freely draggable across the viewport and persist position
   */
  function makeDraggable(element, storageKey = 'zaloBadgePos') {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let hasMoved = false;

    // Restore previously saved coordinates
    if (isExtensionValid()) {
      chrome.storage.local.get([storageKey], (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res[storageKey]) {
          const { left, top } = res[storageKey];
          const maxLeft = Math.max(0, window.innerWidth - (element.offsetWidth || 260));
          const maxTop = Math.max(0, window.innerHeight - (element.offsetHeight || 50));
          const boundedLeft = Math.min(Math.max(10, left), maxLeft - 10);
          const boundedTop = Math.min(Math.max(10, top), maxTop - 10);
          element.style.bottom = 'auto';
          element.style.right = 'auto';
          element.style.left = `${boundedLeft}px`;
          element.style.top = `${boundedTop}px`;
        }
      });
    }

    element.addEventListener('pointerdown', (e) => {
      // Ignore clicks on buttons or links inside the widget
      if (e.target.closest('button') || e.target.closest('a')) return;

      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;

      const rect = element.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      element.style.bottom = 'auto';
      element.style.right = 'auto';
      element.style.left = `${startLeft}px`;
      element.style.top = `${startTop}px`;
      element.classList.add('sv-dragging');

      element.setPointerCapture(e.pointerId);
    });

    element.addEventListener('pointermove', (e) => {
      if (!isDragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        hasMoved = true;
      }

      let newLeft = startLeft + dx;
      let newTop = startTop + dy;

      // Keep within screen edges
      const maxLeft = Math.max(0, window.innerWidth - element.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - element.offsetHeight);
      newLeft = Math.min(Math.max(4, newLeft), maxLeft - 4);
      newTop = Math.min(Math.max(4, newTop), maxTop - 4);

      element.style.left = `${newLeft}px`;
      element.style.top = `${newTop}px`;
    });

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      element.classList.remove('sv-dragging');

      try {
        element.releasePointerCapture(e.pointerId);
      } catch (err) {}

      if (hasMoved && isExtensionValid()) {
        const rect = element.getBoundingClientRect();
        chrome.storage.local.set({
          [storageKey]: {
            left: Math.round(rect.left),
            top: Math.round(rect.top)
          }
        }, () => {
          if (chrome.runtime.lastError) {}
        });
      }
    };

    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
  }

  function updateWidgetStatus(text) {
    const statusEl = document.getElementById('sv-z-status');
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.style.color = '#EE4D2D';
      setTimeout(() => {
        if (statusEl) {
          const activeName = getActiveChatName();
          if (isTargetGroup(activeName)) {
            statusEl.textContent = `Đang theo dõi nhóm: ${targetGroupFilter}`;
            statusEl.style.color = '#26AA99';
          } else {
            statusEl.textContent = `Tạm dừng (Chỉ theo dõi nhóm ${targetGroupFilter})`;
            statusEl.style.color = '#888888';
          }
        }
      }, 4000);
    }
  }

  // Safely load configuration
  if (isExtensionValid()) {
    chrome.storage.local.get(['enableZaloSniffer', 'showZaloWidget', 'zaloTargetGroup'], (res) => {
      if (chrome.runtime.lastError) return;
      isSnifferEnabled = res.enableZaloSniffer !== false;
      if (res.zaloTargetGroup) {
        targetGroupFilter = res.zaloTargetGroup;
      }
      if (res.showZaloWidget !== false) {
        injectZaloWidget();
      }
      setupMessageObserver();
    });

    // Watch for configuration changes
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes.enableZaloSniffer) {
          isSnifferEnabled = changes.enableZaloSniffer.newValue !== false;
        }
        if (changes.showZaloWidget) {
          if (changes.showZaloWidget.newValue === false) {
            const existing = document.getElementById('sv-zalo-badge');
            if (existing) existing.remove();
          } else {
            injectZaloWidget();
          }
        }
        if (changes.zaloTargetGroup) {
          targetGroupFilter = changes.zaloTargetGroup.newValue || '[23] LONGHOUSEE';
          const statusEl = document.getElementById('sv-z-status');
          if (statusEl) {
            statusEl.textContent = `Đang theo dõi nhóm: ${targetGroupFilter}`;
          }
        }
      }
    });
  }

  function showZaloPageToast() {
    // Disabled per user request: "bỏ tính năng thông báo và xóa hiện thông báo đi"
    try {
      document.getElementById('sv-zalo-toast-container')?.remove();
      document.getElementById('sv-universal-toast-container')?.remove();
      document.getElementById('sv-universal-toast-style')?.remove();
    } catch (_) {}
  }

  // Clear any existing toast containers on startup
  try {
    document.getElementById('sv-zalo-toast-container')?.remove();
    document.getElementById('sv-universal-toast-container')?.remove();
    document.getElementById('sv-universal-toast-style')?.remove();
  } catch (_) {}

})();
