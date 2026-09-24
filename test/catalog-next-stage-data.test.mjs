import test from 'node:test';
import assert from 'node:assert/strict';
import rankings from '../data/rarity-rankings.json' with { type: 'json' };
import { auditCatalogLinks } from '../providers/catalog-sync.mjs';
import { normalizeRarityRecord, rarityCanonicalCode, rarityDisplayLabel } from '../providers/normalize.mjs';

process.env.PORT = '0';
process.env.CATALOG_SYNC_ON_START = 'false';
const { buildCoverageGame, coverageMetric, server } = await import('../server.mjs?catalog-next-stage-data');
test.after(async () => {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

const games = ['pokemon', 'onepiece', 'yugioh', 'weiss-schwarz', 'haikyuu'];
const token = value => String(value ?? '').normalize('NFKC').toLocaleUpperCase().replace(/[\s・·._:：'’"\-]/g, '').replace(/[^\p{L}\p{N}+]/gu, '');

test('all five IP rarity definitions expose reversible high/low groups', () => {
  for (const game of games) {
    const definition = rankings.systems[game];
    assert.ok(definition, `${game} rarity definition is missing`);
    assert.equal(definition.highToLow.length, definition.lowToHigh.length, `${game} direction lengths differ`);
    assert.deepEqual(
      definition.lowToHigh.map(group => token(group[0])),
      [...definition.highToLow].reverse().map(group => token(group[0])),
      `${game} low-to-high is not the reverse of high-to-low`
    );
    assert.equal(new Set(definition.canonicalCodes.map(token)).size, definition.canonicalCodes.length, `${game} has duplicate canonical codes`);
  }
});

test('rarity aliases stay scoped to their own IP and retain source evidence', () => {
  assert.equal(rarityCanonicalCode('onepiece', 'SP CARD'), 'SP');
  assert.equal(rarityCanonicalCode('onepiece', 'SP卡'), 'SP');
  assert.equal(rarityDisplayLabel('onepiece', 'Special Card'), 'SP 卡');
  assert.notEqual(rarityCanonicalCode('pokemon', 'Amazing Rare'), 'CHR');
  assert.notEqual(rarityCanonicalCode('yugioh', 'Short Print'), 'Common');
  const record = normalizeRarityRecord({ gameId: 'onepiece', rawRarity: 'SP卡', source: 'fixture', metadata: { providerId: 'op-1' } });
  assert.equal(record.rarity_code, 'SP');
  assert.equal(record.rarity_label, 'SP 卡');
  assert.equal(record.metadata.rawRarity, 'SP卡');
  assert.equal(record.metadata.normalizedRarityCode, 'SP');
  assert.equal(record.metadata.providerId, 'op-1');
});

test('catalog link coverage identifies missing names/images and orphan references without merging IPs', () => {
  const report = auditCatalogLinks({
    cards: [
      { id: 'pokemon-shared', game_id: 'pokemon', provider_id: 'shared', official_card_number: 'PK-1', name_zh: null },
      { id: 'yugioh-shared', game_id: 'yugioh', provider_id: 'shared', official_card_number: 'YG-1', name_zh: '黑魔導女孩', image_url: 'https://example.invalid/ygo.jpg' }
    ],
    printings: [
      { card_id: 'pokemon-shared', image_url: null },
      { card_id: 'missing-card', image_url: 'https://example.invalid/orphan.jpg' }
    ],
    images: [
      { card_id: 'yugioh-shared', image_url: 'https://example.invalid/ygo.jpg' },
      { card_id: 'missing-card', image_url: 'https://example.invalid/orphan.jpg' }
    ]
  });
  assert.equal(report.stableIdentityCards, 2);
  assert.equal(report.missingImages.count, 1);
  assert.deepEqual(report.missingImages.sampleIds, ['pokemon-shared']);
  assert.equal(report.missingChineseNames.count, 1);
  assert.deepEqual(report.missingChineseNames.sampleIds, ['pokemon-shared']);
  assert.equal(report.orphanPrintings, 1);
  assert.equal(report.orphanImages, 1);
  assert.equal(report.duplicateProviderKeys.length, 0, 'same provider id must remain scoped by game');
  assert.equal(report.complete, false);
});

test('coverage does not report a percentage when the denominator is zero or unknown', () => {
  assert.equal(coverageMetric(0, 0).percent, null);
  assert.equal(coverageMetric(0, null).percent, null);
  assert.equal(coverageMetric(null, 4).covered, null);
  assert.equal(coverageMetric(0, null).denominator, null);
  assert.equal(coverageMetric(2, 4).percent, 50);
});

test('failed image or printing relations are unknown, not zero coverage or a full gap',()=>{
  const cards=[{id:'card-1',game:'pokemon',nameZh:'測試卡'}];
  for(const status of [{printingStatus:'unknown',imageStatus:'complete'},{printingStatus:'complete',imageStatus:'unknown'},{printingStatus:'unknown',imageStatus:'unknown'}]){
    const report=buildCoverageGame('pokemon',cards,[],[],status);
    assert.equal(report.cards,1);
    assert.equal(report.displayableImages,null);
    assert.equal(report.cardsWithImageUrls,null);
    assert.equal(report.coverage.images.covered,null);
    assert.equal(report.coverage.images.status,'unknown');
    assert.equal(report.coverage.missingImages.missing,null);
    assert.equal(report.linkAudit.missingImages.count,null);
    assert.equal(report.metricStatus.images,'unknown');
  }
});

test('verified zero and catalog-file sample image counts remain numeric',()=>{
  const cards=[{id:'card-1',game:'pokemon',nameZh:'測試卡'}];
  for(const status of [{printingStatus:'complete',imageStatus:'complete'},{printingStatus:'catalog-file',imageStatus:'catalog-file'}]){
    const report=buildCoverageGame('pokemon',cards,[],[],status);
    assert.equal(report.displayableImages,0);
    assert.equal(report.coverage.images.covered,0);
    assert.equal(report.coverage.missingImages.missing,1);
  }
});

test('read-only reports fallback stays quiet when Supabase is unavailable', async () => {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/reports?cardId=pokemon-test`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.data, { reports: [], stats: [], total: 0 });
  assert.equal(body.meta.status, 'unavailable');
});
