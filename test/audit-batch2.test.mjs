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

test('HCI-06：手機卡牆的「− 數量 ＋」不被切掉：數字欄可縮、<360px 改一排 2 張',async()=>{
  const css=await read('look-v2.css');
  assert.match(css,/\.watchlist-inline \.watch-quantity\{flex:1 1 auto;min-width:0;/);
  assert.match(css,/@media \(max-width:359px\)\{\s*html\.look-clean body\[data-view\] \.cards:not\(\.list-view\)\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.ok(css.indexOf('@media (max-width:359px)')>css.indexOf('grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 8px'),'要排在一排 3 張的規則之後才蓋得過');
});
