import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const css=await readFile(new URL('../catalog-layout.css',import.meta.url),'utf8');

test('controls have a 44px minimum target size',()=>{
  assert.match(css,/button,select,summary,input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="range"\]\),\.brand\{min-height:44px\}/);
  assert.match(css,/\.close,\.detail-nav,\.bottom button,\.favorite-toggle,\.watchlist-inline button,\.product-category\{min-width:44px\}/);
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

// 重新設計 v2 階段 1：按鈕三種都是 44px 高，ⓘ 也是 44×44；375px 手機頂欄不換行、沒有小於 44 的可點目標（行內文字連結除外）。
const v2=await readFile(new URL('../look-v2.css',import.meta.url),'utf8');

test('look-v2.css: one 44px button height, no smaller min-size, press feedback and hover only where allowed',()=>{
  assert.match(v2,/--btn-h:44px/);
  for(const [,size] of v2.matchAll(/min-(?:height|width):\s*(\d+)px/g))assert.ok(Number(size)>=44,`min size ${size}px`);
  assert.match(v2,/\.info-tip>summary\{[^}]*width:var\(--btn-h\)[^}]*height:var\(--btn-h\)/,'the ⓘ button is 44×44');
  assert.doesNotMatch(v2,/transition:\s*all/,'transitions list the properties that change');
  assert.match(v2,/:active\{transform:scale\(\.97\)\}/);
  assert.match(v2,/--ease:cubic-bezier\(\.23,1,\.32,1\)/);
  // 拿掉 (hover:hover) and (pointer:fine) 區塊之後，不能還有 :hover
  let rest=v2;
  for(let start=rest.indexOf('@media (hover:hover) and (pointer:fine){');start>=0;start=rest.indexOf('@media (hover:hover) and (pointer:fine){')){
    let depth=0,end=start;
    for(let i=rest.indexOf('{',start);i<rest.length;i++){if(rest[i]==='{')depth++;if(rest[i]==='}'&&--depth===0){end=i+1;break}}
    rest=rest.slice(0,start)+rest.slice(end);
  }
  // 唯一留在區塊外的是把 look-showcase 的觸控殘留滑過樣式「還原成平常樣子」的那一條
  rest=rest.replace('header.top .nav button:hover{background:var(--v2-surface);border:0}','');
  assert.doesNotMatch(rest,/:hover/,'every :hover rule sits inside (hover:hover) and (pointer:fine)');
});

test('look-v2.css is the last stylesheet linked from index.html',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const links=[...html.matchAll(/<link rel="stylesheet" href="\/([\w-]+\.css)">/g)].map(match=>match[1]);
  assert.equal(links.at(-1),'look-v2.css');
  assert.ok(links.indexOf('look-v2.css')>links.indexOf('look-clean.css')&&links.indexOf('look-v2.css')>links.indexOf('look-effects.css'));
});

test('the phone header stays on one row: brand hidden and no wrap rule in look-v2.css; header tap targets are 44px',async()=>{
  const clean=await readFile(new URL('../look-clean.css',import.meta.url),'utf8');
  assert.match(clean,/html\.look-clean \.bar\{display:flex;flex-wrap:nowrap;align-items:center/);
  assert.doesNotMatch(v2,/\.bar\{[^}]*flex-wrap:\s*wrap/);
  assert.match(v2,/header\.top #go\{[^}]*width:var\(--btn-h\)[^}]*height:var\(--btn-h\)/);
  assert.match(v2,/header\.top \.nav button\{min-height:var\(--btn-h\)/);
});
