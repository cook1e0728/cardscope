import test from 'node:test';
import assert from 'node:assert/strict';
import { planPokemonJpManifest } from '../providers/pokemon-jp-manifest.mjs';
import { buildPokemonJpImportBatchPlans } from '../providers/pokemon-jp-import-plan.mjs';
import { buildPokemonJpImportSql, pokemonJpPlanDigest } from '../providers/pokemon-jp-import-sql.mjs';

function snapshot(total) {
  const cards = Array.from({ length: total }, (_, index) => {
    const localId = String(index + 1).padStart(3, '0');
    return { id: `SVB-${localId}`, localId, name: `カード${localId}`, rarity: index % 2 ? 'Common' : 'None', set: { id: 'SVB' } };
  });
  return {
    observedAt: '2026-10-01T10:00:00.000Z',
    sourceIdentity: { source: 'tcgdex-ja', region: 'JP', locale: 'ja-JP' },
    sets: [{ id: 'SVB', name: 'バッチテスト', releaseDate: '2024-01-01', region: 'JP', locale: 'ja-JP' }],
    cards,
    existingJpRows: { series: [], cards: [], printings: [] }
  };
}

function pages(input) {
  const manifests = [];
  let cursor = null;
  do {
    const manifest = planPokemonJpManifest(input, { seriesId: 'SVB', limit: 100, cursor });
    manifests.push(manifest);
    cursor = manifest.scope.nextCursor;
  } while (cursor);
  return manifests;
}

test('a 210-card series becomes three ordered batches that share one series row', () => {
  const plans = buildPokemonJpImportBatchPlans(pages(snapshot(210)));
  assert.deepEqual(plans.map(plan => [plan.batch.index, plan.batch.count, plan.batch.seriesCardCount, plan.cards.length]), [[1, 3, 210, 100], [2, 3, 210, 100], [3, 3, 210, 10]]);
  assert.equal(new Set(plans.map(plan => JSON.stringify(plan.series))).size, 1, 'every batch carries the identical series row');
  assert.equal(new Set(plans.map(plan => plan.sourceHash)).size, 1);
  assert.deepEqual(plans[2].cards.map(card => card.official_card_number).slice(0, 2), ['201', '202']);
  for (const plan of plans) assert.ok(plan.cards.every(card => card.metadata.manifestHash === plan.manifestHash));
  assert.notEqual(plans[0].manifestHash, plans[1].manifestHash);
});

test('batch plans refuse single pages and quarantined pages', () => {
  assert.throws(() => buildPokemonJpImportBatchPlans(pages(snapshot(50))), /NEEDS_PAGES/);
  const input = snapshot(150);
  input.cards[120] = { ...input.cards[120], id: 'SVB-999' };
  assert.throws(() => buildPokemonJpImportBatchPlans(pages(input)), /QUARANTINE/);
});

test('batch import SQL calls the batch importer and expects the series only in batch 1', () => {
  const plans = buildPokemonJpImportBatchPlans(pages(snapshot(150)));
  const first = buildPokemonJpImportSql(plans[0], { actor: 'tester', dryRun: false, gated: true });
  const second = buildPokemonJpImportSql(plans[1], { actor: 'tester', dryRun: false, gated: true });
  assert.equal(first.digest, pokemonJpPlanDigest(plans[0]));
  assert.match(first.sql, /'batch', jsonb_build_object\('index', 1, 'count', 2, 'seriesCardCount', 150\)/);
  assert.match(first.sql, /"series":1,"cards":100/);
  assert.match(second.sql, /"series":0,"cards":50/);
  assert.match(second.sql, /private\.import_pokemon_jp_metadata_batch\(plan, 'tester', false\)/);
});
