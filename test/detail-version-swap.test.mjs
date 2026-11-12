import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const ui=fs.readFileSync(new URL('../ui-enhancements.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('切換版本保留目前內容並標記忙碌，其他開卡路徑先清掉忙碌標記',()=>{
  assert.match(ui,/options\.keepPosition&&box\.querySelector\('\.detail'\)\)box\.setAttribute\('aria-busy','true'\);\s*else\{box\.removeAttribute\('aria-busy'\)/);
  assert.match(ui,/box\.removeAttribute\('aria-busy'\);box\.innerHTML=`\$\{detailCrumbs\}<div class="detail detail-flow"/);
  assert.match(ui,/catch\(error\)\{if\(stale\(\)\)return;box\.removeAttribute\('aria-busy'\)/);
});
test('捲到結果超過一個畫面高時直接跳，不平滑掃過中間區塊',()=>{
  assert.match(html,/behavior:reduce\|\|Math\.abs\(top-scrollY\)>innerHeight\?'auto':'smooth'/);
});
