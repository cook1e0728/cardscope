import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// 全站體檢第 2 批（docs/SITE_AUDIT_SPEC_20261124.md）的回歸檢查。
const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('HCI-03：系列分頁列只有選中的在 Tab 順序裡，左右鍵／Home／End 切換，重畫後焦點回到新分頁',async()=>{
  const [band,nav]=await Promise.all([read('series-band.js'),read('series-navigator.js')]);
  // 取出 tabKey 單獨測按鍵對應
  const src=band.slice(band.indexOf('const tabKey='),band.indexOf('};',band.indexOf('const tabKey='))+2);
  const tabKey=vm.runInNewContext(`(()=>{${src};return tabKey})()`);
  const tabs=[0,1,2].map(i=>({i,closest(){return this}}));
  const ev=(key,i)=>({key,target:tabs[i],currentTarget:{querySelectorAll:()=>tabs},prevented:false,preventDefault(){this.prevented=true}});
  assert.deepEqual(['ArrowRight','ArrowLeft','Home','End'].map(k=>tabKey(ev(k,0),'x').i),[1,2,0,2]);
  assert.equal(tabKey(ev('ArrowRight',2),'x').i,0,'右鍵到底繞回第一個');
  const enter=ev('Enter',1);assert.equal(tabKey(enter,'x'),null);assert.equal(enter.prevented,false,'其他鍵不攔');
  assert.ok(band.includes('tabindex="${id===homeTab?0:-1}"'),'首頁最新系列用 roving tabindex');
  assert.ok(band.includes('tabindex="${id===active?0:-1}"'),'遊戲頁系列分頁用 roving tabindex');
  assert.match(band,/tabBar\.onkeydown=/);
  assert.match(band,/band\.querySelector\('\.series-band-tabs'\)\.onkeydown=/);
  assert.match(band,/if\(back\)tabBar\.querySelector\(`\[data-home-tab=/,'首頁最新系列重畫後焦點放回');
  assert.match(band,/if\(back\)band\.querySelector\(`\[data-band-tab=/,'遊戲頁系列分頁重畫後焦點放回');
  assert.match(nav,/tabindex="\$\{bucket\.label===selected\?0:-1\}"/);
  assert.match(nav,/controls\.onkeydown=/);
});

test('HCI-08：內頁主標（卡牆／搜尋／收藏、行情、關於、隱私）在無障礙樹是第一層標題',async()=>{
  const html=await read('index.html');
  for(const id of ['cardsTitle','marketTitle','aboutTitle','privacyTitle'])
    assert.match(html,new RegExp(`<h2 id="${id}" role="heading" aria-level="1"`),id);
});

test('HCI-06：<360px 手機卡牆改一排 2 張（「− 數量 ＋」已改成收藏開關）',async()=>{
  const css=await read('look-v2.css');
  assert.match(css,/@media \(max-width:359px\)\{\s*html\.look-clean body\[data-view\] \.cards:not\(\.list-view\)\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.ok(css.indexOf('@media (max-width:359px)')>css.indexOf('grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 8px'),'要排在一排 3 張的規則之後才蓋得過');
});

// WCAG 相對亮度與對比
const lum=hex=>{const [r,g,b]=hex.match(/\w\w/g).map(h=>{const c=parseInt(h,16)/255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4});return .2126*r+.7152*g+.0722*b};
const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05)};

test('UI-02：輸入框與下拉選單外框對底色 ≥3:1',async()=>{
  const [v2,clean]=await Promise.all([read('look-v2.css'),read('look-clean.css')]);
  assert.match(v2,/--v2-field:#857D6E;/);
  for(const bg of ['FFFFFF','F8F5EE','EFEAE0'])assert.ok(ratio('857D6E',bg)>=3,`#857D6E 對 #${bg}`);
  for(const rule of [/main select\{border:1px solid var\(--v2-field\)/,/#sideNav \.series-band-filter\{[^}]*border:1px solid var\(--v2-field\)/,/\.coll-edit :is\(select,input\)\{[^}]*border:1px solid var\(--v2-field\)/,/header\.top \.search input\{[^}]*border:1px solid var\(--v2-field\)/])assert.match(v2,rule);
  assert.match(clean,/\.series-band-filter\{[^}]*border:1px solid #857D6E/);
  assert.match(clean,/\.home-search\{height:62px;border:1px solid #8A83B0/);
  assert.ok(ratio('8A83B0','1B1733')>=3&&ratio('8A83B0','24203F')>=3,'首頁深色搜尋框外框');
});

test('UI-04：次要小字不靠 opacity 變淡；篩選時分頁只淡到 .85，字對比仍 ≥4.5:1',async()=>{
  const [ui,v2,clean]=await Promise.all([read('ui-enhancements.js'),read('look-v2.css'),read('look-clean.css')]);
  assert.doesNotMatch(ui,/\.cr-original\{[^}]*opacity/);
  assert.doesNotMatch(clean,/\.cr-src\{[^}]*opacity/);
  assert.doesNotMatch(v2+clean,/is-filtering \.series-band-tabs\{opacity:\.45\}/);
  // #5A5348 在 .85 不透明度下疊在頁面底 #F8F5EE
  const mix=[0x5A,0x53,0x48].map((c,i)=>Math.round(c*.85+[0xF8,0xF5,0xEE][i]*.15).toString(16).padStart(2,'0')).join('');
  assert.ok(ratio(mix,'F8F5EE')>=4.5,`#${mix}`);
});

test('UI-06：look-v2 不再用 15px／19px，字級收斂到 12／13／14／16／標題；頂欄展示小字至少 12px',async()=>{
  const [v2,show]=await Promise.all([read('look-v2.css'),read('look-showcase.css')]);
  const rules=v2.replace(/\/\*[\s\S]*?\*\//g,'');
  assert.doesNotMatch(rules,/font(-size)?:[^;{}]*\b1[59]px/);
  assert.match(v2,/--fs-14:14px;/);
  assert.doesNotMatch(show,/11\.5px/);
});

test('UI-07：所有停用的按鈕都有停用外觀（淡掉、不浮起、不縮放），不再只限少數幾顆',async()=>{
  const v2=await read('look-v2.css');
  assert.match(v2,/html\.look-clean body\[data-view\] button:disabled\{opacity:\.5;box-shadow:none;cursor:default;transform:none\}/);
});

test('UI-06：首頁右欄漲跌、時事與行情頁欄標題也不用 15px',async()=>{
  const [show,layout]=await Promise.all([read('look-showcase.css'),read('catalog-layout.css')]);
  assert.match(show,/\.mover-name b\{[^}]*font-size:16px/);
  assert.match(show,/\.mover-chg\{font-size:16px/);
  assert.match(show,/\.event-list li\{[^}]*font-size:14px/);
  assert.match(layout,/#trendsSection \.movers-head\{[^}]*font-size:16px/);
});
