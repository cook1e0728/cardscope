import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('..',import.meta.url);
const [html,css,ui,switcher]=await Promise.all([
  readFile(new URL('index.html',root),'utf8'),
  readFile(new URL('catalog-layout.css',root),'utf8'),
  readFile(new URL('ui-enhancements.js',root),'utf8'),
  readFile(new URL('game-switcher.js',root),'utf8')
]);

test('catalog defaults to the visual grid and exposes an explicit IP landing scope',()=>{
  assert.match(ui,/let cardViewMode='grid'/);
  assert.match(ui,/data-view="grid">圖鑑模式/);
  assert.match(html,/game==='all'/);
  assert.match(html,/classList\.add\('game-entry-grid'\)/);
  assert.match(html,/不同 IP 不會合併|每個 IP 獨立呈現/);
  assert.doesNotMatch(html+ui,/\bgameFilters\b/);
});

test('rarity choices remain directly switchable after a filtered request',()=>{
  assert.match(html,/id="rarityFilter"/);
  assert.match(html,/全部稀有度/);
  assert.match(ui,/const rarityOptionMemory=new Map\(\)/);
  assert.match(ui,/function installRarityOptionMemory\(\)/);
  assert.match(ui,/new MutationObserver\(restoreRarityOptions\)/);
  assert.match(ui,/select\.value=known\.has\(selected\)\?selected:'all'/);
});

test('card detail and zoom controls reserve a complete viewport',()=>{
  assert.match(ui,/card-zoom-viewport/);
  assert.match(ui,/card-zoom-canvas/);
  assert.match(ui,/card-zoom-media/);
  assert.match(ui,/container-type:inline-size/);
  assert.match(ui,/max-height:100%/);
  assert.match(ui,/data-zoom-preset="fit"/);
  assert.match(ui,/data-zoom-preset="4"/);
  assert.match(ui,/card-zoom-close/);
  assert.match(ui,/event\.key==='Escape'/);
});

test('card opening control stays separate from nested card actions',()=>{
  assert.match(ui,/class="card-open-hit" data-card-open=/);
  assert.doesNotMatch(ui,/data-card-open="\$\{id\}" role="button"/);
  assert.match(ui,/\.card-actions\{position:relative;z-index:2\}/);
});

test('desktop and mobile brand layouts keep rabbit artwork separate from copy',()=>{
  assert.match(css,/\.brand-showcase\{grid-template-columns:minmax\(250px,clamp\(280px,30vw,430px\)\) minmax\(0,1fr\)/);
  assert.match(css,/\.brand-showcase\{display:grid;grid-template-columns:minmax\(128px,42%\) minmax\(0,1fr\)/);
  assert.match(css,/@media\(max-width:420px\)[\s\S]*\.brand-showcase\{grid-template-columns:1fr/);
  assert.match(css,/\.brand-showcase-copy\{width:auto;min-width:0/);
});

test('IP picker is modal, keyboard reachable, and preserves per-IP scope',()=>{
  assert.match(switcher,/aria-haspopup','dialog/);
  assert.match(switcher,/aria-modal','true/);
  assert.match(switcher,/event\.key==='Escape'/);
  assert.match(switcher,/aria-pressed="\$\{choice\.id===active\}"/);
  assert.match(switcher,/不同作品不會合併/);
  assert.match(switcher,/依版本與系列分開/);
});
