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
