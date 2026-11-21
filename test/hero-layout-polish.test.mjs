import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, v2] = await Promise.all(['../index.html', '../look-v2.css'].map(p => readFile(new URL(p, import.meta.url), 'utf8')));

test('hero intro splits its two sentences into clean punctuation-ending lines without breaking SSR h1 hook', () => {
  assert.match(html, /<div class="hero-intro"><h1>跨版本卡牌圖鑑<\/h1><p><span class="hero-line"><span class="hero-seg">直接搜卡名或卡號，<\/span><span class="hero-seg">或從下方選遊戲開始翻閱。<\/span><\/span><span class="hero-line"><span class="hero-seg">寶可夢同一張卡<\/span><span class="hero-seg">支援日版、台版並列對照。<\/span><\/span><\/p><\/div>/);
  assert.match(v2, /body\[data-view="landing"\] \.hero-intro p\{max-width:none;text-wrap:pretty\}/);
  assert.match(v2, /body\[data-view="landing"\] \.hero-intro \.hero-line\{display:block\}/);
  assert.match(v2, /\.hero-seg,html\.look-clean body\[data-view\] \.copy-seg\{display:inline-block\}/);
});

test('site-wide intro paragraphs wrap complete clauses in .copy-seg for clean punctuation breaks', () => {
  assert.match(html, /<h2 id="aboutTitle">資料收錄狀態<\/h2><p><span class="copy-seg">各 IP 的收錄量、欄位缺口與更新時間都分開呈現；<\/span><span class="copy-seg">缺資料會標示待補，不以推測內容填空。<\/span><\/p>/);
  assert.match(html, /<h2 id="brandShowcaseTitle">你的卡牌宇宙，一眼找到<\/h2><p><span class="copy-seg">從作品、版本、系列到稀有度，<\/span><span class="copy-seg">用熟悉的方式探索每一張卡。<\/span><\/p>/);
  assert.match(html, /<h2 id="betaGuidanceTitle">查得到，也看得懂資料狀態<\/h2><p><span class="copy-seg">CardSeek 仍在補齊各遊戲的卡號、卡圖、中文名與稀有度。<\/span><span class="copy-seg">資料不完整時會直接標記，不以推測內容填空。<\/span><\/p>/);
});

test('both #heroQ and #q use a concise complete placeholder and generous desktop search widths', () => {
  assert.match(html, /id="q"[^>]*placeholder="搜尋卡名、卡號或系列（如皮卡丘、OP-05）"/);
  assert.match(html, /id="heroQ"[^>]*placeholder="搜尋卡名、卡號或系列（如皮卡丘、OP-05）"/);
  assert.match(v2, /\.hero>\.home-search,html\.look-clean body\[data-view="landing"\]:not\(\[data-side\]\) \.hero>\.home-examples\{max-width:560px\}/);
  assert.match(v2, /@media \(min-width:761px\) and \(max-width:999px\)\{[^}]*body\[data-side\] header\.top \.bar>\.brand\{min-width:auto\}/);
});

test('.home-examples isolates its pill buttons into .home-examples-list so pills stay on one row on desktop and never drop under the label', () => {
  assert.match(html, /<div class="home-examples" role="group" aria-label="搜尋範例"><span>熱門搜尋<\/span><div class="home-examples-list">(<button type="button" data-example="[^"]+">[^<]+<\/button>){5}<\/div><\/div>/);
  assert.match(v2, /body\[data-view="landing"\] \.home-examples\{display:grid;grid-template-columns:max-content minmax\(0,1fr\);align-items:start;column-gap:10px;row-gap:6px\}/);
  assert.match(v2, /body\[data-view="landing"\] \.home-examples-list\{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0\}/);
  assert.match(v2, /body\[data-view="landing"\] \.home-examples button\{[^}]*min-height:var\(--btn-h\);padding:0 13px;[^}]*font-size:13px/);
  assert.match(v2, /@media \(max-width:760px\)\{[\s\S]*body\[data-view="landing"\] \.home-examples\{grid-template-columns:minmax\(0,1fr\);margin-top:8px\}/);
});
