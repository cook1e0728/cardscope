import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { localizePokemonName, localizeProductName, parseOnePieceCards, parseOnePieceProducts, parseOnePieceSeries, parsePokemonSpeciesNames } from '../providers/catalog-sync.mjs';
import { classifyProduct, PRODUCT_CATEGORIES } from '../providers/products.mjs';

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

test('all IP and regions share the three product catalog categories',()=>{
  assert.equal(classifyProduct({game:'pokemon',productType:'特殊禮盒',nameZh:'烈焰狂火特殊禮盒'}),'原盒');
  assert.equal(classifyProduct({game:'haikyuu',region:'JP',productType:'特典卡'}),'特典卡');
  assert.equal(classifyProduct({game:'onepiece',region:'ASIA',name:'Official Playmat'}),'周邊道具');
  assert.equal(classifyProduct({game:'yugioh',region:'KR',nameKo:'카드 슬리브'}),'周邊道具');
  assert.equal(classifyProduct({game:'pokemon',region:'US',name:'Great Encounters'}),'原盒');
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
  for(const tour of ['cardscopeFeatureTour','暫停輪播','setInterval','prefers-reduced-motion'])assert.match(ui,new RegExp(tour));
  assert.match(navigator,/series-accordion/);
  assert.match(navigator,/item\.catalogCategory===productCategory/);
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

