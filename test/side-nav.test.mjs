import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const [source,html,cssAll,ui,switcher,smoke]=await Promise.all(
  ['../side-nav.js','../index.html','../look-v2.css','../ui-enhancements.js','../game-switcher.js','../scripts/beta-browser-smoke.mjs']
    .map(path=>readFile(new URL(path,import.meta.url),'utf8'))
);
const css=cssAll.slice(cssAll.indexOf('/* ===== 9.'));

// side-nav.js 沒有 #sideNav 就什麼都不做，但仍匯出純函式；測試用假的 window 取出它們
const side=(()=>{
  const scope={document:{getElementById:()=>null}};
  vm.runInNewContext(source,{window:scope,...scope},{});
  return scope.CardScopeSide;
})();
const run=fn=>{const context={};vm.runInNewContext('globalThis.out=('+fn+')()',context);return context.out};

test('模式界線：≤760 底部選單、≥1000 且高 ≥501 固定側欄，其餘（含矮視窗）從左滑出',()=>{
  const m=side.sideMode;
  assert.equal(m(375,812),'sheet');
  assert.equal(m(760,1000),'sheet');
  assert.equal(m(761,900),'drawer');
  assert.equal(m(999,900),'drawer');
  assert.equal(m(1000,900),'inline');
  assert.equal(m(1440,900),'inline');
  assert.equal(m(1440,500),'drawer','高度不到 501px 的桌機視窗（例如 200% 縮放）用抽屜，內容才不被切掉');
});

test('側欄只在遊戲頁與全部遊戲的搜尋結果出現',()=>{
  const s=side.sideState;
  assert.equal(s('game',false),'game');
  assert.equal(s('game',true),'game');
  assert.equal(s('landing',true),'results');
  assert.equal(s('landing',false),'');
  assert.equal(s('about',false),'');
  assert.equal(s('privacy',true),'');
});

test('收合狀態：localStorage 讀寫失敗不丟例外，讀不到就當展開',()=>{
  const broken={getItem(){throw new Error('blocked')},setItem(){throw new Error('blocked')},removeItem(){throw new Error('blocked')}};
  const bad=side.collapsedStore(broken);
  assert.equal(bad.read(),false);
  assert.doesNotThrow(()=>bad.write(true));
  assert.doesNotThrow(()=>bad.write(false));
  const map=new Map();
  const good=side.collapsedStore({getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)});
  assert.equal(good.read(),false);
  good.write(true);
  assert.equal(map.get(side.COLLAPSE_KEY),'1');
  assert.equal(good.read(),true);
  good.write(false);
  assert.equal(good.read(),false);
  assert.equal(map.has(side.COLLAPSE_KEY),false);
});

test('連 window.localStorage 這個屬性都會丟例外（封鎖網站資料）時，載入時與頁面最早的腳本都包了 try',()=>{
  assert.match(source,/let storage;try\{storage=scope\.localStorage\}catch\{\}/);
  assert.match(html,/try\{if\(localStorage\.getItem\('cardscope-side-collapsed'\)==='1'\)document\.documentElement\.dataset\.sideCollapsed='1'\}catch\{\}/);
});

test('重繪後的焦點記號與選取器互相對得上',()=>{
  const el=(classes,data)=>({classList:{contains:name=>classes.includes(name)},dataset:data});
  assert.equal(side.focusKey(el(['channel'],{ip:'pokemon'})),'ip:pokemon');
  assert.equal(side.focusKey(el([],{bandTab:'recent'})),'tab:recent');
  assert.equal(side.focusKey(el([],{region:'JP'})),'region:JP');
  assert.equal(side.focusKey(el(['band-tile'],{kind:'series',id:'sv2a'})),'tile:series:sv2a');
  assert.equal(side.focusKey(el(['plain'],{})),'');
  assert.equal(side.keySelector('ip:pokemon'),'.channel[data-ip="pokemon"]');
  assert.equal(side.keySelector('tab:recent'),'[data-band-tab="recent"]');
  assert.equal(side.keySelector('tile:series:sv2a'),'.band-tile[data-kind="series"][data-id="sv2a"]');
  assert.equal(side.keySelector('region:J"P'),'[data-region="J\\"P"]','引號會被跳脫，不能跳出選取器');
});

test('標記：aside 有名稱，收合鈕帶 aria-expanded／aria-controls 且指向存在的元素，沒有行內事件',()=>{
  const aside=html.match(/<aside id="sideNav"[\s\S]*?<\/aside>/)[0];
  assert.match(aside,/aria-label="遊戲、版本與系列"/);
  assert.match(aside,/id="sideToggle"[^>]*aria-expanded="true" aria-controls="sideBody"/);
  assert.match(aside,/id="sideBody"/);
  assert.match(aside,/id="sideClose"/);
  assert.doesNotMatch(aside,/\son[a-z]+=|javascript:/i);
  for(const id of ['sideGames','sideRegion','sideSeries'])assert.match(aside,new RegExp(`id="${id}"`));
  assert.match(html,/id="sideMenuBtn"[^>]*aria-haspopup="dialog" aria-controls="sideNav" aria-expanded="false"/);
  assert.match(html,/id="sideSheetBtn"[^>]*aria-haspopup="dialog" aria-controls="sideNav" aria-expanded="false"/);
  assert.match(html,/<div class="side-scrim" id="sideScrim" aria-hidden="true"><\/div>/);
});

test('標記：側欄在 <main> 之前，略過連結仍指向卡片牆；腳本在 navigation-state.js 與 dialog-focus.js 之後載入',()=>{
  assert.ok(html.indexOf('<aside id="sideNav"')<html.indexOf('<main'));
  assert.match(html,/<a class="skip-link" href="#main">/);
  assert.match(html,/<main[^>]*id="main"/);
  const at=name=>html.indexOf(`<script src="/${name}"></script>`);
  assert.ok(at('dialog-focus.js')>0&&at('navigation-state.js')>at('dialog-focus.js')&&at('side-nav.js')>at('navigation-state.js'));
  assert.doesNotMatch(source,/\son[a-z]+=|eval\(|new Function|javascript:/);
});

test('選取狀態：目前的遊戲有 aria-current，而且仍走 data-do 事件（網址與上一頁由 navigation-state.js 處理，側欄不碰）',()=>{
  const channels=html.match(/function channels\(\)\{[\s\S]*?\n/)[0];
  assert.match(channels,/aria-current="true"/);
  assert.match(channels,/data-do="choose"/);
  assert.doesNotMatch(source,/history\.(push|replace)State|location\.(href|search|assign|replace)|popstate/,'側欄不自己改網址');
  assert.match(source,/aria-current/,'版本按鈕的選取狀態由 decorate() 補上');
  assert.match(css,/\.channel\[data-ip\]\[aria-current="true"\][^{]*\{[^}]*inset 3px 0 0 var\(--v2-ink\)/,'選中＝粗體＋墨色細線，不只靠顏色');
  assert.match(css,/\.channel\[data-ip\]\.on,#sideNav|\.channel\[data-ip\]\.on,\.channel\[data-ip\]\[aria-current="true"\]\) b\{font-weight:700/);
});

test('2×5 快速入口與 navigate.browse 對它的引用都拿掉了，圖鑑改開側欄',()=>{
  assert.doesNotMatch(ui,/installMobileQuickGrid|mobileQuickGrid|mqg-/);
  assert.doesNotMatch(switcher,/mobileQuickGrid|mqg-/);
  assert.match(source,/\[data-nav="browse"\]/);
  assert.match(source,/installDialogFocus\?\.\(side,/);
});

test('樣式：三個模式的 media query、版面寬度與收合',()=>{
  assert.match(css,/@media \(max-width:760px\)\{/);
  assert.match(css,/@media \(min-width:761px\) and \(max-width:999px\),\(min-width:1000px\) and \(max-height:500px\)\{/);
  assert.match(css,/@media \(min-width:1000px\) and \(min-height:501px\)\{/);
  assert.match(css,/--side-w:264px/);
  assert.match(css,/--shell-max:1440px/);
  assert.match(css,/html\[data-side-collapsed\]/);
  assert.match(css,/body\[data-side\] #sideNav\{display:flex\}/);
  assert.match(css,/body\[data-view="game"\] \.side-sheet-btn\{display:flex\}/);
});

test('樣式：暫停動態與 prefers-reduced-motion 時側欄沒有動畫，也沒有 transition:all、沒有小於 12px 的字、沒有小於 44px 的最小尺寸',()=>{
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)\{#sideNav,#sideScrim\{transition:none!important\}\}/);
  assert.match(css,/html\[data-cs-paused\] #sideNav,html\[data-cs-paused\] #sideScrim\{transition:none!important\}/);
  assert.doesNotMatch(css,/transition:\s*all|font-size:\s*(?:[0-9]|1[01])(?:\.\d+)?px|@keyframes/);
  for(const [,value] of css.matchAll(/min-(?:height|width):\s*(\d+)px/g))assert.ok(Number(value)>=44,`min-size ${value}px`);
  assert.match(css,/#mobileHeaderScope select\{min-width:44px\}/,'手機頂欄的兩個選單補到 44px 寬');
});

test('瀏覽器驗收（smoke）涵蓋側欄：桌機、平板抽屜、手機選單、封鎖儲存、上一頁',()=>{
  assert.match(smoke,/async function runSidebarChecks/);
  assert.match(smoke,/results\.push\(await runSidebarChecks\(browser\)\)/);
  assert.match(smoke,/storage blocked/);
  assert.match(smoke,/goBack/);
  assert.doesNotMatch(smoke,/mobile-quick-grid \.mqg-tile/);
});
