import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const [navigation,ui,html]=await Promise.all([
  readFile(new URL('../navigation-state.js',import.meta.url),'utf8'),
  readFile(new URL('../ui-enhancements.js',import.meta.url),'utf8'),
  readFile(new URL('../index.html',import.meta.url),'utf8')
]);

function navigationHarness(initialSearch='?game=pokemon&region=JP&rarity=SR&price=priced&sort=price-desc&q=luffy&pages=2&card=pk-1'){
  const location={origin:'http://localhost',pathname:'/',search:initialSearch,hash:''},historyCalls=[],documentListeners=new Map(),windowListeners=new Map(),nodes=new Map();
  const initialParams=new URLSearchParams(initialSearch);
  const classList=()=>{
    const values=new Set();
    return {add(...items){items.forEach(item=>values.add(item))},remove(...items){items.forEach(item=>values.delete(item))},contains(item){return values.has(item)}};
  };
  const makeNode=(id,value='')=>{
    const listeners=new Map(),node={id,value,style:{},dataset:{},classList:classList(),children:[],textContent:'',
      addEventListener(type,handler){const handlers=listeners.get(type)||[];handlers.push(handler);listeners.set(type,handlers)},
      dispatchEvent(event){for(const handler of listeners.get(event.type)||[])handler(event)},
      querySelector(){return null},querySelectorAll(){return[]},closest(){return null},after(){},append(){},prepend(){},
      setAttribute(){},removeAttribute(){},focus(){this.focused=true}};
    nodes.set(id,node);return node;
  };
  for(const id of ['browseRegion','priceFilter','cardSort','q','modal','close','detail','cardZoom'])makeNode(id);
  nodes.get('browseRegion').value=initialParams.get('region')||'all';
  nodes.get('priceFilter').value=initialParams.get('price')||'all';
  nodes.get('cardSort').value=initialParams.get('sort')||'number-asc';
  nodes.get('q').value=initialParams.get('q')||'';
  const document={
    getElementById:id=>nodes.get(id),
    querySelector:()=>null,
    createElement:()=>makeNode(`created-${nodes.size}`),
    addEventListener(type,handler){const handlers=documentListeners.get(type)||[];handlers.push(handler);documentListeners.set(type,handlers)}
  };
  const applyUrl=url=>{const parsed=new URL(url,location.origin);location.pathname=parsed.pathname;location.search=parsed.search;location.hash=parsed.hash};
  const history={state:{scrollY:0},replaceState(state,unused,url){this.state=state;historyCalls.push({method:'replace',url});applyUrl(url)},pushState(state,unused,url){this.state=state;historyCalls.push({method:'push',url});applyUrl(url)}};
  const context=vm.createContext({document,history,location,URL,URLSearchParams,console,setTimeout,clearTimeout,requestAnimationFrame:callback=>{callback();return 1},window:null,
    C:{games:[{id:'pokemon',nameZh:'寶可夢'}]},game:initialParams.get('game')||'all',browse:{seriesId:'',offset:Number(initialParams.get('pages')||1)>1?200:0,loading:false,hasMore:false},
    cardFilters:{rarity:initialParams.get('rarity')||'all',price:initialParams.get('price')||'all',sort:initialParams.get('sort')||'number-asc'},
    openCalls:[],chooseCalls:[]});
  context.window=context;
  context.scrollTo=()=>{};
  context.addEventListener=(type,handler)=>{const handlers=windowListeners.get(type)||[];handlers.push(handler);windowListeners.set(type,handlers)};
  vm.runInContext("let activeDetailCardId=null; choose=async id=>{chooseCalls.push(id);game=id}; openCard=async id=>{openCalls.push(id);activeDetailCardId=id;document.getElementById('modal').classList.add('open')};",context);
  vm.runInContext(navigation,context);
  const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
  const dispatchWindow=(type,event={type})=>Promise.all((windowListeners.get(type)||[]).map(handler=>handler(event)));
  const dispatchDocument=(type,event={type})=>{for(const handler of documentListeners.get(type)||[])handler(event);return event};
  context.dispatchEvent=event=>dispatchWindow(event.type,event);
  const setSearch=search=>{location.search=search};
  const dispatchPopstate=async()=>{await dispatchWindow('popstate',{type:'popstate'})};
  const dispatchEscape=()=>{const event={type:'keydown',key:'Escape',defaultPrevented:false,preventDefault(){this.defaultPrevented=true}};dispatchDocument('keydown',event);return event};
  return {context,nodes,historyCalls,flush,setSearch,dispatchPopstate,dispatchEscape,run:code=>vm.runInContext(code,context)};
}

test('shareable browsing URLs preserve every public catalog dimension',()=>{
  for(const key of ['game','region','series','rarity','price','sort','q','card','pages'])assert.match(navigation,new RegExp(`params\\.set\\('${key}'`),`${key} is missing from URL state`);
  assert.match(navigation,/popstate/);
  assert.match(navigation,/scrollRestoration='manual'/);
  assert.match(navigation,/scrollY/);
  assert.match(navigation,/loadCardsPage\(false\)/);
  assert.match(navigation,/分享此卡/);
  assert.match(html,/navigation-state\.js/);
});

test('primary catalog content is moved ahead of secondary coverage content',()=>{
  assert.match(navigation,/main\.insertBefore\(guidance,brand\)/);
  assert.match(navigation,/main\.insertBefore\(coverage,brand\)/);
});

test('card detail waits only for core card data',()=>{
  const coreFetch=ui.indexOf("const cr=await fetch('/api/cards/'");
  const optionalFetch=ui.indexOf('Promise.allSettled',coreFetch);
  const coreCheck=ui.indexOf('if(!cr.ok)throw Error',coreFetch);
  assert.ok(coreFetch>=0&&coreCheck>coreFetch&&optionalFetch>coreCheck,'optional market/report requests must start after the core card response succeeds');
  assert.match(ui,/行情服務暫時無法回應；卡片資料仍可正常查看/);
});

test('Back to a URL without a card closes detail and preserves browsing state',async()=>{
  const h=navigationHarness();
  await h.flush();
  assert.equal(h.nodes.get('modal').classList.contains('open'),true);
  assert.equal(h.run('activeDetailCardId'),'pk-1');
  h.setSearch('?game=pokemon&region=JP&rarity=SR&price=priced&sort=price-desc&q=luffy&pages=2');
  await h.dispatchPopstate();
  assert.equal(h.nodes.get('modal').classList.contains('open'),false);
  assert.equal(h.run('activeDetailCardId'),null);
  const params=new URL(h.historyCalls.at(-1).url,'http://localhost').searchParams;
  for(const [key,value] of [['game','pokemon'],['region','JP'],['rarity','SR'],['price','priced'],['sort','price-desc'],['q','luffy'],['pages','2']])assert.equal(params.get(key),value,key);
  assert.equal(params.has('card'),false);
});

test('Escape clears card history only when zoom is not active',async()=>{
  const h=navigationHarness('');
  await h.flush();
  h.setSearch('?game=pokemon&region=JP&card=pk-2');
  h.run("activeDetailCardId='pk-2';document.getElementById('modal').classList.add('open')");
  h.dispatchEscape();
  assert.equal(h.nodes.get('modal').classList.contains('open'),false);
  assert.equal(h.run('activeDetailCardId'),null);
  assert.equal(new URL(h.historyCalls.at(-1).url,'http://localhost').searchParams.has('card'),false);

  h.setSearch('?game=pokemon&region=JP&card=pk-3');
  h.run("activeDetailCardId='pk-3';document.getElementById('modal').classList.add('open');document.getElementById('cardZoom').classList.add('open')");
  const before=h.historyCalls.length;
  h.dispatchEscape();
  assert.equal(h.nodes.get('modal').classList.contains('open'),true);
  assert.equal(h.run('activeDetailCardId'),'pk-3');
  assert.equal(new URL(h.context.location.href||`http://localhost${h.context.location.pathname}${h.context.location.search}`,'http://localhost').searchParams.get('card'),'pk-3');
  assert.equal(h.historyCalls.length,before);
});

test('Forward and reload with a card reopen the requested detail',async()=>{
  const h=navigationHarness('');
  await h.flush();
  h.setSearch('?game=pokemon&region=JP&card=pk-forward');
  await h.dispatchPopstate();
  assert.equal(h.nodes.get('modal').classList.contains('open'),true);
  assert.equal(h.run('activeDetailCardId'),'pk-forward');

  const reloaded=navigationHarness('?game=pokemon&region=JP&card=pk-reload');
  await reloaded.flush();
  assert.equal(reloaded.nodes.get('modal').classList.contains('open'),true);
  assert.equal(reloaded.run('activeDetailCardId'),'pk-reload');
});
