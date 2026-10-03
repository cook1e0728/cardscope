import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { catalogProvidersNeedingSync, localizePokemonName, localizeProductName, parseOnePieceCards, parseOnePieceProducts, parseOnePieceSeries, parsePokemonSpeciesNames } from '../providers/catalog-sync.mjs';
import { classifyProduct, normalizeProduct, PRODUCT_CATEGORIES } from '../providers/products.mjs';
import { catalogCollectionAllowed, imageCollectionAllowed, imageRightsAllowDisplay, sourcePolicySummary } from '../providers/source-policy.mjs';

const port=4197;
let server;

test.before(async()=>{
  server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),SUPABASE_URL:'',SUPABASE_SERVICE_KEY:''},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('server start timeout')),5000);server.once('error',reject);server.stdout.on('data',chunk=>{if(String(chunk).includes('CardScope is running')){clearTimeout(timer);resolve()}})});
});

test.after(()=>server?.kill());

async function api(path){const response=await fetch(`http://127.0.0.1:${port}${path}`);assert.equal(response.status,200);return response.json()}

async function listenOnEphemeralPort(httpServer){
  await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(0,'127.0.0.1',resolve)});
  return httpServer.address().port;
}
async function closeHttpServer(httpServer){if(httpServer?.listening)await new Promise((resolve,reject)=>httpServer.close(error=>error?reject(error):resolve()))}
async function freePort(){const probe=createServer();const free=await listenOnEphemeralPort(probe);await closeHttpServer(probe);return free}

test('catalog exposes canonical cards and risk-accepted source images without marking them licensed',async()=>{
  const {data}=await api('/api/catalog');
  assert.equal(data.source,'catalog.json');
  assert.ok(data.cards.length>=5);
  for(const card of data.cards){assert.ok(card.id===card.canonicalId);assert.ok(card.imageUrl);assert.ok(card.printings.length);assert.ok(card.printings[0].region);assert.ok(card.printings[0].language)}
});

test('source policy gates collectors and image display independently',()=>{
  assert.equal(catalogCollectionAllowed('pokemon'),true);
  assert.equal(catalogCollectionAllowed('onepiece'),false);
  assert.equal(catalogCollectionAllowed('yuyutei'),false);
  assert.equal(imageCollectionAllowed('yugioh'),false);
  assert.equal(imageRightsAllowDisplay('not-provided',null,'pokemontcg'),true);
  assert.equal(imageRightsAllowDisplay(null,null,'ygoprodeck'),true);
  assert.equal(imageRightsAllowDisplay('not-displayable',null,'pokemontcg'),false);
  assert.equal(imageRightsAllowDisplay('licensed',null,'pokemontcg'),true);
  assert.equal(imageRightsAllowDisplay('licensed',null,'unknown-source'),false);
  assert.equal(imageRightsAllowDisplay('partner-provided','2020-01-01T00:00:00Z','pokemontcg'),false);
  assert.equal(sourcePolicySummary().version,3);
  assert.equal(sourcePolicySummary().unverifiedImageDisplayEnabled,true);
});

test('database detail, search, and series paths retain image policy fields',async()=>{
  const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
  const functions=['searchCatalogDatabase','browseCardsByGame','loadCardFromDatabase'];
  for(const [index,name] of functions.entries()){
    const start=source.indexOf(`async function ${name}`);
    const end=index===functions.length-1?source.indexOf('async function getCard',start):source.indexOf(`async function ${functions[index+1]}`,start);
    assert.ok(start>=0&&end>start,`${name} source is missing`);
    assert.match(source.slice(start,end),/select:BROWSE_PRINTING_SELECT/,`${name} must fetch source and image rights fields`);
  }
});

test('public health and source policy endpoints are available without database secrets',async()=>{
  const health=await api('/api/catalog/health'),sources=await api('/api/catalog/sources');
  assert.equal(health.data.policy.version,3);
  assert.ok(sources.data.some(source=>source.runtimeProvider==='onepiece'&&source.status==='blocked'));
  const response=await fetch(`http://127.0.0.1:${port}/api/admin/catalog/health?token=leaked`);
  assert.equal(response.status,401);
});

test('One Piece image proxy rejects non-official hosts and frontend routes official card art through it',async()=>{
  const rejected=await fetch(`http://127.0.0.1:${port}/api/images/onepiece?url=${encodeURIComponent('https://example.com/card.png')}`);
  assert.equal(rejected.status,400);
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/asia-tc\.onepiece-cardgame\.com/);
  assert.match(html,/\/api\/images\/onepiece\?url=/);
});

test('coverage reports honest fallback totals without a database',async()=>{
  const {data}=await api('/api/catalog/coverage');
  assert.equal(data.source,'catalog.json');
  assert.equal(data.totalCards,Object.values(data.games).reduce((sum,g)=>sum+g.cards,0));
  assert.ok(data.games.pokemon.cards>0);
});

test('catalog cooldown treats an active provider run as covered',async()=>{
  let requestedPath='';
  const providers=await catalogProvidersNeedingSync(async path=>{requestedPath=path;return[
    {provider:'pokemontcg',status:'running',metadata:{}},
    {provider:'tcgdex-zh-tw',status:'completed',metadata:{}},
    {provider:'onepiece-official-tw',status:'completed',metadata:{twCards:0}},
    {provider:'ygoprodeck',status:'completed',metadata:{}}
  ]},72);
  assert.match(requestedPath,/status=in\.\(completed,running\)/);
  assert.deepEqual(providers,['onepiece']);
});

test('price filters stay honest when no verified database source is configured',async()=>{
  const {data,meta}=await api('/api/buyback-prices?game=pokemon');
  assert.deepEqual(data,[]);
  assert.equal(meta.source,'yuyutei-buyback');
});

test('all five IP navigation images are local and served as SVG',async()=>{
  for(const name of ['pokemon','onepiece','yugioh','haikyuu','frieren']){
    const response=await fetch(`http://127.0.0.1:${port}/assets/ip-${name}.svg`);
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type')||'',/^image\/svg\+xml/);
    assert.match(await response.text(),/<svg/);
  }
});

test('product feed never promotes a single card as a box or series image',{timeout:45000},async()=>{
  const {data,series,meta}=await api('/api/products');
  assert.ok(Array.isArray(data));
  assert.ok(series.length);
  assert.ok(data.every(item=>item.imageKind!=='card'));
  assert.ok(data.every(item=>item.imageKind==='sealed-product'));
  assert.ok(data.every(item=>PRODUCT_CATEGORIES.includes(item.catalogCategory)));
  assert.equal(meta.productCount,data.length);
  assert.equal(meta.seriesCount,series.length);
  for(const game of ['pokemon','onepiece','yugioh','haikyuu','weiss-schwarz']){
    assert.equal(meta.productCountsByGame[game],data.filter(item=>item.game===game).length);
    assert.equal(meta.seriesCountsByGame[game],series.filter(item=>item.game===game).length);
    assert.equal(meta.productImageCountsByGame[game],data.filter(item=>item.game===game&&item.imageUrl).length);
    assert.equal(meta.seriesImageCountsByGame[game],series.filter(item=>item.game===game&&item.imageUrl).length);
  }
  assert.deepEqual(meta.productSources,[...new Set(data.map(item=>item.source).filter(Boolean))].sort());
  assert.deepEqual(meta.seriesSources,[...new Set(series.map(item=>item.source).filter(Boolean))].sort());
  assert.deepEqual(meta.sources,[...new Set([...meta.productSources,...meta.seriesSources])].sort());
  for(const item of series.filter(item=>item.source==='curated-official-index')){
    assert.equal(item.imageUrl,null);
    assert.equal(item.cardsCount,null);
    assert.equal(item.productType,'系列');
  }
});

test('official product parser keeps sealed products separate from cards',()=>{
  const products=parseOnePieceProducts('<li class="linkListColBox" data-cat="BOOSTER PACK"><a href="/products/boosters/op-01.php" class="linkListColItem"><img data-src="/images/products/boosters/op01.jpg"><h4 class="linkListColTitle">ROMANCE DAWN</h4><time datetime="2022-12-02"></time></a></li>');
  assert.equal(products.length,1);assert.equal(products[0].image_kind,'sealed-product');assert.equal(products[0].product_type,'BOOSTER PACK');assert.ok(!('official_card_number' in products[0]));
  const cards=parseOnePieceCards('<a class="modalOpen" data-src="/images/cardlist/card/OP01-001.png" alt="Roronoa Zoro"></a><dl><div class="infoCol"><span>OP01-001</span> | <span>L</span> | <span>LEADER</span><div class="cardName">Roronoa Zoro</div></dl>');
  assert.equal(cards.length,1);assert.equal(cards[0].number,'OP01-001');assert.ok(!('image_kind' in cards[0]));
  const series=parseOnePieceSeries('<option value="556101">BOOSTER PACK &lt;br class=&quot;spInline&quot;&gt;-ROMANCE DAWN- [OP-01]</option>');assert.equal(series[0].code,'OP-01');assert.equal(series[0].name,'BOOSTER PACK -ROMANCE DAWN- [OP-01]');
  const twSeries=parseOnePieceSeries('<option value="554117">補充包 世界最強的戰士【OP-17】</option>');assert.equal(twSeries[0].code,'OP-17');assert.equal(twSeries[0].name,'補充包 世界最強的戰士【OP-17】');assert.equal(twSeries[0].productType,'補充包');
});

test('product taxonomy exposes seven accepted feed values',()=>{
  assert.deepEqual(PRODUCT_CATEGORIES,['原盒','特典卡','周邊道具','decks','event-store','other','singles']);
});

test('all IP and regions keep legacy product classifications',()=>{
  assert.equal(classifyProduct({game:'pokemon',productType:'特殊禮盒',nameZh:'烈焰狂火特殊禮盒'}),'原盒');
  assert.equal(classifyProduct({game:'haikyuu',region:'JP',productType:'特典卡'}),'特典卡');
  assert.equal(classifyProduct({game:'onepiece',region:'ASIA',name:'Official Playmat'}),'周邊道具');
  assert.equal(classifyProduct({game:'yugioh',region:'KR',nameKo:'카드 슬리브'}),'周邊道具');
  assert.equal(classifyProduct({game:'pokemon',region:'US',name:'Great Encounters'}),'原盒');
});

test('product taxonomy separates decks, event rewards, accessories and unknowns',()=>{
  const cases=[
    [{game:'pokemon',productType:'起始牌組',nameZh:'冠軍特典套組'},'decks'],
    [{game:'onepiece',productType:'STARTER DECK',name:'Tournament Prize'},'decks'],
    [{game:'haikyuu',productType:'賽事獎品',name:'Champion Card'},'event-store'],
    [{game:'yugioh',productType:'店鋪限定',name:'Store Exclusive Card'},'event-store'],
    [{game:'onepiece',productType:'周邊道具',name:'Champion Playmat'},'周邊道具'],
    [{game:'onepiece',name:'Champion Playmat'},'周邊道具'],
    [{game:'pokemon',name:'Mystery Collector Item'},'other']
  ];
  for(const [product,expected] of cases)assert.equal(classifyProduct(product),expected,JSON.stringify(product));
  assert.equal(normalizeProduct({catalogCategory:'sealed',name:'Known box'}).catalogCategory,'原盒');
  assert.equal(normalizeProduct({catalogCategory:'accessories',name:'Deck box'}).catalogCategory,'周邊道具');
});

test('structured product type wins over incidental name keywords',()=>{
  assert.equal(classifyProduct({productType:'周邊道具',name:'Champion Tournament Prize Playmat'}),'周邊道具');
  assert.equal(classifyProduct({productType:'BOOSTER PACK',name:'Official Tournament Prize'}),'原盒');
  assert.equal(classifyProduct({productType:'STARTER DECK',name:'Promo Prize'}),'decks');
  assert.equal(classifyProduct({metadata:{productType:'賽事限定'},name:'Playmat'}),'event-store');
});

test('frontend exposes seven shared product categories and maps legacy labels',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const sourceStart=html.indexOf('const PRODUCT_CATEGORY_DEFINITIONS='),sourceEnd=html.indexOf('let C=',sourceStart);
  assert.ok(sourceStart>=0&&sourceEnd>sourceStart,'frontend category definitions are missing');
  const {PRODUCT_CATEGORY_DEFINITIONS,productMatchesCategory}=new Function(`${html.slice(sourceStart,sourceEnd)};return {PRODUCT_CATEGORY_DEFINITIONS,productMatchesCategory}`)();
  assert.deepEqual(PRODUCT_CATEGORY_DEFINITIONS.map(({id,label})=>[id,label]),[
    ['singles','單卡'],['sealed','密封商品'],['decks','牌組／構築商品'],['promo','特典／贈品'],
    ['event-store','賽事／商店限定'],['accessories','周邊道具'],['other','其他']
  ]);
  for(const [legacy,id] of [['原盒','sealed'],['特典卡','promo'],['周邊道具','accessories']])assert.equal(productMatchesCategory({catalogCategory:legacy},id),true,`${legacy} should map to ${id}`);
  assert.match(html,/PRODUCT_CATEGORY_DEFINITIONS\.map\(category=>/);
  assert.match(html,/onclick="chooseProductCategory\('\$\{category\.id\}'\)"/);
});

test('Pokemon cards keep their edition image but display official Traditional Chinese species names',()=>{
  const names=parsePokemonSpeciesNames('pokemon_species_id,local_language_id,name,genus\n6,4,噴火龍,火焰寶可夢\n6,9,Charizard,Flame Pokémon\n118,4,角金魚,金魚寶可夢\n118,9,Goldeen,Goldfish Pokémon');
  assert.equal(localizePokemonName('Goldeen',[118],names),'角金魚');
  assert.equal(localizePokemonName('Charizard ex',[6],names),'噴火龍 ex');
  assert.equal(localizePokemonName("Blaine's Charizard",[6],names),null);
});

test('all product feeds receive a Chinese display name',()=>{
  assert.equal(localizeProductName('pokemon','Obsidian Flames','系列'),'黑曜火焰');
  assert.equal(localizeProductName('onepiece','BOOSTER PACK -ROMANCE DAWN- [OP-01]','BOOSTER PACK'),'補充包 -浪漫黎明- [OP-01]');
  assert.equal(localizeProductName('yugioh','Legend of Blue Eyes White Dragon','系列'),'遊戲王系列｜Legend of Blue Eyes White Dragon');
});

test('round three browsing controls and honest fallbacks stay wired',async()=>{
  const [ui,navigator,mappings]=await Promise.all([
    readFile(new URL('../ui-enhancements.js',import.meta.url),'utf8'),
    readFile(new URL('../series-navigator.js',import.meta.url),'utf8'),
    readFile(new URL('../data/series-zh.json',import.meta.url),'utf8').then(JSON.parse)
  ]);
  assert.match(ui,/let cardViewMode='grid'/);
  assert.match(ui,/圖鑑模式/);
  assert.match(ui,/清單模式/);
  assert.match(ui,/圖片待補/);
  for(const tab of ['資訊','跨市場比價','成交趨勢','使用者回報'])assert.match(ui,new RegExp(tab));
  for(const interaction of ['tilt-card','perspective:1000px','上一張卡','下一張卡','ArrowLeft','ArrowRight','card-zoom','點擊卡圖可放大'])assert.match(ui,new RegExp(interaction));
  for(const marker of ['cardscopeFeatureTour','feature-tour','快速使用說明','help-grid'])assert.match(ui,new RegExp(marker));
  assert.doesNotMatch(ui,/暫停輪播|setInterval/);
  assert.match(navigator,/series-block/);
  assert.match(navigator,/series-groups/);
  assert.doesNotMatch(navigator,/host\.innerHTML[\s\S]{0,1000}series-accordion/);
  assert.match(navigator,/productMatchesCategory\(item,category\)/);
  assert.ok(mappings.entries.some(row=>row.game==='haikyuu'&&row.code==='HV-P04'));
  assert.ok(mappings.entries.some(row=>row.game==='weiss-schwarz'&&row.code==='S136'));
});

test('canonical migration links physical cards and images durably',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260902_canonical_card_links.sql',import.meta.url),'utf8');
  assert.match(sql,/tcg_cards_canonical_id_fkey/);
  assert.match(sql,/card_images_canonical_id_fkey/);
  assert.match(sql,/sync_tcg_canonical_from_card_trigger/);
  assert.match(sql,/sync_card_image_canonical_id_trigger/);
  assert.match(sql,/security_invoker = true/);
  assert.match(sql,/tcg_canonical_card_catalog/);
});

for(const [query,expected] of [
  ['噴火龍','Charizard'],['Charizard','Charizard'],['リザードン','Charizard'],
  ['超夢','Mewtwo'],['Mewtwo','Mewtwo'],['ミュウツー','Mewtwo'],
  ['夢幻','Mew ex'],['Mew','Mew ex'],['ミュウ','Mew ex'],
  ['魯夫','Monkey.D.Luffy'],['黑魔導女孩','Dark Magician Girl']
])test(`multilingual search: ${query}`,async()=>{const {data,meta}=await api(`/api/search?q=${encodeURIComponent(query)}`);assert.equal(meta.architecture,'canonical-card-with-printings');assert.equal(data.length,1,`${query} should prefer one exact multilingual name`);assert.equal(data[0].nameEn,expected)});

test('configured search merges local exact cards with bounded database matches and reports fallback truthfully',async()=>{
  const sampleCard={id:'onepiece-luffy-op05-119-jp',canonicalId:'onepiece-monkey-d-luffy-op05-119',game:'onepiece',seriesId:'onepiece-op05-jp',officialCardNumber:'OP05-119',rarity:'SEC',nameZh:'魯夫',nameJa:'モンキー・D・ルフィ',nameEn:'Monkey.D.Luffy',nameKo:'몽키 D. 루피',aliases:['魯夫','luffy'],metadata:{}};
  const searchCards=Array.from({length:100},(_,index)=>{
    const suffix=String(index+1).padStart(3,'0');
    return index===0?sampleCard:{...sampleCard,id:`onepiece-luffy-fixture-${suffix}`,canonicalId:`onepiece-luffy-fixture-canonical-${suffix}`,officialCardNumber:`OP05-${suffix}`};
  });
  const printings=searchCards.map((card,index)=>({id:`fixture-printing-${String(index+1).padStart(3,'0')}`,cardId:card.id,seriesId:'onepiece-op05-jp',region:index===0?'JP':'US',language:index===0?'ja-JP':'en-US',localSetCode:'OP05',localCardNumber:card.officialCardNumber,rarity:card.rarity,imageUrl:null,imageRehostRequired:false}));
  let failSearch=false;
  const searchQueries=[];
  const mockSupabase=createServer((req,res)=>{
    const url=new URL(req.url,'http://mock-supabase'),table=url.pathname.split('/').at(-1),respond=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body))};
    if(table==='tcg_cards'&&url.searchParams.get('order')!=='created_at.asc'){
      searchQueries.push(url.searchParams);
      if(failSearch)return respond(503,{message:'fixture search unavailable'});
      return respond(200,searchCards);
    }
    if(table==='tcg_cards')return respond(200,[sampleCard]);
    if(table==='tcg_printings')return respond(200,printings);
    return respond(200,[]);
  });
  const supabasePort=await listenOnEphemeralPort(mockSupabase),appPort=await freePort();
  let app;
  try{
    app=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(appPort),SUPABASE_URL:`http://127.0.0.1:${supabasePort}`,SUPABASE_SERVICE_KEY:'local-fixture-key',CATALOG_SYNC_ON_START:'false',CARD_IMAGE_CACHE_ON_START:'false'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error(`search fixture server start timeout: ${output}`)),5000);
      app.once('error',error=>{clearTimeout(timer);reject(error)});
      app.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`search fixture server exited before start (${code??signal})`))});
      app.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('CardScope is running')){clearTimeout(timer);resolve()}});
    });
    const call=async(region='')=>{
      const suffix=region?`&region=${encodeURIComponent(region)}`:'';
      const response=await fetch(`http://127.0.0.1:${appPort}/api/search?q=${encodeURIComponent('魯夫')}${suffix}`);
      assert.equal(response.status,200);
      return response.json();
    };

    const merged=await call();
    const mergedIds=merged.data.map(card=>card.id);
    assert.equal(mergedIds.length,40);
    assert.equal(new Set(mergedIds).size,40,'same-name records with different canonical IDs must remain distinct');
    assert.ok(mergedIds.includes('onepiece-monkey-d-luffy-op05-119'),'local exact card must be merged with database results');
    assert.ok(mergedIds.includes('onepiece-luffy-fixture-canonical-002'),'second distinct same-name database card must remain visible');
    assert.equal(merged.meta.source,'supabase-search');
    assert.equal(merged.meta.databaseSearch,'available');
    assert.equal(merged.meta.candidateCount,100);
    assert.equal(merged.meta.candidateLimit,100);
    assert.equal(merged.meta.resultLimit,40);
    assert.equal(merged.meta.mayHaveMore,true);
    assert.match(searchQueries[0].get('or'),/name_zh\.ilike\.\*魯夫\*/,'raw multilingual term should be queried');
    assert.match(searchQueries[0].get('or'),/name_en\.ilike\.\*Luffy\*/,'mapped English alias should also be queried');
    assert.equal(searchQueries[0].get('limit'),'100','database candidate reads must remain bounded');

    const regional=await call('US');
    assert.ok(regional.data.every(card=>card.printings.some(printing=>printing.region==='US')));
    assert.ok(!regional.data.some(card=>card.id==='onepiece-monkey-d-luffy-op05-119'),'region filtering must exclude JP-only exact sample');
    assert.ok(regional.data.some(card=>card.id==='onepiece-luffy-fixture-canonical-002'));

    failSearch=true;
    // A query answered within the last minute is served from the search cache, so the failure path uses one not asked yet.
    const fallback=await call('JP');
    assert.deepEqual(fallback.data.map(card=>card.id),['onepiece-monkey-d-luffy-op05-119']);
    assert.equal(fallback.meta.databaseSearch,'unavailable');
    assert.equal(fallback.meta.searchScope,'loaded-catalog-only');
    assert.equal(fallback.meta.match,'exact-name');
  }finally{
    if(app&&app.exitCode===null&&app.signalCode===null)await new Promise(resolve=>{app.once('exit',resolve);app.kill()});
    await closeHttpServer(mockSupabase);
  }
});

test('cards sharing a canonical merge into one result that keeps both printings and the known rarity',async()=>{
  const canonical='pokemon-tcgdex-tw-sv6a-039';
  const cards=[
    {id:canonical,canonicalId:canonical,game:'pokemon',seriesId:'pokemon-tcgdex-tw-sv6a',officialCardNumber:'039',rarity:null,nameZh:'桃歹郎ex',nameJa:null,nameEn:null,nameKo:null,aliases:['SV6a-039'],metadata:{}},
    {id:'pokemon-tcgdex-ja-sv6a-039',canonicalId:canonical,game:'pokemon',seriesId:'pokemon-tcgdex-ja-sv6a',officialCardNumber:'039',rarity:'RR',nameZh:'桃歹郎ex',nameJa:'モモワロウex',nameEn:null,nameKo:null,aliases:['SV6a-039'],metadata:{nameZhBasis:'tw-official'}}
  ];
  const printing=(card,region,language,rarity)=>({id:`${card.id}-p`,cardId:card.id,seriesId:card.seriesId,region,language,localSetCode:'SV6a',localCardNumber:'039',rarity,imageUrl:null,imageRehostRequired:false});
  const mockSupabase=createServer((req,res)=>{
    const url=new URL(req.url,'http://mock-supabase'),table=url.pathname.split('/').at(-1),respond=body=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body))};
    if(table==='tcg_cards'&&url.searchParams.has('or'))return respond(cards);
    if(table==='tcg_printings')return respond([printing(cards[0],'TW','zh-TW',null),printing(cards[1],'JP','ja-JP','RR')]);
    return respond([]);
  });
  const supabasePort=await listenOnEphemeralPort(mockSupabase),appPort=await freePort();
  let app;
  try{
    app=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(appPort),SUPABASE_URL:`http://127.0.0.1:${supabasePort}`,SUPABASE_SERVICE_KEY:'local-fixture-key',CATALOG_SYNC_ON_START:'false',CARD_IMAGE_CACHE_ON_START:'false'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error(`canonical merge fixture start timeout: ${output}`)),5000);
      app.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`canonical merge fixture exited (${code??signal})`))});
      app.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('CardScope is running')){clearTimeout(timer);resolve()}});
    });
    const body=await (await fetch(`http://127.0.0.1:${appPort}/api/search?q=${encodeURIComponent('桃歹郎')}`)).json();
    const merged=body.data.filter(card=>card.id===canonical);
    assert.equal(merged.length,1);
    assert.equal(merged[0].rarity,'RR');
    assert.deepEqual(merged[0].printings.map(p=>p.region).sort(),['JP','TW']);
  }finally{
    if(app&&app.exitCode===null&&app.signalCode===null)await new Promise(resolve=>{app.once('exit',resolve);app.kill()});
    await closeHttpServer(mockSupabase);
  }
});

test('series search results also carry the printings of linked cards in the same canonical',async()=>{
  const tw={id:'pokemon-tcgdex-tw-sv6a-039',canonicalId:'pokemon-tcgdex-tw-sv6a-039',game:'pokemon',seriesId:'pokemon-tcgdex-tw-sv6a',officialCardNumber:'039',rarity:null,nameZh:'桃歹郎ex',nameJa:null,nameEn:null,nameKo:null,aliases:[],metadata:{}};
  const jp={...tw,id:'pokemon-tcgdex-ja-sv6a-039',seriesId:'pokemon-tcgdex-ja-sv6a',rarity:'RR',nameJa:'モモワロウex'};
  const requests=[];
  const mockSupabase=createServer((req,res)=>{
    const url=new URL(req.url,'http://mock-supabase'),table=url.pathname.split('/').at(-1),respond=body=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body))};
    requests.push([table,url.searchParams]);
    if(table==='tcg_cards'&&url.searchParams.has('or'))return respond([]);
    if(table==='tcg_series'&&url.searchParams.has('or'))return respond([{id:'pokemon-tcgdex-ja-sv6a'}]);
    if(table==='tcg_printings'&&url.searchParams.has('series_id'))return respond([{cardId:jp.id}]);
    if(table==='tcg_cards'&&url.searchParams.has('id'))return respond([jp]);
    if(table==='tcg_cards'&&url.searchParams.has('canonical_id'))return respond([jp,tw]);
    if(table==='tcg_printings')return respond([jp,tw].map(card=>({id:`${card.id}-p`,cardId:card.id,seriesId:card.seriesId,region:card===jp?'JP':'TW',language:card===jp?'ja-JP':'zh-TW',localSetCode:'SV6a',localCardNumber:'039',rarity:card.rarity,imageUrl:null,imageRehostRequired:false})));
    return respond([]);
  });
  const supabasePort=await listenOnEphemeralPort(mockSupabase),appPort=await freePort();
  let app;
  try{
    app=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(appPort),SUPABASE_URL:`http://127.0.0.1:${supabasePort}`,SUPABASE_SERVICE_KEY:'local-fixture-key',CATALOG_SYNC_ON_START:'false',CARD_IMAGE_CACHE_ON_START:'false'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error(`sibling fixture start timeout: ${output}`)),5000);
      app.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`sibling fixture exited (${code??signal})`))});
      app.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('CardScope is running')){clearTimeout(timer);resolve()}});
    });
    const body=await (await fetch(`http://127.0.0.1:${appPort}/api/search?q=${encodeURIComponent('ナイトワンダラー')}`)).json();
    assert.equal(body.meta.match,'database-series');
    assert.equal(body.meta.candidateCount,1,'siblings must not inflate the candidate count');
    assert.deepEqual(body.data.map(card=>[card.id,card.rarity,card.printings.map(p=>p.region).sort().join('/')]),[[tw.id,'RR','JP/TW']]);
    assert.match(requests.find(([table,params])=>table==='tcg_cards'&&params.has('canonical_id'))[1].get('canonical_id'),/pokemon-tcgdex-tw-sv6a-039/);
  }finally{
    if(app&&app.exitCode===null&&app.signalCode===null)await new Promise(resolve=>{app.once('exit',resolve);app.kill()});
    await closeHttpServer(mockSupabase);
  }
});

test('database search falls back to series names and lists that series in card-number order',async()=>{
  const seriesId='pokemon-tcgdex-ja-sv6a';
  const cards=['002','001'].map(n=>({id:`${seriesId}-${n}`,canonicalId:`${seriesId}-${n}`,game:'pokemon',seriesId,officialCardNumber:n,rarity:null,nameZh:null,nameJa:n==='001'?'バチュル':'デンチュラ',nameEn:null,nameKo:null,aliases:[`SV6a-${n}`],metadata:{}}));
  const requests=[];
  const mockSupabase=createServer((req,res)=>{
    const url=new URL(req.url,'http://mock-supabase'),table=url.pathname.split('/').at(-1),respond=body=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body))};
    requests.push([table,url.searchParams]);
    if(table==='tcg_cards'&&url.searchParams.has('or'))return respond([]);
    if(table==='tcg_series'&&url.searchParams.has('or'))return respond([{id:seriesId}]);
    if(table==='tcg_printings'&&url.searchParams.has('series_id'))return respond([{cardId:`${seriesId}-001`},{cardId:`${seriesId}-002`}]);
    if(table==='tcg_cards'&&url.searchParams.has('id'))return respond(cards);
    if(table==='tcg_printings')return respond(cards.map(card=>({id:card.id,cardId:card.id,seriesId,region:'JP',language:'ja-JP',localSetCode:'SV6a',localCardNumber:card.officialCardNumber,rarity:null,imageUrl:null,imageRehostRequired:false})));
    return respond([]);
  });
  const supabasePort=await listenOnEphemeralPort(mockSupabase),appPort=await freePort();
  let app;
  try{
    app=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(appPort),SUPABASE_URL:`http://127.0.0.1:${supabasePort}`,SUPABASE_SERVICE_KEY:'local-fixture-key',CATALOG_SYNC_ON_START:'false',CARD_IMAGE_CACHE_ON_START:'false'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error(`series search fixture start timeout: ${output}`)),5000);
      app.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`series search fixture exited (${code??signal})`))});
      app.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('CardScope is running')){clearTimeout(timer);resolve()}});
    });
    const response=await fetch(`http://127.0.0.1:${appPort}/api/search?q=${encodeURIComponent('ナイトワンダラー')}`),body=await response.json();
    assert.equal(response.status,200);
    assert.deepEqual(body.data.map(card=>card.officialCardNumber),['001','002']);
    assert.equal(body.meta.match,'database-series');
    const seriesQuery=requests.find(([table,params])=>table==='tcg_series'&&params.has('or'))[1];
    assert.match(seriesQuery.get('or'),/name_ja\.ilike\.\*ナイトワンダラー\*/);
    assert.match(seriesQuery.get('or'),/official_code\.ilike/);
    assert.equal(seriesQuery.get('limit'),'5');
    assert.equal(requests.find(([table,params])=>table==='tcg_printings'&&params.has('series_id'))[1].get('limit'),'100');
  }finally{
    if(app&&app.exitCode===null&&app.signalCode===null)await new Promise(resolve=>{app.once('exit',resolve);app.kill()});
    await closeHttpServer(mockSupabase);
  }
});


test('search typed as printed matches TW names whose owner prefix carries source markup',async()=>{
  const card={id:'pokemon-tcgdex-tw-sv10-039',canonicalId:'pokemon-tcgdex-tw-sv10-039',game:'pokemon',seriesId:'pokemon-tcgdex-tw-sv10',officialCardNumber:'039',rarity:'RR',nameZh:'<火箭隊的>超夢ex',nameJa:null,nameEn:null,nameKo:null,aliases:[],metadata:{}};
  const requests=[];
  const mockSupabase=createServer((req,res)=>{
    const url=new URL(req.url,'http://mock-supabase'),table=url.pathname.split('/').at(-1),respond=body=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body))};
    requests.push([table,url.searchParams]);
    if(table==='tcg_cards'&&url.searchParams.has('or'))return respond(url.searchParams.get('or').includes('name_zh.ilike.*<火箭隊的>超夢*')?[card]:[]);
    if(table==='tcg_printings')return respond([{id:`${card.id}-p`,cardId:card.id,seriesId:card.seriesId,region:'TW',language:'zh-TW',localSetCode:'SV10',localCardNumber:'039',rarity:'RR',imageUrl:null,imageRehostRequired:false}]);
    return respond([]);
  });
  const supabasePort=await listenOnEphemeralPort(mockSupabase),appPort=await freePort();
  let app;
  try{
    app=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(appPort),SUPABASE_URL:`http://127.0.0.1:${supabasePort}`,SUPABASE_SERVICE_KEY:'local-fixture-key',CATALOG_SYNC_ON_START:'false',CARD_IMAGE_CACHE_ON_START:'false'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error(`markup search fixture start timeout: ${output}`)),5000);
      app.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`markup search fixture exited (${code??signal})`))});
      app.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('CardScope is running')){clearTimeout(timer);resolve()}});
    });
    const body=await (await fetch(`http://127.0.0.1:${appPort}/api/search?q=${encodeURIComponent('火箭隊的超夢')}`)).json();
    assert.deepEqual(body.data.map(c=>c.id),[card.id]);
    assert.doesNotMatch(requests.find(([table,params])=>table==='tcg_cards'&&params.has('or'))[1].get('or'),/<<|>>/);
  }finally{
    if(app&&app.exitCode===null&&app.signalCode===null)await new Promise(resolve=>{app.once('exit',resolve);app.kill()});
    await closeHttpServer(mockSupabase);
  }
});

test('repeated searches reuse the loaded catalog instead of re-paging every series',async()=>{
  const requests=[];
  const mockSupabase=createServer((req,res)=>{
    const url=new URL(req.url,'http://mock-supabase'),table=url.pathname.split('/').at(-1);
    requests.push([table,url.searchParams]);
    res.writeHead(200,{'content-type':'application/json'});res.end('[]');
  });
  const supabasePort=await listenOnEphemeralPort(mockSupabase),appPort=await freePort();
  let app;
  try{
    app=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(appPort),SUPABASE_URL:`http://127.0.0.1:${supabasePort}`,SUPABASE_SERVICE_KEY:'local-fixture-key',CATALOG_SYNC_ON_START:'false',CARD_IMAGE_CACHE_ON_START:'false'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error(`catalog cache fixture start timeout: ${output}`)),5000);
      app.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`catalog cache fixture exited (${code??signal})`))});
      app.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('CardScope is running')){clearTimeout(timer);resolve()}});
    });
    const seriesPages=()=>requests.filter(([table,params])=>table==='tcg_series'&&!params.has('or')&&!params.has('id')).length;
    for(const q of ['噴火龍','皮卡丘'])assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/search?q=${encodeURIComponent(q)}`)).status,200);
    assert.equal(seriesPages(),1);
  }finally{
    if(app&&app.exitCode===null&&app.signalCode===null)await new Promise(resolve=>{app.once('exit',resolve);app.kill()});
    await closeHttpServer(mockSupabase);
  }
});

test('a stale catalog is served at once while one background load refreshes it',async()=>{
  let seriesLoads=0;
  const mockSupabase=createServer((req,res)=>{
    const url=new URL(req.url,'http://mock-supabase'),table=url.pathname.split('/').at(-1);
    const send=()=>{res.writeHead(200,{'content-type':'application/json'});res.end('[]')};
    if(table==='tcg_series'&&!url.searchParams.has('or')){seriesLoads++;if(seriesLoads>1)return setTimeout(send,2000)}
    send();
  });
  const supabasePort=await listenOnEphemeralPort(mockSupabase),appPort=await freePort();
  let app;
  try{
    app=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(appPort),SUPABASE_URL:`http://127.0.0.1:${supabasePort}`,SUPABASE_SERVICE_KEY:'local-fixture-key',CATALOG_SYNC_ON_START:'false',CARD_IMAGE_CACHE_ON_START:'false',CATALOG_CACHE_TTL_MS:'0'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error(`stale catalog fixture start timeout: ${output}`)),5000);
      app.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`stale catalog fixture exited (${code??signal})`))});
      app.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('CardScope is running')){clearTimeout(timer);resolve()}});
    });
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/search?q=${encodeURIComponent('噴火龍')}`)).status,200);
    const started=performance.now();
    for(const q of ['皮卡丘','超夢'])assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/search?q=${encodeURIComponent(q)}`)).status,200);
    assert.ok(performance.now()-started<1500,'the slow refresh is not awaited');
    assert.equal(seriesLoads,2,'one background refresh is shared');
  }finally{
    if(app&&app.exitCode===null&&app.signalCode===null)await new Promise(resolve=>{app.once('exit',resolve);app.kill()});
    await closeHttpServer(mockSupabase);
  }
});

test('card detail and its market tab share one get_card_detail call',async()=>{
  const card={id:'pokemon-tcgdex-ja-sv6a-039',canonicalId:'pokemon-tcgdex-tw-sv6a-039',game:'pokemon',seriesId:'pokemon-tcgdex-ja-sv6a',officialCardNumber:'039',rarity:'RR',nameZh:'桃歹郎ex',nameJa:'モモワロウex',nameEn:null,nameKo:null,aliases:[],metadata:{},printings:[{id:1,cardId:'pokemon-tcgdex-ja-sv6a-039',seriesId:'pokemon-tcgdex-ja-sv6a',region:'JP',language:'ja-JP',localSetCode:'SV6a',localCardNumber:'039',rarity:'RR',imageUrl:null,imageRehostRequired:false,metadata:{}}]};
  const twin={...card,id:'pokemon-tcgdex-tw-sv6a-039',seriesId:'pokemon-tcgdex-tw-sv6a',nameJa:null,printings:[{...card.printings[0],id:2,cardId:'pokemon-tcgdex-tw-sv6a-039',seriesId:'pokemon-tcgdex-tw-sv6a',region:'TW',language:'zh-TW'}]};
  const requests=[];
  const mockSupabase=createServer((req,res)=>{
    const url=new URL(req.url,'http://mock-supabase'),table=url.pathname.split('/').at(-1);requests.push(table);
    const body=table==='get_card_detail'?{cards:[card,twin],series:[{id:'pokemon-tcgdex-ja-sv6a',game:'pokemon',officialCode:'SV6a',nameJa:'ナイトワンダラー',region:'JP'}],games:[{id:'pokemon',nameZh:'寶可夢'}]}:[];
    setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body))},table==='get_card_detail'?200:0);
  });
  const supabasePort=await listenOnEphemeralPort(mockSupabase),appPort=await freePort();
  let app;
  try{
    app=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(appPort),SUPABASE_URL:`http://127.0.0.1:${supabasePort}`,SUPABASE_SERVICE_KEY:'local-fixture-key',CATALOG_SYNC_ON_START:'false',CARD_IMAGE_CACHE_ON_START:'false'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error(`card detail fixture start timeout: ${output}`)),5000);
      app.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`card detail fixture exited (${code??signal})`))});
      app.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('CardScope is running')){clearTimeout(timer);resolve()}});
    });
    const [detail,market]=await Promise.all([fetch(`http://127.0.0.1:${appPort}/api/cards/${card.id}`),fetch(`http://127.0.0.1:${appPort}/api/cards/${card.id}/market`)]);
    assert.equal(detail.status,200);assert.equal(market.status,200);
    const body=await detail.json();
    assert.deepEqual(body.data.printings.map(p=>p.region).sort(),['JP','TW']);
    assert.equal(body.data.game?.nameZh,'寶可夢');
    assert.equal(requests.filter(table=>table==='get_card_detail').length,1);
    assert.equal(requests.filter(table=>table==='tcg_printings').length,0,'no PostgREST printing query');
  }finally{
    if(app&&app.exitCode===null&&app.signalCode===null)await new Promise(resolve=>{app.once('exit',resolve);app.kill()});
    await closeHttpServer(mockSupabase);
  }
});

async function searchWithMock(handler,q,repeat=1){
  const requests=[];
  const mockSupabase=createServer((req,res)=>{
    const url=new URL(req.url,'http://mock-supabase'),table=url.pathname.split('/').at(-1),respond=(body,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body))};
    requests.push([table,url.searchParams]);
    const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>handler(table,url.searchParams,respond,Buffer.concat(chunks).toString('utf8')));
  });
  const supabasePort=await listenOnEphemeralPort(mockSupabase),appPort=await freePort();
  let app;
  try{
    app=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(appPort),SUPABASE_URL:`http://127.0.0.1:${supabasePort}`,SUPABASE_SERVICE_KEY:'local-fixture-key',CATALOG_SYNC_ON_START:'false',CARD_IMAGE_CACHE_ON_START:'false'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error(`embed fixture start timeout: ${output}`)),5000);
      app.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`embed fixture exited (${code??signal})`))});
      app.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('CardScope is running')){clearTimeout(timer);resolve()}});
    });
    const responses=[];for(let index=0;index<repeat;index++){const response=await fetch(`http://127.0.0.1:${appPort}/api/search?q=${encodeURIComponent(q)}`);responses.push({body:await response.json(),headers:response.headers})}
    return {...responses[0],requests,responses};
  }finally{
    if(app&&app.exitCode===null&&app.signalCode===null)await new Promise(resolve=>{app.once('exit',resolve);app.kill()});
    await closeHttpServer(mockSupabase);
  }
}
const embedCard={id:'pokemon-tcgdex-tw-sv2a-006',canonicalId:'pokemon-tcgdex-tw-sv2a-006',game:'pokemon',seriesId:'pokemon-tcgdex-tw-sv2a',officialCardNumber:'006',rarity:'RR',nameZh:'測試獸ex',nameJa:null,nameEn:null,nameKo:null,aliases:[],metadata:{}};
const embedPrinting={id:'p-006',cardId:embedCard.id,seriesId:embedCard.seriesId,region:'TW',language:'zh-TW',localSetCode:'SV2a',localCardNumber:'006',rarity:'RR',imageUrl:null,imageRehostRequired:false};

test('search reads printings embedded in the card query without a separate printing request',async()=>{
  const {body,requests}=await searchWithMock((table,params,respond)=>{
    if(table==='tcg_cards'&&params.has('or'))return respond([{...embedCard,printings:[embedPrinting]}]);
    if(table==='tcg_cards'&&params.has('canonical_id'))return respond([{...embedCard,printings:[embedPrinting]}]);
    return respond([]);
  },'測試獸');
  assert.deepEqual(body.data.map(c=>[c.id,c.printings.map(p=>p.region).join('/')]),[[embedCard.id,'TW']]);
  assert.match(requests.find(([table,params])=>table==='tcg_cards'&&params.has('or'))[1].get('select'),/printings:tcg_printings!tcg_printings_card_id_fkey\(/);
  assert.equal(requests.filter(([table,params])=>table==='tcg_printings'&&params.has('card_id')).length,0);
});

test('search falls back to a plain card select and a printing fetch when the embed is rejected',async()=>{
  const {body,requests}=await searchWithMock((table,params,respond)=>{
    if(table==='tcg_cards'&&String(params.get('select')).includes('tcg_printings'))return respond({message:'Could not find a relationship'},400);
    if(table==='tcg_cards'&&params.has('or'))return respond([embedCard]);
    if(table==='tcg_printings'&&params.has('card_id'))return respond([embedPrinting]);
    return respond([]);
  },'測試獸');
  assert.equal(body.meta.databaseSearch,'available');
  assert.deepEqual(body.data.map(c=>[c.id,c.printings.map(p=>p.region).join('/')]),[[embedCard.id,'TW']]);
  assert.equal(requests.filter(([table,params])=>table==='tcg_cards'&&String(params.get('select')).includes('tcg_printings')).length,1,'the embed is tried once, then dropped for the rest of the search');
});

test('search reports where its time went in a Server-Timing header',async()=>{
  const {headers}=await searchWithMock((table,params,respond)=>{
    if(table==='tcg_cards'&&params.has('or'))return respond([{...embedCard,printings:[embedPrinting]}]);
    if(table==='tcg_cards'&&params.has('canonical_id'))return respond([{...embedCard,printings:[embedPrinting]}]);
    return respond([]);
  },'測試獸');
  const timing=headers.get('server-timing')||'';
  for(const name of ['catalog','db','names','siblings','total'])assert.match(timing,new RegExp('(^|, )'+name+';dur=[0-9]+'),name);
});

test('search uses the one-round-trip database function when it is available',async()=>{
  const twin={...embedCard,id:'pokemon-tcgdex-ja-sv2a-006',canonicalId:embedCard.canonicalId,nameJa:'テスト獣ex',printings:[{...embedPrinting,id:'p-jp-006',cardId:'pokemon-tcgdex-ja-sv2a-006',region:'JP',language:'ja-JP'}]};
  const {body,requests,headers}=await searchWithMock((table,params,respond)=>{
    if(table==='search_cards_with_siblings')return respond({hits:[{...embedCard,printings:[embedPrinting]}],siblings:[twin]});
    return respond([]);
  },'測試獸');
  assert.deepEqual(body.data.map(c=>[c.id,c.printings.map(p=>p.region).sort().join('/')]),[[embedCard.id,'JP/TW']]);
  assert.equal(requests.filter(([table,params])=>(table==='tcg_cards'&&(params.has('or')||params.has('canonical_id')))||(table==='tcg_printings'&&String(params.get('card_id')).includes(embedCard.id))).length,0,'no PostgREST search queries');
  assert.match(headers.get('server-timing')||'',/(^|, )rpc;dur=[0-9]+/);
});

test('search uses the ranked database function first and keeps its order, counts and region',async()=>{
  const twin={...embedCard,id:'pokemon-tcgdex-ja-sv2a-006',canonicalId:embedCard.canonicalId,nameJa:'テスト獣ex',printings:[{...embedPrinting,id:'p-jp-006',cardId:'pokemon-tcgdex-ja-sv2a-006',region:'JP',language:'ja-JP'}]};
  const other={...embedCard,id:'pokemon-tcgdex-tw-sv2a-007',canonicalId:'pokemon-tcgdex-tw-sv2a-007',officialCardNumber:'007',nameZh:'測試獸',printings:[{...embedPrinting,id:'p-007',cardId:'pokemon-tcgdex-tw-sv2a-007',localCardNumber:'007'}]};
  const bodies=[];
  const {body,requests}=await searchWithMock((table,params,respond,requestBody)=>{
    if(table==='search_cards_ranked'){bodies.push(requestBody);return respond({matchCount:57,groupCount:41,cards:[{...other,hit:true},{...embedCard,printings:[embedPrinting],hit:true},{...twin,hit:false}]})}
    return respond([]);
  },'測試獸');
  assert.deepEqual(body.data.map(c=>[c.id,c.printings.map(p=>p.region).sort().join('/')]),[[other.id,'TW'],[embedCard.id,'JP/TW']],'SQL order is kept and the group is merged');
  assert.equal(body.data[0].hit,undefined);
  assert.equal(body.meta.candidateCount,57);
  assert.equal(body.meta.mayHaveMore,true);
  assert.equal(requests.filter(([table,params])=>table==='search_cards_with_siblings'||(table==='tcg_cards'&&(params.has('or')||params.has('canonical_id')))).length,0,'no fallback queries');
  const sent=JSON.parse(bodies[0]);
  assert.equal(sent.p_limit,40);assert.equal(sent.p_region,null);assert.deepEqual(sent.p_needles,['測試獸']);assert.deepEqual(sent.p_patterns,['%測試獸%']);
});

test('after the ranked function no PostgREST text query runs, and names removed by the region filter end the search',async()=>{
  const filtered=await searchWithMock((table,params,respond)=>{
    if(table==='search_cards_ranked')return respond({matchedBy:'name',matchCount:5,groupCount:0,cards:[]});
    return respond([]);
  },'測試獸');
  assert.deepEqual(filtered.body.data,[]);
  assert.equal(filtered.requests.filter(([table,params])=>((table==='tcg_cards'||table==='tcg_series')&&(params.has('or')||params.has('canonical_id')))||table==='search_cards_with_siblings').length,0);
  const none=await searchWithMock((table,params,respond)=>{
    if(table==='search_cards_ranked')return respond({matchedBy:null,matchCount:0,groupCount:0,cards:[]});
    return respond([]);
  },'測試獸');
  assert.equal(none.requests.filter(([table,params])=>table==='tcg_cards'&&params.has('or')).length,0,'search_text was already tried in SQL');
  assert.equal(none.requests.filter(([table,params])=>table==='tcg_series'&&params.has('or')).length,1,'series names are still tried');
});

test('a series listing from the ranked function keeps card-number order and reports the series match',async()=>{
  const first={...embedCard,id:'pokemon-tcgdex-ja-sv6a-001',canonicalId:'pokemon-tcgdex-ja-sv6a-001',officialCardNumber:'001',nameZh:null,nameJa:'カード一',printings:[{...embedPrinting,id:'p-1',cardId:'pokemon-tcgdex-ja-sv6a-001',region:'JP',localCardNumber:'001'}]};
  const second={...first,id:'pokemon-tcgdex-ja-sv6a-002',canonicalId:'pokemon-tcgdex-ja-sv6a-002',officialCardNumber:'002',nameJa:'カード二',printings:[{...first.printings[0],id:'p-2',cardId:'pokemon-tcgdex-ja-sv6a-002',localCardNumber:'002'}]};
  const {body,requests}=await searchWithMock((table,params,respond)=>{
    if(table==='search_cards_ranked')return respond({matchedBy:'series',matchedSeries:1,matchCount:2,groupCount:2,cards:[{...first,hit:true},{...second,hit:true}]});
    return respond([]);
  },'ナイトワンダラー');
  assert.deepEqual(body.data.map(c=>c.id),[first.id,second.id]);
  assert.equal(body.meta.match,'database-series');
  assert.equal(requests.filter(([table,params])=>(table==='tcg_series'||table==='tcg_cards')&&params.has('or')).length,0);
  assert.equal(requests.filter(([table,params])=>table==='tcg_printings'&&params.has('series_id')).length,0);
});

test('a repeated search within a minute is answered from the search cache',async()=>{
  const {requests,responses}=await searchWithMock((table,params,respond)=>{
    if(table==='search_cards_with_siblings')return respond({hits:[{...embedCard,printings:[embedPrinting]}],siblings:[]});
    return respond([]);
  },'測試獸',2);
  assert.deepEqual(responses[1].body,responses[0].body);
  assert.match(responses[1].headers.get('server-timing')||'',/cache;desc="hit"/);
  assert.equal(requests.filter(([table])=>table==='search_cards_with_siblings').length,1);
});
