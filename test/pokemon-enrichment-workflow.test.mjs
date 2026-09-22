import test from 'node:test';
import assert from 'node:assert/strict';
import { planPokemonEnrichmentWorkflow } from '../providers/pokemon-enrichment-workflow.mjs';

function snapshot(count = 2) {
  const cards = Array.from({ length: count }, (_, index) => ({
    id: `card-${index}`,
    game_id: 'pokemon',
    source: 'tcgdex-zh-tw',
    provider_id: `sv4a-${index}`,
    official_card_number: `${index}/190`,
    name_zh: null,
    rarity: null
  }));
  const printings = cards.map((card, index) => ({
    id: `printing-${index}`,
    card_id: card.id,
    source: 'tcgdex-zh-tw',
    provider_id: card.provider_id,
    local_set_code: 'sv4a',
    local_card_number: `${index}/190`,
    rarity: null,
    rarity_code: null,
    rarity_label: null,
    image_url: null
  }));
  return { cards, printings, cardNames: [], sourceRecords: [] };
}

function fakeFetch(calls) {
  return async url => {
    const providerId = decodeURIComponent(String(url).split('/').at(-1));
    calls.push(providerId);
    const number = providerId.split('-').at(-1);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: providerId,
        localId: `${number}/190`,
        set: { id: 'sv4a' },
        name: `官方名稱 ${number}`,
        rarity: 'SSR',
        image: `https://assets.tcgdex.net/zh-tw/sv4a/${providerId}`
      })
    };
  };
}

test('is dry-run only, provider-ID only, blank-only, and bounded to 100 provider groups', async () => {
  await assert.rejects(() => planPokemonEnrichmentWorkflow({ snapshot: snapshot(), dryRun: false }), /DRY_RUN_ONLY/);
  const calls = [];
  const plan = await planPokemonEnrichmentWorkflow({
    snapshot: snapshot(120),
    fields: ['name_zh', 'rarity'],
    batchSize: 999,
    observedAt: '2026-09-18T00:00:00Z',
    fetchImpl: fakeFetch(calls)
  });
  assert.equal(plan.dryRun, true);
  assert.equal(plan.matchingPolicy, 'provider-id-only');
  assert.equal(plan.fillPolicy, 'blank-fields-only');
  assert.equal(plan.batch.limit, 100);
  assert.equal(calls.length, 100);
  assert.equal(plan.cursor.hasMore, true);
  assert.ok(plan.candidatePlan.candidates.every(row => row.matching_method === 'provider-id'));
  assert.ok(plan.candidatePlan.candidates.every(row => row.current_value == null));
  assert.equal(plan.provenance.writesPerformed, false);
});

test('resumes deterministically and image candidates require explicit opt-in', async () => {
  const calls = [];
  const first = await planPokemonEnrichmentWorkflow({
    snapshot: snapshot(3),
    fields: ['rarity'],
    batchSize: 2,
    fetchImpl: fakeFetch(calls),
    observedAt: '2026-09-18T00:00:00Z'
  });
  const second = await planPokemonEnrichmentWorkflow({
    snapshot: snapshot(3),
    fields: ['rarity'],
    batchSize: 2,
    cursor: first.cursor.next,
    fetchImpl: fakeFetch(calls),
    observedAt: '2026-09-18T00:00:00Z'
  });
  assert.deepEqual(first.batch.candidateProviderIds, ['sv4a-0', 'sv4a-1']);
  assert.deepEqual(second.batch.candidateProviderIds, ['sv4a-2']);
  assert.equal(second.cursor.hasMore, false);

  await assert.rejects(() => planPokemonEnrichmentWorkflow({
    snapshot: snapshot(1),
    fields: ['image_url'],
    fetchImpl: fakeFetch([])
  }), /IMAGE_OPT_IN_REQUIRED/);
  const images = await planPokemonEnrichmentWorkflow({
    snapshot: snapshot(1),
    fields: ['image_url'],
    includeImages: true,
    fetchImpl: fakeFetch([]),
    imageProbeImpl: async () => ({
      status: 206,
      headers: { get: name => name === 'content-type' ? 'image/webp' : null }
    }),
    observedAt: '2026-09-18T00:00:00Z'
  });
  assert.equal(images.candidatePlan.candidates[0].review_reason, 'image-rights-review-required');
});

test('does not fetch or propose values for already populated targets', async () => {
  const complete = snapshot(1);
  complete.cards[0].name_zh = '既有名稱';
  complete.cards[0].rarity = 'SSR';
  complete.printings[0].rarity_code = 'SSR';
  complete.printings[0].rarity_label = 'SSR';
  complete.cardNames.push({ card_id: 'card-0', locale: 'zh-Hant-TW', name_type: 'official', name: '既有名稱' });
  const calls = [];
  const plan = await planPokemonEnrichmentWorkflow({
    snapshot: complete,
    fields: ['name_zh', 'rarity'],
    fetchImpl: fakeFetch(calls)
  });
  assert.equal(calls.length, 0);
  assert.equal(plan.candidatePlan.candidates.length, 0);
});

test('keeps the parent card context when a printing has its own provider ID', async () => {
  const source = snapshot(1);
  source.cards[0].provider_id = 'card-provider-id';
  source.cards[0].rarity = 'SSR';
  source.cardNames.push({ card_id: 'card-0', locale: 'zh-Hant-TW', name_type: 'official', name: '既有名稱' });
  const plan = await planPokemonEnrichmentWorkflow({
    snapshot: source,
    fields: ['rarity'],
    fetchImpl: fakeFetch([]),
    observedAt: '2026-09-18T00:00:00Z'
  });
  assert.ok(plan.candidatePlan.candidates.some(row => row.target_printing_id === 'printing-0'));
  assert.ok(plan.candidatePlan.candidates.every(row => row.matching_method === 'provider-id'));
});

test('scopes workflow batches by exact series and inclusive numeric range while preserving cursor bounds', async () => {
  const calls = [];
  const first = await planPokemonEnrichmentWorkflow({
    snapshot: snapshot(12),
    series: ' SV4A ',
    cardNumberFrom: '2',
    cardNumberTo: '10',
    batchSize: 2,
    fields: ['rarity'],
    fetchImpl: fakeFetch(calls),
    observedAt: '2026-09-18T00:00:00Z'
  });
  assert.deepEqual(first.batch.candidateProviderIds, ['sv4a-2', 'sv4a-3']);
  assert.equal(first.batch.limit, 2);
  assert.equal(first.scope.series, 'sv4a');
  assert.equal(first.scope.from, 2);
  assert.equal(first.scope.to, 10);
  assert.equal(first.cursor.hasMore, true);

  const second = await planPokemonEnrichmentWorkflow({
    snapshot: snapshot(12),
    series: 'sv4a',
    cardNumberFrom: 2,
    cardNumberTo: 10,
    batchSize: 2,
    fields: ['rarity'],
    cursor: first.cursor.next,
    fetchImpl: fakeFetch(calls),
    observedAt: '2026-09-18T00:00:00Z'
  });
  assert.deepEqual(second.batch.candidateProviderIds, ['sv4a-4', 'sv4a-5']);
  assert.equal(second.cursor.candidate.offset, 2);
  assert.ok(second.cursor.candidate.next);
  assert.equal(second.cursor.hasMore, true);
});
