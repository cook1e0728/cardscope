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

test('phone bottom bar has the same three real actions as the header (搜尋、圖鑑、我的收藏)',async()=>{
  const [html,switcher]=await Promise.all(['../index.html','../game-switcher.js'].map(path=>readFile(new URL(path,import.meta.url),'utf8')));
  const bar=html.match(/<nav class="bottom"[^]*?<\/nav>/)[0];
  assert.match(bar,/aria-label="主要導覽"/);
  assert.deepEqual([...bar.matchAll(/data-nav="([^"]+)"/g)].map(match=>match[1]),['search','browse','collection']);
  assert.equal((bar.match(/<button/g)||[]).length,3,'every bar button has an action');
  assert.doesNotMatch(bar,/data-jump/,'no page-anchor stand-ins');
  assert.match(switcher,/querySelectorAll\('\[data-nav\]'\)/,'header and bar share one handler');
});

test('short viewports (200% zoom, landscape phones) do not pin the header',()=>{
  assert.match(css,/@media\(max-height:500px\)\{\.top\{position:static\}/);
});
