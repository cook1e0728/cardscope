import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// L6：卡牆每張卡同一個固定結構（名稱、卡號列、收藏列對齊）；手機頁尾把聲明收成一行摘要，全文一點就開。
const [html,css,clean]=await Promise.all(['index.html','look-v2.css','look-clean.css'].map(name=>readFile(new URL(`../${name}`,import.meta.url),'utf8')));
const footer=html.match(/<footer class="brand-footer">[\s\S]*?<\/footer>/)?.[0]||'';
const mobile=css.slice(css.indexOf('/* ---- L6 手機頁尾'));

test('footer: the full disclaimer is on the page twice (desktop paragraph, phone expander) with identical text',()=>{
  const full=footer.match(/<p class="foot-legal-full">([^<]+)<\/p>/)?.[1];
  const inner=footer.match(/<details class="foot-legal"><summary><span>([^<]+)<\/span><b>聲明<\/b><\/summary><p>([^<]+)<\/p><\/details>/);
  assert.ok(full&&inner,'both forms exist');
  assert.equal(inner[1],'非官方資料服務，卡圖與商標屬原權利人','one-line summary');
  assert.equal(inner[2],full,'the expander holds the whole text, not a shortened one');
  for(const part of ['未獲官方贊助或認可','官方 Logo 僅用於辨識遊戲','權利人要求時將立即移除'])assert.ok(full.includes(part),`legal meaning kept: ${part}`);
  assert.doesNotMatch(footer,/\son[a-z]+\s*=/i,'no inline handlers (strict CSP)');
});

test('footer CSS: desktop shows the paragraph; at phone width the expander replaces it, links are a 2-column grid with 44px targets',()=>{
  assert.match(css,/\.brand-footer \.foot-legal\{display:none\}/,'expander is hidden by default (desktop)');
  assert.match(mobile,/@media \(max-width:760px\)\{[\s\S]*\.brand-footer \.foot-legal-full\{display:none\}[\s\S]*\.brand-footer \.foot-legal\{display:block\}/,'phone swaps them');
  assert.match(mobile,/\.footer-links ul\{display:grid;grid-template-columns:1fr 1fr;/,'links in two columns');
  assert.match(clean,/\.brand-footer \.footer-links a\{display:inline-flex;align-items:center;min-height:44px/,'link targets stay 44px');
  assert.match(clean,/\.brand-footer summary\{min-height:44px/,'and so do the summary rows (expander included)');
});

test('wall cards: name is always two lines tall, number and rarity never wrap, collect row is the last stretching row',()=>{
  assert.match(css,/\.card:not\(\.card-list\) h3\{[^}]*min-height:2\.7em[^}]*font-weight:700/,'desktop name: bold, 2-line slot');
  assert.match(css,/\.card:not\(\.card-list\) h3\{min-height:2\.6em;/,'phone name: 2-line slot');
  assert.match(css,/\.card:not\(\.card-list\) \.meta\{[^}]*flex-wrap:nowrap/,'number + rarity on one row');
  assert.match(css,/\.card-ctx :is\(\.card-game,\.card-series\)\{display:block;height:16px;/,'game line and series line are fixed 16px rows');
  assert.doesNotMatch(css,/\.card\.is-owned:not\(\.card-list\)/,'owned cards keep the same layout: the collect toggle stays put when pressed');
  assert.match(css,/@media \(max-width:760px\)\{[\s\S]*"flags flags" "act act";grid-template-rows:repeat\(6,auto\) 1fr\}/,'phone: every card ends with the collect row');
});
