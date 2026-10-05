import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficialJpUnnumberedPlans, buildOfficialJpUnnumberedSql } from '../providers/pokemon-jp-official-unnumbered-plan.mjs';

const page = (cardId, nameJa, setMark = 'DP1', rarityIcon = null, number = null) => ({ cardId, nameJa, setMark, rarityIcon, number, fetchedAt: '2026-10-05T00:00:00Z' });

test('ADR 0026 draft: each official page of a numberless set is one card, in list order', () => {
  const cache = {
    lists: { 55: { cardIds: ['900', '800', '850', '860'], hitCount: 4, fetchedAt: '2026-10-05T00:00:00Z' } },
    details: { 900: page('900', 'ナエトル', 'DP1', 'ic_rare_c'), 800: page('800', 'ハヤシガメ', 'DP1', 'ic_rare_s'), 850: page('850', '基本草エネルギー', 'ENE'), 860: page('860', 'ドダイトス', 'DP1', null, '001') }
  };
  const { plans, quarantined, rarityUnknown } = buildOfficialJpUnnumberedPlans({ code: 'DP1', listKey: '55', seriesMeta: { name_ja: '拡張パック「時空の創造」' }, cache, rarityCodes: new Set(['C', 'U', 'R']) });
  assert.deepEqual(plans[0].cards.map(c => [c.id, c.rarity_code, c.metadata.officialListPosition, c.metadata.numberStatus]), [
    ['pokemon-official-ja-dp1-c900', 'C', 1, 'not-printed'],
    ['pokemon-official-ja-dp1-c800', null, 2, 'not-printed']
  ]);
  assert.equal('official_card_number' in plans[0].cards[0], false);
  assert.deepEqual(quarantined.map(q => q.reason), ['SET_MISMATCH:ENE', 'NUMBER_PRESENT:001']);
  assert.deepEqual(rarityUnknown.map(r => r.cardId), ['800']);
  assert.match(buildOfficialJpUnnumberedSql(plans[0], 'tester').gated, /"series": 1, "cards": 2, "canonical": 2, "printings": 2/);
});
