import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// 首頁「最新｜最夯｜最熱」（home-rails.js）：標記跳脫、ARIA、鍵盤、預設分頁、API 失敗／空資料時的空白狀態。
const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');
const [html,railsSrc,moversSrc,css]=await Promise.all(['index.html','home-rails.js','price-movers.js','look-v2.css'].map(read));
const tick=()=>new Promise(resolve=>setImmediate(resolve));

const moverRow=(i,extra={})=>({cardId:`pokemon-up-${i}`,name:`漲幅卡 ${i}`,cardNumber:`${i}/100`,seriesCode:'SV5',changePercent:80-i,imageUrl:`https://img.example/${i}.png`,from:{date:'2026-10-29',amount:10,amountTwd:350},to:{date:'2026-11-11',amount:18,amountTwd:630},...extra});
const prizeRow=(i,extra={})=>({cardId:`onepiece-op17-${i}`,name:`大獎卡 ${i}`,cardNumber:`OP17-11${i}`,rarity:'SEC',altArt:false,seriesCode:'OP-17',game:'onepiece',imageUrl:`https://img.example/p${i}.png`,...extra});
const prizes=(games,pinned=[])=>({pinned,games,meta:{windowDays:90}});
const hotRow=(i,extra={})=>({cardId:`pokemon-hot-${i}`,name:`熱門卡 ${i}`,nameJa:'ホット',cardNumber:`${i}/190`,seriesCode:'SV6a',seriesName:'夜之狂亂',game:'pokemon',imageUrl:`https://img.example/h${i}.png`,...extra});

// 兩支 script 跑在同一個假的 window 裡（和瀏覽器一樣：home-rails 向 price-movers 要共用的請求）。
function load({responses={},doc}={}){
  const calls=[],ctx={infoTip:(label,body)=>`[ⓘ ${label}|${body}]`,setTimeout:()=>0,document:doc};
  ctx.window=ctx;
  ctx.fetch=url=>{calls.push(url);const r=responses[url];return r instanceof Error?Promise.reject(r):Promise.resolve(r||{ok:false,status:404,json:async()=>({})})};
  vm.createContext(ctx);
  vm.runInContext(moversSrc,ctx);vm.runInContext(railsSrc,ctx);
  return {ctx,calls,rails:ctx.homeRails};
}
const ok=body=>({ok:true,status:200,json:async()=>body});

test('最熱：空資料與讀取中的空白狀態；兔子素材用 BRAND_RABBIT 的檔案，一句話說明',()=>{
  const {rails}=load();
  const empty=rails.hotPanel({rows:[],meta:{}});
  assert.match(empty,/rails-empty/);
  assert.match(empty,/src="\/assets\/brand\/web\/rabbit-offline\.webp" alt=""/,'裝飾圖，alt 留空');
  assert.match(empty,/熱門排行統計中，累積幾天後就會出現/);
  assert.doesNotMatch(empty,/trend-card/);
  assert.match(rails.hotPanel(undefined),/讀取中/);
  assert.doesNotMatch(rails.hotPanel(undefined),/rails-empty/,'還沒回應時不能先說「統計中」');
});

test('最熱：ⓘ 寫明依本站被開啟次數、不記錄是誰開的；meta 的數字被轉成數字',()=>{
  const {rails}=load();
  const html=rails.hotPanel({rows:[hotRow(1)],meta:{windowDays:7,minOpens:3}});
  assert.match(html,/\[ⓘ 熱門排行的算法\|/);
  assert.match(html,/依本站近 7 天卡片被開啟的次數排序，不記錄是誰開的/);
  assert.match(html,/至少 3 次/);
  const evil=rails.hotPanel({rows:[],meta:{windowDays:'7<script>',minOpens:'<b>'}});
  assert.doesNotMatch(evil,/<script|NaN|門檻/);
  assert.match(evil,/近 7 天/);
});

test('最熱：卡名、卡號、圖片網址都跳脫；點卡用 data-do="openCard"，沒有行內事件',()=>{
  const {rails}=load();
  const out=rails.hotPanel({rows:[hotRow(1,{name:'<img src=x onerror=alert(1)>',cardId:'a"b',imageUrl:'https://x/"><script>1</script>',seriesName:'<i>',cardNumber:'<u>'}),hotRow(2,{imageUrl:null})],meta:{}});
  assert.doesNotMatch(out,/<img src=x|<script|<i>|<u>/);
  assert.match(out,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(out,/data-do="openCard" data-arg="a&quot;b"/);
  assert.doesNotMatch(out.replace(/"[^"]*"/g,'""'),/<[^>]*\son[a-z]+=/,'屬性值外沒有 onXXX=（卡名裡的 onerror= 已被跳脫在 alt 裡）');
  assert.match(out,/data-img-error="swap-hidden"/,'圖片失敗退回既有的 swap-hidden');
  assert.match(out,/圖片待補/,'沒有圖網址時直接顯示待補');
});

test('最夯＝本彈大獎：每個遊戲一排、標題寫遊戲與系列；手動置頂排最前；異圖有文字標記；ⓘ 寫明挑法；留著去行情頁的連結',()=>{
  const {rails}=load();
  const out=rails.trendingPanel(prizes([{game:'onepiece',seriesName:'世界最強的戰士',data:[prizeRow(1,{altArt:true}),prizeRow(2)]},{game:'pokemon',seriesName:'30th CELEBRATION',data:[prizeRow(3,{game:'pokemon',rarity:'SAR',referencePrice:{amountTwd:1234.4}})]}],[prizeRow(9,{name:'置頂卡'})]));
  assert.match(out,/本彈大獎/);
  assert.equal(out.match(/<button type="button" class="trend-card/g).length,4);
  assert.ok(out.indexOf('精選')<out.indexOf('世界最強的戰士')&&out.indexOf('置頂卡')<out.indexOf('大獎卡 1'),'置頂在自動挑選之前');
  assert.match(out,/trend-card-number is-wrap">SEC · 異圖 · OP17-111/,'卡號可換行，手機上不截斷');
  assert.match(out,/置頂卡<\/b><\/div><span[^>]*>[^<]*<\/span><small>OP-17<\/small>/,'精選那排卡上寫遊戲與系列');
  assert.doesNotMatch(out.slice(out.indexOf('世界最強的戰士')),/<small>OP-17/,'各遊戲那排已有標題，卡上不重複');
  assert.match(out,/參考價約 NT\$1,234/,'寶可夢有參考價才顯示');
  assert.doesNotMatch(out.slice(0,out.indexOf('30th')),/參考價約/,'其他遊戲不放價格');
  assert.match(out,/\[ⓘ 本彈大獎怎麼挑\|[^\]]*近 90 天[^\]]*參考價不是成交價/);
  assert.match(out,/<a href="\/\?view=market" data-spa>看參考價漲跌<\/a>/);
  assert.match(out,/data-do="openCard" data-arg="onepiece-op17-1"/);
});

test('最夯：讀取中與沒有資料時各一句話；卡名、系列名跳脫',()=>{
  const {rails}=load();
  assert.match(rails.trendingPanel(undefined),/讀取中/);
  assert.match(rails.trendingPanel(prizes([])),/近期沒有新彈的大獎資料/);
  const evil=rails.trendingPanel(prizes([{game:'onepiece',seriesName:'<i>x</i>',data:[prizeRow(1,{name:'<script>1</script>',cardId:'a"b'})]}]));
  assert.doesNotMatch(evil,/<script>|<i>/);
  assert.match(evil,/data-arg="a&quot;b"/);
});

test('nextTab：左右鍵循環、Home／End、其他鍵不處理',()=>{
  const {rails}=load();
  assert.deepEqual(['ArrowRight','ArrowLeft','Home','End','Enter'].map(key=>rails.nextTab(key,0,3)),[1,2,0,2,-1]);
  assert.equal(rails.nextTab('ArrowRight',2,3),0);
  assert.equal(rails.nextTab('ArrowLeft',1,3),0);
});

// ---- init：用最小的假 DOM 走一遍預設分頁、鍵盤與失敗路徑 ----
function fakeDom(){
  const mk=id=>({dataset:{railsTab:id},classList:{toggle(name,on){this.on=on}},attrs:{},tabIndex:0,focused:false,setAttribute(k,v){this.attrs[k]=v},focus(){this.focused=true},closest(){return this}});
  const tabs=['latest','trending','hot'].map(mk),panels=Object.fromEntries(['latest','trending','hot'].map(id=>[id,{hidden:id!=='latest',innerHTML:''}]));
  const handlers={},bar={addEventListener:(type,fn)=>handlers[type]=fn,querySelectorAll:()=>tabs};
  const section={dataset:{},querySelector:()=>bar};
  const doc={getElementById:id=>id==='homeRails'?section:id.startsWith('railsPanel-')?panels[id.slice(11)]:null};
  return {doc,tabs,panels,section,handlers,selected:()=>tabs.find(tab=>tab.attrs['aria-selected']==='true')?.dataset.railsTab,visible:()=>Object.keys(panels).filter(id=>!panels[id].hidden)};
}

test('預設：最熱有資料就選最熱，兩個請求各打一次；首頁不再打 /api/price-movers（漲跌榜只在行情頁）',async()=>{
  const dom=fakeDom();
  const {calls}=load({doc:dom.doc,responses:{'/api/hot-cards':ok({data:[hotRow(1),hotRow(2)],meta:{windowDays:7,minOpens:3}}),'/api/pack-prizes':ok(prizes([{game:'onepiece',seriesName:'OP-17',data:[prizeRow(1)]}]))}});
  assert.equal(dom.section.dataset.pending,'','等最熱回來前先藏起面板，避免先亮最新再跳');
  await tick();await tick();await tick();
  assert.equal(dom.selected(),'hot');
  assert.deepEqual(dom.visible(),['hot']);
  assert.equal(dom.tabs.find(t=>t.dataset.railsTab==='hot').tabIndex,0);
  assert.equal(dom.tabs.find(t=>t.dataset.railsTab==='latest').tabIndex,-1,'roving tabindex');
  assert.match(dom.panels.hot.innerHTML,/熱門卡 1/);
  assert.match(dom.panels.trending.innerHTML,/大獎卡 1/);
  assert.equal('pending' in dom.section.dataset,false);
  assert.equal(calls.filter(url=>url==='/api/price-movers').length,0);
  assert.equal(calls.filter(url=>url==='/api/pack-prizes').length,1);
  assert.deepEqual(calls.filter(url=>url==='/api/hot-cards').length,1);
});

test('預設：/api/hot-cards 404、空陣列、連線失敗時留在最新，最熱面板是安靜的空白狀態',async()=>{
  for(const response of [undefined,ok({data:[],meta:{windowDays:7,minOpens:3}}),ok({data:null}),new Error('offline'),{ok:true,json:async()=>{throw new Error('bad json')}}]){
    const dom=fakeDom();
    load({doc:dom.doc,responses:{'/api/hot-cards':response,'/api/pack-prizes':response}});
    await tick();await tick();await tick();
    assert.equal(dom.selected(),undefined,'沒有資料就不動 HTML 預設的「最新」');
    assert.match(dom.panels.hot.innerHTML,/熱門排行統計中/);
    assert.match(dom.panels.trending.innerHTML,/近期沒有新彈的大獎資料/);
    assert.equal('pending' in dom.section.dataset,false,'失敗也要解除隱藏');
  }
});

test('最夯：不收壞資料列，整排都壞就不畫那一排',async()=>{
  const dom=fakeDom();
  load({doc:dom.doc,responses:{'/api/pack-prizes':ok({pinned:[null,{name:'沒有 id'}],games:[{game:'pokemon',data:[{cardId:'x'},null,'bad']},{game:'weiss-schwarz',data:[null]},null],meta:{}})}});
  await tick();await tick();await tick();
  assert.equal(dom.panels.trending.innerHTML.match(/<button type="button" class="trend-card/g).length,1);
  assert.doesNotMatch(dom.panels.trending.innerHTML,/rails-sub">(?:精選|weiss)/);
});

test('鍵盤：左右鍵切換並把焦點跟過去，使用者自己選過就不被預設覆蓋',async()=>{
  const dom=fakeDom();
  let release;const slow=new Promise(resolve=>release=resolve);
  const {ctx}=load({doc:dom.doc,responses:{'/api/pack-prizes':ok(prizes([])),'/api/hot-cards':{ok:true,json:()=>slow}}});
  let prevented=0;
  assert.equal(dom.section.dataset.pending,'');
  dom.handlers.keydown({target:dom.tabs[0],key:'ArrowRight',preventDefault:()=>prevented++});
  assert.equal('pending' in dom.section.dataset,false,'自己選了分頁就不再等最熱，面板立刻顯示');
  assert.equal(dom.selected(),'trending');assert.equal(dom.tabs[1].focused,true);assert.deepEqual(dom.visible(),['trending']);assert.equal(prevented,1);
  dom.handlers.keydown({target:dom.tabs[1],key:'End',preventDefault:()=>prevented++});
  assert.equal(dom.selected(),'hot');
  dom.handlers.keydown({target:dom.tabs[2],key:'ArrowRight',preventDefault:()=>prevented++});
  assert.equal(dom.selected(),'latest','最後一個再按右鍵回到第一個');
  dom.handlers.keydown({target:dom.tabs[0],key:'a',preventDefault:()=>prevented++});assert.equal(prevented,3,'其他鍵不攔截');
  release({data:[hotRow(1)],meta:{}});await tick();await tick();await tick();
  assert.equal(dom.selected(),'latest','最熱晚到，但使用者已經自己選了');
  dom.handlers.click({target:dom.tabs[1]});assert.equal(dom.selected(),'trending');
});

test('index.html：tablist／tab／tabpanel 的 ARIA 互相對得上，只有選中的 tab 在 tab 順序裡，最新面板包著原本的 #homeLatest',()=>{
  const section=html.slice(html.indexOf('<section class="home-rails"'),html.indexOf('<section class="about-intro"'));
  assert.match(section,/role="tablist" aria-label="[^"]+"/);
  const tabs=[...section.matchAll(/<button type="button" role="tab" id="(railsTab-\w+)"[^>]*?aria-controls="(railsPanel-\w+)" aria-selected="(true|false)">([^<]+)</g)];
  assert.deepEqual(tabs.map(m=>m[4]),['最新','最夯','最熱']);
  assert.deepEqual(tabs.map(m=>m[3]),['true','false','false']);
  assert.equal([...section.matchAll(/role="tab"[^>]*tabindex="-1"/g)].length,2);
  for(const [,tab,panel] of tabs)assert.match(section,new RegExp(`role="tabpanel" id="${panel}" aria-labelledby="${tab}"`));
  assert.match(section,/id="railsPanel-latest"[^>]*><section class="home-latest" id="homeLatest"/);
  assert.match(section,/id="railsPanel-trending"[^>]*hidden/);assert.match(section,/id="railsPanel-hot"[^>]*hidden/);
  assert.doesNotMatch(html.slice(html.indexOf('<section class="hero"'),html.indexOf('<section class="home-rails"')),/id="homeLatest"/,'#homeLatest 只剩一份，搬出了夜空展示區');
  assert.ok(html.indexOf('<section class="home-rails"')>html.indexOf('id="hero"'),'夜空展示區之後');
  assert.match(html,/const anchor=\$\('marketIntro'\)\|\|\$\('homeRails'\)\|\|hero;if\(anchor\.nextElementSibling!==trends\)anchor\.after\(trends\)/,'完整漲跌榜搬到行情頁，排在行情標題之後');
  assert.match(html,/<section class="market-intro" id="marketIntro"[^>]*><h2 id="marketTitle" tabindex="-1">行情<\/h2>/,'行情頁的標題');
  assert.ok(html.indexOf('id="marketIntro"')<html.indexOf('id="homeRails"'));
});

test('載入順序與 CSP：home-rails.js 在 ui-actions（infoTip）與 price-movers（共用請求）之後，沒有行內事件',()=>{
  const at=name=>html.indexOf(`<script src="/${name}"></script>`);
  assert.ok(at('ui-actions.js')>0&&at('price-movers.js')>at('ui-actions.js')&&at('home-rails.js')>at('price-movers.js'));
  assert.doesNotMatch(railsSrc,/\son[a-z]+=/);
  assert.match(moversSrc,/root\.priceMoversShared=\{request,card,image,info\}/);
  assert.match(moversSrc,/歐洲平台參考價，不是成交價/,'完整漲跌榜標題旁的警語還在');
});

test('樣式：面板先保留高度、分段按鈕沿用 .view-switch、手機頂欄選單縮窄且沒有小於 12px 的字',()=>{
  assert.match(css,/\.home-rails \.rails-panels\{min-height:\d+px/);
  assert.match(css,/body:not\(\[data-view="landing"\]\) #homeRails\{display:none\}/);
  assert.match(css,/#mobileHeaderScope select\{width:2\.5em/);
  assert.match(html,/class="view-switch rails-switch" role="tablist"/);
  assert.match(css,/#homeRails \.trend-card:active\{transform:scale\(\.97\)\}/);
  assert.doesNotMatch(css.slice(css.indexOf('/* ===== 8.'),css.indexOf('/* ===== 9.')),/transition:all|font-size:\s*(?:[0-9]|1[01])(?:\.\d+)?px|@keyframes|animation:/);
});
