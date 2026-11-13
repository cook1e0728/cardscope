import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 第 2 波前端：B6 手機第一次進站不自動跳導覽、D2 頁尾連結、D3 麵包屑、F4 隱私頁統計說明。
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const html = read('index.html'), ui = read('ui-enhancements.js'), nav = read('navigation-state.js'), showcase = read('look-showcase.js'), showcaseCss = read('look-showcase.css'), clean = read('look-clean.css');
const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
const slice = (source, from, to) => { const start = source.indexOf(from), end = source.indexOf(to, start); assert.ok(start >= 0 && end > start, `找不到 ${from}`); return source.slice(start, end); };

test('B6: 手機（≤760px）第一次進站不自動開導覽；看導覽鈕沒看過叫「看導覽」，看過叫「重看導覽」', () => {
  assert.match(showcase, /if\(tourDone\(\)\|\|!landing\(\)\|\|mobile\(\)\)return;/, 'maybeAutoStart 在手機直接返回');
  assert.match(showcase, /const mobile=\(\)=>matchMedia\('\(max-width:760px\)'\)\.matches;/, '與其他手機判斷同一個斷點');
  assert.match(showcase, /\$\('\.hero-intro'\)\?\.append\(mk\('cs1-replay-m'\)\);syncReplayLabel\(\);/, '建立按鈕後立刻標上正確文字');
  assert.match(showcase, /if\(mark\)\{try\{localStorage\.setItem\(DONE,'1'\)\}catch\{\}syncReplayLabel\(\)\}/, '看完／略過後文字改成重看導覽');
  const run = done => {
    const button = { textContent: '', classList: { set: new Set(), toggle(name, on) { on ? this.set.add(name) : this.set.delete(name) } } };
    const context = vm.createContext({ DONE: 'cs-tour-done', $: () => button, localStorage: { getItem: () => (done ? '1' : null) } });
    vm.runInContext(slice(showcase, 'const tourDone=', '\n  const firstVis') , context);
    vm.runInContext('syncReplayLabel()', context);
    return button;
  };
  const fresh = run(false), seen = run(true);
  assert.equal(fresh.textContent, '✦ 看導覽'); assert.ok(fresh.classList.set.has('cs1-replay-new'));
  assert.equal(seen.textContent, '✦ 重看導覽'); assert.ok(!seen.classList.set.has('cs1-replay-new'));
  // localStorage 讀不到（無痕等）當成沒看過
  const blocked = vm.createContext({ DONE: 'x', $: () => null, localStorage: { getItem() { throw new Error('blocked') } } });
  vm.runInContext(slice(showcase, 'const tourDone=', '  // 手機按鈕'), blocked);
  assert.equal(vm.runInContext('tourDone()', blocked), false);
  // 第一次的按鈕實心米白（深底上最醒目），焦點框用深色；底色不透明，冒煙測試才量得到對比
  assert.match(showcaseCss, /\.cs1-replay\.cs1-replay-new\{[^}]*background:#F6F1E6;[^}]*color:#1B1733/);
  assert.match(showcaseCss, /\.cs1-replay\.cs1-replay-new:focus-visible\{outline-color:#1B1733\}/);
  assert.match(showcaseCss, /\.cs1-replay\{display:inline-flex;[^}]*min-height:44px/, '觸控目標 44px');
});

test('D2: 頁尾連結列：站內三個連結＋勘誤表單＋聯絡信箱', () => {
  const footer = html.match(/<footer class="brand-footer">[\s\S]*?<\/footer>/)[0];
  const links = footer.match(/<nav class="footer-links" aria-label="站內資訊">[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...links.matchAll(/<a href="([^"]+)" data-spa>([^<]+)<\/a>/g)].map(m => [m[1], m[2]]), [['/?view=market', '行情'], ['/?view=about', '資料收錄狀態'], ['/?view=privacy', '隱私說明'], ['/?view=privacy#sources', '資料來源']]);
  assert.equal((links.match(/<a /g) || []).length, 6, '沒有多出來的（死）連結');
  assert.match(links, /<a href="https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/viewform" target="_blank" rel="noopener">勘誤回報<\/a>/);
  assert.match(links, /<a href="mailto:cardscopetw@gmail\.com">聯絡我們<\/a>/);
  assert.doesNotMatch(links, /href="(#|mailto:|)"/);
  assert.match(footer, /權利人要求時將立即移除/, '版權與免責文字保留');
  assert.match(footer, /class="mascot-gallery"/, '吉祥物圖庫保留');
  // 字級與觸控目標：頁尾全部 13px 以上，連結 44px 高
  assert.match(clean, /html\.look-clean \.brand-footer\{font-size:16px\}/);
  assert.match(clean, /html\.look-clean \.brand-footer \.footer-links a\{display:inline-flex;align-items:center;min-height:44px;/);
  assert.match(clean, /html\.look-clean \.mascot-gallery figcaption\{font-size:13px\}/);
  assert.doesNotMatch(footer, /on\w+="/i, '不用 on*= 屬性（CSP）');
});

test('D2: data-spa 連結走 pushState 站內導覽，不整頁重載', async () => {
  const location = { origin: 'http://localhost', pathname: '/', search: '', hash: '', get href() { return this.origin + this.pathname + this.search + this.hash } };
  const pushes = [], docListeners = new Map(), nodes = new Map();
  const classes = () => { const set = new Set(); return { add: n => set.add(n), remove: n => set.delete(n), contains: n => set.has(n) } };
  const node = id => { const n = { id, value: '', style: {}, dataset: {}, classList: classes(), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, after() {}, append() {}, prepend() {}, setAttribute() {}, removeAttribute() {}, focus() {} }; nodes.set(id, n); return n };
  for (const id of ['browseRegion', 'priceFilter', 'cardSort', 'q', 'modal', 'close', 'detail', 'cardZoom', 'sources']) node(id);
  nodes.get('sources').scrollIntoView = () => { nodes.get('sources').scrolled = true };
  const document = { getElementById: id => nodes.get(id), querySelector: () => null, createElement: () => node('x'), addEventListener(type, handler) { (docListeners.get(type) || docListeners.set(type, []).get(type)).push(handler) } };
  const apply = url => { const p = new URL(url, location.origin); location.pathname = p.pathname; location.search = p.search; location.hash = p.hash };
  const history = { state: { scrollY: 0 }, replaceState(s, u, url) { this.state = s; apply(url) }, pushState(s, u, url) { this.state = s; pushes.push(url); apply(url) }, back() {} };
  const context = vm.createContext({ document, history, location, URL, URLSearchParams, console, setTimeout, clearTimeout, requestAnimationFrame: cb => { cb(); return 1 }, window: null, C: { games: [{ id: 'pokemon' }, { id: 'onepiece' }], series: [] }, game: 'all', browse: { seriesId: '', offset: 0, loading: false, hasMore: false }, cardFilters: { rarity: 'all', price: 'all', sort: 'number-asc' }, chosen: [] });
  context.window = context; context.scrollTo = () => {}; context.addEventListener = () => {};
  vm.runInContext("let activeDetailCardId=null; choose=async id=>{chosen.push(id);game=id}; openCard=async()=>{};", context);
  vm.runInContext(nav, context);
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  await flush(); pushes.length = 0; context.chosen.length = 0;
  const click = (href, init = {}) => { const link = { getAttribute: () => href }, event = { type: 'click', button: 0, defaultPrevented: false, target: { closest: sel => (sel === 'a[data-spa]' ? link : null) }, preventDefault() { this.defaultPrevented = true }, ...init }; for (const handler of docListeners.get('click') || []) handler(event); return event };
  // 一般左鍵：攔下、pushState、依新網址還原（選到 pokemon）
  let event = click('/?game=pokemon&region=JP'); await flush(); await flush();
  assert.equal(event.defaultPrevented, true); assert.deepEqual(pushes, ['/?game=pokemon&region=JP']); assert.deepEqual(context.chosen.slice(0, 1), ['pokemon']);
  // 詳細頁開著：先關掉（不用 history.back，新網址是新的一步）
  nodes.get('modal').classList.add('open'); pushes.length = 0;
  click('/?game=pokemon&series=pokemon-jp-m6a'); await flush(); await flush();
  assert.equal(nodes.get('modal').classList.contains('open'), false, '麵包屑連結先關掉詳細頁');
  assert.deepEqual(pushes, ['/?game=pokemon&series=pokemon-jp-m6a']);
  // 錨點：還原後捲到目標
  pushes.length = 0; click('/?view=privacy#sources'); await flush(); await flush();
  assert.deepEqual(pushes, ['/?view=privacy#sources']); assert.equal(nodes.get('sources').scrolled, true);
  // 修飾鍵、非左鍵、別的網域：交給瀏覽器
  pushes.length = 0;
  for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) assert.equal(click('/?view=about', init).defaultPrevented, false, JSON.stringify(init));
  assert.equal(click('https://example.test/?view=about').defaultPrevented, false);
  assert.deepEqual(pushes, []);
  // 沒有 data-spa 的點擊不處理
  const plain = { type: 'click', button: 0, defaultPrevented: false, target: { closest: () => null }, preventDefault() { this.defaultPrevented = true } };
  for (const handler of docListeners.get('click') || []) handler(plain);
  assert.equal(plain.defaultPrevented, false);
});

// 麵包屑函式在 ui-enhancements.js 的全域範圍；取出來用假的 G／rn／titleName 跑
const crumbSource = slice(ui, 'function crumbTrail(', '\n// ── 分頁標題 end');
function crumbContext(extra = {}) {
  const context = vm.createContext({
    e: esc, G: id => ({ pokemon: { nameZh: '寶可夢' }, onepiece: { nameZh: '航海王' } }[id] || {}), rn: (region, game) => (region === 'TW' && game === 'onepiece' ? '亞洲日文版' : { JP: '日版', TW: '台版', US: '美版' }[region] || region),
    titleName: row => row.nameZh || row.officialCode || '', URLSearchParams, ...extra
  });
  vm.runInContext(crumbSource, context);
  return context;
}

test('D3: crumbsMarkup 輸出 nav＞ol，前面是連結、最後一格 aria-current="page"，字串都跳脫', () => {
  const context = crumbContext();
  const markup = vm.runInContext(`crumbsMarkup(crumbTrail('pokemon','JP',{id:'pokemon-jp-m6a',nameZh:'<b>M6a</b>'}).concat([{label:'<img src=x onerror=1>'}]))`, context);
  assert.match(markup, /^<nav class="crumbs" aria-label="麵包屑"><ol>/);
  assert.deepEqual([...markup.matchAll(/<li><a href="([^"]+)" data-spa>([^<]+)<\/a><\/li>/g)].map(m => [m[1], m[2]]), [
    ['/?game=pokemon', '寶可夢'], ['/?game=pokemon&amp;region=JP', '日版'], ['/?game=pokemon&amp;series=pokemon-jp-m6a', '&lt;b&gt;M6a&lt;/b&gt;']
  ]);
  assert.match(markup, /<li><span aria-current="page">&lt;img src=x onerror=1&gt;<\/span><\/li><\/ol><\/nav>$/);
  assert.equal((markup.match(/aria-current/g) || []).length, 1);
  assert.doesNotMatch(markup, /<img|<b>/, '外部字串不得以標籤出現');
  // 版本用既有地區名稱（航海王台版叫亞洲日文版）；沒有地區或系列就省略那一格，不留死連結
  assert.match(vm.runInContext(`crumbsMarkup(crumbTrail('onepiece','TW',null).concat([{label:'卡'}]))`, context), /亞洲日文版/);
  const bare = vm.runInContext(`crumbsMarkup(crumbTrail('pokemon','',null).concat([{label:'卡'}]))`, context);
  assert.equal((bare.match(/<a /g) || []).length, 1);
});

test('D3: 系列頁卡牆上方才有麵包屑；首頁、搜尋、全部卡片、關於頁都沒有', () => {
  let host = null;
  const section = { prepend(n) { section.child = n; host = n } };
  const document = { body: { dataset: { view: 'game' } }, createElement: () => ({ remove() { host = null } }) };
  const context = crumbContext({ document, $: id => (id === 'cardsSection' ? section : id === 'seriesCrumbs' ? host : null), game: 'pokemon', browse: { seriesId: 'pokemon-jp-m6a', all: false }, C: { series: [{ id: 'pokemon-jp-m6a', region: 'JP', nameZh: 'M6a 系列' }] } });
  vm.runInContext(crumbSource.slice(crumbSource.indexOf('function syncSeriesCrumbs')), context);
  const sync = () => vm.runInContext('syncSeriesCrumbs()', context);
  sync();
  assert.ok(host && host.id === 'seriesCrumbs');
  assert.match(host.innerHTML, /寶可夢[\s\S]*日版[\s\S]*<span aria-current="page">M6a 系列<\/span>/);
  assert.equal((host.innerHTML.match(/<a /g) || []).length, 2);
  const first = host; sync(); assert.equal(host, first, '內容沒變不重畫');
  for (const [label, setup] of [['首頁', "document.body.dataset.view='landing'"], ['搜尋', "document.body.dataset.view='game';activeSearch={q:'x'}"], ['全部卡片', "activeSearch=null;browse.all=true"], ['沒選系列', "browse.all=false;browse.seriesId=''"]]) {
    vm.runInContext("document.body.dataset.view='game';game='pokemon';activeSearch=null;browse.all=false;browse.seriesId='pokemon-jp-m6a'", context); sync(); assert.ok(host, `${label} 前置`);
    vm.runInContext(setup, context); sync(); assert.equal(host, null, `${label}不顯示麵包屑`);
  }
  // 詳細頁：卡名在最後，前面都是連結；crumbs 接在 #detail 內容最前面（與 .detail 同層）
  assert.match(ui, /detailCrumbs=crumbsMarkup\(\[\.\.\.crumbTrail\(gid,crumbSeries\?\.region\|\|selectedPrinting\?\.region,crumbSeries\),\{label:name\(c\)\}\]\);/);
  assert.match(ui, /box\.innerHTML=`\$\{detailCrumbs\}<div class="detail detail-flow"/);
  assert.match(ui, /syncSeriesCrumbs\(\)\}catch/, '跟分頁標題同時機更新');
  // 樣式：觸控 44px、滑鼠 24px 以上，焦點框有實線
  assert.match(clean, /\.crumbs a\{display:inline-flex;align-items:center;min-height:24px;/);
  assert.match(clean, /@media \(pointer:coarse\)\{html\.look-clean \.crumbs a\{min-height:44px\}\}/);
  assert.match(clean, /\.crumbs a:focus-visible\{outline:2px solid var\(--lc-ink\)/);
});

test('F4: 隱私頁寫明每天只統計各類頁面開啟總次數，且前面的句子不再說「完全沒有分析」', () => {
  const privacy = html.match(/<section class="info-page" id="privacy"[\s\S]*?<\/section>/)[0];
  assert.ok(privacy.includes('<li>伺服器每天統計各類頁面（首頁、遊戲、系列、卡片、搜尋）被開啟的總次數，只留下每天的總數；不記 IP、不記搜尋字詞、不放 cookie，也無法分辨是誰開的。另外每天記錄被開啟最多次的前 50 張卡各被開了幾次，用來排「最熱」，同樣不記錄是誰開的。</li>'));
  assert.ok(privacy.includes('<li>不使用第三方的分析或廣告工具（沒有 Google Analytics、沒有像素、沒有指紋辨識）。</li>'));
  assert.doesNotMatch(privacy, /不使用任何分析/);
  assert.match(privacy, /最後更新：2026-11-12/);
  assert.doesNotMatch(privacy, /\son\w+=|javascript:|<script/i);
});
