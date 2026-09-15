import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG_BASELINE_REGISTRY,
  CatalogBaselineError,
  aggregateCatalogBaselines,
  extractSeriesBaseline,
  validateCatalogBaselineRegistry
} from '../providers/catalog-baseline.mjs';

const games = ['pokemon', 'onepiece', 'yugioh', 'weiss-schwarz', 'haikyuu'];

function clone(value) {
  return structuredClone(value);
}

function providerSeries({ gameId = 'pokemon', region = 'US', seriesId, total = 10, sourceId = 'fixture-provider', sourceUrl = 'https://example.test/catalog', asOf = '2026-09-14', sourceStatus = 'approved-api', sourceConfidence = 'medium', field = 'printedTotal', language = 'en-US' } = {}) {
  return {
    gameId,
    region,
    id: seriesId,
    language,
    metadata: {
      [field]: total,
      sourceId,
      sourceUrl,
      asOf,
      sourceStatus,
      sourceConfidence
    }
  };
}

function approvedRegistry({ regions = ['US'], series = [], providerId = 'fixture-provider', language = 'en-US' } = {}) {
  const fixture = clone(CATALOG_BASELINE_REGISTRY);
  const pokemon = fixture.games.find(game => game.gameId === 'pokemon');
  const unknownSeriesBaseline = () => ({ kind: 'unknown', value: null, status: 'unknown', confidence: 'unverified', source: { id: null, url: null, asOf: null, status: 'unknown', confidence: 'unverified' } });
  pokemon.regions = pokemon.regions.filter(region => regions.includes(region.region));
  for (const region of pokemon.regions) region.series = series.map(seriesId => ({
    seriesId,
    providerId,
    language,
    approvedDynamic: true,
    baseline: unknownSeriesBaseline()
  }));
  return fixture;
}

test('registry includes all five IPs and keeps unverified denominators unknown/null', () => {
  assert.deepEqual(CATALOG_BASELINE_REGISTRY.games.map(game => game.gameId), games);
  for (const game of CATALOG_BASELINE_REGISTRY.games) {
    assert.equal(game.baseline.kind, 'unknown');
    assert.equal(game.baseline.value, null);
    for (const region of game.regions) {
      assert.equal(region.baseline.kind, 'unknown');
      assert.equal(region.baseline.value, null);
      assert.ok(Object.hasOwn(region.baseline.source, 'id'));
      assert.ok(Object.hasOwn(region.baseline.source, 'url'));
      assert.ok(Object.hasOwn(region.baseline.source, 'asOf'));
      assert.ok(Object.hasOwn(region.baseline.source, 'status'));
      assert.ok(Object.hasOwn(region.baseline.source, 'confidence'));
    }
  }
  const report = aggregateCatalogBaselines();
  assert.equal(report.summary.status, 'unknown');
  assert.equal(report.summary.knownGameCount, 0);
  for (const game of report.games) assert.equal(game.baseline.value, null, `${game.gameId} must not invent a denominator`);
});

test('traceable provider series totals aggregate within a region without claiming a whole-IP total', () => {
  const report = aggregateCatalogBaselines({
    registry: approvedRegistry({ series: ['sv1', 'sv2'] }),
    series: [
      providerSeries({ seriesId: 'sv1', total: 198 }),
      providerSeries({ seriesId: 'sv2', total: 100, field: 'total' })
    ]
  });
  const pokemon = report.games.find(game => game.gameId === 'pokemon');
  const us = pokemon.regions.find(region => region.region === 'US');
  assert.equal(us.baseline.kind, 'provider-total');
  assert.equal(us.baseline.value, 298);
  assert.equal(us.baseline.status, 'complete');
  assert.equal(pokemon.baseline.value, null, 'unknown regions must prevent a false whole-IP denominator');
  assert.equal(pokemon.baseline.status, 'partial');
  assert.equal(pokemon.baseline.knownTotal, 298);
});

test('provider-reported denominators may be used without inventing a URL/as-of', () => {
  const report = aggregateCatalogBaselines({
    registry: approvedRegistry({ series: ['svp-series'] }),
    series: [{
      gameId: 'pokemon',
      region: 'US',
      id: 'svp-series',
      source: 'fixture-provider',
      provider_id: 'provider-svp-series',
      language: 'en-US',
      metadata: { printedTotal: 30, denominatorKind: 'provider-total', sourceChecksum: 'sha256:fixture' }
    }]
  });
  const us = report.games.find(game => game.gameId === 'pokemon').regions.find(region => region.region === 'US');
  assert.equal(us.baseline.kind, 'provider-total');
  assert.equal(us.baseline.denominatorKind, 'provider-total');
  assert.equal(us.baseline.value, 30);
  assert.equal(us.baseline.evidenceStatus, 'provider-reported');
  assert.equal(us.baseline.providerSeriesId, 'provider-svp-series');
  assert.equal(us.baseline.source.sourceChecksum, 'sha256:fixture');
  assert.equal(us.baseline.source.url, null);
  assert.equal(us.baseline.source.asOf, null);
});

test('known anomalous provider series are quarantined and retain the reported value without becoming a denominator', () => {
  for (const seriesId of ['svp', 'sve', 'CS1.5', 'SV5K']) {
    const report = aggregateCatalogBaselines({
      series: [providerSeries({ seriesId, total: 40, sourceId: 'provider', sourceUrl: null, asOf: null })]
    });
    const us = report.games.find(game => game.gameId === 'pokemon').regions.find(region => region.region === 'US');
    assert.equal(us.baseline.kind, 'unknown', seriesId);
    assert.equal(us.baseline.value, null, seriesId);
    assert.equal(us.baseline.evidenceStatus, 'quarantined', seriesId);
    assert.equal(us.baseline.reportedValue, 40, seriesId);
    assert.match(us.baseline.quarantineReason, /隔離|quarantined/, seriesId);
  }
});

test('numeric metadata without complete source evidence stays unknown/null', () => {
  const report = aggregateCatalogBaselines({
    series: [providerSeries({ seriesId: 'unregistered', total: 99 })]
  });
  const us = report.games.find(game => game.gameId === 'pokemon').regions.find(region => region.region === 'US');
  assert.equal(us.baseline.kind, 'unknown');
  assert.equal(us.baseline.value, null);
  assert.equal(us.baseline.status, 'unknown');
  assert.equal(us.baseline.knownTotal, null);
  assert.equal(us.baseline.reportedValue, 99, 'unregistered provider metadata remains auditable as a candidate');
});

test('direct series extraction cannot bypass the registry approval gate', () => {
  const result=extractSeriesBaseline(providerSeries({seriesId:'unregistered-direct',total:99}));
  assert.equal(result.accepted,false);
  assert.equal(result.baseline.kind,'unknown');
  assert.equal(result.baseline.value,null);
  assert.equal(result.baseline.reportedValue,99);
});

test('duplicate provider scopes and conflicting values are rejected', () => {
  assert.throws(
    () => aggregateCatalogBaselines({ series: [providerSeries({ seriesId: 'sv1', total: 10 }), providerSeries({ seriesId: 'sv1', total: 11 })] }),
    error => error instanceof CatalogBaselineError && error.code === 'DUPLICATE_SERIES_SCOPE'
  );
  assert.throws(
    () => aggregateCatalogBaselines({ series: [
      { ...providerSeries({ seriesId: 'provider-row-1', total: 10 }), providerSeriesId: 'same-provider-series' },
      { ...providerSeries({ seriesId: 'provider-row-2', total: 11 }), providerSeriesId: 'same-provider-series' }
    ] }),
    error => error instanceof CatalogBaselineError && error.code === 'DUPLICATE_PROVIDER_SERIES_SCOPE'
  );
  const duplicateRegion = clone(CATALOG_BASELINE_REGISTRY);
  duplicateRegion.games[0].regions.push(clone(duplicateRegion.games[0].regions[0]));
  assert.throws(
    () => validateCatalogBaselineRegistry(duplicateRegion),
    error => error instanceof CatalogBaselineError && error.code === 'DUPLICATE_REGION_SCOPE'
  );
});

test('different series across regions are not summed into a whole-IP denominator', () => {
  const fixture = approvedRegistry({ regions: ['JP', 'US'], series: ['shared-jp', 'shared-us'] });
  const pokemon = fixture.games.find(game => game.gameId === 'pokemon');
  pokemon.regions.find(region => region.region === 'JP').series = pokemon.regions.find(region => region.region === 'JP').series.filter(series => series.seriesId === 'shared-jp');
  pokemon.regions.find(region => region.region === 'US').series = pokemon.regions.find(region => region.region === 'US').series.filter(series => series.seriesId === 'shared-us');
  const report = aggregateCatalogBaselines({
    registry: fixture,
    series: [
      providerSeries({ region: 'JP', seriesId: 'shared-jp', total: 20 }),
      providerSeries({ region: 'US', seriesId: 'shared-us', total: 30 })
    ]
  });
  const pokemonReport = report.games.find(game => game.gameId === 'pokemon');
  assert.equal(pokemonReport.baseline.value, null);
  assert.equal(pokemonReport.baseline.status, 'partial');
  assert.equal(pokemonReport.baseline.knownTotal, 50);
  assert.match(pokemonReport.limitations.join(' '), /IP 層不由地區或系列動態加總/);
});

test('provider and language scopes are never combined inside one region', () => {
  const fixture = approvedRegistry({ series: [] });
  const pokemon = fixture.games.find(game => game.gameId === 'pokemon');
  pokemon.regions[0].series = [
    { seriesId: 'provider-a-series', providerId: 'provider-a', language: 'en-us', approvedDynamic: true, baseline: { kind: 'unknown', value: null, status: 'unknown', confidence: 'unverified', source: { id: null, url: null, asOf: null, status: 'unknown', confidence: 'unverified' } } },
    { seriesId: 'provider-b-series', providerId: 'provider-b', language: 'ja-jp', approvedDynamic: true, baseline: { kind: 'unknown', value: null, status: 'unknown', confidence: 'unverified', source: { id: null, url: null, asOf: null, status: 'unknown', confidence: 'unverified' } } }
  ];
  const report = aggregateCatalogBaselines({
    registry: fixture,
    series: [
      providerSeries({ seriesId: 'provider-a-series', sourceId: 'provider-a', total: 10, language: 'en-US' }),
      providerSeries({ seriesId: 'provider-b-series', sourceId: 'provider-b', total: 20, language: 'ja-JP' })
    ]
  });
  const us = report.games.find(game => game.gameId === 'pokemon').regions.find(region => region.region === 'US');
  assert.equal(us.baseline.value, null);
  assert.equal(us.baseline.status, 'partial');
  assert.equal(us.baseline.knownTotal, 30);
  assert.match(us.limitations.join(' '), /provider\/language/);
});

test('numeric static parent and child baselines are rejected to prevent double counting', () => {
  const fixture = clone(CATALOG_BASELINE_REGISTRY);
  const pokemon = fixture.games.find(game => game.gameId === 'pokemon');
  const evidence = { id: 'fixture', url: 'https://example.test/baseline', asOf: '2026-09-14', status: 'verified', confidence: 'high' };
  pokemon.baseline = { kind: 'official-total', value: 100, status: 'complete', confidence: 'high', source: evidence };
  pokemon.regions[0].baseline = { kind: 'official-total', value: 100, status: 'complete', confidence: 'high', source: evidence };
  assert.throws(
    () => validateCatalogBaselineRegistry(fixture),
    error => error instanceof CatalogBaselineError && error.code === 'OVERLAPPING_NUMERIC_BASELINES'
  );
});
