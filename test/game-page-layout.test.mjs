import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [html,css,ui]=await Promise.all(['../index.html','../catalog-layout.css','../ui-enhancements.js'].map(path=>readFile(new URL(path,import.meta.url),'utf8')));

test('game pages are marked before first paint and kept in sync by render',()=>{
  assert.ok(html.indexOf("document.body.dataset.view=")<html.indexOf('class="skip-link"'),'the view is set before any content paints');
  assert.match(html,/function render\(\)\{const gameView=game!=='all';if\(document\.body\?\.dataset\)\{document\.body\.dataset\.view=gameView\?'game':'landing';document\.body\.dataset\.game=game\}placeTrends\(gameView\);/);
});

test('game pages open on series and cards; the landing keeps its introduction',()=>{
  assert.match(css,/body\[data-view="game"\] \.hero-intro,body\[data-view="game"\] \.hero-trust/);
  assert.match(css,/body\[data-view="game"\] \.channel-art\{display:none\}/);
  assert.match(css,/body\[data-view="game"\] #trendsSection:empty\{display:none\}/);
  assert.match(html,/if\(gameView\)\{if\(cardsSection\.nextElementSibling!==trends\)cardsSection\.after\(trends\)\}/);
});

test('phone filters live in a bottom sheet that waits for 套用',()=>{
  assert.match(ui,/installCardUtilities\(\);\r?\ninstallFilterSheet\(\);/);
  assert.match(ui,/sheet\.addEventListener\('change',event=>\{if\(applying\|\|!isOpen\(\)\|\|!selects\.includes\(event\.target\)\)return;event\.stopPropagation\(\);/);
  assert.match(ui,/backdrop\.onclick=\(\)=>close\(true\)/,'the backdrop discards changes');
  assert.match(ui,/installDialogFocus\?\.\(sheet,/,'the sheet traps focus like the detail dialog');
  assert.match(css,/\.filter-sheet\{display:contents\}/,'wide screens keep the inline toolbar');
  assert.match(css,/\.card-tools\{backdrop-filter:none\}/,'the fixed sheet is positioned against the viewport');
});

test('the series band replaces the old title band and the game-page 商品圖鑑',async()=>{
  const [band,theme]=await Promise.all(['../series-band.js','../theme-binder.css'].map(path=>readFile(new URL(path,import.meta.url),'utf8')));
  assert.ok(html.includes('<script src="/series-navigator.js"></script><script src="/series-band.js"></script>'),'the band wraps series() after the navigator defines it');
  assert.ok(theme.includes('body[data-view="game"] #gameContext{display:none}'));
  assert.ok(theme.includes('body[data-view="game"] section.section:has(> #series)'));
  assert.doesNotMatch(html,/renderLatestSeries|latestSeriesEntry/,'the retired 最新系列 button is gone');
  assert.ok(band.includes("regionOrder=['JP','TW','US'"),'Japanese first, per the data priority');
  assert.ok(band.includes('if(!regions.includes(select.value))select.value=regions[0]'),'a game page always browses one region');
});

test('a region-limited search offers the IP\'s other regions and survives a region switch',async()=>{
  const [band,theme]=await Promise.all(['../series-band.js','../theme-binder.css'].map(path=>readFile(new URL(path,import.meta.url),'utf8')));
  assert.match(band,/<button type="button" data-search-region="\$\{id\}">/,'other regions are real buttons');
  assert.ok(band.includes('沒有符合的系列或商品'),'an empty region still explains itself inside the search tab');
  assert.ok(band.includes('found.length||elsewhere.length'),'the search tab stays when only other regions match');
  assert.ok(band.includes("closest('[data-region],[data-search-region]')"),'both button kinds switch region the same way');
  assert.ok(html.includes("else if(activeSearch?.game===game&&activeSearch.state===browse)search(activeSearch.q)"),'a region change re-runs the active search');
  assert.ok(html.includes('沒有符合的卡；'),'the notice names the other regions');
  assert.match(theme,/\.series-band-regions button\{[^}]*min-height:44px/,'the switch buttons share the 44px region button style');
});
