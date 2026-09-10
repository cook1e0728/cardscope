import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [html,ui,layout]=await Promise.all([
  readFile(new URL('../index.html',import.meta.url),'utf8'),
  readFile(new URL('../ui-enhancements.js',import.meta.url),'utf8'),
  readFile(new URL('../catalog-layout.css',import.meta.url),'utf8')
]);

test('public Beta surfaces explain coverage, freshness, and correction path',()=>{
  for(const marker of ['公開 BETA','betaDataStatus','betaUpdatedAt','betaCoverageSummary','betaGuidanceTitle','copyReportTemplate','gameContext'])assert.match(html,new RegExp(marker));
  assert.match(html,/勘誤／權利通知/);
  assert.match(ui,/資料完整度與圖片權利狀態/);
  assert.match(ui,/官方總數尚未核定/);
});

test('trend UI labels the market scope and keeps empty data honest',()=>{
  assert.match(ui,/renderPublicTrends/);
  assert.match(ui,/日版買取價變動/);
  assert.match(ui,/目前沒有可驗證的漲勢資料/);
  assert.match(ui,/不代表全市場人氣或成交量/);
  assert.match(ui,/trend-scope/);
});

test('Beta composition remains responsive and keyboard-visible',()=>{
  assert.match(layout,/\.beta-guidance\{display:grid/);
  assert.match(layout,/\.beta-report button:hover/);
  assert.match(layout,/\.channel:focus-visible/);
  assert.match(layout,/\.card-tools\{position:sticky/);
  assert.match(layout,/min-height:44px/);
  assert.match(layout,/@media\(max-width:760px\)/);
  assert.match(layout,/overflow-x:clip/);
});
