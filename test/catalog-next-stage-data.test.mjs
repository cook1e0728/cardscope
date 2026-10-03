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

// fetch refuses the Fetch standard's "bad ports" (6000, 6665-6669, 10080, ...), which the OS may hand out.
const FETCH_BAD_PORTS=new Set([1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080]);
async function listenOnUsablePort(httpServer){
  for(;;){
    await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(0,'127.0.0.1',resolve)});
    const {port}=httpServer.address();if(!FETCH_BAD_PORTS.has(port))return port;
    await new Promise((resolve,reject)=>httpServer.close(error=>error?reject(error):resolve()));
  }
}
async function withCoverageDatabase(name,handleDatabaseRequest,run){
  const mockDatabase=createServer(handleDatabaseRequest);
  await listenOnUsablePort(mockDatabase);
  const envKeys=['PORT','CATALOG_SYNC_ON_START','SUPABASE_URL','SUPABASE_SERVICE_KEY'],previousEnv=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  let coverageServer;
  try{
    const probe=createServer();process.env.PORT=String(await listenOnUsablePort(probe));await new Promise(resolve=>probe.close(resolve));process.env.CATALOG_SYNC_ON_START='false';process.env.SUPABASE_URL=`http://127.0.0.1:${mockDatabase.address().port}`;process.env.SUPABASE_SERVICE_KEY='test-key';
    ({server:coverageServer}=await import(`../server.mjs?coverage-${name}`));
    if(!coverageServer.listening)await new Promise(resolve=>coverageServer.once('listening',resolve));
    return await run(`http://127.0.0.1:${coverageServer.address().port}`);
  }finally{
    for(const key of envKeys){if(previousEnv[key]===undefined)delete process.env[key];else process.env[key]=previousEnv[key]}
    if(coverageServer?.listening)await new Promise((resolve,reject)=>coverageServer.close(error=>error?reject(error):resolve()));
    await new Promise((resolve,reject)=>mockDatabase.close(error=>error?reject(error):resolve()));
  }
}

function coverageFixture(){
  const cards=Array.from({length:500},(_,index)=>({id:`card-${String(index).padStart(3,'0')}`,game:'pokemon',nameZh:'測試卡',rarity:'UR'})),printings=[],images=[];
  for(const card of cards){
    for(let index=0;index<3;index++)printings.push({id:printings.length+1,cardId:card.id,seriesId:'test-series',region:'JP',language:'ja-JP',localCardNumber:String(printings.length+1),rarity:'R'});
    for(let index=0;index<2;index++)images.push({id:images.length+1,cardId:card.id,language:'en',source:'ygoprodeck',imageUrl:`https://example.test/${images.length+1}.jpg`,sourceUrl:'https://example.test/source',isPrimary:index===0,fetchedAt:'2026-09-01T00:00:00.000Z'});
  }
  printings.push({id:printings.length+1,cardId:'orphan-printing-card',seriesId:'orphan-series',region:'JP',language:'ja-JP',rarity:'R'});
  images.push({id:images.length+1,cardId:'orphan-image-card',language:'en',source:'ygoprodeck',imageUrl:'https://example.test/orphan.jpg',sourceUrl:'https://example.test/source',isPrimary:false,fetchedAt:'2026-09-01T00:00:00.000Z'});
  return {cards,printings,images};
}

function coverageDatabaseHandler({cards,printings,images,requests=[],mode=null}){
  const relationRows={tcg_printings:printings,card_images:images};
  return (req,res)=>{
    const url=new URL(req.url,`http://${req.headers.host}`),reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body))};
    if(url.pathname==='/rest/v1/tcg_series')return reply(200,[]);
    if(url.pathname==='/rest/v1/tcg_cards'){
      if(url.searchParams.get('game_id')!=='eq.pokemon')return reply(200,[]);
      const limit=Number(url.searchParams.get('limit')||1000),offset=Number(url.searchParams.get('offset')||0);
      return reply(200,cards.slice(offset,offset+limit));
    }
    if(Object.hasOwn(relationRows,url.pathname.split('/').at(-1))){
      const table=url.pathname.split('/').at(-1),select=url.searchParams.get('select')||'',cursor=url.searchParams.get('id'),rows=relationRows[table],isPrimary=table==='tcg_printings'?select.includes('rarityCode'):select.includes('imageRightsStatus');
      requests.push({table,select,cursor,cardIdFilter:url.searchParams.get('card_id'),order:url.searchParams.get('order'),limit:Number(url.searchParams.get('limit')||1000)});
      if(mode==='legacy-fallback'&&isPrimary)return reply(400,{message:'primary select requires the legacy fallback'});
      if(mode==='later-page-failure'&&table==='tcg_printings'&&cursor)return reply(500,{message:'printing page failed'});
      if(mode==='malformed-page'&&table==='tcg_printings'&&cursor)return reply(200,{rows:[]});
      if(mode==='repeated-page'&&table==='tcg_printings'&&cursor)return reply(200,rows.slice(0,1000));
      const after=cursor?Number(cursor.replace(/^gt\./,'')):null,limit=Math.min(Number(url.searchParams.get('limit')||1000),mode==='short-pages'?500:1000),ordered=rows.slice().sort((a,b)=>a.id-b.id),page=ordered.filter(row=>after===null||row.id>after).slice(0,limit);
      return reply(200,table==='card_images'&&!select.includes('imageRightsStatus')?page.map(({imageRightsStatus,...row})=>row):page);
    }
    return reply(200,[]);
  };
}

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

test('displayable image gap uses the same policy-aware card set as its numerator',()=>{
  const cards=[
    {id:'allowed',game:'yugioh',imageUrl:'https://example.invalid/allowed.jpg',imageSource:'ygoprodeck',imageRightsStatus:'not-provided'},
    {id:'blocked',game:'yugioh',imageUrl:'https://example.invalid/blocked.jpg',imageSource:'unregistered-source',imageRightsStatus:'not-provided'}
  ];
  const report=buildCoverageGame('yugioh',cards,[],[]);
  assert.equal(report.cardsWithImageUrls,2);
  assert.equal(report.coverage.images.covered,1);
  assert.equal(report.coverage.missingImages.covered,1);
  assert.equal(report.coverage.missingImages.missing,1);
  assert.deepEqual(report.coverage.missingImages.sampleIds,['blocked']);
  assert.equal(report.coverage.images.covered+report.coverage.missingImages.missing,report.cards);
  assert.equal(report.linkAudit.missingImages.count,0,'raw URL audit remains a distinct diagnostic');
});

test('aggregate coverage marks images unknown when printing lookup fails',async()=>{
  const mockDatabase=createServer((req,res)=>{
    const url=new URL(req.url,`http://${req.headers.host}`),reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body))};
    if(url.pathname==='/rest/v1/tcg_series'||url.pathname==='/rest/v1/card_images')return reply(200,[]);
    if(url.pathname==='/rest/v1/tcg_printings')return reply(500,{message:'printing lookup unavailable'});
    if(url.pathname==='/rest/v1/tcg_cards')return reply(200,url.searchParams.get('game_id')==='eq.pokemon'?[{id:'card-1',game:'pokemon',nameZh:'測試卡',rarity:'UR'}]:[]);
    return reply(200,[]);
  });
  await listenOnUsablePort(mockDatabase);
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

test('global coverage scans complete keyset pages, filters orphan relations, and preserves legacy image rights',async()=>{
  const fixture=coverageFixture(),reports=[],relationRequestCounts=[];
  for(const mode of ['primary','legacy-fallback','short-pages']){
    const requests=[];
    await withCoverageDatabase(`global-scan-${mode}`,coverageDatabaseHandler({...fixture,requests,mode}),async baseUrl=>{
      const response=await fetch(`${baseUrl}/api/catalog/coverage`),body=await response.json();
      assert.equal(response.status,200);
      assert.equal(body.data.complete,true);
      assert.equal(body.data.games.pokemon.cards,500);
      assert.equal(body.data.games.pokemon.totalPrintings,1500,'orphan printing rows must not enter observed-card totals');
      assert.equal(body.data.games.pokemon.totalImages,1000,'orphan image rows must not enter observed-card totals');
      assert.equal(body.data.games.pokemon.metricStatus.printings,'complete');
      assert.equal(body.data.games.pokemon.metricStatus.images,'complete');
      assert.equal(body.data.games.pokemon.linkAudit.orphanPrintings,0);
      assert.equal(body.data.games.pokemon.linkAudit.orphanImages,0);
      assert.equal(body.data.games.pokemon.imageHealth.policyEligibleUrlRecords,1000,'not-provided provenance remains eligible for this risk-accepted source');
      assert.equal(body.data.errors.printings,null);
      assert.equal(body.data.errors.images,null);
      reports.push(body.data.games.pokemon);
    });
    const relationRequests=requests.filter(request=>request.table==='tcg_printings'||request.table==='card_images');
    relationRequestCounts.push(relationRequests.length);
    assert.ok(relationRequests.every(request=>request.cardIdFilter===null),'global scans must not send per-card ID filters');
    assert.ok(relationRequests.every(request=>request.order==='id.asc'),'global scans must use a stable unique order');
    assert.ok(relationRequests.every(request=>request.limit===1000),'each bounded global page must use the configured response cap');
    for(const table of ['tcg_printings','card_images']){
      const tableRequests=relationRequests.filter(request=>request.table===table),primary=tableRequests.filter(request=>table==='tcg_printings'?request.select.includes('rarityCode'):request.select.includes('imageRightsStatus'));
      assert.equal(tableRequests[0].cursor,null,'the first page must start at the beginning');
      const pageSize=mode==='short-pages'?500:1000,rows=table==='tcg_printings'?fixture.printings:fixture.images,expectedCursors=[null];
      for(let offset=pageSize;offset<rows.length;offset+=pageSize)expectedCursors.push(`gt.${offset}`);
      expectedCursors.push(`gt.${rows.at(-1).id}`);
      if(mode==='legacy-fallback'){
        const fallback=tableRequests.filter(request=>!primary.includes(request));
        assert.equal(primary.length,1,'legacy select fallback starts only after the primary select fails');
        assert.deepEqual(fallback.map(request=>request.cursor),expectedCursors,'legacy select fallback must scan through an empty terminal page');
      }else{
        assert.deepEqual(primary.map(request=>request.cursor),expectedCursors,'global scans must continue after short pages and stop only at an empty page');
      }
      assert.ok(tableRequests.some(request=>request.cursor===`gt.${pageSize}`),'the second page must advance from the last unique ID');
    }
    assert.ok(relationRequests.length<Math.ceil(fixture.cards.length/100)*2,'full coverage scans must reduce requests below the former 100-ID fanout');
  }
  assert.deepEqual(reports[0].coverage,reports[1].coverage,'primary and legacy projections should preserve coverage semantics');
  assert.deepEqual(reports[0].imageHealth,reports[1].imageHealth,'legacy image rights mapping should preserve the same policy provenance');
  assert.deepEqual(relationRequestCounts,[6,8,9]);
});

test('catalog coverage starts relation scans before blocked card queries resolve',async()=>{
  const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail});return {promise,resolve,reject}},
    releaseCards=deferred(),allCardRequestsStarted=deferred(),seriesRequestStarted=deferred(),relationsStarted=deferred(),cardGamesStarted=new Set(),relationTablesStarted=new Set(),
    cardRows=[{id:'coverage-overlap-pokemon-card',game:'pokemon',nameZh:'測試卡',rarity:'UR'}];
  let cardResponsesSent=0;
  const handleDatabaseRequest=async(req,res)=>{
    const url=new URL(req.url,`http://${req.headers.host}`),reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body))};
    if(url.pathname==='/rest/v1/tcg_series'){seriesRequestStarted.resolve();return reply(200,[])}
    if(url.pathname==='/rest/v1/tcg_cards'){
      const gameId=(url.searchParams.get('game_id')||'').replace(/^eq\./,'');
      cardGamesStarted.add(gameId);
      if(cardGamesStarted.size===games.length)allCardRequestsStarted.resolve();
      await releaseCards.promise;
      cardResponsesSent++;
      return reply(200,gameId==='pokemon'?cardRows:[]);
    }
    const table=url.pathname.split('/').at(-1);
    if(table==='tcg_printings'||table==='card_images'){
      relationTablesStarted.add(table);
      if(relationTablesStarted.size===2)relationsStarted.resolve();
      return reply(200,[]);
    }
    return reply(200,[]);
  };

  await withCoverageDatabase('coverage-relation-overlap',handleDatabaseRequest,async baseUrl=>{
    const responsePromise=fetch(`${baseUrl}/api/catalog/coverage`);
    // This only prevents a regression from leaving the deferred card barrier hung; ordering is asserted by request events below.
    const deadlockGuard=setTimeout(()=>relationsStarted.reject(new Error('relation scans did not start while card requests were blocked')),5000);
    try{
      await Promise.all([allCardRequestsStarted.promise,seriesRequestStarted.promise,relationsStarted.promise]);
      assert.deepEqual([...cardGamesStarted].sort(),[...games].sort(),'all five card tasks must have started');
      assert.deepEqual([...relationTablesStarted].sort(),['card_images','tcg_printings']);
      assert.equal(cardResponsesSent,0,'relation calls must begin while every card response is still blocked');
    }finally{clearTimeout(deadlockGuard);releaseCards.resolve()}
    const response=await responsePromise,body=await response.json();
    assert.equal(response.status,200);
    assert.equal(body.data.complete,true);
    assert.equal(body.data.totalCards,1);
    assert.equal(body.data.errors.printings,null);
    assert.equal(body.data.errors.images,null);
  });
});

test('global coverage marks failed, malformed, and repeated later relation pages unknown',async t=>{
  for(const mode of ['later-page-failure','malformed-page','repeated-page'])await t.test(mode,async()=>{
    const fixture=coverageFixture(),requests=[];
    await withCoverageDatabase(`global-scan-${mode}`,coverageDatabaseHandler({...fixture,requests,mode}),async baseUrl=>{
      const response=await fetch(`${baseUrl}/api/catalog/coverage`),body=await response.json(),report=body.data,game=report.games.pokemon;
      assert.equal(response.status,200);
      assert.equal(game.cards,500);
      assert.equal(report.complete,false);
      assert.equal(report.metricStatus.printings,'unknown');
      assert.equal(game.metricStatus.printings,'unknown');
      assert.equal(game.totalPrintings,null,'rows from earlier pages must not appear as a complete total');
      assert.equal(game.coverage.printings.covered,null);
      assert.equal(game.coverage.printings.status,'unknown');
      assert.ok(report.errors.printings);
      assert.ok(requests.some(request=>request.table==='tcg_printings'&&request.cursor==='gt.1000'));
    });
  });
});

test('ordinary browse bounds long-ID relation URLs and concurrency while paginating legacy printings',async()=>{
  const ids=Array.from({length:500},(_,index)=>`card-${String(index).padStart(3,'0')}-${'long-card-id-segment'.repeat(4)}`),
    cards=ids.map((id,index)=>({id,game:'pokemon',officialCardNumber:String(index+1),nameZh:'測試卡'})),
    printings=ids.flatMap((cardId,index)=>Array.from({length:71},(_,printingIndex)=>({id:index*71+printingIndex+1,cardId,seriesId:'test-series',region:'JP',language:'ja-JP',localCardNumber:String(printingIndex+1),rarity:'R'}))),
    images=ids.map((cardId,index)=>({id:index+1,cardId,language:'en',source:'ygoprodeck',imageUrl:`https://example.test/${index+1}.jpg`,sourceUrl:'https://example.test/source',isPrimary:true,fetchedAt:'2026-09-01T00:00:00.000Z'})),
    relationRows={tcg_printings:printings,card_images:images},requests=[],activeByTable={tcg_printings:0,card_images:0},maxConcurrentByTable={tcg_printings:0,card_images:0};
  const parseCardIds=value=>[...String(value||'').matchAll(/"([^"]+)"/g)].map(([,id])=>id),
    handleDatabaseRequest=(req,res)=>{
      const url=new URL(req.url,`http://${req.headers.host}`),reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body))};
      if(url.pathname==='/rest/v1/tcg_cards'){
        const limit=Number(url.searchParams.get('limit')||1000),offset=Number(url.searchParams.get('offset')||0);
        return reply(200,cards.slice(offset,offset+limit));
      }
      const table=url.pathname.split('/').at(-1);
      if(!Object.hasOwn(relationRows,table))return reply(200,[]);
      const select=url.searchParams.get('select')||'',cardIds=parseCardIds(url.searchParams.get('card_id')),offset=Number(url.searchParams.get('offset')||0),isPrimary=table==='tcg_printings'?select.includes('rarityCode'):select.includes('imageRightsStatus');
      requests.push({table,select,cardIds,offset,urlBytes:Buffer.byteLength(`${process.env.SUPABASE_URL}${req.url}`,'utf8')});
      activeByTable[table]++;maxConcurrentByTable[table]=Math.max(maxConcurrentByTable[table],activeByTable[table]);
      setTimeout(()=>{
        activeByTable[table]--;
        if(isPrimary)return reply(400,{message:'force the bounded legacy-select path'});
        const selectedIds=new Set(cardIds),rows=relationRows[table].filter(row=>selectedIds.has(row.cardId)).sort((a,b)=>a.id-b.id);
        return reply(200,rows.slice(offset,offset+1000));
      },5);
    },previousBatchSize=process.env.CATALOG_RELATION_BATCH_SIZE;
  process.env.CATALOG_RELATION_BATCH_SIZE='100';
  try{
    await withCoverageDatabase('bounded-id-browse',handleDatabaseRequest,async baseUrl=>{
      const response=await fetch(`${baseUrl}/api/cards?game=pokemon&region=JP&limit=60`),body=await response.json();
      assert.equal(response.status,200);
      assert.equal(body.meta.total,500);
      assert.equal(body.data.length,60);
      assert.equal(body.data[0].printings.length,71,'legacy offset pages must be combined for the real browse response');
    });
  }finally{
    if(previousBatchSize===undefined)delete process.env.CATALOG_RELATION_BATCH_SIZE;else process.env.CATALOG_RELATION_BATCH_SIZE=previousBatchSize;
  }

  const relationRequests=requests.filter(request=>Object.hasOwn(relationRows,request.table));
  assert.ok(relationRequests.length>0);
  assert.ok(relationRequests.every(request=>request.cardIds.length>0&&request.cardIds.length<=100),'each ordinary browse relation request must stay within the 100-ID cap');
  assert.ok(relationRequests.every(request=>request.urlBytes<=8*1024),'encoded primary and legacy URLs must stay within 8 KiB');
  for(const table of ['tcg_printings','card_images']){
    const tableRequests=relationRequests.filter(request=>request.table===table),primary=tableRequests.filter(request=>table==='tcg_printings'?request.select.includes('rarityCode'):request.select.includes('imageRightsStatus')),
      legacyFirstPages=tableRequests.filter(request=>!primary.includes(request)&&request.offset===0),batchKey=request=>request.cardIds.join('\u0000');
    assert.ok(primary.some(request=>request.cardIds.length<100),'long IDs must trigger URL-byte splitting below the numeric batch cap');
    assert.deepEqual([...new Set(primary.flatMap(request=>request.cardIds))].sort(),[...ids].sort(),'primary batches must preserve every card ID');
    assert.deepEqual(primary.map(batchKey).sort(),legacyFirstPages.map(batchKey).sort(),'legacy fallback must retry the same bounded card-ID batches');
    assert.ok(maxConcurrentByTable[table]>1,'bounded loaders should still use parallel requests');
    assert.ok(maxConcurrentByTable[table]<=4,'concurrency must remain at or below four per relation table');
  }
  assert.ok(relationRequests.some(request=>request.table==='tcg_printings'&&request.offset>=1000),'legacy printing results must paginate beyond the first 1000 rows');
});

test('read-only reports fallback stays quiet when Supabase is unavailable', async () => {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/reports?cardId=pokemon-test`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.data, { reports: [], stats: [], total: 0 });
  assert.equal(body.meta.status, 'unavailable');
});
