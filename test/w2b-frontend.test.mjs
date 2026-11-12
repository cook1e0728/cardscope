import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 第 1 波 W2b：漲勢連結只收 https、換版本後的鍵盤焦點、開卡不打 /api/reports、coverage 只在關於頁載入、
// 不寫死遊戲數量、整頁只有一個 h1、搜尋結果頂欄有搜尋框、隱私說明／資料來源頁。
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const html = read('index.html'), ui = read('ui-enhancements.js'), navigator = read('series-navigator.js'), nav = read('navigation-state.js'), theme = read('theme-binder.css'), layout = read('catalog-layout.css'), events = read('market-events.js');
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

test('series-navigator renderTrends: cardUrl 只接受 https://，其餘改成 #', () => {
  const start = navigator.indexOf('function renderTrends(){'), end = navigator.indexOf('\nfetch(', start);
  assert.ok(start >= 0 && end > start);
  const section = { hidden: false, innerHTML: '' };
  const context = vm.createContext({ e: esc, document: { getElementById: () => section }, trendRows: [], trendMeta: {} });
  vm.runInContext(navigator.slice(start, end), context);
  const hrefs = url => {
    context.trendRows = [{ cardUrl: url, cardName: 'x', cardNumber: '1', changePercent: 5, currency: 'JPY', previousPrice: 1, price: 2 }];
    vm.runInContext('renderTrends()', context);
    return [...section.innerHTML.matchAll(/class="trend-card" href="([^"]*)"/g)].map(match => match[1]);
  };
  assert.deepEqual(hrefs('https://example.test/card?a=1&b=2'), ['https://example.test/card?a=1&amp;b=2']);
  for (const bad of ['javascript:alert(1)', 'http://example.test/', 'data:text/html,x', '//example.test/', '', undefined, null]) assert.deepEqual(hrefs(bad), ['#'], String(bad));
  assert.deepEqual(hrefs('https://example.test/"><img src=x onerror=1>'), ['https://example.test/&quot;&gt;&lt;img src=x onerror=1&gt;'], '帶引號的網址仍被跳脫');
});

test('B4: 換版本後焦點留在版本列，載入中舊內容的鍵盤操作被擋掉', () => {
  assert.match(ui, /refocus=Boolean\(options\.keepPosition&&document\.activeElement\?\.closest\?\.\('#detail \[data-version-card\]'\)\)/, '只有從版本按鈕換版本才要還焦點');
  assert.match(ui, /if\(refocus\)\{const current=\$\('detail'\)\.querySelector\('\.version-list \[aria-current="true"\]'\);if\(current\)\{current\.tabIndex=-1;current\.focus\(\)\}\}/, '重畫後焦點移到新版本的「目前顯示」列');
  assert.match(ui, /if\(refocus\)retry\.focus\(\)/, '失敗時焦點移到重試鈕');
  // 守門：#detail[aria-busy=true] 時，捕獲階段擋 click／Enter／Space／方向鍵
  const start = ui.indexOf("(()=>{const busy=event=>$('detail')"), end = ui.indexOf('\n', start);
  assert.ok(start >= 0 && end > start, 'guard found');
  const listeners = {}, attrs = {}, detail = { getAttribute: name => attrs[name] ?? null }, document = { addEventListener: (type, handler, capture) => { listeners[type] = { handler, capture } } };
  vm.runInContext(ui.slice(start, end), vm.createContext({ $: () => detail, document }));
  assert.equal(listeners.click.capture, true); assert.equal(listeners.keydown.capture, true);
  const fire = (type, init = {}) => { const event = { ...init, target: { closest: selector => (init.outside ? null : selector === '#detail' ? detail : null) }, prevented: false, stopped: false, preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true } }; listeners[type].handler(event); return event };
  attrs['aria-busy'] = 'true';
  for (const key of ['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) { const event = fire('keydown', { key }); assert.ok(event.prevented && event.stopped, `busy blocks ${JSON.stringify(key)}`); }
  for (const key of ['Escape', 'Tab']) { const event = fire('keydown', { key }); assert.ok(!event.prevented && !event.stopped, `busy still lets ${key} through`); }
  assert.ok(fire('click').stopped, 'busy blocks keyboard-synthesised clicks');
  assert.ok(!fire('click', { outside: true }).stopped && !fire('keydown', { key: 'Enter', outside: true }).stopped, 'busy: 對話框以外的元素不受影響');
  delete attrs['aria-busy'];
  assert.ok(!fire('click').stopped && !fire('keydown', { key: 'Enter' }).stopped, 'idle: nothing is blocked');
});

test('B5a: 開卡不再請求 /api/reports，回報分頁程式移除', () => {
  assert.doesNotMatch(ui, /api\/reports/);
  assert.doesNotMatch(ui, /reportList|reportResult|reportResponse/);
  assert.doesNotMatch(ui, /data-detail-panel="reports"|detail-tab-reports/);
  assert.match(ui, /const DETAIL_TABS=\[\['info','資訊'\],\['market','價格'\]\];/);
});

test('B5a: coverage 只在關於頁載入（首頁與遊戲頁不請求）', () => {
  const start = html.indexOf('window.onAboutView='), end = html.indexOf('window.coverageOnce=', start);
  assert.ok(start >= 0 && end > start);
  const make = view => {
    const body = { dataset: { view } }, observers = [];
    class MutationObserver { constructor(callback) { this.callback = callback; this.live = true; observers.push(this) } observe() {} disconnect() { this.live = false } }
    const context = vm.createContext({ window: {}, document: { body }, MutationObserver });
    vm.runInContext(html.slice(start, end), context);
    const setView = next => { body.dataset.view = next; observers.filter(o => o.live).forEach(o => o.callback()) };
    return { onAboutView: context.window.onAboutView, setView };
  };
  for (const view of ['landing', 'game', 'privacy']) {
    const { onAboutView, setView } = make(view); let calls = 0;
    onAboutView(() => calls++);
    assert.equal(calls, 0, `${view}: coverage not requested`);
    setView('landing'); assert.equal(calls, 0);
    setView('about'); assert.equal(calls, 1, `${view} → about (client-side navigation): requested once`);
    setView('landing'); setView('about'); assert.equal(calls, 1, 'only once');
  }
  const direct = make('about'); let calls = 0;
  direct.onAboutView(() => calls++);
  assert.equal(calls, 1, '網址直開 ?view=about：立刻載入');
  // 每個呼叫 coverageOnce 的地方都包在 onAboutView 裡
  const body = html.replace(/window\.coverageOnce=\(\)=>[^\n]*/, '');
  for (const match of body.matchAll(/coverageOnce/g)) assert.match(body.slice(Math.max(0, match.index - 40), match.index), /onAboutView\(\(\)=>window\.$/, 'index.html: coverageOnce 只在 onAboutView 內呼叫');
  assert.match(ui, /coverageRequest=window\.onAboutView\?new Promise\(resolve=>window\.onAboutView\(\(\)=>resolve\(loadCoverage\(\)\)\)\):loadCoverage\(\)/, 'ui-enhancements.js: 資料完整度區塊同樣等到關於頁');
});

test('B5b: 不寫死遊戲數量，收錄狀態格線自動欄數', () => {
  assert.doesNotMatch(html + ui, /五個 IP|5 個 IP/);
  assert.match(layout, /\.coverage-status-grid\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(\d+px,1fr\)\)/);
});

test('F1: 整頁只有一個 h1（.hero-intro），其餘兩個改成 h2 且樣式選擇器跟著改', () => {
  const h1s = [...html.matchAll(/<h1\b[^>]*>/g)];
  assert.equal(h1s.length, 1);
  assert.match(html, /<div class="hero-intro"><h1>跨版本卡牌圖鑑<\/h1>/, '伺服器用這段標記換 h1，不能動');
  assert.match(html, /<h2 id="aboutTitle">資料收錄狀態<\/h2>/);
  assert.match(html, /<h2 id="brandShowcaseTitle">你的卡牌宇宙，一眼找到<\/h2>/);
  assert.doesNotMatch(theme, /about-intro h1/);
  assert.doesNotMatch(layout, /brand-showcase h1/);
  assert.match(theme, /about-intro h2\{/);
  assert.match(layout, /brand-showcase h2\{font-size:25px\}/);
});

test('D1: 搜尋結果（#cardsSection.has-results）不套用首頁版面的「隱藏頂欄搜尋框」', () => {
  assert.match(theme, /body\[data-view="landing"\]:where\(:not\(:has\(#cardsSection\.has-results\)\)\) \.top \.search\{display:none\}/);
  assert.doesNotMatch(theme, /\r?\nbody\[data-view="landing"\] \.top \.search\{display:none\}/, '舊的無條件規則已移除');
  assert.match(html, /\$\('cardsSection'\)\?\.classList\.add\('has-results'\)/, '搜尋時加上 has-results');
  assert.match(html, /\$\('cardsSection'\)\?\.classList\.remove\('has-results'\)/, '回到首頁時移除');
});

test('G1/G3: ?view=privacy 有隱私說明與資料來源表，不含待辦字樣，頁尾連得到', () => {
  assert.match(html, /<section class="info-page" id="privacy" aria-labelledby="privacyTitle">/);
  assert.match(html, /<section class="info-page" id="sources" aria-labelledby="sourcesTitle">/);
  assert.match(html, /<h2 id="privacyTitle">隱私說明<\/h2>/);
  assert.match(html, /<h2 id="sourcesTitle">資料來源<\/h2>/);
  assert.doesNotMatch(html, /TODO|example\.invalid|〈/, '聯絡信箱未定，不上線待辦字樣');
  assert.match(html, /<!-- 聯絡方式：等決定 5 -->/);
  const table = html.match(/<table class="source-table">[\s\S]*?<\/table>/)[0];
  for (const game of ['寶可夢', '航海王', '遊戲王', '葬送的芙莉蓮', '排球少年', '七龍珠超 Fusion World']) assert.match(table, new RegExp(`<th scope="row">${game}`));
  assert.equal([...table.matchAll(/<tbody>[\s\S]*<\/tbody>/g)].length, 1);
  assert.equal([...table.matchAll(/<tr><th scope="row">/g)].length, 6);
  const privacy = html.match(/<section class="info-page" id="privacy"[\s\S]*?<\/section>/)[0] + html.match(/<section class="info-page" id="sources"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(privacy, /\son\w+=|javascript:|<script/i);
  assert.match(privacy, /<a href="https:\/\/www\.exchangerate-api\.com" rel="noopener">/);
  assert.match(html, /<a href="\/\?view=privacy">隱私說明與資料來源<\/a>/, '頁尾連結');
  assert.match(html, /<a href="\/\?view=about">資料收錄狀態與勘誤方式<\/a>/);
  // 其他頁面一律不顯示；privacy 視同 about 的版面（隱藏首頁與卡牆）
  assert.match(theme, /body:not\(\[data-view="privacy"\]\) \.info-page\{display:none\}/);
  assert.match(theme, /body\[data-view="privacy"\] \.hero,body\[data-view="privacy"\] #cardsSection/);
});

test('G1/G3: body[data-view] 與網址狀態把 privacy 當成站內頁', () => {
  assert.match(html, /document\.body\.dataset\.view=g==='all'\?\(\['about','privacy'\]\.includes\(p\.get\('view'\)\)\?p\.get\('view'\):'landing'\):'game'/, '提早執行的內嵌腳本');
  assert.match(html, /siteView==='about'\|\|siteView==='privacy'\?siteView:'landing'/, 'render()');
  assert.match(nav, /\['all','about','privacy'\]\.includes\(clean\(params\.get\('view'\)\)\)/);
  assert.match(nav, /siteView=\['about','privacy'\]\.includes\(state\.view\)\?state\.view:''/);
  assert.match(nav, /\(\['about','privacy'\]\.includes\(document\.body\?\.dataset\?\.view\)\?document\.body\.dataset\.view:''\)/, 'urlFor 保留 view=privacy');
  assert.match(events, /view\.view==='about'\|\|view\.view==='privacy'/, '隱私頁不載入卡牌時事');
  // 內嵌腳本不得出現 on*= 屬性（CSP script-src-attr 'none'）
  assert.doesNotMatch(html, /<[a-z][^>]*\son(?:click|error|load|submit|change|input|keydown)=/i);
});
