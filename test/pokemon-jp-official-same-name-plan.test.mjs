import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficialJpSameNamePlan, buildOfficialJpSameNameSql } from '../providers/pokemon-jp-official-same-name-plan.mjs';

const page = (cardId, number, nameJa, rarityIcon = null, setMark = 'SVI') => ({ cardId, number, nameJa, rarityIcon, setMark, fetchedAt: '2026-10-03T00:00:00Z' });

test('ADR 0025: same-name repeated numbers become one card listing every official page', () => {
  const cache = {
    lists: { SVI: { cardIds: ['3', '1', '2', '4', '5'], fetchedAt: '2026-10-03T00:00:00Z' } },
    details: { 1: page('1', '001', 'ピカチュウ'), 2: page('2', '002', 'ニャオハex', 'ic_rare_rr'), 3: page('3', '002', 'ニャオハex', 'ic_rare_rr'), 4: page('4', '018', 'ピカチュウex', 'ic_rare_rr'), 5: page('5', '018', 'ピカチュウex') }
  };
  const { plan, rarityUnknown, summary } = buildOfficialJpSameNamePlan({ code: 'SVI', cache, seriesId: 'pokemon-official-ja-svi', existingNumbers: ['001'] });
  assert.deepEqual(plan.cards.map(c => [c.id, c.provider_id, c.rarity_code, c.metadata.officialCardIds]), [
    ['pokemon-official-ja-svi-002', '2', 'RR', ['2', '3']],
    ['pokemon-official-ja-svi-018', '4', null, ['4', '5']]
  ]);
  assert.deepEqual(rarityUnknown.map(r => r.number), ['018']);
  assert.equal(summary.add, 2);
  assert.match(buildOfficialJpSameNameSql(plan, 'tester').gated, /"cards": 2, "canonical": 2, "printings": 2/);
});

test('ADR 0025: a series with a repeated number under different names is left out whole', () => {
  const cache = {
    lists: { MG: { cardIds: ['1', '2', '3', '4'] } },
    details: { 1: page('1', '001', 'モンジャラ', null, 'MG'), 2: page('2', '001', 'ミュウツー', null, 'MG'), 3: page('3', '016', 'ポケモン回収', null, 'MG'), 4: page('4', '016', 'ポケモン回収', null, 'MG') }
  };
  const { plan, conflicts } = buildOfficialJpSameNamePlan({ code: 'MG', cache, seriesId: 'x', existingNumbers: [] });
  assert.equal(plan, null);
  assert.deepEqual(conflicts, ['001']);
});

test('ADR 0025: an era rarity limit (ADR 0019) leaves other codes empty', () => {
  const cache = { lists: { Bb: { cardIds: ['1', '2'] } }, details: { 1: page('1', '010', 'ポケモンいれかえ', 'ic_rare_s', 'Bb'), 2: page('2', '010', 'ポケモンいれかえ', 'ic_rare_s', 'Bb') } };
  const { plan } = buildOfficialJpSameNamePlan({ code: 'Bb', cache, seriesId: 'pokemon-official-ja-bb', existingNumbers: [], rarityCodes: new Set(['C', 'U', 'R']) });
  assert.equal(plan.cards[0].rarity_code, null);
});

test('ADR 0025: a repeated number already in the series stops the plan', () => {
  const cache = { lists: { SVI: { cardIds: ['1', '2'] } }, details: { 1: page('1', '002', 'ニャオハex'), 2: page('2', '002', 'ニャオハex') } };
  assert.throws(() => buildOfficialJpSameNamePlan({ code: 'SVI', cache, seriesId: 'pokemon-official-ja-svi', existingNumbers: ['002'] }), /NUMBER_ALREADY_PRESENT:SVI:002/);
});
