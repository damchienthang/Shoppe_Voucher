/**
 * Sequential Slow Voucher Queue & New/Reset Code Detector.
 * Designed for high-volume Zalo voucher hunting groups:
 * - Collects incoming voucher codes into a deduplicated FIFO list.
 * - Saves strictly ONE voucher at a time at a slow, human-safe pace (default 6s-8.5s).
 * - Only accepts NEW codes or codes that have been RESET (new Shopee reset slot or explicit reset signal).
 * - Never auto-opens or chases back-voucher links.
 */

export const SHOPEE_RESET_HOURS = [0, 9, 12, 15, 18, 21];

/**
 * Computes the deterministic Shopee voucher reset slot key for a timestamp.
 * Slots change at 00:00, 09:00, 12:00, 15:00, 18:00, and 21:00 local time.
 *
 * @param {number} [timestampMs=Date.now()]
 * @returns {string} e.g. "2026-11-18#S12"
 */
export function getShopeeResetSlotKey(timestampMs = Date.now()) {
  const d = new Date(timestampMs);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = d.getHours();

  let activeSlot = SHOPEE_RESET_HOURS[0];
  for (const h of SHOPEE_RESET_HOURS) {
    if (hour >= h) {
      activeSlot = h;
    }
  }
  return `${year}-${month}-${day}#S${String(activeSlot).padStart(2, '0')}`;
}

/**
 * Detects whether a Zalo message explicitly signals that vouchers were reset,
 * reopened, or replenished for a new turn/time slot.
 *
 * @param {string} [text='']
 * @returns {boolean}
 */
export function hasResetSignal(text = '') {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) return false;

  return /(?:reset|mở\s*lại|mo\s*lai|lên\s*lại|len\s*lai|nhả\s*lượt|nha\s*luot|về\s*thêm\s*lượt|thêm\s*lượt|them\s*luot|làm\s*mới|lam\s*moi|khung\s*giờ\s*mới|khung\s*gio\s*moi|đợt\s*mới|dot\s*moi|ca\s*mới|ca\s*moi|mã\s*mới|ma\s*moi|lên\s*mã\s*mới|reopen|restock|refresh|new\s*slot)/i.test(
    normalized
  );
}

/**
 * Creates a serialized slow-saving voucher queue with new/reset deduplication.
 *
 * @param {object} options
 */
export function createVoucherQueue(options = {}) {
  const {
    saveFn,
    getDelayMs = () => 6000,
    jitterMs = 2500,
    resetDebounceMs = 120000,
    savedResetCooldownMs = 900000,
    maxQueueSize = 300,
    maxProcessedHistory = 60,
    maxSeenEntries = 1000,
    initialSeenMap = {},
    onUpdate = () => {},
    onPersistSeen = () => {},
    onItemDone = () => {},
    nowFn = () => Date.now(),
    sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    randomFn = () => Math.random()
  } = options;

  let delayOverrideMs = null;
  let isPaused = false;
  let isProcessing = false;
  let activeItem = null;
  let pendingQueue = [];
  let recentProcessed = [];
  let idleResolvers = [];

  const stats = {
    enqueuedTotal: 0,
    processedTotal: 0,
    savedTotal: 0,
    alreadySavedTotal: 0,
    failedTotal: 0,
    skippedDuplicates: 0
  };

  /** @type {Map<string, { lastSeenAt: number, lastProcessedAt: number, lastSlotKey: string, lastStatus: string, lastErrCode: number | null, triggerCount: number }>} */
  const seenMap = new Map();
  if (initialSeenMap && typeof initialSeenMap === 'object') {
    for (const [k, v] of Object.entries(initialSeenMap)) {
      if (k && v && typeof v === 'object') {
        seenMap.set(String(k).trim().toUpperCase(), {
          lastSeenAt: Number(v.lastSeenAt) || 0,
          lastProcessedAt: Number(v.lastProcessedAt) || 0,
          lastSlotKey: String(v.lastSlotKey || ''),
          lastStatus: String(v.lastStatus || 'pending'),
          lastErrCode: v.lastErrCode ?? null,
          triggerCount: Number(v.triggerCount) || 1
        });
      }
    }
  }

  function getEffectiveDelayMs() {
    const base = delayOverrideMs != null ? delayOverrideMs : Number(getDelayMs());
    return Math.max(1000, Number.isFinite(base) ? base : 6000);
  }

  function serializeSeenMap() {
    const obj = {};
    for (const [k, v] of seenMap.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  function trimSeenMap() {
    if (seenMap.size <= maxSeenEntries) return;
    const entries = Array.from(seenMap.entries()).sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
    const excess = seenMap.size - maxSeenEntries;
    for (let i = 0; i < excess; i++) {
      seenMap.delete(entries[i][0]);
    }
  }

  function notifyUpdate() {
    try {
      onUpdate(getSnapshot());
    } catch (_) {}
  }

  function notifyPersistSeen() {
    try {
      onPersistSeen(serializeSeenMap());
    } catch (_) {}
  }

  function resolveIdleWaiters() {
    if (!isProcessing && (pendingQueue.length === 0 || isPaused)) {
      const waiters = idleResolvers.splice(0, idleResolvers.length);
      waiters.forEach((fn) => fn());
    }
  }

  /**
   * Decides whether a detected voucher code is NEW or RESET and eligible to join the slow queue.
   *
   * @param {string} rawCode
   * @param {string} [messageText='']
   * @param {number} [now=nowFn()]
   */
  function evaluateCode(rawCode, messageText = '', now = nowFn()) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code || code.length < 5 || !/^[A-Z0-9]+$/.test(code)) {
      return { accept: false, code, reason: 'invalid' };
    }

    if (
      (activeItem && activeItem.code === code) ||
      pendingQueue.some((item) => item.code === code)
    ) {
      return { accept: false, code, reason: 'in_queue' };
    }

    if (pendingQueue.length >= maxQueueSize) {
      return { accept: false, code, reason: 'queue_full' };
    }

    const currentSlot = getShopeeResetSlotKey(now);
    const record = seenMap.get(code);

    // 1. Brand-new code never seen before
    if (!record) {
      return {
        accept: true,
        code,
        trigger: 'new',
        triggerLabel: 'Mã mới',
        slotKey: currentSlot
      };
    }

    // 2. Crossed into a new Shopee reset time slot (0h / 9h / 12h / 15h / 18h / 21h or new day)
    if (record.lastSlotKey && record.lastSlotKey !== currentSlot) {
      return {
        accept: true,
        code,
        trigger: 'reset_slot',
        triggerLabel: 'Reset khung giờ mới',
        slotKey: currentSlot
      };
    }

    // 3. Explicit reset/reopen keyword in message within the same slot
    if (hasResetSignal(messageText)) {
      const refTime = record.lastProcessedAt || record.lastSeenAt || 0;
      const elapsed = Math.max(0, now - refTime);
      const wasSaved = record.lastStatus === 'success' || record.lastStatus === 'already_saved';
      const requiredCooldown = wasSaved ? savedResetCooldownMs : resetDebounceMs;

      if (elapsed >= requiredCooldown) {
        return {
          accept: true,
          code,
          trigger: 'reset_signal',
          triggerLabel: 'Mã reset / mở lại',
          slotKey: currentSlot
        };
      }
    }

    return { accept: false, code, reason: 'duplicate' };
  }

  /**
   * Filters codes from an incoming Zalo message and enqueues only new or reset codes.
   */
  function enqueueFromMessage({
    codes = [],
    text = '',
    groupName = 'Zalo Group',
    senderName = 'Thành viên',
    messageId = '',
    timestamp = nowFn()
  }) {
    const enqueued = [];
    const skipped = [];
    const uniqueBatch = new Set();

    for (const rawCode of codes) {
      const upper = String(rawCode || '').trim().toUpperCase();
      if (!upper || uniqueBatch.has(upper)) continue;
      uniqueBatch.add(upper);

      const decision = evaluateCode(upper, text, timestamp);
      if (!decision.accept) {
        stats.skippedDuplicates++;
        skipped.push({ code: upper, reason: decision.reason });
        continue;
      }

      const prevRecord = seenMap.get(upper);
      seenMap.set(upper, {
        lastSeenAt: timestamp,
        lastProcessedAt: prevRecord ? prevRecord.lastProcessedAt : 0,
        lastSlotKey: decision.slotKey,
        lastStatus: 'queued',
        lastErrCode: prevRecord ? prevRecord.lastErrCode : null,
        triggerCount: (prevRecord ? prevRecord.triggerCount : 0) + 1
      });
      trimSeenMap();

      const item = {
        id: `q_${timestamp}_${Math.random().toString(36).slice(2, 7)}`,
        code: upper,
        trigger: decision.trigger,
        triggerLabel: decision.triggerLabel,
        slotKey: decision.slotKey,
        groupName,
        senderName,
        messageId,
        enqueuedAt: timestamp,
        status: 'queued',
        message: `Đang chờ lưu (${decision.triggerLabel})`
      };

      pendingQueue.push(item);
      stats.enqueuedTotal++;
      enqueued.push(item);
    }

    if (enqueued.length > 0) {
      notifyPersistSeen();
      notifyUpdate();
      startWorker();
    } else if (skipped.length > 0) {
      notifyUpdate();
    }

    return { enqueued, skipped };
  }

  async function startWorker() {
    if (isProcessing || isPaused || pendingQueue.length === 0) {
      resolveIdleWaiters();
      return;
    }

    isProcessing = true;

    try {
      while (!isPaused && pendingQueue.length > 0) {
        const item = pendingQueue.shift();
        if (!item) break;

        activeItem = {
          ...item,
          status: 'processing',
          startedAt: nowFn(),
          message: 'Đang lưu chậm vào ví Shopee...'
        };
        notifyUpdate();

        let result;
        try {
          result = saveFn
            ? await saveFn(item.code, activeItem)
            : { success: false, alreadySaved: false, status: 'failed', errCode: -1, message: 'Chưa cấu hình hàm lưu mã' };
        } catch (err) {
          result = {
            success: false,
            alreadySaved: false,
            status: 'failed',
            errCode: -1,
            message: err?.message || 'Lỗi không xác định khi lưu mã'
          };
        }

        const finishedAt = nowFn();
        const isAlreadySaved = Boolean(result?.alreadySaved) || result?.status === 'already_saved';
        const isSuccess = Boolean(result?.success) || isAlreadySaved;
        const status = result?.status || (isAlreadySaved ? 'already_saved' : isSuccess ? 'success' : 'failed');

        stats.processedTotal++;
        if (isAlreadySaved) {
          stats.alreadySavedTotal++;
        } else if (isSuccess) {
          stats.savedTotal++;
        } else {
          stats.failedTotal++;
        }

        const existingSeen = seenMap.get(item.code) || { triggerCount: 1 };
        seenMap.set(item.code, {
          ...existingSeen,
          lastSeenAt: Math.max(existingSeen.lastSeenAt || 0, item.enqueuedAt),
          lastProcessedAt: finishedAt,
          lastSlotKey: getShopeeResetSlotKey(finishedAt),
          lastStatus: status,
          lastErrCode: result?.errCode ?? null
        });

        const completedItem = {
          ...activeItem,
          status,
          success: isSuccess,
          alreadySaved: isAlreadySaved,
          errCode: result?.errCode ?? null,
          message: result?.message || (isSuccess ? 'Lưu thành công vào ví!' : 'Lưu thất bại'),
          voucherTitle: result?.voucherTitle || '',
          finishedAt
        };

        recentProcessed.unshift(completedItem);
        if (recentProcessed.length > maxProcessedHistory) {
          recentProcessed.length = maxProcessedHistory;
        }

        activeItem = null;
        notifyPersistSeen();

        try {
          await onItemDone(completedItem, result);
        } catch (_) {}

        notifyUpdate();

        // Always wait slowly between consecutive codes so Shopee never flags rapid automated requests
        if (!isPaused && pendingQueue.length > 0) {
          const baseDelay = getEffectiveDelayMs();
          const jitter = jitterMs > 0 ? Math.floor(randomFn() * jitterMs) : 0;
          await sleepFn(baseDelay + jitter);
        }
      }
    } finally {
      activeItem = null;
      isProcessing = false;
      notifyUpdate();
      resolveIdleWaiters();
    }
  }

  function pause() {
    isPaused = true;
    notifyUpdate();
  }

  function resume() {
    isPaused = false;
    notifyUpdate();
    startWorker();
  }

  function clearPending() {
    // Allow cleared queued items to be accepted again if re-announced later
    for (const item of pendingQueue) {
      const rec = seenMap.get(item.code);
      if (rec && rec.lastStatus === 'queued' && rec.lastProcessedAt === 0) {
        seenMap.delete(item.code);
      }
    }
    pendingQueue = [];
    notifyPersistSeen();
    notifyUpdate();
    resolveIdleWaiters();
  }

  function resetSeenMemory() {
    seenMap.clear();
    stats.skippedDuplicates = 0;
    notifyPersistSeen();
    notifyUpdate();
  }

  function setDelayMs(ms) {
    const parsed = Number(ms);
    if (Number.isFinite(parsed) && parsed >= 1000) {
      delayOverrideMs = parsed;
      notifyUpdate();
    }
  }

  function getSnapshot() {
    return {
      isPaused,
      isProcessing,
      delayMs: getEffectiveDelayMs(),
      jitterMs,
      activeItem,
      pendingCount: pendingQueue.length,
      pending: pendingQueue.slice(0, 40),
      recentProcessed: recentProcessed.slice(0, 30),
      seenCount: seenMap.size,
      stats: { ...stats }
    };
  }

  function waitUntilIdle() {
    if (!isProcessing && (pendingQueue.length === 0 || isPaused)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      idleResolvers.push(resolve);
    });
  }

  return {
    evaluateCode,
    enqueueFromMessage,
    pause,
    resume,
    clearPending,
    resetSeenMemory,
    setDelayMs,
    getSnapshot,
    waitUntilIdle
  };
}
