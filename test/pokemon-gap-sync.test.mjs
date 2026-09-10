import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokemonGapPlan, makeLocalKey, normalizeExactPart } from '../providers/pokemon-gap-sync.mjs';

const card = (overrides = {}) => ({
  id: 'card-1',
  game_id: 'pokemon',
  source: 'pokemontcg',
  provider_id: 'sv4a-347',
  official_card_number: '347/190',
  name_zh: null,
  name_en: 'Mew ex',
  rarity: null,
  ...overrides
});

const printing = (overrides = {}) => ({
  id: 'printing-1',
  card_id: 'card-1',
  source: 'pokemontcg',
  provider_id: 'sv4a-347',
  local_set_code: 'sv4a',
  local_card_number: '347/190',
  region: 'US',
  language: 'en-US',
  image_url: null,
  rarity: null,
  rarity_code: null,
  rarity_label: null,
  ...overrides
});

const zhSource = (overrides = {}) => ({
  provider: 'tcgdex-zh-tw',
  providerId: 'sv4a-347',
  setId: 'sv4a',
  localId: '347/190',
  name: '夢幻 ex',
  rarity: 'SSR',
  image: { low: 'https://assets.example.test/sv4a-347.webp' },
  sourceUrl: 'https://www.tcgdex.net/database/cards/sv4a-347',
  ...overrides
});

test('normalizes only exact identity parts and preserves meaningful separators', () => {
  assert.equal(normalizeExactPart(' SV4A '), 'sv4a');
  assert.equal(normalizeExactPart('347 / 190'), '347/190');
  assert.equal(makeLocalKey(' SV4A ', '347 / 190'), 'sv4a|347/190');
});

test('matches by stable provider ID or exact local set plus number and emits all three enrichment plans', () => {
  const plan = createPokemonGapPlan({ cards: [card()], printings: [printing()], sourceRecords: [zhSource()] });
  assert.equal(plan.dryRun, true);
  assert.equal(plan.matches.length, 1);
  assert.equal(plan.matches[0].matchType, 'local-set-number');
  assert.equal(plan.patches.tcg_cards.length, 1);
  assert.deepEqual(plan.patches.tcg_cards[0].patch, { name_zh: '夢幻 ex', rarity: 'SSR' });
  assert.equal(plan.patches.tcg_printings.length, 1);
  assert.deepEqual(plan.patches.tcg_printings[0].patch, {
    image_url: 'https://assets.example.test/sv4a-347.webp',
    rarity: 'SSR',
    rarity_code: 'SSR',
    rarity_label: 'SSR'
  });
  assert.equal(plan.patches.tcg_card_names.length, 1);
  assert.equal(plan.patches.tcg_card_names[0].patch.locale, 'zh-Hant-TW');
  assert.equal(plan.patches.tcg_cards[0].provenance.imageRights, 'not-inferred');
});

test('prefers an exact provider ID when the provider namespace agrees', () => {
  const plan = createPokemonGapPlan({
    cards: [card()],
    printings: [printing()],
    sourceRecords: [{
      provider: 'pokemontcg',
      providerId: 'sv4a-347',
      nameZh: '夢幻 ex',
      rarityCode: 'SSR',
      images: { small: 'https://assets.example.test/sv4a-347.webp' },
      sourceUrl: 'https://github.com/PokemonTCG/pokemon-tcg-data'
    }]
  });
  assert.equal(plan.matches[0].matchType, 'provider-id');
  assert.equal(plan.patches.tcg_cards[0].id, 'card-1');
});

test('uses a stable provider ID even when a local set and number is shared by another printing', () => {
  const secondCard = card({ id: 'card-2', provider_id: 'sv4a-348', official_card_number: '348/190' });
  const duplicateLocal = printing({ id: 'printing-2', card_id: 'card-2', provider_id: 'sv4a-348' });
  const plan = createPokemonGapPlan({
    cards: [card(), secondCard],
    printings: [printing(), duplicateLocal],
    sourceRecords: [{ provider: 'pokemontcg', providerId: 'sv4a-347', nameZh: '夢幻 ex', rarityCode: 'SSR' }]
  });
  assert.equal(plan.matches[0].cardId, 'card-1');
  assert.equal(plan.matches[0].matchType, 'provider-id');
});

test('accepts the approved TCGdex zh-tw API shape without guessing an identity', () => {
  const plan = createPokemonGapPlan({
    cards: [card({ source: 'tcgdex', provider_id: 'sv4a-347' })],
    printings: [printing({ source: 'tcgdex', provider_id: 'sv4a-347' })],
    sourceRecords: [{
      provider: 'tcgdex',
      locale: 'zh-tw',
      id: 'sv4a-347',
      set: { id: 'sv4a' },
      localId: '347/190',
      name: '夢幻 ex',
      rarity: 'SSR',
      image: 'https://assets.example.test/sv4a-347',
      sourceUrl: 'https://www.tcgdex.net/database/cards/sv4a-347'
    }]
  });
  assert.equal(plan.matches.length, 1);
  assert.equal(plan.patches.tcg_card_names[0].patch.locale, 'zh-Hant-TW');
  assert.equal(plan.patches.tcg_printings[0].patch.image_url, 'https://assets.example.test/sv4a-347/low.webp');
});

test('rejects ambiguous exact matches and never falls back to names', () => {
  const cards = [card({ id: 'card-a', provider_id: null, official_card_number: null }), card({ id: 'card-b', provider_id: null, official_card_number: null })];
  const printings = [
    printing({ id: 'printing-a', card_id: 'card-a', provider_id: null }),
    printing({ id: 'printing-b', card_id: 'card-b', provider_id: null })
  ];
  const ambiguous = createPokemonGapPlan({ cards, printings, sourceRecords: [zhSource({ providerId: null, name: 'Mew ex' })] });
  assert.equal(ambiguous.matches.length, 0);
  assert.equal(ambiguous.patches.tcg_cards.length, 0);
  assert.equal(ambiguous.rejected[0].reason, 'ambiguous-local-set-number');

  const noKey = createPokemonGapPlan({ cards: [card({ name_zh: null })], printings: [printing()], sourceRecords: [zhSource({ providerId: null, setId: null, localId: null, name: 'Mew ex' })] });
  assert.equal(noKey.patches.tcg_cards.length, 0);
  assert.equal(noKey.rejected[0].reason, 'missing-stable-key');
});

test('does not destructively overwrite reviewed names, rarity, images, or printing/version fields', () => {
  const existingCard = card({ name_zh: '夢幻 ex', rarity: 'SSR' });
  const existingPrinting = printing({ image_url: 'https://existing.example.test/card.webp', rarity: 'SSR', rarity_code: 'SSR', rarity_label: 'SSR', region: 'JP', language: 'ja-JP' });
  const existingName = { card_id: 'card-1', locale: 'zh-Hant-TW', name: '夢幻 ex', name_type: 'official', source: 'reviewed', data_status: 'verified' };
  const plan = createPokemonGapPlan({ cards: [existingCard], printings: [existingPrinting], cardNames: [existingName], sourceRecords: [zhSource({ name: '別名', rarity: 'COMMON', imageUrl: 'https://new.example.test/card.webp' })] });
  assert.equal(plan.patchCounts.total, 0);
  assert.deepEqual(plan.patches.tcg_cards, []);
  assert.deepEqual(plan.patches.tcg_printings, []);
  assert.deepEqual(plan.patches.tcg_card_names, []);
  assert.deepEqual(plan.coverage.delta.gaps, { chineseNames: 0, cardChineseNameFields: 0, rarities: 0, printingRarities: 0, displayableImages: 0, officialChineseNameRows: 0 });
});

test('emits changed-only patches and keeps the source cursor resumable', () => {
  const complete = card({ id: 'card-complete', provider_id: 'sv4a-1', official_card_number: '1/190', name_zh: '妙蛙種子', rarity: 'C' });
  const completePrinting = printing({ id: 'printing-complete', card_id: 'card-complete', provider_id: 'sv4a-1', local_card_number: '1/190', image_url: 'https://existing.example.test/1.webp', rarity: 'C', rarity_code: 'C', rarity_label: 'C' });
  const missing = card({ id: 'card-missing', provider_id: 'sv4a-2', official_card_number: '2/190' });
  const missingPrinting = printing({ id: 'printing-missing', card_id: 'card-missing', provider_id: 'sv4a-2', local_card_number: '2/190' });
  const sources = [
    zhSource({ providerId: 'sv4a-1', localId: '1/190', name: '不應覆寫', rarity: 'R', imageUrl: 'https://new.example.test/1.webp' }),
    zhSource({ providerId: 'sv4a-2', localId: '2/190', name: '妙蛙花', rarity: 'RR' })
  ];
  const existingCompleteName = { card_id: 'card-complete', locale: 'zh-Hant-TW', name: '妙蛙種子', name_type: 'official', source: 'reviewed', data_status: 'verified' };
  const first = createPokemonGapPlan({ cards: [complete, missing], printings: [completePrinting, missingPrinting], cardNames: [existingCompleteName], sourceRecords: sources, batchSize: 2 });
  assert.deepEqual(first.patches.tcg_cards.map(item => item.id), ['card-missing']);
  assert.deepEqual(first.patches.tcg_printings.map(item => item.id), ['printing-missing']);
  assert.equal(first.patches.tcg_card_names.length, 1);
  assert.equal(first.cursor.hasMore, false);

  const pagedFirst = createPokemonGapPlan({ cards: [complete, missing], printings: [completePrinting, missingPrinting], cardNames: [existingCompleteName], sourceRecords: sources, batchSize: 1 });
  assert.equal(pagedFirst.cursor.hasMore, true);
  const pagedSecond = createPokemonGapPlan({ cards: [complete, missing], printings: [completePrinting, missingPrinting], cardNames: [existingCompleteName], sourceRecords: sources, batchSize: 1, cursor: pagedFirst.cursor.next });
  assert.equal(pagedSecond.cursor.offset, 1);
  assert.equal(pagedSecond.sourceRecords.checksum, pagedFirst.sourceRecords.checksum);
  assert.equal(pagedSecond.cursor.hasMore, false);
});

test('reports an honest batch projection and rejects source-policy conflicts', () => {
  const plan = createPokemonGapPlan({
    cards: [card()],
    printings: [printing()],
    sourceRecords: [zhSource(), { ...zhSource({ providerId: 'sv4a-999' }), provider: 'unknown-source' }]
  });
  assert.equal(plan.coverage.scope, 'current-batch-projection');
  assert.equal(plan.coverage.gapCounts.before.displayableImages, 1);
  assert.equal(plan.coverage.gapCounts.after.displayableImages, 0);
  assert.equal(plan.coverage.delta.gaps.displayableImages, 1);
  assert.equal(plan.coverage.delta.gaps.chineseNames, 1);
  assert.equal(plan.coverage.delta.gaps.rarities, 1);
  assert.equal(plan.rejected.some(item => item.reason === 'source-not-approved'), true);
});

test('rejects a stale cursor when the source checksum changes', () => {
  const first = createPokemonGapPlan({ cards: [card()], printings: [printing()], sourceRecords: [zhSource(), zhSource({ providerId: 'sv4a-348', localId: '348/190' })], batchSize: 1 });
  assert.ok(first.cursor.next);
  assert.throws(() => createPokemonGapPlan({ cards: [card()], printings: [printing()], sourceRecords: [zhSource(), zhSource({ providerId: 'sv4a-348', localId: '348/190', rarity: 'UR' })], batchSize: 1, cursor: first.cursor.next }), /INVALID_POKEMON_GAP_CURSOR/);
});
