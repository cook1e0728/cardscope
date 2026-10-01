import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPokemonJpEnrichPlan } from '../providers/pokemon-jp-enrich-plan.mjs';
import { buildPokemonJpEnrichSql } from '../providers/pokemon-jp-import-sql.mjs';

const COMMIT = 'c5c0a8a63fe81746d05b9c95e8f51ed6931f7e78';
const jp = (n, ja, extra = {}) => ({ id: `pokemon-tcgdex-ja-svt-${n}`, provider_id: `SVT-${n}`, name_ja: ja, name_zh: null, canonical_id: `pokemon-tcgdex-ja-svt-${n}`, rarity: null, ...extra });
const tw = (n, zh, extra = {}) => ({ id: `pokemon-tcgdex-tw-svt-${n}`, provider_id: `SVT-${n}`, name_zh: zh, canonical_id: `pokemon-tcgdex-tw-svt-${n}`, canonicalShared: false, ...extra });
const arc = (n, ja, zhTw, rarity = 'Common') => ({ providerId: `SVT-${n}`, ja, zhTw, rarity });

function input(overrides = {}) {
  return {
    jpSeries: { id: 'pokemon-tcgdex-ja-svt', providerId: 'SVT', nameZh: null },
    jpCards: [jp('001', 'モモワロウex', { rarity: 'RR' }), jp('002', 'デンジャラス光線'), jp('090', 'モモワロウex'), jp('093', '大地の器')],
    archiveSet: { zhTw: '測試系列' },
    archiveCards: [arc('001', 'モモワロウex', '桃歹郎ex', 'Double rare'), arc('002', 'デンジャラス光線', '危險光線', 'ACE SPEC Rare'), arc('090', 'モモワロウex', null, 'None'), arc('093', '大地の器', null, 'Mega Hyper Rare')],
    twSeries: { id: 'pokemon-tcgdex-tw-svt', official_code: 'SVT', name_zh: '測試系列' },
    twCards: [tw('001', '桃歹郎ex'), tw('002', '危險光線')],
    sourceArchive: { repository: 'tcgdex/cards-database', commit: COMMIT },
    ...overrides
  };
}

test('links same Provider IDs, derives same-name secret rares and fills ACE', () => {
  const { plan, quarantined, summary } = buildPokemonJpEnrichPlan(input());
  assert.deepEqual(quarantined, []);
  assert.deepEqual(plan.series, { name_zh: '測試系列', twSeriesId: 'pokemon-tcgdex-tw-svt' });
  assert.deepEqual(plan.cards, [
    { id: 'pokemon-tcgdex-ja-svt-001', name_ja: 'モモワロウex', link: 'pokemon-tcgdex-tw-svt-001', name_zh: '桃歹郎ex', basis: 'tw-official', rarity_code: null },
    { id: 'pokemon-tcgdex-ja-svt-002', name_ja: 'デンジャラス光線', link: 'pokemon-tcgdex-tw-svt-002', name_zh: '危險光線', basis: 'tw-official', rarity_code: 'ACE' },
    { id: 'pokemon-tcgdex-ja-svt-090', name_ja: 'モモワロウex', link: null, name_zh: '桃歹郎ex', basis: 'derived-same-name', rarity_code: null }
  ]);
  assert.deepEqual(summary, { cards: 3, links: 2, derived: 1, rarities: 1, series: 1, quarantined: 0, stillWithoutZh: 1 });
  assert.match(plan.evidenceHash, /^[0-9a-f]{64}$/);
});

test('quarantines name mismatches, shared canonicals and ambiguous derived names', () => {
  const { plan, quarantined } = buildPokemonJpEnrichPlan(input({
    jpCards: [jp('001', 'モモワロウex'), jp('002', 'モモワロウex'), jp('003', 'カシオペア'), jp('090', 'モモワロウex')],
    archiveCards: [arc('001', 'モモワロウex', '桃歹郎ex', null), arc('002', 'モモワロウex', '桃歹郎EX', null), arc('003', 'カシオペア', '仙后', null), arc('090', 'モモワロウex', null, null)],
    twCards: [tw('001', '桃歹郎ex'), tw('002', '桃歹郎EX'), tw('003', '仙后X', { canonicalShared: true })]
  }));
  assert.deepEqual(quarantined, [
    { id: 'pokemon-tcgdex-ja-svt-003', link: 'pokemon-tcgdex-tw-svt-003', reasons: ['archive-zh-tw-name-mismatch', 'tw-canonical-shared'] },
    { id: 'pokemon-tcgdex-ja-svt-090', reasons: ['ambiguous-derived-name'], candidates: ['桃歹郎EX', '桃歹郎ex'] }
  ]);
  assert.deepEqual(plan.cards.map(c => c.id), ['pokemon-tcgdex-ja-svt-001', 'pokemon-tcgdex-ja-svt-002']);
});

test('series without a Taiwanese release keeps its Japanese title and gets no derived names', () => {
  const { plan, summary } = buildPokemonJpEnrichPlan(input({ twSeries: null, twCards: [], archiveSet: { zhTw: null } }));
  assert.equal(plan.series, null);
  assert.deepEqual(plan.cards.map(c => [c.id, c.basis, c.rarity_code]), [['pokemon-tcgdex-ja-svt-002', null, 'ACE']]);
  assert.equal(summary.stillWithoutZh, 4);
});

test('enrichment SQL is digest-guarded and gated on the dry-run summary', () => {
  const { plan } = buildPokemonJpEnrichPlan(input());
  const { digest, sql } = buildPokemonJpEnrichSql(plan, { actor: 'tester', dryRun: false, gated: true });
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.match(sql, /\('090','モモワロウex','桃歹郎ex','derived-same-name',null,null\)/);
  assert.match(sql, /dry->'changed' = '\{"cards":3,"links":2,"derived":1,"rarities":1,"series":1\}'::jsonb/);
  assert.match(sql, /then private\.enrich_pokemon_jp_metadata\(plan, 'tester', true\) end as dry/);
  const tampered = { ...plan, cards: plan.cards.map((c, i) => (i === 0 ? { ...c, link: 'pokemon-tcgdex-tw-other-001' } : c)) };
  assert.throws(() => buildPokemonJpEnrichSql(tampered, { actor: 'tester', dryRun: true }), /NOT_DERIVABLE/);
});

test('cross-series names fill only cards that are still unnamed and cite a Taiwanese card', () => {
  const crossSeriesNames = new Map([
    ['大地の器', { zh: '大地之容器', sourceCardId: 'pokemon-tcgdex-tw-sv4k-060' }],
    ['モモワロウex', { zh: '不該使用', sourceCardId: 'pokemon-tcgdex-tw-other-001' }]
  ]);
  const { plan, summary } = buildPokemonJpEnrichPlan(input({ crossSeriesNames }));
  assert.deepEqual(plan.cards.find(c => c.id === 'pokemon-tcgdex-ja-svt-093'), {
    id: 'pokemon-tcgdex-ja-svt-093', name_ja: '大地の器', link: null, name_zh: '大地之容器', basis: 'derived-cross-series', rarity_code: null, nameSource: 'pokemon-tcgdex-tw-sv4k-060'
  });
  assert.equal(plan.cards.find(c => c.id === 'pokemon-tcgdex-ja-svt-090').basis, 'derived-same-name', 'same-series names win over cross-series ones');
  assert.equal(summary.derived, 2);
  assert.equal(summary.stillWithoutZh, 0);
  const { sql } = buildPokemonJpEnrichSql(plan, { actor: 'tester', dryRun: false, gated: true });
  assert.match(sql, /\('093','大地の器','大地之容器','derived-cross-series',null,'pokemon-tcgdex-tw-sv4k-060'\)/);
  assert.match(sql, /"derived":2/);
});
