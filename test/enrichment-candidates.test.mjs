import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANDIDATE_FIELDS,
  DEFAULT_REQUESTED_FIELDS,
  TCGDEX_PROVIDER,
  makeLocalKey,
  planPokemonEnrichment
} from '../providers/enrichment-candidates.mjs';

const snapshot = ({ cardOverrides = {}, printingOverrides = {}, cardNames = [] } = {}) => ({
  cards: [{
    id: 'card-1',
    canonical_id: 'canonical-1',
    game_id: 'pokemon',
    source: TCGDEX_PROVIDER,
    provider_id: 'sv4a-347',
    official_card_number: '347/190',
    name_zh: null,
    rarity: null,
    ...cardOverrides
  }],
  printings: [{
    id: 'printing-1',
    card_id: 'card-1',
    source: TCGDEX_PROVIDER,
    provider_id: 'sv4a-347',
    local_set_code: 'sv4a',
    local_card_number: '347/190',
    rarity: null,
    rarity_code: null,
    rarity_label: null,
    image_url: null,
    ...printingOverrides
  }],
  cardNames: cardNames
});

function fakeFetch(payloads, calls = [], { delay = 0 } = {}) {
  return async (url, options) => {
    calls.push({ url: String(url), options });
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const id = decodeURIComponent(String(url).split('/').at(-1));
    if (!Object.hasOwn(payloads, id)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => payloads[id] };
  };
}

const payload = (id = 'sv4a-347', overrides = {}) => ({
  id,
  set: { id: 'sv4a' },
  localId: '347/190',
  name: '夢幻 ex',
  rarity: 'SSR',
  image: 'https://assets.tcgdex.net/zh-tw/SV4a/347',
  ...overrides
});

test('defaults to rarity only, fetches exact TCGdex IDs with GET, and emits table-shaped rows', async () => {
  const calls = [];
  const plan = await planPokemonEnrichment(snapshot({
    cardNames: [{ card_id: 'card-1', locale: 'zh-Hant-TW', name_type: 'official', name: '夢幻 ex' }]
  }), {
    fetchImpl: fakeFetch({ 'sv4a-347': payload() }, calls),
    observedAt: '2026-09-15T00:00:00Z'
  });

  assert.deepEqual(DEFAULT_REQUESTED_FIELDS, ['rarity']);
  assert.deepEqual(plan.summary.requestedFields, ['rarity']);
  assert.deepEqual(plan.summary.candidateFields, ['rarity_code']);
  assert.equal(plan.summary.includeImages, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].url, 'https://api.tcgdex.net/v2/zh-tw/cards/sv4a-347');
  assert.ok(plan.candidates.length > 0);
  assert.ok(plan.candidates.every(row => CANDIDATE_FIELDS.includes(row.field_name)));
  assert.ok(plan.candidates.every(row => !['name_zh', 'image_url'].includes(row.field_name)));
  assert.ok(plan.candidates.every(row => row.source === TCGDEX_PROVIDER));
  assert.ok(plan.candidates.every(row => row.payload_hash.length === 64));
  assert.ok(plan.candidates.every(row => ['tcg_cards','tcg_printings'].includes(row.target_table)));
  assert.ok(plan.candidates.every(row => row.target_key));
  assert.ok(plan.candidates.every(row => row.source_url === 'https://www.tcgdex.net/database/cards/sv4a-347'));
  assert.ok(plan.candidates.every(row => row.observed_at === '2026-09-15T00:00:00.000Z'));
  assert.ok(plan.candidates.every(row => row.status === 'candidate'));
});

test('normalizes source rarity aliases and preserves raw evidence', async () => {
  const plan = await planPokemonEnrichment(snapshot(), {
    fetchImpl: fakeFetch({ 'sv4a-347': payload('sv4a-347', { rarity: 'Common' }) }),
    observedAt: '2026-09-15T00:00:00Z'
  });
  assert.ok(plan.candidates.length > 0);
  assert.ok(plan.candidates.every(row => row.proposed_value === 'C'));
  assert.ok(plan.candidates.every(row => row.evidence.rawRarity === 'Common'));
});

test('name enrichment is opt-in and official card-name rows count as existing coverage', async () => {
  const calls = [];
  const plan = await planPokemonEnrichment(snapshot({
    cardOverrides: { name_zh: '夢幻 ex' },
    cardNames: [{ card_id: 'card-1', locale: 'zh-Hant-TW', name_type: 'official', name: '夢幻 ex' }]
  }), {
    fields: ['name_zh'],
    fetchImpl: fakeFetch({ 'sv4a-347': payload() }, calls),
    observedAt: '2026-09-15T00:00:00Z'
  });
  assert.equal(calls.length, 0);
  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.summary.requestedFields[0], 'name_zh');
  assert.equal(plan.summary.skippedSnapshotRows, 2);
});

test('uses exact set and number crosswalks only, never names or fuzzy matches', async () => {
  const source = snapshot({
    cardOverrides: {
      id: 'card-a',
      provider_id: 'sv4a-source',
      name_zh: null,
      official_card_number: '347/190'
    },
    printingOverrides: {
      id: 'printing-b',
      card_id: 'card-a',
      provider_id: 'sv4a-other',
      local_set_code: 'sv4a',
      local_card_number: '347/190'
    }
  });
  const calls = [];
  const plan = await planPokemonEnrichment(source, {
    fields: ['name_zh', 'rarity'],
    fetchImpl: fakeFetch({
      'sv4a-other': payload('sv4a-347', { name: '夢幻 ex' }),
      'sv4a-source': payload('sv4a-347', { name: '夢幻 ex' })
    }, calls),
    observedAt: '2026-09-15T00:00:00Z'
  });
  assert.equal(calls.length, 2);
  assert.ok(plan.candidates.some(row => row.target_card_id === 'card-a' && row.matching_method === 'provider-crosswalk'));
  assert.ok(plan.candidates.some(row => row.target_printing_id === 'printing-b' && row.matching_method === 'provider-crosswalk'));
  assert.equal(makeLocalKey(' SV4A ', '347 / 190'), 'sv4a|347/190');

  const fuzzy = await planPokemonEnrichment(snapshot({ cardOverrides: { provider_id: 'sv4a-unknown', official_card_number: null } }), {
    fields: ['name_zh'],
    fetchImpl: fakeFetch({ 'sv4a-unknown': payload('unrelated-id', { name: '夢幻 ex' }) }),
    observedAt: '2026-09-15T00:00:00Z'
  });
  assert.equal(fuzzy.candidates.length, 0);
  assert.ok(fuzzy.audit.some(item => item.status === 'unmatched'));
});

test('excludes non-TCGdex sources and complete requested fields before fetching', async () => {
  const calls = [];
  const plan = await planPokemonEnrichment({
    cards: [{ id: 'pokemon-card', game_id: 'pokemon', source: 'pokemontcg', provider_id: 'sv4a-347', name_zh: null, rarity: null }],
    printings: [],
    cardNames: []
  }, { fields: ['name_zh', 'rarity'], fetchImpl: fakeFetch({ 'sv4a-347': payload() }, calls) });
  assert.equal(calls.length, 0);
  assert.equal(plan.candidates.length, 0);
  assert.ok(plan.skipped.some(item => item.reason === 'source-not-tcgdex'));

  const complete = await planPokemonEnrichment(snapshot({
    cardOverrides: { name_zh: '夢幻 ex', rarity: 'SSR' },
    printingOverrides: { rarity: 'SSR', rarity_code: 'SSR', rarity_label: 'SSR', image_url: 'https://existing.test/card.webp' },
    cardNames: [{ card_id: 'card-1', locale: 'zh-Hant-TW', name_type: 'official', name: '夢幻 ex' }]
  }), { fields: ['name_zh', 'rarity'], fetchImpl: fakeFetch({ 'sv4a-347': payload() }, calls) });
  assert.equal(complete.candidates.length, 0);
});

test('image candidates require explicit opt-in and retain unverified rights state', async () => {
  await assert.rejects(
    () => planPokemonEnrichment(snapshot(), {
      fields: ['image_url'],
      fetchImpl: fakeFetch({ 'sv4a-347': payload() })
    }),
    /IMAGE_OPT_IN_REQUIRED/
  );
  const plan = await planPokemonEnrichment(snapshot(), {
    fields: ['image_url'],
    includeImages: true,
    fetchImpl: fakeFetch({ 'sv4a-347': payload() }),
    observedAt: '2026-09-15T00:00:00Z'
  });
  const image = plan.candidates.find(row => row.field_name === 'image_url');
  assert.ok(image);
  assert.deepEqual(image.proposed_value, {
    url: 'https://assets.tcgdex.net/zh-tw/SV4a/347/low.webp',
    imageRightsStatus: 'not-provided',
    imageRights: 'not-inferred'
  });
  assert.equal(image.review_reason, 'image-rights-review-required');
  assert.equal(plan.provenance.imageRightsStatus, 'not-provided');
  assert.equal(plan.provenance.imageRights, 'not-inferred');
});

test('caps source records at 100 and keeps output deterministic across input order', async () => {
  const cards = Array.from({ length: 120 }, (_, index) => ({
    id: `card-${index}`,
    game_id: 'pokemon',
    source: TCGDEX_PROVIDER,
    provider_id: `sv4a-${index}`,
    name_zh: null,
    rarity: null,
    official_card_number: `${index}/190`
  }));
  const payloads = Object.fromEntries(cards.map(card => [card.provider_id, payload(card.provider_id, { localId: `${Number(card.provider_id.split('-')[1])}/190` })]));
  const plan = await planPokemonEnrichment({ cards, printings: [], cardNames: [] }, {
    fields: ['name_zh'],
    batchSize: 250,
    concurrency: 2,
    fetchImpl: fakeFetch(payloads),
    observedAt: '2026-09-15T00:00:00Z'
  });
  assert.equal(plan.summary.selectedRecords, 100);
  assert.equal(plan.summary.deferredRecords, 20);
  assert.ok(plan.candidates.length <= 100);

  const reversed = await planPokemonEnrichment({ cards: [...cards].reverse(), printings: [], cardNames: [] }, {
    fields: ['name_zh'],
    batchSize: 100,
    fetchImpl: fakeFetch(payloads),
    observedAt: '2026-09-15T00:00:00Z'
  });
  assert.deepEqual(plan.candidates, reversed.candidates);
});
