import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// 全站體檢第 3 批（DES 設計精修，docs/SITE_AUDIT_SPEC_20261124.md）的回歸檢查；DES-02 表格與價格區塊另見 reference-price／market-printing-price 測試。
const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('DES-03：收錄版本列不再每列重複「點擊查看此版本的卡圖」，讀屏說明保留',async()=>{
  const ui=await read('ui-enhancements.js');
  assert.doesNotMatch(ui,/<span class="meta">點擊查看此版本的卡圖<\/span>/);
  assert.match(ui,/<span class="sr-only">，點擊查看此版本的卡圖<\/span>/);
});

test('DES-04：價格區一層白卡，卡內小項目改細線，不再盒中盒',async()=>{
  const css=await read('look-v2.css');
  assert.match(css,/#detail :is\(\.price-overview>\*,#graded-prices>\*\)\{background:#fff;border:1px solid #E7E1D4;border-radius:14px/);
  assert.match(css,/#detail :is\(\.price-overview,\.dpanel-trend\) :is\(\.pov-row,\.ebay-item,\.ptl-now,\.pov-list>\*\)\{background:transparent;border:0;border-top:1px solid #EFEAE0/);
});

test('DES-15：走勢大數字 32px（手機 28px），讀法說明收進摺疊，淡底方格只在電腦版',async()=>{
  const [layout,timeline,css]=await Promise.all([read('catalog-layout.css'),read('price-timeline.js'),read('look-v2.css')]);
  assert.match(layout,/\.ptl-big\{font-size:32px;/);
  assert.match(layout,/\.ptl-big\{font-size:28px\}/);
  assert.match(timeline,/<details class="ptl-howto"><summary>ⓘ 圖表怎麼看<\/summary><p class="ptl-caption" data-r="caption"><\/p><\/details>/);
  assert.match(css,/@media \(min-width:1000px\)\{html\.look-clean body\[data-view\] #detail \.ptl-cells>div\{background:#F7F3EA/);
});

test('DES-08：世代分頁超過 4 個時收起第 4 個以後，「更多世代」可展開；選中的在收起區時不收；方向鍵略過隱藏分頁',async()=>{
  const band=await read('series-band.js');
  assert.match(band,/extraEras=eraIds\.length>4&&!eraIds\.slice\(3\)\.includes\(active\)\?eraIds\.slice\(3\):\[\]/);
  assert.match(band,/\$\{erasHidden&&extraEras\.includes\(id\)\?' hidden':''\}/);
  assert.match(band,/data-band-eras aria-expanded="\$\{!erasHidden\}">\$\{erasHidden\?`更多世代（\$\{extraEras\.length\}）`:'收合世代'\}/);
  assert.match(band,/tabKey\(event,'\[data-band-tab\]:not\(\[hidden\]\)'\)/);
  assert.match(band,/closest\('\[data-band-eras\]'\)\)\{bandEras\[game\]=!bandEras\[game\];render\(\)/);
});

test('DES-01／11：卡面文字包成側板白卡；隱私頁有本頁目錄',async()=>{
  const [ui,html]=await Promise.all([read('ui-enhancements.js'),read('index.html')]);
  assert.equal((ui.match(/<section class="dpanel dpanel-text"><h4 class="dpanel-title">卡片文字<\/h4>/g)||[]).length,2);
  assert.match(html,/<nav class="info-toc" aria-label="本頁目錄"><b>本頁目錄<\/b><a href="#privacy">隱私說明<\/a><a href="#sources">資料來源<\/a><a href="#rights">/);
});

test('頁首帳號選單用深色字：首頁深色頁首的淺色字不能繼承進白底選單（信箱會看不到）',async()=>{
  const css=await read('look-v2.css');
  assert.match(css,/\n\.account-menu\{[^}]*background:var\(--v2-surface\)[^}]*color:var\(--v2-ink\)/);
});
