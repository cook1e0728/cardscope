import test from 'node:test';
import assert from 'node:assert/strict';
import { planJpTwSameNumberLinks } from '../providers/pokemon-jp-tw-same-number-link.mjs';

const pair = (code, num, jn, tn, extra = {}) => ({ code, num, jp_id: `jp-${code}-${num}`, jc: `jp-${code}-${num}`, jn, tw_id: `tw-${code}-${num}`, tc: `tw-${code}-${num}`, tn, jp_dupes: 1, tw_links: 0, ...extra });

test('ADR 0024: aligned series link by number; one name mismatch drops the whole series', () => {
  const { plans, byCode, misaligned, skipped } = planJpTwSameNumberLinks([
    pair('SVD', '001', '妙蛙種子', '妙蛙種子'),
    pair('SVD', '133', '妮莫', '妮莫（過去）'),
    pair('SVD', '002', null, '妙蛙草'),
    pair('SVOD', '001', '天秤偶', '天秤偶'),
    pair('SVOD', '002', '念力土偶', '天秤偶'),
    pair('SV4A', '347', '夢幻ex', '夢幻ex', { jc: 'pokemon-mew-ex' }),
    pair('SV9', '001', '索偵蟲', '索偵蟲', { jc: 'tw-SV9-001' })
  ]);
  assert.deepEqual(plans[0].rows.map(row => row.jpCardId), ['jp-SVD-001', 'jp-SVD-133']);
  assert.deepEqual(byCode, { SVD: 2 });
  assert.deepEqual(misaligned, { SVOD: 'NAME_MISMATCH:002' });
  assert.deepEqual(skipped.map(row => row.reason), ['JP_NAME_MISSING', 'JP_ALREADY_LINKED']);
});

test('ADR 0024: a series with a JP card linked to another number is not planned; batches hold 100', () => {
  const many = Array.from({ length: 150 }, (_, i) => pair('S4A', String(i + 1).padStart(3, '0'), '皮卡丘', '皮卡丘'));
  const { plans } = planJpTwSameNumberLinks([...many, pair('SVM', '001', '喵喵', '‌喵喵')], ['SVM']);
  assert.deepEqual(plans.map(plan => plan.rows.length), [100, 50]);
  assert.equal(plans.flatMap(plan => plan.rows).some(row => row.jpCardId.includes('SVM')), false);
});
