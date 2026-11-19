import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDomToast,
  isAlreadySavedResult,
  normalizeSaveResult
} from '../utils/parser.js';

test('classifyDomToast accurately classifies real success messages', () => {
  const res1 = classifyDomToast('Lưu voucher thành công vào ví!');
  assert.equal(res1?.status, 'success');
  assert.equal(res1?.errorCode, 0);

  const res2 = classifyDomToast('Đã lưu vào ví');
  assert.equal(res2?.status, 'success');
  assert.equal(res2?.errorCode, 0);
});

test('classifyDomToast does NOT misclassify negated failures as success', () => {
  const negated1 = classifyDomToast('Lưu không thành công, vui lòng thử lại');
  assert.equal(negated1?.status, 'failed');
  assert.notEqual(negated1?.errorCode, 0);

  const negated2 = classifyDomToast('Không thể lưu vào ví vì mã không hợp lệ');
  assert.equal(negated2?.status, 'failed');
  assert.notEqual(negated2?.errorCode, 0);

  const exhausted = classifyDomToast('Rất tiếc, bạn đã nhận hết lượt của mã này');
  assert.equal(exhausted?.status, 'failed');
  assert.equal(exhausted?.errorCode, 2);

  const exhausted2 = classifyDomToast('Mã giảm giá đã được lưu hết bởi người dùng khác');
  assert.equal(exhausted2?.status, 'failed');
  assert.equal(exhausted2?.errorCode, 2);
});

test('classifyDomToast classifies already-saved and specific Shopee failure reasons', () => {
  const saved = classifyDomToast('Bạn đã lưu mã giảm giá này vào ví rồi');
  assert.equal(saved?.status, 'already_saved');
  assert.equal(saved?.errorCode, 3);

  const notStarted = classifyDomToast('Chưa đến khung giờ mở mã voucher này');
  assert.equal(notStarted?.status, 'failed');
  assert.equal(notStarted?.errorCode, 7);

  const invalid = classifyDomToast('Mã voucher không tồn tại hoặc nhập sai');
  assert.equal(invalid?.status, 'failed');
  assert.equal(invalid?.errorCode, 1);

  // Unrelated text containing only "voucher" or "mã" must be ignored
  assert.equal(classifyDomToast('Áp dụng cho đơn hàng có mã vận chuyển'), null);
});

test('isAlreadySavedResult avoids false positives on failure codes', () => {
  assert.equal(isAlreadySavedResult(3, ''), true);
  assert.equal(isAlreadySavedResult(140003, ''), true);
  assert.equal(isAlreadySavedResult(4, 'Rất tiếc! Mã đã được lưu hết'), false);
  assert.equal(isAlreadySavedResult(2, 'Đã có lỗi xảy ra khi lưu mã'), false);
  assert.equal(isAlreadySavedResult(4, 'Bạn đã lưu mã này vào ví rồi'), true);
});

test('normalizeSaveResult maps error codes to accurate status and message', () => {
  const ok = normalizeSaveResult('fa50k', { error: 0, data: { title: 'Giảm 50K đơn 250K' } }, 'Shopee App RN');
  assert.equal(ok.success, true);
  assert.equal(ok.alreadySaved, false);
  assert.equal(ok.status, 'success');
  assert.equal(ok.code, 'FA50K');
  assert.equal(ok.voucherTitle, 'Giảm 50K đơn 250K');

  const already = normalizeSaveResult('vip99', { error: 140003 });
  assert.equal(already.success, true);
  assert.equal(already.alreadySaved, true);
  assert.equal(already.status, 'already_saved');

  const exhausted = normalizeSaveResult('hetma99', { error: 140002 });
  assert.equal(exhausted.success, false);
  assert.equal(exhausted.alreadySaved, false);
  assert.equal(exhausted.status, 'failed');
  assert.match(exhausted.message, /hết lượt/i);

  const notEligible = normalizeSaveResult('badcode', { error: 4, error_msg: 'not eligible condition' });
  assert.equal(notEligible.success, false);
  assert.equal(notEligible.status, 'failed');
  assert.match(notEligible.message, /không hợp lệ/i);
});
