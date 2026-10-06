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
