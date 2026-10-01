import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planPokemonJpManifest, sha256PokemonJpPayload } from '../providers/pokemon-jp-manifest.mjs';
import { buildPokemonJpImportPlan } from '../providers/pokemon-jp-import-plan.mjs';

const evidence = JSON.parse(await readFile(new URL('../docs/evidence/pokemon-jp/SVLN-snapshot-20261001.json', import.meta.url), 'utf8'));

function snapshot(cards) {
  return {
    observedAt: '2026-10-01T00:00:00.000Z',
    sourceIdentity: { source: 'tcgdex-ja', region: 'JP', locale: 'ja-JP' },
    sets: [{ id: 'sv8a', name: 'テラスタルフェスex', releaseDate: '2024-12-06' }],
    cards,
    existingJpRows: { series: [], cards: [], printings: [] }
  };
}

function rehash(manifest) {
  const { manifestHash, ...rest } = manifest;
  return { ...rest, manifestHash: sha256PokemonJpPayload(rest) };
}

test('builds the SVLN pilot plan from the saved source evidence', () => {
  const manifest = planPokemonJpManifest(evidence, { seriesId: 'SVLN' });
  const plan = buildPokemonJpImportPlan(manifest);
  assert.equal(plan.planVersion, 1);
  assert.equal(plan.source, 'tcgdex-ja');
  assert.equal(plan.seriesProviderId, 'SVLN');
  assert.equal(plan.manifestHash, manifest.manifestHash);
  assert.deepEqual({ ...plan.series, metadata: undefined }, {
    id: 'pokemon-tcgdex-ja-svln',
    provider_id: 'SVLN',
    name_ja: 'スターターセット テラスタイプ：ステラ ニンフィアex',
    release_date: '2024-08-30',
    source_url: 'https://api.tcgdex.net/v2/ja/sets/SVLN',
    metadata: undefined
  });
  assert.equal(plan.cards.length, 22);
  const first = plan.cards.find(card => card.provider_id === 'SVLN-001');
  assert.deepEqual({ ...first, metadata: undefined }, {
    id: 'pokemon-tcgdex-ja-svln-001',
    provider_id: 'SVLN-001',
    official_card_number: '001',
    name_ja: 'マンタイン',
    rarity_code: null,
    search_text: 'マンタイン 001 SVLN-001 svln001',
    source_url: 'https://api.tcgdex.net/v2/ja/cards/SVLN-001',
    release_date: '2024-08-30',
    metadata: undefined
  });
  assert.equal(first.metadata.manifestHash, manifest.manifestHash);
  assert.doesNotMatch(JSON.stringify(plan), /"(?:image|image_url|name_zh|price|prices)"\s*:/);
});

test('carries supported rarity codes only', () => {
  const plan = buildPokemonJpImportPlan(planPokemonJpManifest(snapshot([
    { id: 'sv8a-001', localId: '001', name: 'イーブイ', rarity: 'Common', set: { id: 'sv8a' } },
    { id: 'sv8a-002', localId: '002', name: 'シャワーズ', rarity: 'None', set: { id: 'sv8a' } }
  ]), { seriesId: 'sv8a' }));
  assert.deepEqual(plan.cards.map(card => card.rarity_code), ['C', null]);
});

test('refuses partial, quarantined, multi-page or tampered manifests', () => {
  const quarantined = planPokemonJpManifest(snapshot([
    { id: 'sv8a-001', localId: '001', name: 'イーブイ', set: { id: 'sv8a' } },
    { id: 'sv8a-009', localId: '002', name: '不一致', set: { id: 'sv8a' } }
  ]), { seriesId: 'sv8a' });
  assert.throws(() => buildPokemonJpImportPlan(quarantined), /POKEMON_JP_PLAN_HAS_QUARANTINE/);

  const many = snapshot(Array.from({ length: 3 }, (_, index) => ({
    id: `sv8a-00${index + 1}`, localId: `00${index + 1}`, name: `カード${index}`, set: { id: 'sv8a' }
  })));
  const firstPage = planPokemonJpManifest(many, { seriesId: 'sv8a', limit: 2 });
  assert.throws(() => buildPokemonJpImportPlan(firstPage), /POKEMON_JP_PLAN_REQUIRES_WHOLE_SERIES/);
  const secondPage = planPokemonJpManifest(many, { seriesId: 'sv8a', limit: 2, cursor: firstPage.scope.nextCursor });
  assert.throws(() => buildPokemonJpImportPlan(secondPage), /POKEMON_JP_PLAN_REQUIRES_WHOLE_SERIES/);

  const whole = planPokemonJpManifest(many, { seriesId: 'sv8a' });
  const tampered = structuredClone(whole);
  tampered.records.find(row => row.entity === 'card').metadata.name_ja = '改ざん';
  assert.throws(() => buildPokemonJpImportPlan(tampered), /POKEMON_JP_MANIFEST_HASH_MISMATCH/);

  const dropped = structuredClone(whole);
  dropped.records = dropped.records.filter(row => !(row.entity === 'printing' && row.sourceProviderId === 'sv8a-002'));
  assert.throws(() => buildPokemonJpImportPlan(rehash(dropped)), /POKEMON_JP_PLAN_SHAPE_MISMATCH/);

  const seeded = planPokemonJpManifest({ ...many, existingJpRows: {
    series: [{ id: 'seed', game_id: 'pokemon', official_code: 'SV8a', region: 'JP' }], cards: [], printings: []
  } }, { seriesId: 'sv8a' });
  assert.throws(() => buildPokemonJpImportPlan(seeded), /POKEMON_JP_SERIES_NOT_ELIGIBLE/);
});
