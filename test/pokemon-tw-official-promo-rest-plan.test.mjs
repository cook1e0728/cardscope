import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficialTwSupplementSql } from '../providers/pokemon-tw-official-supplement-plan.mjs';
import { OFFICIAL_TW_RARITY_FILTERS } from '../providers/pokemon-tw-official.mjs';
import { buildPromoRarityFillPlans, buildPromoRestPlan, classifyPromoCollector } from '../providers/pokemon-tw-official-promo-rest-plan.mjs';

const rarityLists = (assign = {}) => Object.fromEntries(Object.keys(OFFICIAL_TW_RARITY_FILTERS).map(value => [value, { complete: true, pages: { 1: assign[value] || [] } }]));
const detail = (number, nameZh) => ({ number, nameZh, setMark: 'PROMO.MARK', total: number ? 'M-P' : null, fetchedAt: '2026-10-14T00:00:00Z' });
const page = (list, nameZh, collectorText) => ({ list, nameZh, collectorText, setMark: 'PROMO.MARK.png', cardType: 'x', illustrator: null, effectSha256: 'a', fetchedAt: '2026-10-15T00:00:00Z' });
const cache = {
  seriesLists: { 'M-P': { complete: true, pages: { 1: ['1', '2', '3', '4', '5', '6'] } } },
  details: { 1: detail('001', '皮卡丘'), 2: detail(null, '基本【火】能量'), 3: detail(null, '勝利之證'), 4: detail(null, '勝利之證'), 5: detail(null, '基本【草】能量'), 6: detail(null, '樂園度假地') },
  rarityLists: rarityLists({ 11: ['1', '2', '3', '4', '5', '6'] })
};
const overlay = { pages: { 2: page('M-P', '基本【火】能量', 'FIR'), 3: page('M-P', '勝利之證', 'M-P'), 4: page('M-P', '勝利之證', 'M-P'), 5: page('M-P', '基本【草】能量', 'GRA'), 6: page('M-P', '樂園度假地', 'M-P') } };

test('the collector string decides: energy code is a number, series code or n/a is not printed', () => {
  assert.deepEqual(classifyPromoCollector('GRA', 'M-P'), { kind: 'energy-code', number: 'GRA' });
  assert.equal(classifyPromoCollector('M-P', 'M-P').kind, 'not-printed');
  assert.equal(classifyPromoCollector('n/a', 'S-P').kind, 'not-printed');
  assert.equal(classifyPromoCollector('', 'S-P').kind, 'not-printed');
  assert.equal(classifyPromoCollector('12/ABC', 'S-P').kind, 'unknown');
});

test('promo rest: energies keep their code, same-text number-less pages stay separate cards named c<detail ID>', () => {
  const result = buildPromoRestPlan({ code: 'M-P', seriesId: 'pokemon-official-tw-m-p', existing: [{ num: '001', name_zh: '皮卡丘' }], cache, overlay, observedAt: '2026-10-15T00:00:00Z' });
  assert.deepEqual(result.plans[0].cards.map(card => [card.id, card.official_card_number, card.provider_id, card.rarity_code]), [
    ['pokemon-official-tw-m-p-c3', 'c3', '3', 'NONE'],
    ['pokemon-official-tw-m-p-c4', 'c4', '4', 'NONE'],
    ['pokemon-official-tw-m-p-c6', 'c6', '6', 'NONE'],
    ['pokemon-official-tw-m-p-fir', 'FIR', '2', 'NONE'],
    ['pokemon-official-tw-m-p-gra', 'GRA', '5', 'NONE']
  ]);
  const [victory] = result.plans[0].cards;
  assert.equal(victory.metadata.numberStatus, 'not-printed');
  assert.equal(victory.metadata.officialCollectorText, 'M-P');
  assert.equal(result.plans[0].cards.find(card => card.official_card_number === 'FIR').metadata.numberStatus, undefined);
  assert.deepEqual(result.plans[0].alignment, [{ number: '001', name_zh: '皮卡丘' }]);
  assert.equal(result.held.length, 0);
  const { gated } = buildOfficialTwSupplementSql(result.plans[0], 'tester');
  assert.match(gated, /"cards": 5, "canonical": 5, "printings": 5/);
});

test('promo rest: --no-not-printed plans only the energies', () => {
  const result = buildPromoRestPlan({ code: 'M-P', seriesId: 's', existing: [], cache, overlay, observedAt: 'x', includeNotPrinted: false });
  assert.deepEqual(result.plans[0].cards.map(card => card.official_card_number), ['FIR', 'GRA']);
  assert.deepEqual(result.held.map(entry => entry.reason), ['NOT_PRINTED_EXCLUDED', 'NOT_PRINTED_EXCLUDED', 'NOT_PRINTED_EXCLUDED']);
});

test('promo rest: archive rows are never duplicated; a same-name number-less group is held, not guessed', () => {
  const existing = [{ num: 'FIR', name_zh: '基本【火】能量' }, { num: 'GRA', name_zh: '基本草能量' }, { num: 'no0', name_zh: '勝利之證(冠軍)' }];
  const result = buildPromoRestPlan({ code: 'M-P', seriesId: 's', existing, cache, overlay, observedAt: 'x' });
  assert.deepEqual(result.held.map(entry => [entry.id, entry.reason.split(':')[0]]), [['2', 'ALREADY_IN_SERIES'], ['3', 'ALIGNMENT_AMBIGUOUS'], ['4', 'ALIGNMENT_AMBIGUOUS'], ['5', 'ENERGY_CODE_NAME_CONFLICT']]);
  assert.deepEqual(result.plans[0].cards.map(card => card.official_card_number), ['c6']);
});

test('promo rest: a page without overlay facts stops the build', () => {
  assert.throws(() => buildPromoRestPlan({ code: 'M-P', seriesId: 's', existing: [], cache, overlay: { pages: {} }, observedAt: 'x' }), /TW_PROMO_OVERLAY_MISSING:M-P:2/);
  const wrong = { pages: { ...overlay.pages, 2: page('M-P', '基本【水】能量', 'FIR') } };
  assert.throws(() => buildPromoRestPlan({ code: 'M-P', seriesId: 's', existing: [], cache, overlay: wrong, observedAt: 'x' }), /TW_PROMO_OVERLAY_MISMATCH/);
});

test('promo rarity fill: an energy code is exact, a number-less archive row names its whole page group', () => {
  const rows = [
    { printing_id: 10, card_id: 'a-fir', num: 'FIR', name_zh: '基本火能量', rarity: null },
    { printing_id: 11, card_id: 'a-no1', num: 'no1', name_zh: '勝利之證(冠軍)', rarity: null },
    { printing_id: 12, card_id: 'a-001', num: '001', name_zh: '皮卡丘', rarity: null },
    { printing_id: 13, card_id: 'a-no9', num: 'no9', name_zh: '不存在', rarity: null },
    { printing_id: 14, card_id: 'a-gra', num: 'GRA', name_zh: '基本草能量', rarity: 'NONE' }
  ];
  const fillCache = { ...cache, seriesLists: { 'SV-P': cache.seriesLists['M-P'] } };
  const fillOverlay = { pages: Object.fromEntries(Object.entries(overlay.pages).map(([id, value]) => [id, { ...value, list: 'SV-P', collectorText: value.collectorText === 'M-P' ? 'SV-P' : value.collectorText, nameZh: value.nameZh.replace(/[【】]/g, '') }])) };
  const result = buildPromoRarityFillPlans({ code: 'SV-P', seriesId: 'pokemon-tcgdex-tw-sv-p', rows, cache: fillCache, overlay: fillOverlay });
  assert.deepEqual(result.exact.rows.map(row => [row.number, row.rarity, row.officialDetailIds]), [['FIR', 'NONE', ['2']]]);
  assert.deepEqual(result.group.rows.map(row => [row.number, row.officialDetailIds]), [['no1', ['3', '4']]]);
  assert.deepEqual(result.quarantined.map(row => row.reason), ['OFFICIAL_PAGE_NOT_FOUND']);
});
