import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficialTwSeriesPlans } from '../providers/pokemon-tw-official-series-plan.mjs';
import { OFFICIAL_TW_RARITY_FILTERS } from '../providers/pokemon-tw-official.mjs';

const rarityLists = (assign = {}) => Object.fromEntries(Object.keys(OFFICIAL_TW_RARITY_FILTERS).map(value => [value, { complete: true, pages: { 1: assign[value] || [] } }]));
const detail = (number, nameZh, setMark = 'M3_') => ({ number, nameZh, setMark, total: '080', fetchedAt: '2026-10-02T00:00:00Z' });

test('one TW card per number, smallest detail ID, rarity only when every version agrees', () => {
  const cache = {
    seriesLists: { M3: { complete: true, pages: { 1: ['12', '10', '11', '13', '14'] } } },
    details: { 10: detail('001', '妙蛙種子'), 12: detail('001', '妙蛙種子'), 11: detail('002', '妙蛙草'), 13: detail('003', '妙蛙花'), 14: detail(null, '基本草能量') },
    rarityLists: rarityLists({ 1: ['10', '12', '11'], 4: ['13'], 11: ['11'] })
  };
  const { plans, quarantined, rarityUnknown, summary } = buildOfficialTwSeriesPlans({ code: 'M3', seriesNameZh: '虛無歸零', cache, observedAt: '2026-10-02T00:00:00Z' });
  assert.equal(plans[0].series.id, 'pokemon-official-tw-m3');
  assert.deepEqual(plans[0].cards.map(c => [c.official_card_number, c.provider_id, c.rarity_code]), [['001', '10', 'C'], ['002', '11', null], ['003', '13', 'RR']]);
  assert.equal(plans[0].cards[0].source_url, 'https://asia.pokemon-card.com/tw/card-search/detail/10/');
  assert.deepEqual(plans[0].cards[0].metadata.officialDetailIds, ['10', '12']);
  assert.deepEqual(rarityUnknown.map(r => r.number), ['002']);
  assert.deepEqual(quarantined.map(q => q.reason), ['NUMBER_MISSING']);
  assert.equal(summary.cards, 3);
});

test('versions of a number with different names are quarantined together', () => {
  const cache = {
    seriesLists: { M3: { complete: true, pages: { 1: ['1', '2'] } } },
    details: { 1: detail('005', '皮卡丘'), 2: detail('005', '雷丘') },
    rarityLists: rarityLists({ 1: ['1', '2'] })
  };
  const { plans, quarantined } = buildOfficialTwSeriesPlans({ code: 'M3', seriesNameZh: '虛無歸零', cache, observedAt: 'x' });
  assert.equal(plans.length, 0);
  assert.deepEqual(quarantined.map(q => q.reason), ['VERSION_NAME_CONFLICT', 'VERSION_NAME_CONFLICT']);
});

test('versions whose names differ only in name markup are one card, named after the lowest official ID', () => {
  const cache = {
    seriesLists: { MC: { complete: true, pages: { 1: ['18255', '16744'] } } },
    details: { 18255: detail('273', '奇樹的光蚪仔', 'MC'), 16744: detail('273', '<奇樹的>光蚪仔', 'MC') },
    rarityLists: rarityLists({ 1: ['18255', '16744'] })
  };
  const { plans, quarantined } = buildOfficialTwSeriesPlans({ code: 'MC', seriesNameZh: '初階牌組 100對戰收藏', cache, observedAt: 'x' });
  assert.deepEqual(quarantined, []);
  const card = plans[0].cards[0];
  assert.equal(card.name_zh, '<奇樹的>光蚪仔');
  assert.deepEqual(card.metadata.officialDetailIds, ['16744', '18255']);
});

test('ADR 0022: an aliased set mark is accepted only when the series uses it alone', () => {
  const series = { SVOM: { complete: true, pages: { 1: ['1', '2'] } }, SVOD: { complete: true, pages: { 1: ['3'] } } };
  const details = { 1: detail('001', '扒手貓', 'SVO_ex'), 2: detail(null, '基本【惡】能量', 'SVO_ex'), 3: detail('001', '天秤偶', 'SVOD_ex') };
  const { plans, quarantined } = buildOfficialTwSeriesPlans({ code: 'SVOM', seriesNameZh: '挑戰牌組', cache: { seriesLists: series, details, rarityLists: rarityLists({ 11: ['1', '2'] }) }, observedAt: 'x' });
  assert.deepEqual(plans[0].cards.map(c => [c.official_card_number, c.rarity_code]), [['001', 'NONE']]);
  assert.deepEqual(quarantined.map(q => q.reason), ['NUMBER_MISSING']);
  const shared = { ...details, 3: detail('001', '天秤偶', 'SVO_ex') };
  assert.throws(() => buildOfficialTwSeriesPlans({ code: 'SVOM', seriesNameZh: '挑戰牌組', cache: { seriesLists: series, details: shared, rarityLists: rarityLists() }, observedAt: 'x' }), /TW_SET_MARK_ALIAS_NOT_EXCLUSIVE:SVOM/);
  const mixed = { ...details, 2: detail('002', '酷豹', 'SVOM_ex') };
  assert.throws(() => buildOfficialTwSeriesPlans({ code: 'SVOM', seriesNameZh: '挑戰牌組', cache: { seriesLists: series, details: mixed, rarityLists: rarityLists() }, observedAt: 'x' }), /TW_SET_MARK_ALIAS_NOT_EXCLUSIVE:SVOM/);
});

test('promo series: PROMO.MARK pages count by the series printed after the slash, number-less, special-number and foreign-series pages are quarantined', () => {
  const promo = (number, nameZh, total = 'M-P') => ({ number, nameZh, setMark: 'PROMO.MARK', total, fetchedAt: '2026-10-14T00:00:00Z' });
  const cache = {
    seriesLists: { 'M-P': { complete: true, pages: { 1: ['1', '2', '3', '4', '5', '6'] } } },
    details: { 1: promo('001', '菊草葉'), 2: promo('002', '拉普拉斯ex'), 3: promo('002', '拉普拉斯ex'), 4: promo(null, '基本能量', null), 5: promo('003', '皮卡丘', 'SV-P'), 6: promo('no0', '樂園度假地') },
    rarityLists: rarityLists({ 11: ['1', '2', '3', '6'], 6: ['5'] })
  };
  const { plans, quarantined, summary } = buildOfficialTwSeriesPlans({ code: 'M-P', seriesNameZh: '特典卡 超級進化', cache, observedAt: 'x' });
  assert.equal(plans[0].series.id, 'pokemon-official-tw-m-p');
  assert.equal(plans[0].series.provider_id, 'M-P');
  assert.deepEqual(plans[0].cards.map(card => [card.id, card.official_card_number, card.rarity_code, card.metadata.officialDetailIds]), [
    ['pokemon-official-tw-m-p-001', '001', 'NONE', ['1']],
    ['pokemon-official-tw-m-p-002', '002', 'NONE', ['2', '3']]
  ]);
  assert.deepEqual(quarantined.map(row => [row.id, row.reason]), [['4', 'NUMBER_MISSING'], ['5', 'SET_MISMATCH:PROMO.MARK'], ['6', 'PROMO_SPECIAL_NUMBER']]);
  assert.equal(summary.cards, 2);
});
