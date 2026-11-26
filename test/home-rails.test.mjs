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
  assert.match(out,/<span class="trend-card-meta"><span class="tc-no" title="OP17-111">OP17-111<\/span><span class="card-rarity" data-tier="top">SEC<\/span><\/span>/,'同卡牆：卡號＋稀有度膠囊同一行');
  assert.match(out,/<span class="tc-alt">異圖<\/span>/,'異圖標在卡圖角上');
  assert.match(out,/置頂卡<\/b><\/div><span class="trend-card-meta">.*?<\/span><\/span><small>OP-17<\/small>/,'精選那排卡上寫遊戲與系列');
  assert.doesNotMatch(out.slice(out.indexOf('世界最強的戰士')),/<small>OP-17/,'各遊戲那排已有標題，卡上不重複');
  assert.match(out,/<strong class="trend-price">NT\$1,234<\/strong><small>參考價（約）<\/small>/,'寶可夢有參考價才顯示，金額獨立放大');
  const tiers=rails.trendingPanel(prizes([{game:'union-arena',seriesName:'x',data:[prizeRow(1,{rarity:'SR★★★'}),prizeRow(2,{rarity:'SR★★★'}),prizeRow(3,{rarity:'SR★★'}),prizeRow(4,{rarity:'SR★'}),prizeRow(5,{rarity:'UR'})]}]));
  assert.deepEqual([...tiers.matchAll(/data-tier="(\w+)"/g)].map(m=>m[1]),['top','top','high','mid','mid'],'每排第一種稀有度金、第二種銀、其餘銅');
  assert.match(rails.trendingPanel(prizes([{game:'pokemon',seriesName:'x',data:[prizeRow(4,{game:'pokemon',referencePrice:{amountTwd:840},priceRegion:'JP'})]}])),/NT\$840<\/strong><small>日版參考價（約）/,'借日版價格要寫明');
  assert.doesNotMatch(out.slice(0,out.indexOf('30th')),/trend-price/,'其他遊戲不放價格');
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

// ---- init：用最小的假 DOM 走一遍三排的載入、失敗路徑與 ☆ ----
function fakeDom(){
  const panels=Object.fromEntries(['latest','trending','hot'].map(id=>[id,{hidden:false,innerHTML:'',focused:false,focus(){this.focused=true}}]));
  const handlers={},buttons=[];
  const section={dataset:{},addEventListener:(type,fn)=>{const prev=handlers[type];handlers[type]=prev?event=>{prev(event);fn(event)}:fn}};
  const doc={getElementById:id=>id==='homeRails'?section:id.startsWith('railsPanel-')?panels[id.slice(11)]:null,querySelectorAll:()=>buttons};
  return {doc,panels,section,handlers,buttons,visible:()=>Object.keys(panels).filter(id=>!panels[id].hidden)};
}

test('三排直接顯示：最熱與大獎各打一次 API、都畫出來；首頁不打 /api/price-movers（漲跌榜只在行情頁）',async()=>{
  const dom=fakeDom();
  const {calls}=load({doc:dom.doc,responses:{'/api/hot-cards':ok({data:[1,2,3,4,5,6].map(i=>hotRow(i)),meta:{windowDays:7,minOpens:3}}),'/api/pack-prizes':ok(prizes([{game:'onepiece',seriesName:'OP-17',data:[1,2,3,4,5,6].map(i=>prizeRow(i))}]))}});
  assert.match(dom.panels.hot.innerHTML,/讀取中/,'資料回來前先說讀取中');
  await tick();await tick();await tick();
  assert.deepEqual(dom.visible(),['latest','trending','hot']);
  assert.match(dom.panels.hot.innerHTML,/熱門卡 1/);
  assert.match(dom.panels.trending.innerHTML,/大獎卡 1/);
  assert.equal(calls.filter(url=>url==='/api/price-movers').length,0);
  assert.equal(calls.filter(url=>url==='/api/pack-prizes').length,1);
  assert.equal(calls.filter(url=>url==='/api/hot-cards').length,1);
});

test('預設：/api/hot-cards 404、空陣列時兩排都是安靜的空白狀態，不藏起來',async()=>{
  for(const response of [undefined,ok({data:[],meta:{windowDays:7,minOpens:3}}),ok({data:null})]){
    const dom=fakeDom();
    load({doc:dom.doc,responses:{'/api/hot-cards':response,'/api/pack-prizes':response}});
    await tick();await tick();await tick();
    assert.match(dom.panels.hot.innerHTML,/熱門排行統計中/);
    assert.match(dom.panels.trending.innerHTML,/近期沒有新彈的大獎資料/);
    assert.deepEqual(dom.visible(),['latest','trending','hot']);
  }
});

test('讀取失敗（連線中斷、5xx、壞 JSON）不能畫成「沒有資料」：寫「暫時讀不到」並給重試鈕，重試會重新請求（體檢 HCI-05）',async()=>{
  for(const response of [new Error('offline'),{ok:false,status:502,json:async()=>({})},{ok:true,json:async()=>{throw new Error('bad json')}}]){
    const dom=fakeDom();
    const {calls}=load({doc:dom.doc,responses:{'/api/hot-cards':response,'/api/pack-prizes':response}});
    await tick();await tick();await tick();
    for(const id of ['hot','trending']){
      assert.match(dom.panels[id].innerHTML,/暫時讀不到/);
      assert.match(dom.panels[id].innerHTML,new RegExp(`data-rails-retry="${id}"`));
    }
    assert.doesNotMatch(dom.panels.hot.innerHTML,/熱門排行統計中/);
    assert.doesNotMatch(dom.panels.trending.innerHTML,/近期沒有新彈的大獎資料/);
    assert.equal(dom.panels.hot.hidden,false,'失敗的那排不能被當成「不到一排」藏起來');
    const before=calls.filter(url=>url==='/api/hot-cards').length;
    dom.handlers.click({target:{closest:()=>({dataset:{railsRetry:'hot'}})}});
    assert.match(dom.panels.hot.innerHTML,/讀取中/,'按重試先回到讀取中');
    assert.equal(dom.panels.hot.focused,true,'焦點移到那一排，不掉到頁首');
    await tick();await tick();
    assert.equal(calls.filter(url=>url==='/api/hot-cards').length,before+1);
  }
});

test('最夯：不收壞資料列，整排都壞就不畫那一排',async()=>{
  const dom=fakeDom();
  load({doc:dom.doc,responses:{'/api/pack-prizes':ok({pinned:[null,{name:'沒有 id'}],games:[{game:'pokemon',data:[{cardId:'x'},null,'bad']},{game:'weiss-schwarz',data:[null]},null],meta:{}})}});
  await tick();await tick();await tick();
  assert.equal(dom.panels.trending.innerHTML.match(/<button type="button" class="trend-card/g).length,1);
  assert.doesNotMatch(dom.panels.trending.innerHTML,/rails-sub">(?:精選|weiss)/);
});

test('榜上只有 1–5 張卡：那一排不顯示；0 張或 6 張以上照舊',async()=>{
  const dom=fakeDom();
  load({doc:dom.doc,responses:{'/api/hot-cards':ok({data:[hotRow(1),hotRow(2),hotRow(3)],meta:{}}),'/api/pack-prizes':ok(prizes([{game:'onepiece',seriesName:'OP-17',data:[1,2,3,4,5,6].map(i=>prizeRow(i))}]))}});
  await tick();await tick();await tick();
  assert.deepEqual(dom.visible(),['latest','trending'],'最熱只有 3 張，藏起來；最夯 6 張，留著');
  const few=fakeDom();
  load({doc:few.doc,responses:{'/api/pack-prizes':ok(prizes([{game:'onepiece',seriesName:'OP-17',data:[prizeRow(1),prizeRow(2)]}],[prizeRow(3)]))}});
  await tick();await tick();await tick();
  assert.equal(few.panels.trending.hidden,true,'精選＋各遊戲合計只有 3 張，最夯藏起來');
  const none=fakeDom();load({doc:none.doc,responses:{'/api/pack-prizes':ok(prizes([])),'/api/hot-cards':ok({data:[]})}});
  await tick();await tick();await tick();
  assert.deepEqual(none.visible(),['latest','trending','hot'],'0 張沿用安靜的空白狀態');
});

test('☆：卡片與 ☆ 是同一格裡並排的兩顆按鈕（不巢狀）；狀態跟收藏數量；點 ☆ 把那一列交給 collectRailCard；refreshCollect 就地更新',async()=>{
  const dom=fakeDom();
  const {ctx,rails}=load({doc:dom.doc,responses:{'/api/hot-cards':ok({data:[1,2,3,4,5,6].map(i=>hotRow(i,i===1?{name:'<b>壞</b>'}:{})),meta:{}})}});
  const owned={'pokemon-hot-2':3},got=[];
  ctx.railCollectQuantity=id=>owned[id]||0;ctx.collectRailCard=row=>got.push(row);
  await tick();await tick();await tick();
  const out=dom.panels.hot.innerHTML;
  assert.equal(out.match(/<div class="trend-cell"><button type="button" class="trend-card"[^]*?<\/button><button type="button" class="favorite-toggle rail-collect"/g).length,6);
  assert.doesNotMatch(out.replace(/<button[^>]*>/g,'B').replace(/<\/button>/g,'E'),/B[^E]*B/,'沒有按鈕包按鈕');
  assert.match(out,/data-rail-collect="pokemon-hot-1" data-rail-name="&lt;b&gt;壞&lt;\/b&gt;" aria-pressed="false" aria-label="加入我的收藏：&lt;b&gt;壞&lt;\/b&gt;"[^>]*>☆</);
  assert.match(out,/data-rail-collect="pokemon-hot-2"[^>]*aria-pressed="true" aria-label="已收藏：熱門卡 2（3 張），按一下移除"[^>]*>★</);
  const target={dataset:{railCollect:'pokemon-hot-3'}};
  dom.handlers.click({target:{closest:()=>target}});
  assert.equal(got.length,1);assert.equal(got[0].cardId,'pokemon-hot-3');assert.equal(got[0].game,'pokemon');
  dom.handlers.click({target:{closest:()=>null}});assert.equal(got.length,1,'點卡片本身不收藏（交給 data-do="openCard"）');
  const attrs={},button={dataset:{railCollect:'pokemon-hot-3',railName:'熱門卡 3'},setAttribute(k,v){attrs[k]=v},title:'',textContent:'☆'};
  dom.buttons.push(button);owned['pokemon-hot-3']=1;rails.refreshCollect(dom.doc);
  assert.deepEqual([attrs['aria-pressed'],attrs['aria-label'],button.textContent,button.title],['true','已收藏：熱門卡 3（1 張），按一下移除','★','已收藏']);
});

test('index.html：沒有分頁，最新、最夯、最熱三排依序疊著，最新那排包著原本的 #homeLatest 與看得到的標題',()=>{
  const section=html.slice(html.indexOf('<section class="home-rails"'),html.indexOf('<section class="about-intro"'));
  assert.doesNotMatch(section,/role="tab|data-rails-tab|rails-switch/);
  assert.deepEqual([...section.matchAll(/<div class="rails-block" id="(railsPanel-\w+)"(?: tabindex="-1")?( hidden)?>/g)].map(m=>m[1]+(m[2]||'')),['railsPanel-latest','railsPanel-trending','railsPanel-hot']);
  assert.match(section,/id="railsPanel-latest"><section class="home-latest" id="homeLatest" aria-labelledby="homeLatestTitle" hidden><div class="rails-head"><h3 id="homeLatestTitle">最新系列<\/h3>/);
  assert.doesNotMatch(html.slice(html.indexOf('<section class="hero"'),html.indexOf('<section class="home-rails"')),/id="homeLatest"/,'#homeLatest 只剩一份，搬出了夜空展示區');
  assert.ok(html.indexOf('<section class="home-rails"')>html.indexOf('id="hero"'),'夜空展示區之後');
  assert.match(html,/const anchor=\$\('marketIntro'\)\|\|\$\('homeRails'\)\|\|hero;if\(anchor\.nextElementSibling!==trends\)anchor\.after\(trends\)/,'完整漲跌榜搬到行情頁，排在行情標題之後');
  assert.match(html,/<section class="market-intro" id="marketIntro"[^>]*><h2 id="marketTitle" role="heading" aria-level="1" tabindex="-1">行情<\/h2>/,'行情頁的標題');
  assert.ok(html.indexOf('id="marketIntro"')<html.indexOf('id="homeRails"'));
  assert.doesNotMatch(railsSrc,/PICK_WAIT|role="tab|nextTab/,'不再等最熱決定預設分頁');
});

test('載入順序與 CSP：home-rails.js 在 ui-actions（infoTip）與 price-movers（共用請求）之後，沒有行內事件',()=>{
  const at=name=>html.indexOf(`<script src="/${name}"></script>`);
  assert.ok(at('ui-actions.js')>0&&at('price-movers.js')>at('ui-actions.js')&&at('home-rails.js')>at('price-movers.js'));
  assert.doesNotMatch(railsSrc,/\son[a-z]+=/);
  assert.match(moversSrc,/root\.priceMoversShared=\{request,card,image,info,rgbLetter\}/);
  assert.match(moversSrc,/歐洲平台參考價，不是成交價/,'完整漲跌榜標題旁的警語還在');
});

test('樣式：三排間距、☆ 44×44 疊在圖上、手機頂欄選單縮窄且沒有小於 12px 的字',()=>{
  assert.match(css,/\.home-rails \.rails-block\+\.rails-block\{margin-top:/);
  assert.match(css,/body:not\(\[data-view="landing"\]\) #homeRails\{display:none\}/);
  assert.match(css,/#mobileHeaderScope select\{width:2\.5em/);
  assert.match(css,/#homeRails \.trend-card:active\{transform:scale\(\.97\)\}/);
  assert.match(css,/#homeRails \.rail-collect\{position:absolute;[^}]*width:var\(--btn-h\);height:var\(--btn-h\)/);
  assert.doesNotMatch(css,/rails-switch|data-pending/);
  assert.doesNotMatch(css.slice(css.indexOf('/* ===== 8.'),css.indexOf('/* ===== 9.')),/transition:all|font-size:\s*(?:[0-9]|1[01])(?:\.\d+)?px|@keyframes|animation:/);
});

// ---- L1：寬螢幕右側面板 ----
function asideDom(){
  const mk=(tag='div')=>({tag,attrs:{},children:[],hidden:false,innerHTML:'',id:'',className:'',setAttribute(k,v){this.attrs[k]=v},append(...nodes){this.children.push(...nodes)},after(node){this.next=node}});
  const hero=mk("section"),made=[],base=fakeDom();base.section.after=function(node){this.next=node};
  const doc={...base.doc,createElement:tag=>{const node=mk(tag);made.push(node);return node},getElementById:id=>id==='hero'?hero:base.doc.getElementById(id)};
  return {doc,hero,rails:base.section,made,byId:id=>made.find(node=>node.id===id)};
}
const moverBody=(n=6)=>({data:{up:Array.from({length:n},(_,i)=>moverRow(i+1)),down:Array.from({length:n},(_,i)=>moverRow(i+1,{changePercent:-30,cardId:`pokemon-down-${i}`}))},meta:{windowDays:14,minAmount:5,note:''}});
const eventBody={data:[{date:'2099-12-01',game:'pokemon',title:'<script>1</script>新彈'},{date:'2026-01-01',game:'yugioh',title:'舊聞'},null,{date:3,title:'壞資料'}],meta:{}};
// 把 home-rails 在已有 doc 與 matchMedia 的環境裡重新跑一遍（load() 時 ctx.document 已經指到假 DOM，所以 init 只跑一次，這裡直接取得結果）
function loadWide(doc,responses,wide=true){
  const calls=[],ctx={infoTip:(label,body)=>`[ⓘ ${label}|${body}]`,setTimeout:fn=>{fn();return 0},document:doc,matchMedia:()=>({matches:wide,addEventListener:(type,fn)=>(ctx.listeners=ctx.listeners||[]).push(fn)})};
  ctx.window=ctx;ctx.fetch=url=>{calls.push(url);return Promise.resolve(responses[url]||{ok:false,status:404,json:async()=>({})})};
  vm.createContext(ctx);vm.runInContext(moversSrc,ctx);vm.runInContext(railsSrc,ctx);
  return {ctx,calls};
}

test('寬螢幕右側面板：漲、跌各取前 5 筆、時事取前 6 筆；卡名跳脫；點卡用 data-do；沒有行內事件',async()=>{
  const dom=asideDom();
  const {calls}=loadWide(dom.doc,{'/api/price-movers':ok(moverBody()),'/api/market-events':ok(eventBody)});
  await tick();await tick();await tick();await tick();
  const up=dom.byId('homeMoversUp'),down=dom.byId('homeMoversDown'),events=dom.byId('homeEvents'),aside=dom.byId('homeAside');
  assert.ok(dom.rails.next===aside&&aside.children[0]===up&&aside.children[1]===down&&aside.children[2]===events,'右欄在榜單之後，漲最多、跌最多、時事依序疊在同一欄裡（欄內用同一個間距）');
  assert.equal(up.innerHTML.match(/class="mover-row"/g).length,5);assert.equal(down.innerHTML.match(/class="mover-row"/g).length,5);
  assert.match(up.innerHTML,/漲最多/);assert.match(up.innerHTML,/↑ \+/);assert.match(down.innerHTML,/跌最多/);assert.match(down.innerHTML,/↓ -30%/);
  assert.match(down.innerHTML,/<a href="\/\?view=market" data-spa>/);
  assert.match(up.innerHTML,/data-do="openCard" data-arg="pokemon-up-1"/);
  assert.equal(events.innerHTML.match(/<li>/g).length,2,'壞資料列被濾掉');
  assert.doesNotMatch(events.innerHTML,/<script>/);assert.match(events.innerHTML,/即將/);
  assert.equal(aside.hidden,false);
  assert.doesNotMatch(up.innerHTML+down.innerHTML+events.innerHTML,/\son[a-z]+=|style=/);
  assert.ok(calls.includes('/api/price-movers')&&calls.includes('/api/market-events'));
});

test('寬螢幕右側面板：資料缺了那一塊就藏起來；三塊都缺右欄整個藏起來；窄螢幕不去要資料，變寬才開始',async()=>{
  const dom=asideDom();
  loadWide(dom.doc,{'/api/price-movers':ok({data:{up:[moverRow(1)],down:[]},meta:{}}),'/api/market-events':{ok:false,status:500,json:async()=>({})}});
  await tick();await tick();await tick();await tick();
  assert.equal(dom.byId('homeMoversUp').hidden,false);assert.equal(dom.byId('homeMoversDown').hidden,true);assert.equal(dom.byId('homeEvents').hidden,true);
  assert.equal(dom.byId('homeAside').hidden,false,'只剩漲最多也留著右欄');
  const failed=asideDom();
  loadWide(failed.doc,{'/api/price-movers':{ok:false,status:502,json:async()=>({})}});
  await tick();await tick();await tick();await tick();
  assert.equal(failed.byId('homeMoversUp').hidden,true,'API 失敗：三塊都空');assert.equal(failed.byId('homeAside').hidden,true,'三塊都空就整個藏起來，搜尋區與榜單佔滿');
  const narrow=asideDom();
  const {ctx,calls}=loadWide(narrow.doc,{'/api/price-movers':ok(moverBody()),'/api/market-events':ok(eventBody)},false);
  await tick();await tick();
  assert.equal(calls.filter(url=>/price-movers|market-events/.test(url)).length,0,'窄螢幕不要資料');
  assert.equal(ctx.listeners.length,1,'視窗之後變寬才開始');
});

test('樣式：≥1200px 首頁多欄（搜尋左／漲幅右、榜單左／跌幅與時事右）、缺一塊另一塊佔滿、<1200px 面板不顯示、.wrap 放寬',async()=>{
  const showcase=await read('look-showcase.css');
  const block=showcase.slice(showcase.indexOf('首頁電腦版多欄'));
  assert.match(block,/\.home-panel,\.home-aside\{display:none\}/,'預設不顯示（窄螢幕單欄）');
  assert.match(block,/@media \(min-width:1200px\)\{[^]*grid-template-columns:minmax\(0,1fr\) var\(--home-aside\)/);
  assert.match(block,/\.wrap\{max-width:1640px\}/);
  assert.match(block,/#hero:has\(~ #homeAside\[hidden\]\)[^{]*\{grid-column:1\/-1\}/);
  assert.match(block,/#homeRails:has\(~ #homeAside\[hidden\]\)[^{]*\{grid-column:1\/-1\}/);
  assert.match(block,/\.home-panel\[hidden\],\.home-aside\[hidden\]\{display:none!important\}/);
  assert.match(block,/#homeRails \.rails-block\[hidden\]\{display:none!important\}/,'不足一排而藏起來的那排');
  assert.doesNotMatch(block,/font-size:\s*(?:[0-9]|1[01])(?:\.\d+)?px|transition:\s*all/);
  assert.doesNotMatch(block.replace(/@media \(hover:hover\) and \(pointer:fine\)\{[^}]*\}/g,''),/:hover/,':hover 只放在 (hover:hover) 裡');
});
