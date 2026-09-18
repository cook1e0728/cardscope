import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeriesGapManifest,
  GAP_STATUSES,
  manifestChecksum
} from '../providers/series-gap-manifest.mjs';

const baseSeries = (id, overrides = {}) => ({
  id,
  game: 'pokemon',
  region: 'TW',
  officialCode: id.toUpperCase(),
  nameZh: id,
  ...overrides
});

const card = (id, seriesId, overrides = {}) => ({
  id,
  seriesId,
  name_zh: '卡片',
  rarity: 'C',
  image_url: null,
  ...overrides
});

test('classifies uncollected, missing fields, not-published, and update-failed series', () => {
  const manifest = buildSeriesGapManifest({
    asOf: '2026-09-16T00:00:00Z',
    requiredFields: ['name_zh', 'rarity', 'image_url'],
    series: [
      baseSeries('empty', { officialCode: 'EMPTY' }),
      baseSeries('partial', { officialCode: 'PARTIAL' }),
      baseSeries('future', { officialCode: 'FUTURE', releaseDate: '2026-10-01' }),
      baseSeries('failed', { officialCode: 'FAILED' })
    ],
    cards: [
      card('partial-card', 'partial', { name_zh: null, rarity: 'C' }),
      card('failed-card', 'failed')
    ],
    printings: [{ id: 'partial-printing', card_id: 'partial-card', seriesId: 'partial', image_url: null }],
    updates: [{ seriesId: 'failed', game: 'pokemon', region: 'TW', status: 'failed', error: 'timeout' }]
  });

  const rows = new Map(manifest.rows.map(row => [row.seriesId, row]));
  assert.equal(rows.get('empty').status, GAP_STATUSES.UNCOLLECTED);
  assert.equal(rows.get('partial').status, GAP_STATUSES.MISSING_FIELDS);
  assert.deepEqual(rows.get('partial').gaps.missingFields, ['name_zh', 'image_url']);
  assert.equal(rows.get('future').status, GAP_STATUSES.NOT_PUBLISHED);
  assert.equal(rows.get('failed').status, GAP_STATUSES.UPDATE_FAILED);
  assert.equal(rows.get('failed').update.error, 'timeout');
  assert.deepEqual(manifest.summary.byStatus, {
    complete: 0,
    uncollected: 1,
    'missing-fields': 1,
    'not-published': 1,
    'update-failed': 1
  });
});

test('keeps unknown denominators null and counts known denominator gaps only when explicitly supplied', () => {
  const manifest = buildSeriesGapManifest({
    asOf: '2026-09-16T00:00:00Z',
    series: [
      baseSeries('unknown', { officialCode: 'UNKNOWN' }),
      baseSeries('known', {
        officialCode: 'KNOWN',
        baseline: { kind: 'provider-total', value: 3, status: 'provider-reported', confidence: 'medium' }
      })
    ],
    cards: [card('unknown-card', 'unknown'), card('known-card', 'known')],
    printings: []
  });
  const unknown = manifest.rows.find(row => row.seriesId === 'unknown');
  const known = manifest.rows.find(row => row.seriesId === 'known');
  assert.equal(unknown.denominator.value, null);
  assert.equal(unknown.denominator.kind, 'unknown');
  assert.equal(unknown.denominator.missingRecords, null);
  assert.equal(unknown.denominator.coverage, null);
  assert.equal(known.denominator.value, 3);
  assert.equal(known.denominator.missingRecords, 2);
  assert.equal(known.denominator.coverage, 1 / 3);
  assert.equal(manifest.summary.unknownDenominatorSeries, 1);
  assert.equal(manifest.summary.unknownMissingRecords, 1);
});

test('uses exact series IDs/codes, preserves printing image coverage, and is deterministic', () => {
  const input = {
    asOf: '2026-09-16T00:00:00Z',
    series: [baseSeries('s1', { officialCode: 'S1' })],
    cards: [card('c1', null, { officialCode: 'S1', image_url: null })],
    printings: [
      { id: 'p-missing', card_id: 'c1', officialCode: 'S1', image_url: null },
      { id: 'p-image', card_id: 'c1', officialCode: 'S1', image_url: 'https://example.test/card.webp' }
    ]
  };
  const first = buildSeriesGapManifest(input);
  const second = buildSeriesGapManifest({ ...input, cards: [...input.cards].reverse(), printings: [...input.printings].reverse() });
  assert.equal(first.checksum, second.checksum);
  assert.equal(manifestChecksum(first), first.checksum);
  assert.equal(first.rows[0].observed.fields.image_url.missing, 0);
  assert.equal(first.rows[0].status, GAP_STATUSES.COMPLETE);
});
