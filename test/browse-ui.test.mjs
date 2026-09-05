import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const source=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n').split('async function init()')[0];
function harness(fetch=async()=>({ok:true,json:async()=>({data:[],meta:{hasMore:false}})})){
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'all',style:{},classList:{add(){},remove(){}},scrollIntoView(){}});return nodes.get(id)};
  const context=vm.createContext({document:{getElementById:node},window:{},fetch,console});
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
