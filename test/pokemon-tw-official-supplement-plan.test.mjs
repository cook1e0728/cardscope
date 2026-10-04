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
