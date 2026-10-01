import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  planPokemonJpManifest,
  pokemonJpTargetId
} from '../providers/pokemon-jp-manifest.mjs';

const root = new URL('../', import.meta.url);

function snapshot({
  seriesId = 'sv8a',
  cardRows = null,
  setRows = null,
  seedRows = null
} = {}) {
  const sets = setRows || [{
    id: seriesId,
    name: 'テラスタルフェスex',
    releaseDate: '2024-12-06',
    logo: 'https://assets.example.test/sv8a/logo.webp',
    region: 'JP',
    locale: 'ja-JP'
  }];
  const cards = cardRows || [
    {
      id: `${seriesId}-001`,
      localId: '001',
      name: 'イーブイ',
      rarity: 'Common',
      set: { id: seriesId },
      image: 'https://assets.example.test/sv8a/001.webp',
      price: 100
    },
    {
      id: `${seriesId}-002`,
      localId: '002',
      name: 'シャワーズ',
      rarity: 'Double rare',
      set: { id: seriesId },
      image: 'https://assets.example.test/sv8a/002.webp',
      prices: { market: 200 }
    }
  ];
  return {
    observedAt: '2026-09-28T03:00:00.000Z',
    sourceIdentity: { source: 'tcgdex-ja', region: 'JP', locale: 'ja-JP' },
    sets,
    cards,
    existingJpRows: seedRows || { series: [], cards: [], printings: [] }
  };
}

function plan(input = snapshot(), options = {}) {
  return planPokemonJpManifest(input, { seriesId: 'sv8a', ...options });
}

function findRecord(manifest, entity, sourceProviderId) {
  return manifest.records.find(row => row.entity === entity && row.sourceProviderId === sourceProviderId);
}

test('emits a stable, JP-only metadata manifest with a hashed source and no image or price data', () => {
  const input = snapshot();
  const before = structuredClone(input);
  const first = plan(input);
  const replay = plan(input);

  assert.deepEqual(first, replay);
  assert.deepEqual(input, before);
  assert.match(first.provenance.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(first.provenance.seedHash, /^[a-f0-9]{64}$/);
  assert.match(first.manifestHash, /^[a-f0-9]{64}$/);
  assert.equal(first.provenance.sourceObservedAt, input.observedAt);
  assert.equal(first.dryRun, true);
  assert.equal(first.writesPerformed, false);
  assert.equal(first.databaseContacted, false);
  assert.equal(first.policy.globalExpectedTotals.status, 'unknown');
  assert.equal(first.policy.globalExpectedTotals.cards, null);
  assert.equal(first.policy.imageDisplay.enabled, false);
  assert.equal(first.policy.prices.enabled, false);
  assert.equal(first.scope.seriesStatus, 'eligible');
  assert.equal(first.records.filter(row => row.entity === 'card').length, 2);
  assert.equal(first.records.filter(row => row.entity === 'printing').length, 2);

  const card = findRecord(first, 'card', 'sv8a-001');
  const printing = findRecord(first, 'printing', 'sv8a-001');
  const series = findRecord(first, 'series', 'sv8a');
  assert.equal(card.metadata.name_ja, 'イーブイ');
  assert.deepEqual(series.sourceEvidence, {
    url: 'https://api.tcgdex.net/v2/ja/sets/sv8a',
    urlType: 'derived-provider-endpoint',
    observedAt: input.observedAt
  });
  assert.deepEqual(card.sourceEvidence, {
    url: 'https://api.tcgdex.net/v2/ja/cards/sv8a-001',
    urlType: 'derived-provider-endpoint',
    observedAt: input.observedAt
  });
  assert.deepEqual(printing.sourceEvidence, card.sourceEvidence);
  assert.equal(printing.identity.setProviderId, 'sv8a');
  assert.equal(printing.identity.localId, '001');
  assert.deepEqual(printing.metadata.rarity, { code: 'C', label: 'C' });
  assert.equal(printing.metadata.releaseDate, '2024-12-06');
  assert.ok(first.records.every(row => row.region === 'JP' && row.locale === 'ja-JP'));
  assert.ok(first.records.every(row => row.source === 'tcgdex-ja'));
  assert.ok(first.records.every(row => row.sourceEvidence.url.startsWith('https://api.tcgdex.net/v2/ja/')));
  assert.doesNotMatch(JSON.stringify({ records: first.records, quarantined: first.quarantined }), /"(?:image|images|logo|logos|price|prices|marketPrice)"\s*:/i);
});

test('builds readable lower-case IDs and refuses provider IDs it cannot label unambiguously', () => {
  assert.equal(pokemonJpTargetId('series', 'SVLN'), 'pokemon-tcgdex-ja-svln');
  assert.equal(pokemonJpTargetId('series', 'CS1.5'), 'pokemon-tcgdex-ja-cs1.5');
  assert.equal(pokemonJpTargetId('card', 'SVLN-001', 'SVLN'), 'pokemon-tcgdex-ja-svln-001');
  assert.equal(pokemonJpTargetId('printing', 'SVLN-001', 'SVLN'), 'pokemon-tcgdex-ja-svln-001');
  for (const [providerId, seriesId] of [
    ['SV4a/001', 'SV4a'],
    ['SV4a-00/1', 'SV4a'],
    ['SV4a-001', 'SV4b'],
    ['ピカチュウ', 'SV4a'],
    ['SV4a-ピカ', 'SV4a'],
    ['SV-P-001', 'SV-P']
  ]) assert.equal(pokemonJpTargetId('card', providerId, seriesId), null, providerId);
  assert.equal(pokemonJpTargetId('series', 'SV/4a'), null);
  assert.equal(pokemonJpTargetId('series', 'SV-P'), null);
  assert.throws(() => pokemonJpTargetId('card', ' SVLN-001', 'SVLN'), /INVALID_POKEMON_JP_PROVIDER_ID/);

  const manifest = plan(snapshot({ cardRows: [
    { id: 'sv8a-001', localId: '001', name: 'イーブイ', set: { id: 'sv8a' } },
    { id: 'sv8a-P-1', localId: 'P-1', name: 'プロモ', set: { id: 'sv8a' } }
  ] }));
  assert.equal(findRecord(manifest, 'card', 'sv8a-001').targetId, 'pokemon-tcgdex-ja-sv8a-001');
  assert.equal(findRecord(manifest, 'printing', 'sv8a-001').cardTargetId, 'pokemon-tcgdex-ja-sv8a-001');
  assert.equal(findRecord(manifest, 'series', 'sv8a').targetId, 'pokemon-tcgdex-ja-sv8a');
  assert.deepEqual(manifest.quarantined.find(row => row.sourceProviderId === 'sv8a-P-1').reasons, ['unsupported-readable-card-id']);
});

test('encodes provider IDs into fixed Japanese metadata endpoint paths', () => {
  const input = snapshot({
    seriesId: 'SV/4a',
    setRows: [{ id: 'SV/4a', name: 'ハイクラスパック', releaseDate: '2023-12-01' }],
    cardRows: [{ id: 'SV/4a-001', localId: '001', name: 'カード', set: { id: 'SV/4a' } }]
  });
  const manifest = plan(input, { seriesId: 'SV/4a' });
  const quarantinedSeries = manifest.quarantined.find(row => row.entity === 'series');
  const quarantinedCard = manifest.quarantined.find(row => row.entity === 'card');
  assert.equal(manifest.records.length, 0);
  assert.deepEqual(quarantinedSeries.reasons, ['unsupported-readable-series-id']);
  assert.equal(quarantinedSeries.targetId, null);
  assert.equal(quarantinedSeries.sourceEvidence.url, 'https://api.tcgdex.net/v2/ja/sets/SV%2F4a');
  assert.ok(quarantinedCard.reasons.includes('unsupported-readable-series-id'));
  assert.equal(quarantinedCard.sourceEvidence.url, 'https://api.tcgdex.net/v2/ja/cards/SV%2F4a-001');
});

test('enforces the 100-card hard limit and resumes with a source- and seed-bound cursor', () => {
  const cards = Array.from({ length: 101 }, (_, index) => ({
    id: `sv8a-${String(index + 1).padStart(3, '0')}`,
    localId: String(index + 1).padStart(3, '0'),
    name: `カード${index + 1}`,
    rarity: 'Common',
    set: { id: 'sv8a' }
  }));
  const input = snapshot({ cardRows: cards });
  assert.throws(() => plan(input, { limit: 101 }), /INVALID_POKEMON_JP_MANIFEST_LIMIT/);

  const first = plan(input, { limit: 100 });
  assert.equal(first.scope.hasMore, true);
  assert.equal(first.scope.nextCursor != null, true);
  assert.equal(first.summary.selectedCards, 100);
  const second = plan(input, { limit: 100, cursor: first.scope.nextCursor });
  assert.equal(second.summary.selectedCards, 1);
  assert.equal(second.scope.hasMore, false);
  assert.deepEqual(
    new Set([...first.records, ...second.records].filter(row => row.entity === 'card').map(row => row.sourceProviderId)).size,
    101
  );
  assert.throws(() => plan(input, { limit: 50, cursor: first.scope.nextCursor }), /INVALID_POKEMON_JP_MANIFEST_CURSOR/);
  const changed = structuredClone(input);
  changed.cards[0].name = '変更後の名前';
  assert.throws(() => plan(changed, { limit: 100, cursor: first.scope.nextCursor }), /INVALID_POKEMON_JP_MANIFEST_CURSOR/);
});

test('rejects a wrong root source/locale and quarantines card-level identity or set mismatches', () => {
  const wrongRoot = snapshot();
  wrongRoot.sourceIdentity.locale = 'zh-Hant-TW';
  assert.throws(() => plan(wrongRoot), /INVALID_POKEMON_JP_SOURCE_IDENTITY/);

  const mixed = snapshot({ cardRows: [
    { id: 'sv8a-001', localId: '001', name: 'イーブイ', set: { id: 'sv8a' }, source: 'tcgdex-tw' },
    { id: 'sv8a-002', localId: '002', name: 'シャワーズ', set: { id: 'other-set' } },
    { id: 'sv8a-003', localId: '003', name: 'ブースター', set: { id: 'sv8a' }, locale: 'zh-Hant-TW' }
  ] });
  const manifest = plan(mixed);
  assert.equal(manifest.records.filter(row => row.entity === 'card').length, 0);
  assert.deepEqual(manifest.quarantined.filter(row => row.entity === 'card').map(row => row.reasons), [
    ['wrong-source-identity'],
    ['card-set-identity-mismatch'],
    ['wrong-locale-identity']
  ]);
});

test('requires each exact provider card ID to agree with its set and local ID', () => {
  const input = snapshot({
    seriesId: 'PMCG1',
    setRows: [{ id: 'PMCG1', name: 'セット', releaseDate: '2025-01-01' }],
    cardRows: [
      { id: 'PMCG1-001', localId: '002', name: '誤った番号', set: { id: 'PMCG1' } },
      { id: 'PMCG1-003', localId: '003', name: '一致', set: { id: 'PMCG1' } },
      { id: 'pmcg1-004', localId: '004', name: '異なる大文字小文字', set: { id: 'PMCG1' } }
    ]
  });
  const manifest = plan(input, { seriesId: 'PMCG1' });
  assert.deepEqual(manifest.records.filter(row => row.entity === 'card').map(row => row.sourceProviderId), ['PMCG1-003']);
  assert.ok(manifest.quarantined.find(row => row.sourceProviderId === 'PMCG1-001').reasons.includes('card-provider-id-local-id-mismatch'));
  assert.ok(manifest.quarantined.find(row => row.sourceProviderId === 'pmcg1-004').reasons.includes('card-provider-id-local-id-mismatch'));
});

test('requires a valid ISO observation timestamp and binds it into the source hash and cursor', () => {
  const input = snapshot({ cardRows: Array.from({ length: 101 }, (_, index) => ({
    id: `sv8a-${String(index + 1).padStart(3, '0')}`,
    localId: String(index + 1).padStart(3, '0'),
    name: `カード${index + 1}`,
    set: { id: 'sv8a' }
  })) });
  const first = plan(input, { limit: 100 });
  const changedTimestamp = structuredClone(input);
  changedTimestamp.observedAt = '2026-09-28T04:00:00.000Z';
  assert.notEqual(plan(changedTimestamp, { limit: 100 }).provenance.sourceHash, first.provenance.sourceHash);
  assert.throws(() => plan(changedTimestamp, { limit: 100, cursor: first.scope.nextCursor }), /INVALID_POKEMON_JP_MANIFEST_CURSOR/);
  assert.throws(() => plan({ ...input, observedAt: '2026-02-30T03:00:00.000Z' }), /INVALID_POKEMON_JP_OBSERVED_AT/);
  assert.throws(() => plan({ ...input, observedAt: '2026-09-28' }), /INVALID_POKEMON_JP_OBSERVED_AT/);
});

test('quarantines the seeded SV4a series and its normalized 347 printing collision', () => {
  const input = snapshot({
    seriesId: 'SV4a',
    setRows: [{ id: 'SV4a', name: 'ハイクラスパック', releaseDate: '2023-12-01' }],
    cardRows: [
      { id: 'SV4a-347', localId: '347', name: 'ミュウex', rarity: 'SR', set: { id: 'SV4a' } },
      { id: 'SV4a-348', localId: '348', name: '別のカード', rarity: 'R', set: { id: 'SV4a' } }
    ],
    seedRows: {
      series: [{ id: 'pokemon-sv4a-jp', game_id: 'pokemon', official_code: 'SV4a', region: 'JP', source: null, provider_id: null }],
      cards: [],
      printings: [{
        id: 'pokemon-mew-ex-sv4a-347-jp',
        card_id: 'pokemon-mew-ex-jp',
        region: 'JP', language: 'ja', local_set_code: 'SV4a', local_card_number: '347/190',
        source: null, provider_id: null
      }]
    }
  });
  const manifest = plan(input, { seriesId: 'SV4a' });
  assert.equal(manifest.scope.seriesStatus, 'quarantined');
  assert.equal(manifest.records.length, 0);
  const setQuarantine = manifest.quarantined.find(row => row.entity === 'series');
  assert.ok(setQuarantine.reasons.includes('existing-jp-series-natural-key'));
  const card347 = manifest.quarantined.find(row => row.entity === 'card' && row.sourceProviderId === 'SV4a-347');
  assert.ok(card347.reasons.includes('existing-jp-series-natural-key'));
  assert.ok(card347.reasons.includes('existing-jp-printing-natural-key'));
  assert.ok(!card347.reasons.includes('card-provider-id-local-id-mismatch'));
  assert.deepEqual(manifest.seedNumberCollisions, [{ sourceProviderId: 'SV4a-347', localId: '347', count: 1 }]);
});

test('quarantines duplicate JP natural-key seeds and duplicate source card identities', () => {
  const duplicateSeries = snapshot({
    seriesId: 'sv8a',
    seedRows: {
      series: [
        { id: 'jp-series-1', game_id: 'pokemon', official_code: 'SV8a', region: 'JP' },
        { id: 'jp-series-2', game_id: 'pokemon', official_code: 'sv8a', region: 'JP' }
      ],
      cards: [], printings: []
    }
  });
  const seriesPlan = plan(duplicateSeries);
  assert.equal(seriesPlan.scope.seriesStatus, 'quarantined');
  assert.ok(seriesPlan.quarantined.find(row => row.entity === 'series').reasons.includes('duplicate-jp-series-seed'));

  const duplicateCards = snapshot({ cardRows: [
    { id: 'sv8a-001', localId: '001', name: 'カードA', set: { id: 'sv8a' } },
    { id: 'sv8a-001', localId: '001', name: 'カードB', set: { id: 'sv8a' } },
    { id: 'sv8a-003', localId: '003', name: 'カードC', set: { id: 'sv8a' } },
    { id: 'sv8a-3', localId: '3', name: 'カードD', set: { id: 'sv8a' } }
  ] });
  const cardPlan = plan(duplicateCards);
  assert.equal(cardPlan.records.filter(row => row.entity === 'card').length, 0);
  assert.ok(cardPlan.quarantined.filter(row => row.entity === 'card').every(row => row.reasons.includes('duplicate-source-local-id') || row.reasons.includes('duplicate-source-card-id')));
});

test('leaves unknown rarity blank and ignores TW/US seed rows without cross-locale matches', () => {
  const input = snapshot({
    cardRows: [{ id: 'sv8a-001', localId: '001', name: 'イーブイ', rarity: 'unverified rarity', set: { id: 'sv8a' } }],
    seedRows: {
      series: [
        { id: 'tw-series', game_id: 'pokemon', official_code: 'sv8a', region: 'TW' },
        { id: 'us-series', game_id: 'pokemon', official_code: 'sv8a', region: 'US' }
      ],
      cards: [
        { id: 'tw-card', source: 'tcgdex-tw', provider_id: 'sv8a-001' },
        { id: 'us-card', source: 'pokemon-tcg-api', provider_id: 'sv8a-001' },
        { id: pokemonJpTargetId('card', 'sv8a-001', 'sv8a'), source: 'tcgdex-tw', provider_id: 'sv8a-001' }
      ],
      printings: [
        { id: 'tw-printing', card_id: 'tw-card', region: 'TW', language: 'zh-Hant-TW', local_set_code: 'sv8a', local_card_number: '001/187', source: 'tcgdex-tw', provider_id: 'sv8a-001' },
        { id: 'us-printing', card_id: 'us-card', region: 'US', language: 'en-US', local_set_code: 'sv8a', local_card_number: '001/187', source: 'pokemon-tcg-api', provider_id: 'sv8a-001' }
      ]
    }
  });
  const manifest = plan(input);
  const printing = findRecord(manifest, 'printing', 'sv8a-001');
  assert.ok(printing);
  assert.equal(printing.metadata.rarity, null);
  assert.equal(manifest.seedNumberCollisions.length, 0);
  assert.ok(manifest.records.every(row => row.region === 'JP' && row.locale === 'ja-JP'));
  assert.equal(manifest.writesPerformed, false);
  assert.equal(manifest.databaseContacted, false);
});

test('CLI reads a supplied snapshot and emits only a dry-run manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pokemon-jp-manifest-'));
  const inputPath = join(directory, 'snapshot.json');
  try {
    await writeFile(inputPath, JSON.stringify(snapshot()), 'utf8');
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../scripts/plan-pokemon-jp-import.mjs', import.meta.url)),
      inputPath,
      '--series', 'sv8a',
      '--limit', '2'
    ], { cwd: fileURLToPath(root), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(result.stdout);
    assert.equal(manifest.dryRun, true);
    assert.equal(manifest.databaseContacted, false);
    assert.equal(manifest.sourceIdentity.source, 'tcgdex-ja');
    assert.equal(manifest.records.filter(row => row.entity === 'card').length, 2);
    assert.equal((await readFile(inputPath, 'utf8')).length > 0, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
