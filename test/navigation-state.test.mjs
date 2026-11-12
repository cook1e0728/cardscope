import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const [navigation,ui,html]=await Promise.all([
  readFile(new URL('../navigation-state.js',import.meta.url),'utf8'),
  readFile(new URL('../ui-enhancements.js',import.meta.url),'utf8'),
  readFile(new URL('../index.html',import.meta.url),'utf8')
]);

function navigationHarness(initialSearch='?game=pokemon&region=JP&rarity=SR&price=priced&sort=price-desc&q=luffy&pages=2&card=pk-1',catalogSeries=[]){
  const location={origin:'http://localhost',pathname:'/',search:initialSearch,hash:'',get href(){return this.origin+this.pathname+this.search+this.hash}},historyCalls=[],documentListeners=new Map(),windowListeners=new Map(),nodes=new Map();
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
  const history={state:{scrollY:0},replaceState(state,unused,url){this.state=state;historyCalls.push({method:'replace',url});applyUrl(url)},pushState(state,unused,url){this.state=state;historyCalls.push({method:'push',url});applyUrl(url)},back(){historyCalls.push({method:'back'})}};
  const context=vm.createContext({document,history,location,URL,URLSearchParams,console,setTimeout,clearTimeout,requestAnimationFrame:callback=>{callback();return 1},window:null,
    C:{games:[{id:'pokemon',nameZh:'寶可夢'}],series:catalogSeries},game:initialParams.get('game')||'all',browse:{seriesId:'',offset:Number(initialParams.get('pages')||1)>1?96:0,loading:false,hasMore:false},
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
  const dispatchEscape=(target,prevented=false)=>{const event={type:'keydown',key:'Escape',target,defaultPrevented:prevented,preventDefault(){this.defaultPrevented=true}};dispatchDocument('keydown',event);return event};
  return {context,nodes,historyCalls,flush,setSearch,dispatchPopstate,dispatchEscape,dispatchDocument,run:code=>vm.runInContext(code,context)};
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

test('view=all and a series in the URL pick the game page view without loading the default first',async()=>{
  const all=navigationHarness('?game=pokemon&view=all');
  all.run('browse.all=true');
  await all.flush();
  assert.equal(JSON.stringify(all.context.cardscopeEntry),'{"series":"","all":true}');
  assert.equal(new URL(all.historyCalls.at(-1).url,'http://localhost').searchParams.get('view'),'all','the full-list view survives the URL rewrite');
  const series=navigationHarness('?game=pokemon&series=pokemon-jp-m6a');
  await series.flush();
  assert.equal(JSON.stringify(series.context.cardscopeEntry),'{"series":"pokemon-jp-m6a","all":false}');
  const plain=navigationHarness('?game=pokemon');
  await plain.flush();
  assert.equal(plain.context.cardscopeEntry,null,'a bare game URL opens the default newest series');
});
test('the browse and search announcements from index.html update the URL',async()=>{
  assert.match(navigation,/addEventListener\('cardscope:browse'/);
  assert.match(navigation,/addEventListener\('cardscope:search'/);
  assert.match(html,/new CustomEvent\('cardscope:browse'/);
  assert.match(html,/new CustomEvent\('cardscope:search'/);
});

test('a series deep link without region takes the series own region from the catalog, not the default region',async()=>{
  const tw=navigationHarness('?game=pokemon&series=pokemon-tcgdex-tw-sv8a',[{id:'pokemon-tcgdex-tw-sv8a',region:'TW'}]);
  await tw.flush();
  assert.equal(tw.nodes.get('browseRegion').value,'TW');
  assert.equal(new URL(tw.historyCalls.at(-1).url,'http://localhost').searchParams.get('region'),'TW','the rewritten URL carries the region');
  const explicit=navigationHarness('?game=pokemon&region=JP&series=pokemon-tcgdex-tw-sv8a',[{id:'pokemon-tcgdex-tw-sv8a',region:'TW'}]);
  await explicit.flush();
  assert.equal(explicit.nodes.get('browseRegion').value,'JP','an explicit region wins');
  const unknown=navigationHarness('?game=pokemon&series=nope',[{id:'pokemon-tcgdex-tw-sv8a',region:'TW'}]);
  await unknown.flush();
  assert.equal(unknown.nodes.get('browseRegion').value,'all','a series the catalog does not know leaves the region alone');
});

test('opening a card from the list pushes one history entry; next/previous replace it, switching version leaves the URL, and closing steps back once',async()=>{
  const h=navigationHarness('?game=pokemon&region=JP&series=s1');
  await h.flush();
  const pushes=()=>h.historyCalls.filter(call=>call.method==='push').length,card=()=>new URL(h.context.location.href).searchParams.get('card');
  await h.run("openCard('a')");
  assert.equal(pushes(),1);assert.equal(card(),'a');
  await h.run("openCard('b')");
  assert.equal(pushes(),1,'stepping to another card does not add history');assert.equal(card(),'b');
  await h.run("openCard('t',{keepPosition:true})");
  assert.equal(card(),'b','the version switch keeps the list position in the URL');
  h.nodes.get('close').dispatchEvent({type:'click'});
  assert.equal(h.historyCalls.filter(call=>call.method==='back').length,1,'one Back returns to the list');
  const shared=navigationHarness('?game=pokemon&region=JP&card=x');
  await shared.flush();
  await shared.run("openCard('y')");
  assert.equal(shared.historyCalls.filter(call=>call.method==='push').length,0,'a shared-link card steps without pushing');
  shared.nodes.get('close').dispatchEvent({type:'click'});
  assert.equal(shared.historyCalls.filter(call=>call.method==='back').length,0);
  assert.equal(new URL(shared.context.location.href).searchParams.has('card'),false,'closing drops the card from the URL');
});

test('openCard ignores an answer that arrives after a newer card was requested',()=>{
  assert.match(ui,/const version=\+\+detailRequestVersion,stale=\(\)=>version!==detailRequestVersion/);
  const body=ui.match(/openCard=async function[^]*?window\.openCard=openCard/)[0];
  assert.equal((body.match(/if\(stale\(\)\)return/g)||[]).length,4,'checked after the card answer, after the market/report answers, after a price retry, and in the catch');
});

// ---- 階段 4：側板與歷史（五件事之二）----
const urlOf = h => new URL(h.context.location.href), backs = h => h.historyCalls.filter(call => call.method === 'back').length, pushes = h => h.historyCalls.filter(call => call.method === 'push').length;

test('側板開著時在側欄換系列：網址帶新系列與 card，重新整理會直接開這張；Esc 只關側板，不退回上一個系列', async () => {
  const h = navigationHarness('?game=pokemon&region=JP&series=s1');
  await h.flush();
  h.context.detailMode = () => 'panel';
  await h.run("openCard('a')");
  assert.equal(pushes(h), 1);
  assert.equal(h.context.history.state.cardEntry, true, '從列表打開的那一筆歷史帶 cardEntry');
  // 側板開著，使用者在側欄選了別的系列（index.html 宣告 cardscope:browse，push）
  h.run("browse.seriesId='s2'");
  h.dispatchDocument('cardscope:browse', { type: 'cardscope:browse', detail: { push: true } });
  assert.equal(pushes(h), 2);
  assert.equal(urlOf(h).searchParams.get('series'), 's2');
  assert.equal(urlOf(h).searchParams.get('card'), 'a', '側板還開著，網址仍帶 card');
  assert.equal(h.context.history.state.cardEntry, false, '這一筆已經不是「從列表打開」的那一筆');
  const event = h.dispatchEscape();
  assert.equal(event.defaultPrevented, true);
  assert.equal(backs(h), 0, 'Esc 不用 history.back（否則會退回舊系列）');
  assert.equal(h.nodes.get('modal').classList.contains('open'), false);
  assert.equal(urlOf(h).searchParams.get('series'), 's2', '留在新系列');
  assert.equal(urlOf(h).searchParams.has('card'), false, '只拿掉 card');
  assert.equal(pushes(h), 2, '關閉沒有新增歷史');
});

test('從列表打開側板後 Esc：退回打開前的那一筆歷史（一步），Back 之後的 popstate 不會重複還原', async () => {
  const h = navigationHarness('?game=pokemon&region=JP&series=s1');
  await h.flush();
  h.context.detailMode = () => 'panel';
  await h.run("openCard('a')");
  await h.run("openCard('b')");
  assert.equal(pushes(h), 1, '上一張／下一張只改網址，不加歷史');
  h.dispatchEscape();
  assert.equal(backs(h), 1);
  assert.equal(h.nodes.get('modal').classList.contains('open'), false, '先關側板再退，畫面不等網址');
  const calls = h.historyCalls.length;
  h.setSearch('?game=pokemon&region=JP&series=s1');
  await h.dispatchPopstate();
  assert.equal(h.historyCalls.length, calls, '自己發起的返回不再還原一次（會重畫卡牆、捲動跳掉）');
});

test('Back 關閉側板：回到沒有 card 的網址就關，沒有 card 的 Forward 再回來會重開', async () => {
  const h = navigationHarness('?game=pokemon&region=JP&series=s1');
  await h.flush();
  h.context.detailMode = () => 'panel';
  await h.run("openCard('a')");
  h.setSearch('?game=pokemon&region=JP&series=s1');
  await h.dispatchPopstate();
  assert.equal(h.nodes.get('modal').classList.contains('open'), false);
  assert.equal(h.run('activeDetailCardId'), null);
  h.setSearch('?game=pokemon&region=JP&series=s1&card=a');
  await h.dispatchPopstate();
  assert.equal(h.nodes.get('modal').classList.contains('open'), true);
  assert.equal(h.run('activeDetailCardId'), 'a');
});

test('網址直開（重新整理）：card 在網址上就直接開側板；這種情況 Esc 只拿掉 card，不離開頁面', async () => {
  const h = navigationHarness('?game=pokemon&region=JP&series=s1&card=pk-9');
  await h.flush();
  h.context.detailMode = () => 'panel';
  assert.equal(h.nodes.get('modal').classList.contains('open'), true);
  assert.equal(h.run('activeDetailCardId'), 'pk-9');
  h.dispatchEscape();
  assert.equal(backs(h), 0, '這筆歷史不是 openCard 推出來的，退回去會離開網站');
  assert.equal(urlOf(h).searchParams.has('card'), false);
  assert.equal(urlOf(h).searchParams.get('region'), 'JP', '其餘網址狀態不動');
});

test('側板常駐時，搜尋框、選單裡的 Esc 留給它們自己；全螢幕詳細頁與其他地方的 Esc 照樣關閉', async () => {
  const input = { closest: selector => (/input/.test(selector) ? {} : null) }, plain = { closest: () => null };
  const panel = navigationHarness('?game=pokemon&region=JP&series=s1');
  await panel.flush();
  panel.context.detailMode = () => 'panel';
  await panel.run("openCard('a')");
  const typed = panel.dispatchEscape(input);
  assert.equal(typed.defaultPrevented, false);
  assert.equal(panel.nodes.get('modal').classList.contains('open'), true, '搜尋框裡的 Esc 不關側板');
  panel.dispatchEscape(plain);
  assert.equal(panel.nodes.get('modal').classList.contains('open'), false, '側欄、卡牆、側板內的 Esc 關側板');
  const page = navigationHarness('?game=pokemon&region=JP&series=s1');
  await page.flush();
  page.context.detailMode = () => 'page';
  await page.run("openCard('a')");
  page.dispatchEscape(input);
  assert.equal(page.nodes.get('modal').classList.contains('open'), false, '全螢幕詳細頁蓋住整頁，Esc 一律關閉');
});

test('ⓘ 說明先處理 Esc（已 preventDefault）：這時詳細頁不關', async () => {
  const h = navigationHarness('?game=pokemon&region=JP&series=s1');
  await h.flush();
  await h.run("openCard('a')");
  h.dispatchEscape({ closest: () => null }, true);
  assert.equal(h.nodes.get('modal').classList.contains('open'), true);
});
