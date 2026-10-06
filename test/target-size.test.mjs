import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const css=await readFile(new URL('../catalog-layout.css',import.meta.url),'utf8');

test('controls have a 44px minimum target size',()=>{
  assert.match(css,/button,select,summary,input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="range"\]\),\.brand\{min-height:44px\}/);
  assert.match(css,/\.close,\.detail-nav,\.bottom button,\.favorite-toggle,\.watchlist-inline button,\.filter-sheet-close,\.product-category\{min-width:44px\}/);
  assert.doesNotMatch(css,/(^|\})button\{min-width:/m,'a global button min-width lets flex rows squeeze labels until they overlap');
  assert.doesNotMatch(css,/min-height:(3\d|[12]?\d)px\}/,'no rule lowers a control below 44px');
});

test('the tall card filter bar does not stick over cards on phones',()=>{
  const phone=css.match(/@media\(max-width:760px\)\{\.game-context[^\n]*/)[0];
  assert.match(phone,/\.card-tools\{position:static\}/);
});

test('phone bottom bar buttons jump to existing sections instead of doing nothing',async()=>{
  const [html,ui]=await Promise.all(['../index.html','../ui-enhancements.js'].map(path=>readFile(new URL(path,import.meta.url),'utf8')));
  const bar=html.match(/<nav class="bottom"[^]*?<\/nav>/)[0];
  assert.match(bar,/aria-label="快速跳轉"/);
  assert.deepEqual([...bar.matchAll(/data-jump="([^"]+)"/g)].map(match=>match[1]),['q','cardTools','coverageStatus','watchlistSummary']);
  assert.equal((bar.match(/<button/g)||[]).length,4,'every bar button has a destination');
  for(const id of ['q','cardTools','coverageStatus','watchlistSummary'])assert.ok(html.includes(`id="${id}"`)||ui.includes(`id='${id}'`)||ui.includes(`id="${id}"`)||ui.includes(`.id='${id}'`),`${id} exists`);
  assert.match(ui,/nav\.bottom \[data-jump\]/);
});

test('short viewports (200% zoom, landscape phones) do not pin the header',()=>{
  assert.match(css,/@media\(max-height:500px\)\{\.top\{position:static\}/);
});
