import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getShopeeResetSlotKey,
  hasResetSignal,
  createVoucherQueue
} from '../utils/voucher-queue.js';

test('getShopeeResetSlotKey maps timestamps to standard Shopee reset slots (0h, 9h, 12h, 15h, 18h, 21h)', () => {
  const t0859 = new Date(2026, 10, 18, 8, 59, 0).getTime();
  const t0900 = new Date(2026, 10, 18, 9, 0, 0).getTime();
  const t1230 = new Date(2026, 10, 18, 12, 30, 0).getTime();
  const t2105 = new Date(2026, 10, 18, 21, 5, 0).getTime();

  assert.equal(getShopeeResetSlotKey(t0859), '2026-11-18#S00');
  assert.equal(getShopeeResetSlotKey(t0900), '2026-11-18#S09');
  assert.equal(getShopeeResetSlotKey(t1230), '2026-11-18#S12');
  assert.equal(getShopeeResetSlotKey(t2105), '2026-11-18#S21');
});

test('hasResetSignal recognizes Vietnamese and English reset keywords', () => {
  assert.equal(hasResetSignal('Shopee vừa reset lượt mã SVIP200K rồi mn ơi'), true);
  assert.equal(hasResetSignal('Mở lại khung giờ mới 12h mã FA50K'), true);
  assert.equal(hasResetSignal('Đã nhả lượt thêm đợt mới cho SHOPEE50K'), true);
  assert.equal(hasResetSignal('Mã SHOPEE50K giảm 50k đơn 250k toàn sàn'), false);
});

test('createVoucherQueue processes codes strictly one by one with slow delay and deduplicates burst spam', async () => {
  let now = new Date(2026, 10, 18, 12, 0, 10).getTime();
  const sleepCalls = [];
  const callOrder = [];
  let activeConcurrency = 0;
  let maxConcurrency = 0;

  const queue = createVoucherQueue({
    getDelayMs: () => 6000,
    jitterMs: 1000,
    nowFn: () => now,
    randomFn: () => 0.5,
    sleepFn: async (ms) => {
      sleepCalls.push(ms);
      now += ms;
    },
    saveFn: async (code) => {
      activeConcurrency++;
      maxConcurrency = Math.max(maxConcurrency, activeConcurrency);
      callOrder.push(code);
      await Promise.resolve();
      activeConcurrency--;
      return { success: true, alreadySaved: false, status: 'success', errCode: 0, message: 'Lưu thành công!' };
    }
  });

  // Simulate high-volume Zalo burst: 3 messages arrive simultaneously with duplicate codes
  const r1 = queue.enqueueFromMessage({ codes: ['CODE111', 'CODE222'], text: 'Shopee mã CODE111 CODE222' });
  const r2 = queue.enqueueFromMessage({ codes: ['CODE222', 'CODE333'], text: 'Shopee mã CODE222 CODE333' });
  const r3 = queue.enqueueFromMessage({ codes: ['CODE111'], text: 'Spam lại CODE111' });

  assert.equal(r1.enqueued.length, 2);
  assert.equal(r2.enqueued.length, 1);
  assert.equal(r2.skipped.length, 1);
  assert.equal(r3.enqueued.length, 0);
  assert.equal(r3.skipped[0].reason, 'in_queue');

  await queue.waitUntilIdle();

  assert.deepEqual(callOrder, ['CODE111', 'CODE222', 'CODE333']);
  assert.equal(maxConcurrency, 1, 'Must never save two vouchers concurrently');
  assert.deepEqual(sleepCalls, [6500, 6500], 'Must wait slowly between each code');

  const snap = queue.getSnapshot();
  assert.equal(snap.stats.savedTotal, 3);
  assert.equal(snap.stats.skippedDuplicates, 2);
});

test('createVoucherQueue re-accepts codes ONLY when reset signal or new Shopee reset slot occurs', async () => {
  let now = new Date(2026, 10, 18, 12, 0, 5).getTime();
  const savedAttempts = [];

  const queue = createVoucherQueue({
    getDelayMs: () => 6000,
    jitterMs: 0,
    resetDebounceMs: 120000,
    nowFn: () => now,
    sleepFn: async () => {},
    saveFn: async (code) => {
      savedAttempts.push({ code, at: now });
      if (savedAttempts.length === 1) {
        return { success: false, alreadySaved: false, status: 'failed', errCode: 2, message: 'Hết lượt' };
      }
      return { success: true, alreadySaved: false, status: 'success', errCode: 0, message: 'Lưu thành công!' };
    }
  });

  // 1. First time seeing SVIP200K -> accepted as NEW (fails with exhausted)
  const first = queue.enqueueFromMessage({ codes: ['SVIP200K'], text: 'Shopee mã SVIP200K' });
  assert.equal(first.enqueued.length, 1);
  assert.equal(first.enqueued[0].trigger, 'new');
  await queue.waitUntilIdle();

  // 2. Duplicate message 20s later without reset -> MUST SKIP
  now += 20000;
  const dup = queue.enqueueFromMessage({ codes: ['SVIP200K'], text: 'Shopee mã SVIP200K nhanh tay' });
  assert.equal(dup.enqueued.length, 0);
  assert.equal(dup.skipped[0].reason, 'duplicate');

  // 3. Reset message 30s later (inside 2-minute debounce) -> MUST SKIP to avoid burst spam
  now += 30000;
  const tooSoonReset = queue.enqueueFromMessage({ codes: ['SVIP200K'], text: 'Shopee vừa reset mã SVIP200K' });
  assert.equal(tooSoonReset.enqueued.length, 0);

  // 4. Explicit reset signal after debounce (>= 2 min) -> ACCEPTED as reset_signal
  now += 130000;
  const validReset = queue.enqueueFromMessage({ codes: ['SVIP200K'], text: 'Shopee vừa reset mở lại mã SVIP200K!' });
  assert.equal(validReset.enqueued.length, 1);
  assert.equal(validReset.enqueued[0].trigger, 'reset_signal');
  await queue.waitUntilIdle();

  // 5. Same code already saved in 12:00 slot -> skipped even if reposted in 12:00 slot
  now += 60000;
  const alreadySavedDup = queue.enqueueFromMessage({ codes: ['SVIP200K'], text: 'Shopee mã SVIP200K' });
  assert.equal(alreadySavedDup.enqueued.length, 0);

  // 6. Clock crosses to 15:00 Shopee reset slot -> ACCEPTED as reset_slot!
  now = new Date(2026, 10, 18, 15, 0, 2).getTime();
  const nextSlot = queue.enqueueFromMessage({ codes: ['SVIP200K'], text: 'Shopee 15h lên mã SVIP200K' });
  assert.equal(nextSlot.enqueued.length, 1);
  assert.equal(nextSlot.enqueued[0].trigger, 'reset_slot');
  await queue.waitUntilIdle();

  assert.equal(savedAttempts.length, 3);
});
