import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficialJpSeedClaimPlan, buildOfficialJpSeedClaimSql, buildOfficialJpSeriesPlans, buildOfficialJpSeriesSql } from '../providers/pokemon-jp-official-series-plan.mjs';
import { pokemonJpPlanDigest } from '../providers/pokemon-jp-import-sql.mjs';

const page = (cardId, number, nameJa, rarityIcon = 'ic_rare_c_c', setMark = 'S4') => ({ cardId, setMark, number, nameJa, rarityIcon, total: '100', list: 'S4', fetchedAt: `2026-10-03T00:00:${String(Number(cardId) % 60).padStart(2, '0')}Z` });
const cacheOf = pages => ({ lists: { S4: { hitCount: pages.length, cardIds: pages.map(p => p.cardId), fetchedAt: '2026-10-02T23:00:00Z' } }, details: Object.fromEntries(pages.map(p => [p.cardId, p])) });
const meta = { name_ja: '仰天のボルテッカー', release_date: '2020-09-18', basis: 'archive' };

test('official series plan keeps text facts, numbers sort numerically and rarity follows ADR 0007', () => {
  const cache = cacheOf([page('2', '010', 'ピカチュウ', 'ic_rare_rr'), page('1', '002', 'コノハナ'), page('3', '101', 'ピカチュウV', null)]);
  const { plans, summary, rarityUnknown, quarantined } = buildOfficialJpSeriesPlans({ code: 'S4', seriesMeta: meta, cache });
  assert.equal(plans.length, 1);
  const [plan] = plans;
  assert.deepEqual(plan.batch, { index: 1, count: 1, seriesCardCount: 3 });
  assert.equal(plan.source, 'pokemon-card-official-jp');
  assert.equal(plan.series.id, 'pokemon-official-ja-s4');
  assert.deepEqual(plan.cards.map(c => c.official_card_number), ['002', '010', '101']);
  assert.deepEqual(plan.cards.map(c => c.rarity_code), ['C', 'RR', null]);
  assert.deepEqual(plan.cards[1], {
    id: 'pokemon-official-ja-s4-010', provider_id: '2', official_card_number: '010', name_ja: 'ピカチュウ', rarity_code: 'RR',
    source_url: 'https://www.pokemon-card.com/card-search/details.php/card/2/regu/all',
    search_text: 'ピカチュウ 010 S4-010 s4010',
    metadata: { officialCardId: '2', rarityIcon: 'ic_rare_rr', rarityBasis: 'pokemon-card-official-jp' }
  });
  assert.equal(plan.sourceObservedAt, '2026-10-03T00:00:03Z');
  assert.deepEqual(rarityUnknown, [{ number: '101', cardId: '3', reason: 'OFFICIAL_NO_RARITY_ICON' }]);
  assert.deepEqual(quarantined, []);
  assert.match(summary.evidenceHash, /^[0-9a-f]{64}$/);
});

test('a duplicated number, another set mark or a missing number is quarantined, never guessed', () => {
  const cache = cacheOf([page('1', '001', 'A'), page('2', '002', 'B'), page('3', '002', 'B'), page('4', '003', 'C', 'ic_rare_c', 'S4a'), page('5', null, 'D')]);
  const { plans, quarantined } = buildOfficialJpSeriesPlans({ code: 'S4', seriesMeta: meta, cache });
  assert.deepEqual(plans[0].cards.map(c => c.official_card_number), ['001']);
  assert.deepEqual(quarantined.map(q => q.reason).sort(), ['DUPLICATE_NUMBER', 'DUPLICATE_NUMBER', 'NUMBER_MISSING', 'SET_MISMATCH:S4a']);
});

test('more than 100 cards are split into ordered batches sharing one snapshot', () => {
  const pages = Array.from({ length: 205 }, (_, i) => page(String(1000 + i), String(i + 1).padStart(3, '0'), `カード${i + 1}`));
  const { plans } = buildOfficialJpSeriesPlans({ code: 'S4', seriesMeta: meta, cache: cacheOf(pages) });
  assert.deepEqual(plans.map(p => [p.batch.index, p.batch.count, p.cards.length]), [[1, 3, 100], [2, 3, 100], [3, 3, 5]]);
  assert.equal(new Set(plans.map(p => p.evidenceHash + p.sourceObservedAt)).size, 1);
  assert.equal(plans[2].cards[0].official_card_number, '201');
});

test('gated SQL checks the dry run against the locally computed digest before writing', () => {
  const { plans } = buildOfficialJpSeriesPlans({ code: 'S4', seriesMeta: meta, cache: cacheOf([page('1', '001', "O'Neil")]) });
  const { digest, gated, replay } = buildOfficialJpSeriesSql(plans[0], 'tester');
  assert.equal(digest, pokemonJpPlanDigest(plans[0]));
  assert.ok(gated.indexOf(', true);') < gated.indexOf(', false);'));
  assert.ok(gated.includes(`d->>'planDigest' <> '${digest}'`));
  assert.ok(gated.includes(`'{"cards": 1, "series": 1, "canonical": 1, "printings": 1}'::jsonb`));
  assert.ok(replay.includes("'tester', false"));
  assert.throws(() => buildOfficialJpSeriesSql(plans[0], ''), /ACTOR_REQUIRED/);
});

test('a claimed Seed series imports into the Seed series without the claimed number (ADR 0016)', () => {
  const pages = [page('1', '001', 'A'), page('2', '347', 'ミュウex', 'ic_rare_sar'), page('3', '348', 'B')];
  const seedClaim = { seriesId: 'pokemon-s4-jp', cardNumbers: ['347'] };
  const { plans, claimed, evidence, summary } = buildOfficialJpSeriesPlans({ code: 'S4', seriesMeta: meta, cache: cacheOf(pages), seedClaim });
  assert.equal(plans[0].series.id, 'pokemon-s4-jp');
  assert.deepEqual(plans[0].seedClaim, seedClaim);
  assert.deepEqual(plans[0].cards.map(c => c.id), ['pokemon-official-ja-s4-001', 'pokemon-official-ja-s4-348']);
  assert.deepEqual(plans[0].batch, { index: 1, count: 1, seriesCardCount: 2 });
  assert.deepEqual(claimed, [{ cardId: '2', number: '347', nameJa: 'ミュウex' }]);
  assert.equal(evidence.length, 3);
  assert.equal(summary.claimed, 1);
  assert.ok(buildOfficialJpSeriesSql(plans[0], 'tester').gated.includes(`'{"cards": 2, "series": 0, "canonical": 2, "printings": 2}'::jsonb`));
  assert.throws(() => buildOfficialJpSeriesPlans({ code: 'S4', seriesMeta: meta, cache: cacheOf(pages), seedClaim: { ...seedClaim, cardNumbers: ['999'] } }), /SEED_CLAIM_NUMBER_MISSING/);
});

test('the Seed claim plan needs one official page with the same number and name', () => {
  const cache = cacheOf([page('1', '001', 'A'), page('44513', '347', 'ミュウex', 'ic_rare_sar')]);
  const seed = { seriesId: 'pokemon-s4-jp', cardId: 'pokemon-mew-ex-s4-347-jp', printingId: 1, cardNumber: '347/190', nameJa: 'ミュウex', cardRarity: 'SSR', printingRarity: null, seriesNameJa: 'X', releaseDate: '2023-12-01' };
  const plan = buildOfficialJpSeedClaimPlan({ code: 'S4', cache, seed, evidenceHash: 'a'.repeat(64), sourceObservedAt: '2026-10-04T00:00:00Z' });
  assert.equal(plan.seed.cardNumber, '347/190');
  assert.deepEqual(plan.card, {
    provider_id: '44513', official_card_number: '347', name_ja: 'ミュウex', rarity_code: 'SAR',
    source_url: 'https://www.pokemon-card.com/card-search/details.php/card/44513/regu/all',
    search_text: 'ミュウex 347 S4-347 s4347',
    metadata: { officialCardId: '44513', rarityIcon: 'ic_rare_sar', rarityBasis: 'pokemon-card-official-jp' }
  });
  const { digest, gated } = buildOfficialJpSeedClaimSql(plan, 'tester');
  assert.equal(digest, pokemonJpPlanDigest(plan));
  assert.ok(gated.indexOf(', true);') < gated.indexOf(', false);'));
  assert.throws(() => buildOfficialJpSeedClaimPlan({ code: 'S4', cache, seed: { ...seed, nameJa: 'ミュウ' }, evidenceHash: 'a'.repeat(64), sourceObservedAt: 'x' }), /SEED_CLAIM_NAME/);
  assert.throws(() => buildOfficialJpSeedClaimPlan({ code: 'S4', cache, seed: { ...seed, cardNumber: '346/190' }, evidenceHash: 'a'.repeat(64), sourceObservedAt: 'x' }), /SEED_CLAIM_PAGES/);
});
