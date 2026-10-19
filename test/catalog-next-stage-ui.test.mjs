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
  assert.doesNotMatch(html,/classList\.add\('game-entry-grid'\)/,'the landing no longer draws a second game chooser');
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

test('primary navigation is real buttons and the logo tiles are the only game chooser',()=>{
  const nav=html.match(/<nav class="nav"[^]*?<\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/data-nav="([^"]+)">([^<]+)</g)].map(match=>[match[1],match[2]]),[['search','搜尋'],['browse','圖鑑'],['collection','我的收藏']]);
  assert.doesNotMatch(nav,/<b[ >]/,'the old non-focusable <b> labels are gone');
  assert.doesNotMatch(switcher,/\.game-pick|className='game-switch'|picker\.classList|aria-haspopup/,'the header drop-down and its dialog duplicated the tiles');
  assert.match(switcher,/scope\.openCollection/);
  assert.match(switcher,/navigate\[button\.dataset\.nav\]/);
});
