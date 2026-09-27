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

test('coverage relation queries cap long-ID URLs, preserve fallback filters, and paginate every printing',async()=>{
  const ids=Array.from({length:500},(_,index)=>`card-${String(index).padStart(3,'0')}-${'long-card-id-segment'.repeat(2)}`),requests=[];
  let activePrintingRequests=0,maxConcurrentPrintingRequests=0;
  const parseIds=value=>[...String(value||'').matchAll(/"([^"]+)"/g)].map(([,id])=>id),
    mockDatabase=createServer((req,res)=>{
      const url=new URL(req.url,`http://${req.headers.host}`),reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body))};
      if(url.pathname==='/rest/v1/tcg_series'||url.pathname==='/rest/v1/card_images')return reply(200,[]);
      if(url.pathname==='/rest/v1/tcg_cards')return reply(200,url.searchParams.get('game_id')==='eq.pokemon'?ids.map(id=>({id,game:'pokemon',nameZh:'測試卡'})):[]);
      if(url.pathname==='/rest/v1/tcg_printings'){
        const select=url.searchParams.get('select'),cardIds=parseIds(url.searchParams.get('card_id'));
        requests.push({path:req.url,select,cardIds,offset:Number(url.searchParams.get('offset')||0)});
        activePrintingRequests++;maxConcurrentPrintingRequests=Math.max(maxConcurrentPrintingRequests,activePrintingRequests);
        setTimeout(()=>{
          activePrintingRequests--;
          if(select.includes('rarityCode'))return reply(400,{message:'printing schema requires legacy-select fallback'});
          const rows=cardIds.flatMap(cardId=>Array.from({length:11},(_,index)=>({id:`${cardId}-printing-${index}`,cardId,seriesId:'test-series',region:'JP',language:'ja-JP',rarity:'R'}))),limit=Number(url.searchParams.get('limit')||1000);
          return reply(200,rows.slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+limit));
        },10);
        return;
      }
      return reply(200,[]);
    });
  await new Promise((resolve,reject)=>{mockDatabase.once('error',reject);mockDatabase.listen(0,'127.0.0.1',resolve)});
  const envKeys=['PORT','CATALOG_SYNC_ON_START','CATALOG_RELATION_BATCH_SIZE','SUPABASE_URL','SUPABASE_SERVICE_KEY'],previousEnv=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  let coverageServer;
  try{
    process.env.PORT='0';process.env.CATALOG_SYNC_ON_START='false';process.env.CATALOG_RELATION_BATCH_SIZE='500';
    process.env.SUPABASE_URL=`http://127.0.0.1:${mockDatabase.address().port}`;process.env.SUPABASE_SERVICE_KEY='test-key';
    ({server:coverageServer}=await import('../server.mjs?coverage-relation-url-bounded'));
    if(!coverageServer.listening)await new Promise(resolve=>coverageServer.once('listening',resolve));
    const address=coverageServer.address(),response=await fetch(`http://127.0.0.1:${address.port}/api/catalog/coverage`),body=await response.json(),report=body.data,gamesReport=report.games.pokemon;
    assert.equal(response.status,200);
    assert.equal(gamesReport.cards,500);
    assert.equal(gamesReport.totalPrintings,5500,'coverage must include every row across the per-request response cap');
    assert.equal(gamesReport.metricStatus.printings,'complete');
    assert.equal(gamesReport.coverage.printings.covered,500);
    assert.equal(report.errors.printings,null);

    const fullSelectRequests=requests.filter(request=>request.select.includes('rarityCode')),
      fallbackRequests=requests.filter(request=>!request.select.includes('rarityCode')),
      fallbackBatches=[...new Map(fallbackRequests.map(request=>[request.cardIds.join(','),request.cardIds])).values()],
      fullBatches=fullSelectRequests.map(request=>request.cardIds);
    assert.equal(fullBatches.length,5,'500 card IDs should use at most 100 per initial query');
    assert.equal(fallbackBatches.length,5,'legacy fallback should retry each bounded card batch');
    assert.ok(fallbackRequests.length>fallbackBatches.length,'fallback must paginate batches whose rows exceed the per-page cap');
    assert.deepEqual(fullBatches.map(batch=>[...batch].sort()).sort((a,b)=>a[0].localeCompare(b[0])),fallbackBatches.map(batch=>[...batch].sort()).sort((a,b)=>a[0].localeCompare(b[0])),'fallback must use the exact same card IDs as its primary query');
    assert.deepEqual([...fullBatches.flat()].sort(),[...ids].sort());
    assert.ok([...fullBatches,...fallbackRequests.map(request=>request.cardIds)].every(batch=>batch.length<=100));
    assert.ok(requests.every(request=>Buffer.byteLength(`${process.env.SUPABASE_URL}${request.path}`,'utf8')<=8*1024),'all primary and fallback URLs must stay within 8 KiB');
    assert.ok(maxConcurrentPrintingRequests>1,'relation batches should use bounded parallel requests');
    assert.ok(maxConcurrentPrintingRequests<=4,'relation request concurrency must remain bounded');
  }finally{
    for(const key of envKeys){if(previousEnv[key]===undefined)delete process.env[key];else process.env[key]=previousEnv[key]}
    if(coverageServer?.listening)await new Promise((resolve,reject)=>coverageServer.close(error=>error?reject(error):resolve()));
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
