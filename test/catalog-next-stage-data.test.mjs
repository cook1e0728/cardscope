import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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
    assert.equal(report.chineseNames,1);
    assert.equal(report.metricStatus.chineseNames,'complete');
    assert.equal(report.coverage.chineseNames.covered,1);
    assert.equal(report.fields.chineseNames.covered,1);
    assert.equal(report.displayableImages,null);
    assert.equal(report.cardsWithImageUrls,null);
    assert.equal(report.coverage.images.covered,null);
    assert.equal(report.coverage.images.status,'unknown');
    assert.equal(report.fields.images.covered,null);
    assert.equal(report.fields.images.status,'unknown');
    assert.equal(report.coverage.missingImages.missing,null);
    assert.equal(report.fields.missingImages.missing,null);
    assert.equal(report.fields.missingImages.status,'unknown');
    assert.equal(report.linkAudit.missingImages.count,null);
    assert.equal(report.metricStatus.images,'unknown');
    if(status.printingStatus==='unknown'){
      assert.equal(report.rarities,null);
      assert.equal(report.coverage.rarity.covered,null);
      assert.equal(report.coverage.rarity.status,'unknown');
      assert.equal(report.coverage.printings.covered,null);
      assert.equal(report.coverage.printings.status,'unknown');
      assert.equal(report.coverage.versions.covered,null);
      assert.equal(report.coverage.versions.status,'unknown');
      assert.equal(report.metricStatus.rarities,'unknown');
      assert.equal(report.fields.rarity.status,'unknown');
      assert.equal(report.fields.rarity.covered,null);
      assert.equal(report.fields.printings.covered,null);
      assert.equal(report.fields.printings.status,'unknown');
      assert.equal(report.fields.versions.covered,null);
      assert.equal(report.fields.versions.status,'unknown');
      assert.equal(report.metricStatus.printings,'unknown');
      assert.equal(report.metricStatus.versions,'unknown');
      assert.equal(report.totalPrintings,null);
    }else{
      assert.equal(report.rarities,0,'an image-only failure must retain observed rarity coverage');
      assert.equal(report.metricStatus.rarities,'complete');
      assert.equal(report.coverage.rarity.covered,0);
      assert.equal(report.fields.rarity.covered,0);
    }
  }
});

test('verified zero and catalog-file sample image counts remain numeric',()=>{
  const cards=[{id:'card-1',game:'pokemon',nameZh:'測試卡'}];
  for(const status of [{cardStatus:'complete',printingStatus:'complete',imageStatus:'complete'},{cardStatus:'catalog-file',printingStatus:'catalog-file',imageStatus:'catalog-file'}]){
    const report=buildCoverageGame('pokemon',cards,[],[],status);
    assert.equal(report.displayableImages,0);
    assert.equal(report.coverage.images.covered,0);
    assert.equal(report.coverage.missingImages.missing,1);
    assert.equal(report.rarities,0);
    assert.equal(report.coverage.rarity.covered,0);
    assert.equal(report.fields.rarity.covered,0);
    assert.equal(report.metricStatus.rarities,status.printingStatus);
  }
});

test('aggregate coverage marks images unknown when printing lookup fails',async()=>{
  const mockDatabase=createServer((req,res)=>{
    const url=new URL(req.url,`http://${req.headers.host}`),reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body))};
    if(url.pathname==='/rest/v1/tcg_series'||url.pathname==='/rest/v1/card_images')return reply(200,[]);
    if(url.pathname==='/rest/v1/tcg_printings')return reply(500,{message:'printing lookup unavailable'});
    if(url.pathname==='/rest/v1/tcg_cards')return reply(200,url.searchParams.get('game_id')==='eq.pokemon'?[{id:'card-1',game:'pokemon',nameZh:'測試卡',rarity:'UR'}]:[]);
    return reply(200,[]);
  });
  await new Promise((resolve,reject)=>{mockDatabase.once('error',reject);mockDatabase.listen(0,'127.0.0.1',resolve)});
  const previousUrl=process.env.SUPABASE_URL,previousKey=process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_URL=`http://127.0.0.1:${mockDatabase.address().port}`;
  process.env.SUPABASE_SERVICE_KEY='test-key';
  try{
    const address=server.address(),response=await fetch(`http://127.0.0.1:${address.port}/api/catalog/coverage`),body=await response.json(),report=body.data,game=report.games.pokemon;
    assert.equal(response.status,200);
    assert.equal(report.totalCards,1);
    assert.equal(report.metricStatus.rarities,'unknown');
    assert.equal(report.metricStatus.printings,'unknown');
    assert.equal(report.metricStatus.versions,'unknown');
    assert.equal(report.metricStatus.images,'unknown');
    assert.equal(report.metricStatus.chineseNames,'complete');
    assert.equal(game.cards,1);
    assert.equal(game.chineseNames,1);
    assert.equal(game.metricStatus.chineseNames,'complete');
    assert.equal(game.fields.chineseNames.covered,1);
    assert.equal(game.metricStatus.rarities,'unknown');
    assert.equal(game.coverage.images.status,'unknown');
    assert.equal(game.fields.images.status,'unknown');
  }finally{
    if(previousUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=previousUrl;
    if(previousKey===undefined)delete process.env.SUPABASE_SERVICE_KEY;else process.env.SUPABASE_SERVICE_KEY=previousKey;
    await new Promise((resolve,reject)=>mockDatabase.close(error=>error?reject(error):resolve()));
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
