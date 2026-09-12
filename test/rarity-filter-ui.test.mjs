import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const source=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n').split('async function init()')[0];
const rankings=JSON.parse(await readFile(new URL('../data/rarity-rankings.json',import.meta.url),'utf8'));

function harness(responses){
  const nodes=new Map(),requests=[];
  const node=(id='')=>{
    if(id&&nodes.has(id))return nodes.get(id);
    const value={id,value:'all',innerHTML:'',textContent:'',style:{},classList:{add(){},remove(){}},disabled:false,scrollIntoView(){}};
    if(id)nodes.set(id,value);return value;
  };
  for(const id of ['browseRegion','rarityFilter','priceFilter','cardSort','notice','loadMore','cards','filterSummary','cardsTitle','cardsMeta','selectedProduct'])node(id);
  const document={getElementById:id=>nodes.get(id)||null,createElement:()=>node(),querySelector:()=>null,querySelectorAll:()=>[]};
  const fetch=async url=>{requests.push(String(url));return responses.shift()||{ok:true,json:async()=>({data:[],meta:{hasMore:false}})}};
  const context=vm.createContext({document,window:{},console,fetch,URL,URLSearchParams,location:{origin:'http://localhost'}});
  context.window=context;
  vm.runInContext(source,context);
  return {run:code=>vm.runInContext(code,context),node,requests};
}

test('SP aliases collapse into one canonical option and remain available after filtering',async()=>{
  const responses=[
    {ok:true,json:async()=>({data:[{id:'sp',game:'onepiece',rarity:'SP CARD',officialCardNumber:'OP-1'},{id:'sec',game:'onepiece',rarity:'SEC',officialCardNumber:'OP-2'}],meta:{hasMore:false,total:2,facets:{rarity:{'SP CARD':1,'SP卡':1,SEC:1}}}})},
    {ok:true,json:async()=>({data:[{id:'sp',game:'onepiece',rarity:'SP CARD',officialCardNumber:'OP-1'}],meta:{hasMore:false,total:1,facets:{rarity:{'SP CARD':1}}}})},
    {ok:true,json:async()=>({data:[{id:'sec',game:'onepiece',rarity:'SEC',officialCardNumber:'OP-2'}],meta:{hasMore:false,total:1,facets:{rarity:{SEC:1}}}})}
  ];
  const h=harness(responses);
  h.run(`rarityRankings=${JSON.stringify(rankings)};game='onepiece';C={games:[{id:'onepiece',nameZh:'航海王'}],cards:[]};browse={rows:[],offset:0,seriesId:'',product:null,hasMore:false,loading:false,total:0,facets:null};cardFilters={rarity:'all',price:'all',sort:'number-asc'}`);
  await h.run('loadCardsPage(true)');
  assert.match(h.node('rarityFilter').innerHTML,/value="SP"/);
  assert.doesNotMatch(h.node('rarityFilter').innerHTML,/value="SP CARD"/);
  assert.match(h.node('rarityFilter').innerHTML,/value="SEC"/);

  h.run("cardFilters.rarity='SP'");
  await h.run('loadCardsPage(true)');
  assert.equal(h.node('rarityFilter').value,'SP');
  assert.match(h.node('rarityFilter').innerHTML,/value="SEC"/);
  assert.match(h.node('rarityFilter').innerHTML,/全部稀有度/);

  h.run("cardFilters.rarity='SEC'");
  await h.run('loadCardsPage(true)');
  assert.match(h.requests[2],/rarity=SEC/);
});

test('rarity mapping does not strip CARD from unknown values',()=>{
  const h=harness([]);
  h.run(`rarityRankings=${JSON.stringify(rankings)}`);
  assert.equal(h.run("rarityCanonicalCode('onepiece','SP CARD')"),'SP');
  assert.equal(h.run("rarityCanonicalCode('onepiece','SP卡')"),'SP');
  assert.equal(h.run("rarityCanonicalCode('onepiece','CUSTOM CARD')"),'CUSTOM CARD');
});

test('mobile rarity controls stay within the card tools width',async()=>{
  const css=await readFile(new URL('../catalog-layout.css',import.meta.url),'utf8');
  assert.match(css,/\.card-tools \.filter-field select\{width:100%;min-width:0;max-width:100%;/);
  assert.match(css,/\.card-tools \.filter-field:first-child\{flex-basis:100%\}/);
});
