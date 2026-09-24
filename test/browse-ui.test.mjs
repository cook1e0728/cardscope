import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const source=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n').split('async function init()')[0];
function harness(fetch=async()=>({ok:true,json:async()=>({data:[],meta:{hasMore:false}})})){
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'all',style:{},classList:{add(){},remove(){}},scrollIntoView(){}});return nodes.get(id)};
  const context=vm.createContext({document:{getElementById:node},window:{},fetch,console,URLSearchParams});
  vm.runInContext(source,context);
  return {run:code=>vm.runInContext(code,context),node,context};
}
test('region filter includes matching printings and excludes other versions',()=>{
  const h=harness();h.node('browseRegion').value='TW';
  assert.equal(h.run("regionMatches({region:'JP',printings:[{region:'TW'}]})"),true);
  assert.equal(h.run("regionMatches({region:'JP'})"),false);
});
test('old game response cannot replace a newly selected game',async()=>{
  const pending=[];const h=harness(()=>new Promise(resolve=>pending.push(resolve)));
  h.run("game='pokemon'");const first=h.run('loadCardsPage(true)');
  h.run("game='onepiece';clearProduct()");const second=h.run('loadCardsPage(true)');
  pending[1]({ok:true,json:async()=>({data:[{id:'new',game:'onepiece',nameZh:'魯夫'}],meta:{hasMore:false}})});await second;
  pending[0]({ok:true,json:async()=>({data:[{id:'old',game:'pokemon'}],meta:{hasMore:true}})});await first;
  assert.equal(h.run('currentCardRows[0].id'),'new');
  assert.equal(h.run('browse.hasMore'),false);
});
test('product without verified series association does not request unrelated cards',async()=>{
  let requests=0;const h=harness(async()=>{requests++;throw Error('unexpected request')});
  h.run("game='pokemon';P=[{id:'box',game:'pokemon',nameZh:'測試商品',catalogCategory:'原盒'}]");
  await h.run("openProduct('box')");
  assert.equal(requests,0);assert.equal(h.run('currentCardRows.length'),0);
  assert.match(h.node('cardsMeta').textContent,/尚無可靠/);
});
test('cross-game product selection waits for the game reset before opening',async()=>{
  const h=harness();let finishSwitch;
  h.context.switchGate=new Promise(resolve=>{finishSwitch=resolve});
  h.run("game='pokemon';P=[{id:'op-box',game:'onepiece',nameZh:'航海王商品',catalogCategory:'原盒'}];window.choose=async id=>{await switchGate;game=id;clearProduct()}");
  const opening=h.run("openProduct('op-box')");
  assert.equal(h.run('browse.product'),null);
  finishSwitch();await opening;
  assert.equal(h.run('game'),'onepiece');
  assert.equal(h.run('browse.product.id'),'op-box');
  assert.match(h.node('cardsMeta').textContent,/尚無可靠/);
});
test('series image opens its exact card set without counting as a box',async()=>{
  const requests=[];const h=harness(async url=>{requests.push(String(url));return{ok:true,json:async()=>({data:[],meta:{total:0,hasMore:false,facets:{rarity:{}}}})}});
  h.run("game='pokemon';S=[{id:'series-sv8',game:'pokemon',seriesId:'pokemon-tcgdex-tw-sv8',imageKind:'series-logo',nameZh:'超電突圍',region:'TW'}]");
  await h.run("openSeriesIndex('series-sv8')");
  assert.equal(h.run('browse.seriesId'),'pokemon-tcgdex-tw-sv8');
  assert.match(h.node('selectedProduct').innerHTML,/系列索引圖・非卡盒封面/);
  assert.equal(requests.length,1);
  assert.match(requests[0],/series=pokemon-tcgdex-tw-sv8/);
});
test('series index is a labelled fallback only when an IP has no physical products',async()=>{
  const navigator=await readFile(new URL('../series-navigator.js',import.meta.url),'utf8'),definition=navigator.split('\n').find(line=>line.startsWith('function baseSeriesRows()'));
  const context=vm.createContext({P:[],S:[{id:'tw-series',game:'pokemon',imageKind:'series-logo',seriesId:'sv8',region:'TW'},{id:'us-series',game:'pokemon',imageKind:'series-logo',seriesId:'sv8-us',region:'US'}],game:'pokemon',productCategoryId:'sealed',productCategory:'原盒',document:{getElementById:()=>({value:'TW'})},productMatchesCategory:()=>true});
  vm.runInContext(definition,context);
  assert.equal(vm.runInContext('baseSeriesRows().map(row=>row.id).join(",")',context),'tw-series');
  context.document.getElementById=()=>({value:'all'});
  assert.equal(vm.runInContext('baseSeriesRows().map(row=>row.id).join(",")',context),'tw-series,us-series');
  context.P=[{id:'real-box',game:'pokemon'}];
  assert.equal(vm.runInContext('baseSeriesRows().map(row=>row.id).join(",")',context),'real-box');
  context.P=[];context.productCategoryId='decks';
  assert.equal(vm.runInContext('baseSeriesRows().length',context),0);
  assert.match(navigator,/系列圖・非卡盒/);
});
test('series-only navigation clearly distinguishes an index from physical products',async()=>{
  const navigator=await readFile(new URL('../series-navigator.js',import.meta.url),'utf8');
  const definition=navigator.split('\n').find(line=>line.startsWith('function setSeriesContext('));
  const title={textContent:''},description={textContent:''};
  const section={querySelector:selector=>selector==='.title h2'?title:description};
  const context=vm.createContext({document:{getElementById:()=>({closest:()=>section})}});
  vm.runInContext(definition,context);
  vm.runInContext('setSeriesContext(true,276)',context);
  assert.match(title.textContent,/系列導覽（非卡盒）/);
  assert.match(description.textContent,/276 個系列索引/);
  assert.match(description.textContent,/不是卡盒封面/);
  vm.runInContext('setSeriesContext(false,32)',context);
  assert.equal(title.textContent,'商品圖鑑');
  assert.doesNotMatch(description.textContent,/276|卡盒封面/);
});
test('unclassified Pokémon series do not precede verified era groups',async()=>{
  const navigator=await readFile(new URL('../series-navigator.js',import.meta.url),'utf8');
  const definition=navigator.split('\n').find(line=>line.startsWith('function seriesGroupBuckets('));
  const context=vm.createContext({game:'pokemon',seriesGroup:item=>item.group});
  vm.runInContext(definition,context);
  context.rows=[{group:'待確認系列',releaseDate:'2026-01-01'},{group:'朱／紫系列',releaseDate:'2024-01-01'},{group:'MEGA 系列',releaseDate:'2025-01-01'}];
  assert.equal(vm.runInContext('seriesGroupBuckets(rows).map(bucket=>bucket.label).join(",")',context),'MEGA 系列,朱／紫系列,待確認系列');
});
test('verified prices cannot leak across games or non-Japanese editions',()=>{
  const h=harness();h.run("game='pokemon';verifiedPrices.set('001',{price:100,currency:'JPY'})");
  assert.equal(h.run("priceFor({game:'onepiece',region:'JP',officialCardNumber:'001'})"),null);
  assert.equal(h.run("priceFor({game:'pokemon',region:'US',officialCardNumber:'001'})"),null);
  assert.equal(h.run("priceFor({game:'pokemon',region:'JP',officialCardNumber:'001'}).price"),100);
});
test('removed gameFilters is not referenced by homepage scripts',()=>{
  assert.doesNotMatch(source,/\bgameFilters\b/);
  assert.match(html,/cardscope-rabbit-mark\.png/);
});
test('IP navigation uses explicitly non-official CardScope artwork',async()=>{
  const switcher=await readFile(new URL('../game-switcher.js',import.meta.url),'utf8');
  assert.match(switcher,/CardScope 非官方分類圖/);
  for(const id of ['pokemon','onepiece','yugioh','haikyuu','frieren']){
    const svg=await readFile(new URL(`../assets/ip-${id}.svg`,import.meta.url),'utf8');
    assert.match(svg,/CardScope 自製/);
    assert.doesNotMatch(svg,/OFFICIAL CARD GAME|TRADING CARD GAME/);
  }
});
test('all seven rabbit roles are wired to local brand assets',async()=>{
  for(const name of ['hero','hero-mobile','profile','success','explore','silhouette','offline']){
    assert.match(html+source+await readFile(new URL('../ui-enhancements.js',import.meta.url),'utf8'),new RegExp(`rabbit-${name}\\.(?:jpg|png)`));
  }
  assert.match(html,/mascot-gallery/);
});
