import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const indexSource=html;
const uiSource=await readFile(new URL('../ui-enhancements.js',import.meta.url),'utf8');
const serverSource=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
const rarityRankings=JSON.parse(await readFile(new URL('../data/rarity-rankings.json',import.meta.url),'utf8'));
const appSource=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n').split('async function init()')[0];

function createHarness(fetchImpl=async()=>({ok:true,json:async()=>({data:[],meta:{hasMore:false}})}),withUi=false,initialStore={}){
  const nodes=new Map(),created=[];
  const classList={toggle(){},add(){},remove(){},contains(){return false}};
  const node=(id='')=>{
    const value={id,value:'all',innerHTML:'',textContent:'',style:{},classList,children:[],dataset:{},disabled:false,
      append(...items){this.children.push(...items)},prepend(...items){this.children.unshift(...items)},before(){},after(){},insertAdjacentElement(){},
      setAttribute(){},querySelectorAll(){return[]},querySelector(){return null},scrollIntoView(){},closest(){return null},click(){}};
    created.push(value);if(id)nodes.set(id,value);return value;
  };
  for(const id of ['browseRegion','channels','productCategories','series','selectedProduct','cardsTitle','cardsMeta','cardTools','cards','loadMore','filterSummary','rarityFilter','priceFilter','cardSort','notice','modal','detail','status'])node(id);
  const body=node('body'),head=node('head');
  const store=new Map(Object.entries(initialStore));
  const document={body,head,getElementById:id=>nodes.get(id)||created.find(item=>item.id===id)||null,createElement:()=>node(),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};
  const context=vm.createContext({document,window:{},console,fetch:fetchImpl,localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,String(value))},matchMedia:()=>({matches:false}),setTimeout,Blob,URL,URLSearchParams});
  context.window=context;
  vm.runInContext(appSource,context);
  if(withUi)vm.runInContext(uiSource,context);
  return {run:code=>vm.runInContext(code,context),context,nodes};
}

test('card catalog always starts in grid mode even after a previous rarity view',()=>{
  const h=createHarness(undefined,true,{'cardscope-card-view':'rarity'});
  assert.equal(h.run('cardViewMode'),'grid');
});

test('card detail viewer exposes real magnification controls and pan gestures',()=>{
  assert.match(uiSource,/data-zoom-preset="4"/);
  assert.match(uiSource,/touch-action:none/);
  assert.match(uiSource,/pointerdown/);
  assert.match(uiSource,/wheel/);
  assert.match(uiSource,/returnFocus\.focus\(\)/);
});

test('every rendered card image and zoom view carries a SAMPLE watermark',()=>{
  const h=createHarness(undefined,true);
  const markup=h.run("resilientImage('/card.png','測試卡','圖片待補')");
  assert.match(markup,/card-sample-watermark/);
  assert.match(markup,/>SAMPLE</);
  assert.match(uiSource,/card-sample-watermark-zoom/);
  assert.match(uiSource,/if\(sample\)sample\.hidden=true/);
});

test('mobile layout constrains header, dialogs, filters, and long text to the viewport',async()=>{
  const [layout,switcher]=await Promise.all([
    readFile(new URL('../catalog-layout.css',import.meta.url),'utf8'),
    readFile(new URL('../game-switcher.js',import.meta.url),'utf8')
  ]);
  for(const rule of ['overflow-x:clip','grid-template-columns:minmax(0,1fr) auto','grid-column:1/-1','min-height:100dvh','overflow-wrap:anywhere'])assert.match(layout,new RegExp(rule.replace(/[()]/g,'\\$&')));
  assert.match(layout,/\.channel-art img\{width:auto;height:auto;max-width:92px;max-height:44px;padding:0\}/);
  assert.match(layout,/\.brand-showcase picture\{position:absolute;inset:0 0 0 42%;width:auto\}/);
  assert.match(switcher,/max-height:calc\(100dvh - 16px\)/);
  assert.match(switcher,/grid-template-columns:64px minmax\(0,1fr\)/);
});

test('default catalog browsing fetches only the requested page and its image relations',()=>{
  assert.match(serverSource,/function databaseFastBrowseEligible/);
  assert.match(serverSource,/supabaseFetchPage\(`\/tcg_cards\?\$\{params\}`\)/);
  assert.match(serverSource,/loadDatabasePageRelations\('tcg_printings'/);
  assert.match(serverSource,/loadDatabasePageRelations\('card_images'/);
  assert.match(serverSource,/Prefer:'count=exact'/);
  assert.match(indexSource,/正在載入\$\{G\(selectedGame\)\.nameZh\|\|selectedGame\}卡片與圖片/);
  assert.match(indexSource,/countedRarities\.length\?countedRarities:rankedRarities/);
});

test('taxonomy keeps card systems separate from current and planned franchises',async()=>{
  const taxonomy=JSON.parse(await readFile(new URL('../data/game-taxonomy.json',import.meta.url),'utf8'));
  const weiss=taxonomy.systems.find(system=>system.id==='weiss-schwarz');
  assert.equal(weiss.nameZh,'Weiß Schwarz');
  assert.equal(weiss.franchises.find(item=>item.id==='frieren').status,'active');
  assert.equal(weiss.franchises.find(item=>item.id==='rezero').status,'planned');
  assert.equal(taxonomy.systems.find(system=>system.id==='union-arena').enabled,false);
  assert.equal(taxonomy.assetPolicy.officialPermissionRequired,true);
});

test('rarity order is game-specific in both directions and keeps unknown values last',()=>{
  const h=createHarness();
  h.run(`rarityRankings=${JSON.stringify(rarityRankings)}`);
  assert.ok(h.run("compareRarityLabels('pokemon','SAR','C','desc')")<0);
  assert.ok(h.run("compareRarityLabels('pokemon','SAR','C','asc')")>0);
  assert.ok(h.run("compareRarityLabels('onepiece','SEC','UC','desc')")<0);
  assert.ok(h.run("compareRarityLabels('yugioh','Ghost Rare','Common','desc')")<0);
  assert.ok(h.run("compareRarityLabels('weiss-schwarz','SEC+','SEC','desc')")<0);
  assert.ok(h.run("compareRarityLabels('haikyuu','SP','C','desc')")<0);
  assert.ok(h.run("compareRarityLabels('pokemon','尚待對照','C','desc')")>0);
  assert.ok(h.run("compareRarityLabels('pokemon','尚待對照','C','asc')")>0);
});

test('rarity grouping follows the selected high-to-low or low-to-high order',()=>{
  const h=createHarness(undefined,true);
  const rows="[{id:'c',game:'pokemon',nameZh:'普通卡',rarity:'C',officialCardNumber:'003'},{id:'sar',game:'pokemon',nameZh:'特別卡',rarity:'SAR',officialCardNumber:'001'},{id:'u',game:'pokemon',nameZh:'未知卡',rarity:'尚待對照',officialCardNumber:'002'}]";
  h.run(`rarityRankings=${JSON.stringify(rarityRankings)};C={games:[{id:'pokemon',nameZh:'寶可夢'}],cards:[]};cardViewMode='rarity';cardFilters.sort='rarity-desc'`);
  const high=h.run(`renderCardRows(${rows})`);
  assert.ok(high.indexOf('>SAR<')<high.indexOf('>C<'));
  assert.ok(high.indexOf('>C<')<high.indexOf('>尚待對照<'));
  h.run("cardFilters.sort='rarity-asc'");
  const low=h.run(`renderCardRows(${rows})`);
  assert.ok(low.indexOf('>C<')<low.indexOf('>SAR<'));
  assert.ok(low.indexOf('>SAR<')<low.indexOf('>尚待對照<'));
});

test('all-game default renders the IP chooser and no individual cards',()=>{
  const h=createHarness();
  const calls=JSON.parse(h.run(`calls=[];C={cards:[{id:'card-1'}]};P=[{id:'product-1',catalogCategory:'sealed'}];game='all';productCategory='sealed';productCategoryId='sealed';channels=()=>calls.push('channels');productCategories=()=>calls.push('categories');series=()=>calls.push('series');clearProduct=()=>calls.push('clear');renderGameLanding=()=>calls.push('landing');cards=rows=>calls.push({kind:'cards',ids:rows.map(row=>row.id)});render();JSON.stringify(calls)`));
  assert.deepEqual(calls,['channels','categories','series','clear','landing']);
  assert.equal(calls.some(call=>typeof call==='object'&&call.kind==='cards'),false);
});

test('selected IP loading keeps only cards belonging to that IP',async()=>{
  let requestedUrl='';
  const h=createHarness(async url=>{requestedUrl=String(url);return{ok:true,json:async()=>({data:[{id:'pk-1',game:'pokemon',nameZh:'寶可夢卡'},{id:'op-1',game:'onepiece',nameZh:'航海王卡'}],meta:{hasMore:false}})}});
  h.run("game='pokemon';browse={rows:[],offset:0,seriesId:'',product:null,hasMore:false,loading:false};currentCardRows=[];cards=rows=>{currentCardRows=rows}");
  await h.run('loadCardsPage(true)');
  assert.match(requestedUrl,/game=pokemon/);
  assert.equal(h.run('currentCardRows.map(card=>card.id).join(",")'),'pk-1');
  assert.equal(h.run('currentCardRows.every(card=>card.game===game)'),true);
});

test('cross-IP rarity mode creates one group for each IP and rarity pair',()=>{
  const h=createHarness(undefined,true);
  const rendered=h.run(`C={games:[{id:'pokemon',nameZh:'寶可夢'},{id:'onepiece',nameZh:'航海王'}],cards:[]};cardViewMode='rarity';renderCardRows([
    {id:'pk-sr',game:'pokemon',nameZh:'寶可夢 SR',officialCardNumber:'PK-1',rarity:'SR',region:'JP'},
    {id:'op-sr',game:'onepiece',nameZh:'航海王 SR',officialCardNumber:'OP-1',rarity:'SR',region:'JP'},
    {id:'pk-r',game:'pokemon',nameZh:'寶可夢 R',officialCardNumber:'PK-2',rarity:'R',region:'JP'},
    {id:'op-r',game:'onepiece',nameZh:'航海王 R',officialCardNumber:'OP-2',rarity:'R',region:'JP'}
  ])`);
  const groups=[...rendered.matchAll(/<section class="rarity-group"[\s\S]*?<\/section>/g)].map(match=>match[0]);
  assert.equal(groups.length,4);
  for(const [gameName,rarity,id,otherId] of [['寶可夢','SR','pk-sr','op-sr'],['航海王','SR','op-sr','pk-sr'],['寶可夢','R','pk-r','op-r'],['航海王','R','op-r','pk-r']]){
    const group=groups.find(item=>item.includes(gameName)&&item.includes(`>${rarity}<`));
    assert.ok(group,`${gameName} ${rarity} heading is missing`);
    assert.match(group,new RegExp(`data-card-open="${id}"`));
    assert.doesNotMatch(group,new RegExp(`data-card-open="${otherId}"`));
  }
});
