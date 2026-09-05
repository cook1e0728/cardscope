import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { localizePokemonName, localizeProductName, parseOnePieceCards, parseOnePieceProducts, parseOnePieceSeries, parsePokemonSpeciesNames } from '../providers/catalog-sync.mjs';
import { classifyProduct, normalizeProduct, PRODUCT_CATEGORIES } from '../providers/products.mjs';

const port=4197;
let server;

test.before(async()=>{
  server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),SUPABASE_URL:'',SUPABASE_SERVICE_KEY:''},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('server start timeout')),5000);server.once('error',reject);server.stdout.on('data',chunk=>{if(String(chunk).includes('CardScope is running')){clearTimeout(timer);resolve()}})});
});

test.after(()=>server?.kill());

async function api(path){const response=await fetch(`http://127.0.0.1:${port}${path}`);assert.equal(response.status,200);return response.json()}

test('catalog exposes canonical cards with images and printing metadata',async()=>{
  const {data}=await api('/api/catalog');
  assert.equal(data.source,'catalog.json');
  assert.ok(data.cards.length>=5);
  for(const card of data.cards){assert.ok(card.id===card.canonicalId);assert.ok(card.imageUrl);assert.ok(card.printings.length);assert.ok(card.printings[0].region);assert.ok(card.printings[0].language)}
});

test('coverage reports honest fallback totals without a database',async()=>{
  const {data}=await api('/api/catalog/coverage');
  assert.equal(data.source,'catalog.json');
  assert.equal(data.totalCards,Object.values(data.games).reduce((sum,g)=>sum+g.cards,0));
  assert.ok(data.games.pokemon.cards>0);
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
  assert.match(ui,/cardscope-card-view/);
  assert.match(ui,/圖鑑模式/);
  assert.match(ui,/清單模式/);
  assert.match(ui,/圖片待補/);
  for(const tab of ['資訊','跨市場比價','成交趨勢','使用者回報'])assert.match(ui,new RegExp(tab));
  for(const interaction of ['tilt-card','perspective:1000px','上一張卡','下一張卡','ArrowLeft','ArrowRight'])assert.match(ui,new RegExp(interaction));
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

