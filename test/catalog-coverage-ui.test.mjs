import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('..',import.meta.url);
const [html,css]=await Promise.all([
  readFile(new URL('index.html',root),'utf8'),
  readFile(new URL('catalog-layout.css',root),'utf8')
]);

test('coverage status surface renders five IPs from the public coverage response',()=>{
  assert.match(html,/id="coverageStatus"/);
  assert.match(html,/id="coverageStatusGrid"/);
  assert.match(html,/id="coverageStatusSource"/);
  for(const label of ['寶可夢','航海王','遊戲王','葬送的芙莉蓮','排球少年'])assert.match(html,new RegExp(label));
  assert.match(html,/games\[id\]\|\|\{\}/);
  assert.match(html,/目前觀測/);
  assert.match(html,/中文名/);
  assert.match(html,/稀有度/);
  assert.match(html,/可顯示圖片/);
  assert.match(html,/缺口/);
});

test('coverage status keeps unknown denominators honest and supports future baselines',()=>{
  assert.match(html,/baseline/);
  assert.match(html,/baseline\.kind/);
  assert.match(html,/baseline\.source/);
  assert.match(html,/sourceVerified/);
  assert.match(html,/sourceStatus/);
  assert.match(html,/scope\?\.complete/);
  assert.match(html,/expectedTotal/);
  assert.match(html,/expectedCards/);
  assert.match(html,/officialTotal/);
  assert.match(html,/完整分母未核定/);
  assert.match(html,/來源回報基準（局部）/);
  assert.match(html,/已核定範圍/);
  assert.match(html,/allowPercentage/);
  assert.match(html,/status\.allowPercentage&&status\.value!==null&&cards!==null/);
  assert.match(html,/完整分母未核定的 IP 不顯示完成百分比/);
  assert.doesNotMatch(html,/官方基準/);
  assert.doesNotMatch(html,/官方總數未核定/);
});

test('coverage status layout is responsive and keeps card content shrinkable',()=>{
  assert.match(css,/\.coverage-status-grid\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)/);
  assert.match(css,/\.coverage-status-card\{[^}]*min-width:0/);
  assert.match(css,/\.coverage-status-metrics\{[^}]*min-width:0|\.coverage-status-metrics>div\{[^}]*min-width:0/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*\.coverage-status-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)/);
  assert.match(css,/@media\(max-width:420px\)[\s\S]*\.coverage-status-grid\{grid-template-columns:1fr/);
});

test('coverage status keeps the existing beta and browsing surfaces intact',()=>{
  assert.match(html,/公開 BETA/);
  assert.match(html,/id="channels"/);
  assert.match(html,/id="browseRegion"/);
  assert.match(html,/id="cards"/);
});
