import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficialTwSupplementPlan, buildOfficialTwSupplementSql } from '../providers/pokemon-tw-official-supplement-plan.mjs';
import { OFFICIAL_TW_RARITY_FILTERS } from '../providers/pokemon-tw-official.mjs';

const rarityLists = (assign = {}) => Object.fromEntries(Object.keys(OFFICIAL_TW_RARITY_FILTERS).map(value => [value, { complete: true, pages: { 1: assign[value] || [] } }]));
const detail = (number, nameZh) => ({ number, nameZh, setMark: 'SV9_F', total: '100', fetchedAt: '2026-10-04T00:00:00Z' });
const cache = {
  seriesLists: { SV9: { complete: true, pages: { 1: ['1', '2', '3', '4'] } } },
  details: { 1: detail('001', '<火箭隊的>索偵蟲'), 2: detail('002', '皮卡丘'), 3: detail('101', '皮卡丘ex'), 4: detail(null, '基本草能量') },
  rarityLists: rarityLists({ 1: ['1', '2'], 8: ['3'] })
};

test('ADR 0023: only absent official numbers are planned, after every archive number matches', () => {
  const existing = [{ num: '001', name_zh: '<火箭隊的>索偵蟲' }, { num: '002', name_zh: '皮卡丘' }];
  const { plan, summary } = buildOfficialTwSupplementPlan({ code: 'SV9', seriesId: 'pokemon-tcgdex-tw-sv9', existing, cache, observedAt: 'x' });
  assert.deepEqual(plan.cards.map(card => [card.id, card.official_card_number, card.rarity_code]), [['pokemon-official-tw-sv9-101', '101', 'SR']]);
  assert.deepEqual(plan.series, { id: 'pokemon-tcgdex-tw-sv9', provider_id: 'SV9' });
  assert.deepEqual(plan.alignment, [{ number: '001', name_zh: '<火箭隊的>索偵蟲' }, { number: '002', name_zh: '皮卡丘' }]);
  assert.deepEqual([summary.add, summary.misaligned, summary.quarantined], [1, 0, 1]);
  const { gated, replay } = buildOfficialTwSupplementSql(plan, 'tester');
  assert.match(gated, /private\.supplement_pokemon_tw_official_series/);
  assert.match(gated, /"cards": 1, "canonical": 1, "printings": 1/);
  assert.match(replay, /, false\) v;/);
});

test('ADR 0023: one archive number that differs from the official card rejects the series', () => {
  for (const existing of [[{ num: '001', name_zh: '索偵蟲' }, { num: '002', name_zh: '皮卡丘' }], [{ num: '001', name_zh: '<火箭隊的>索偵蟲' }, { num: '003', name_zh: '雷丘' }]]) {
    const { plan, misaligned } = buildOfficialTwSupplementPlan({ code: 'SV9', seriesId: 'pokemon-tcgdex-tw-sv9', existing, cache, observedAt: 'x' });
    assert.equal(plan, null);
    assert.equal(misaligned.length, 1);
  }
});

const promoDetail = (number, nameZh, total = 'SV-P') => ({ number, nameZh, setMark: 'PROMO.MARK', total, fetchedAt: '2026-10-14T00:00:00Z' });

test('promo series: unpadded archive number and number-less archive rows are aligned, the padded duplicate is not added', () => {
  const promoCache = {
    seriesLists: { 'SV-P': { complete: true, pages: { 1: ['1', '2', '3', '4', '5', '6'] } } },
    details: { 1: promoDetail('001', '皮卡丘'), 2: promoDetail('056', '摩托蜥'), 3: promoDetail('057', '臺北的皮卡丘'), 4: promoDetail(null, '勝利之證', null), 5: promoDetail(null, '基本水能量', null), 6: promoDetail('058', '爆香猴') },
    rarityLists: rarityLists({ 11: ['1', '2', '3', '4', '5', '6'] })
  };
  const existing = [{ num: '001', name_zh: '皮卡丘' }, { num: '56', name_zh: '摩托蜥' }, { num: '057', name_zh: '臺北的皮卡丘' }, { num: 'no1', name_zh: '勝利之證(冠軍)' }, { num: 'WAT', name_zh: '基本水能量' }];
  const result = buildOfficialTwSupplementPlan({ code: 'SV-P', seriesId: 'pokemon-tcgdex-tw-sv-p', existing, cache: promoCache, observedAt: 'x' });
  assert.deepEqual(result.plan.cards.map(card => [card.id, card.official_card_number, card.rarity_code]), [['pokemon-official-tw-sv-p-058', '058', 'NONE']]);
  assert.deepEqual(result.zeroPadAliases, [{ archive: '56', official: '056', name: '摩托蜥' }]);
  assert.deepEqual(result.unnumberedAligned.map(row => row.number), ['no1', 'WAT']);
  assert.equal(result.plan.alignment.length, 5);
  assert.equal(result.summary.misaligned, 0);
  // The same unpadded archive number is rejected for a series that is not a -P promo series.
  const other = { ...promoCache, seriesLists: { SV9: promoCache.seriesLists['SV-P'] }, details: Object.fromEntries(Object.entries(promoCache.details).map(([id, d]) => [id, { ...d, setMark: 'SV9_F', total: '100' }])) };
  const rejected = buildOfficialTwSupplementPlan({ code: 'SV9', seriesId: 's', existing: [{ num: '56', name_zh: '摩托蜥' }], cache: other, observedAt: 'x' });
  assert.equal(rejected.plan, null);
  assert.equal(rejected.summary.misaligned, 1);
});

test('promo series: an archive row with a different name than the number-less official entries still rejects the series', () => {
  const promoCache = {
    seriesLists: { 'SV-P': { complete: true, pages: { 1: ['1', '2'] } } },
    details: { 1: promoDetail('001', '皮卡丘'), 2: promoDetail(null, '勝利之證', null) },
    rarityLists: rarityLists({ 11: ['1', '2'] })
  };
  const result = buildOfficialTwSupplementPlan({ code: 'SV-P', seriesId: 's', existing: [{ num: 'no9', name_zh: '別的卡' }], cache: promoCache, observedAt: 'x' });
  assert.equal(result.plan, null);
  assert.deepEqual(result.misaligned.map(row => row.number), ['no9']);
});

test('promo series: more than 100 absent numbers become several plans, later ones align with the earlier cards', () => {
  const ids = Array.from({ length: 230 }, (_, index) => String(index + 1));
  const promoCache = {
    seriesLists: { 'SV-P': { complete: true, pages: { 1: ids } } },
    details: Object.fromEntries(ids.map(id => [id, promoDetail(String(id).padStart(3, '0'), `卡${id}`)])),
    rarityLists: rarityLists({ 11: ids })
  };
  const result = buildOfficialTwSupplementPlan({ code: 'SV-P', seriesId: 'pokemon-tcgdex-tw-sv-p', existing: [{ num: '001', name_zh: '卡1' }], cache: promoCache, observedAt: 'x' });
  assert.deepEqual(result.plans.map(plan => plan.cards.length), [100, 100, 29]);
  assert.deepEqual(result.plans.map(plan => plan.batch.index), [1, 2, 3]);
  assert.deepEqual(result.plans.map(plan => plan.alignment.length), [1, 101, 201]);
  assert.equal(new Set(result.plans.map(plan => plan.evidenceHash)).size, 3);
  assert.equal(result.plan, result.plans[0]);
  // Non-promo series stay at one plan of at most 100 cards.
  const over = { ...promoCache, seriesLists: { SV9: promoCache.seriesLists['SV-P'] }, details: Object.fromEntries(Object.entries(promoCache.details).map(([id, d]) => [id, { ...d, setMark: 'SV9_F', total: '100' }])) };
  const plain = buildOfficialTwSupplementPlan({ code: 'SV9', seriesId: 's', existing: [{ num: '001', name_zh: '卡1' }], cache: over, observedAt: 'x' });
  assert.equal(plain.plan, null);
});
