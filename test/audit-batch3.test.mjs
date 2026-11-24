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
