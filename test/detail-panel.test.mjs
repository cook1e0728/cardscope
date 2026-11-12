import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// 重新設計階段 4（docs/REDESIGN_PLAN.md 第 6 節「側板要解的五件事」）：兩段顯示（卡牆資料先畫、價格後到）、過期答案丟棄、
// 開關時卡牆上正在看的那張不跳位置、卡牆標記與「n / 共」、桌機／手機的模式切換。焦點、歷史、方向鍵各在 dialog-focus／navigation-state／detail-tabs 測試。
const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const [html, ui, css] = await Promise.all(['index.html', 'ui-enhancements.js', 'look-v2.css'].map(read));
const appSource = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n').split('async function init()')[0];
const between = (from, to) => { const start = ui.indexOf(from), end = ui.indexOf(to, start); assert.ok(start >= 0 && end > start, `${from} … ${to}`); return ui.slice(start, end); };

// 最小假 DOM：節點記下 innerHTML、屬性與 class；querySelector 對同一個選擇器回傳同一個子節點（deep），讓價格區塊（[data-price-body]）可以被檢查。
function makeDom() {
  const byId = new Map();
  const node = (id = '') => {
    const kids = new Map(), attrs = new Map(), classes = new Set();
    const n = {
      id, value: 'all', innerHTML: '', textContent: '', style: { setProperty() {} }, dataset: {}, children: [], hidden: false, disabled: false, isConnected: true, open: false,
      parentElement: { style: { setProperty() {} }, classList: { contains: () => true, toggle() {}, add() {}, remove() {} }, querySelector: () => ({}), querySelectorAll: () => [] },
      classList: { toggle() {}, add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
      setAttribute: (name, value) => attrs.set(name, String(value)), removeAttribute: name => attrs.delete(name), getAttribute: name => (attrs.has(name) ? attrs.get(name) : null),
      append() {}, prepend() {}, before() {}, after() {}, remove() {}, insertAdjacentElement() {}, appendChild: child => child, focus() {}, click() {}, scrollIntoView() {}, closest: () => null, contains: () => false, replaceChildren() {},
      getBoundingClientRect: () => ({ top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 }), addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [],
      querySelector(selector) { if (!kids.has(selector)) kids.set(selector, node()); return kids.get(selector) }
    };
    if (id) byId.set(id, n);
    return n;
  };
  for (const id of ['browseRegion', 'channels', 'productCategories', 'series', 'selectedProduct', 'cardsTitle', 'cardsMeta', 'cardTools', 'cards', 'loadMore', 'filterSummary', 'rarityFilter', 'priceFilter', 'cardSort', 'notice', 'modal', 'detail', 'status', 'detailPos']) node(id);
  const body = node('body'), head = node('head');
  const document = { body, head, title: '', activeElement: null, getElementById: id => byId.get(id) || null, createElement: () => node(), createElementNS: () => node(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  return { document, node, byId };
}

function harness({ fetch, mode = 'panel', tiles = () => [], scrollBy = () => {} }) {
  const dom = makeDom();
  dom.document.querySelectorAll = selector => (selector === '#cards .card-open-hit' ? tiles() : []);
  const context = vm.createContext({
    document: dom.document, console, fetch, matchMedia: query => ({ matches: query === '(min-width:1000px)' ? mode === 'panel' : false, addEventListener() {} }), setTimeout: () => 1, clearTimeout() {}, Blob, URL, URLSearchParams,
    localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, innerWidth: mode === 'panel' ? 1440 : 375, innerHeight: 900, scrollBy, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, confirm: () => true, location: { origin: 'http://localhost', search: '' }
  });
  context.window = context;
  vm.runInContext(appSource, context);
  vm.runInContext(ui, context);
  vm.runInContext("C={games:[{id:'pokemon',nameZh:'寶可夢'}],series:[],cards:[]};game='pokemon'", context);
  return { ...dom, context, run: code => vm.runInContext(code, context) };
}

const deferred = () => { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no }); return { promise, resolve, reject } };
const tick = () => new Promise(resolve => setImmediate(resolve));
const cardOf = (id, nameZh) => ({ id, game: 'pokemon', region: 'JP', language: 'ja', nameZh, nameJa: `${nameZh}ja`, officialCardNumber: '001', rarity: 'R', imageUrl: '', printings: [{ id: 1, cardId: id, region: 'JP', language: 'ja', localSetCode: 'S1', localCardNumber: '001', rarity: 'R' }] });
const json = data => ({ ok: true, json: async () => ({ data }) });
const emptyMarket = json({ records: [], meta: {} });

test('兩段顯示：先畫卡牆已有的資料（不標整頁忙碌）、卡片 API 回來補版本與價格區塊（只有它標忙碌）、市場資料回來只填價格區塊', async () => {
  const card = deferred(), market = deferred();
  const h = harness({ fetch: url => (/\/market$/.test(url) ? market.promise : card.promise) });
  h.run("currentCardRows=[{id:'a',game:'pokemon',region:'JP',nameZh:'卡甲',nameJa:'甲j',officialCardNumber:'001',rarity:'R',printings:[]}]");
  const detail = h.byId.get('detail'), pending = h.run('openCard("a")');
  // ① 同步畫出：卡名、卡號來自卡牆；還沒有版本與價格
  assert.match(detail.innerHTML, /detail-preview/);
  assert.match(detail.innerHTML, /卡甲/);
  assert.doesNotMatch(detail.innerHTML, /dpanel-versions|data-price-body/);
  assert.equal(detail.getAttribute('aria-busy'), null, '整個詳細頁沒有在忙，只有載入中的區塊才標 aria-busy');
  assert.equal(h.byId.get('modal').classList.contains('open'), true);
  // ② 卡片 API 回來
  card.resolve(json(cardOf('a', '卡甲')));
  await tick();
  assert.doesNotMatch(detail.innerHTML, /detail-preview/);
  assert.match(detail.innerHTML, /dpanel-versions/);
  assert.match(detail.innerHTML, /<div data-price-body aria-busy="true"><p class="state" role="status">正在讀取價格…<\/p><\/div>/, '價格區塊顯示載入中，並只在這塊標 aria-busy');
  assert.equal(detail.getAttribute('aria-busy'), null);
  // ③ 市場資料回來
  market.resolve(emptyMarket);
  await pending;
  const body = detail.querySelector('[data-price-body]');
  assert.match(body.innerHTML, /dpanel-trend/);
  assert.equal(body.getAttribute('aria-busy'), null, '價格畫好了才拿掉價格區塊的忙碌標記');
});

test('行情服務失敗只影響價格區塊：卡片資料與版本照常顯示，價格區塊說明暫時讀不到', async () => {
  const h = harness({ fetch: url => (/\/market$/.test(url) ? Promise.reject(new Error('down')) : Promise.resolve(json(cardOf('a', '卡甲')))) });
  await h.run('openCard("a")');
  const detail = h.byId.get('detail'), body = detail.querySelector('[data-price-body]');
  assert.match(detail.innerHTML, /dpanel-versions/);
  assert.match(body.innerHTML, /行情服務暫時無法回應/);
  assert.equal(body.getAttribute('aria-busy'), null);
});

test('過期的答案丟棄：先點 a 再點 b，a 比較晚回來也不能蓋掉 b', async () => {
  const gates = { a: { card: deferred(), market: deferred() }, b: { card: deferred(), market: deferred() } };
  const h = harness({ fetch: url => gates[decodeURIComponent(url.match(/cards\/([^/?]+)/)[1])][/\/market$/.test(url) ? 'market' : 'card'].promise });
  const detail = h.byId.get('detail'), first = h.run('openCard("a")'), second = h.run('openCard("b")');
  gates.b.card.resolve(json(cardOf('b', '卡乙')));
  gates.b.market.resolve(emptyMarket);
  await second;
  const shown = detail.innerHTML;
  assert.match(shown, /卡乙/);
  // a 的卡片資料與市場資料晚到
  gates.a.card.resolve(json(cardOf('a', '卡甲')));
  gates.a.market.resolve(emptyMarket);
  await first;
  assert.equal(detail.innerHTML, shown, 'a 的晚到答案整個丟掉');
  assert.equal(h.run('activeDetailCardId'), 'b');
});

test('過期的答案丟棄：卡片資料先回來、市場資料等到使用者換卡才回來，價格不會寫進新的卡', async () => {
  const gates = { a: { card: deferred(), market: deferred() }, b: { card: deferred(), market: deferred() } };
  const h = harness({ fetch: url => gates[decodeURIComponent(url.match(/cards\/([^/?]+)/)[1])][/\/market$/.test(url) ? 'market' : 'card'].promise });
  const detail = h.byId.get('detail'), first = h.run('openCard("a")');
  gates.a.card.resolve(json(cardOf('a', '卡甲')));
  await tick();
  const second = h.run('openCard("b")');
  gates.b.card.resolve(json(cardOf('b', '卡乙')));
  await tick();
  const body = detail.querySelector('[data-price-body]');
  body.innerHTML = '(b 的價格區塊，等待中)';
  gates.a.market.resolve(json({ records: [{ provider: 'Cardmarket', priceType: 'market', currency: 'EUR', amount: 99 }], meta: {} }));
  await first;
  assert.equal(body.innerHTML, '(b 的價格區塊，等待中)', 'a 的價格不寫進 b 的區塊');
  gates.b.market.resolve(emptyMarket);
  await second;
  assert.match(body.innerHTML, /dpanel-trend/);
});

test('關閉也作廢還在路上的請求：關掉之後晚到的答案不會把詳細頁重新畫出來', async () => {
  const card = deferred();
  const h = harness({ fetch: () => card.promise });
  const detail = h.byId.get('detail'), pending = h.run('openCard("a")');
  assert.equal(h.byId.get('modal').classList.contains('open'), true);
  h.run('window.closeCardDetail()');
  assert.equal(h.byId.get('modal').classList.contains('open'), false);
  assert.equal(h.run('activeDetailCardId'), null);
  const before = detail.innerHTML;
  card.resolve(json(cardOf('a', '卡甲')));
  await pending;
  assert.equal(detail.innerHTML, before);
  assert.equal(h.byId.get('modal').classList.contains('open'), false, '不會自己再打開');
});

test('版本切換：舊內容保留並只變淡（aria-busy），新內容換上或失敗時標記拿掉', async () => {
  const first = deferred(), second = deferred();
  const queue = [first, second];
  const h = harness({ fetch: url => (/\/market$/.test(url) ? Promise.resolve(emptyMarket) : queue.shift().promise) });
  const detail = h.byId.get('detail'), opening = h.run('openCard("a")');
  first.resolve(json(cardOf('a', '卡甲')));
  await opening;
  const shown = detail.innerHTML, switching = h.run('openCard("t",{keepPosition:true})');
  assert.equal(detail.innerHTML, shown, '換版本時不閃回骨架');
  assert.equal(detail.getAttribute('aria-busy'), 'true');
  second.resolve(json(cardOf('t', '卡甲台版')));
  await switching;
  assert.equal(detail.getAttribute('aria-busy'), null);
  assert.match(detail.innerHTML, /卡甲台版/);
});

test('開關側板時卡牆上正在看的那張不跳位置：量前後差距，把差距捲回去', () => {
  const scrolls = [];
  let top = 300;
  const tile = { isConnected: true, getBoundingClientRect: () => ({ top, bottom: top + 200 }), closest: () => tile };
  const hit = { dataset: { cardOpen: 'a' }, closest: () => tile };
  const h = harness({ fetch: () => deferred().promise, tiles: () => [hit], scrollBy: arg => scrolls.push(arg) });
  // 開側板：欄數 6→4，這張卡被擠到下面 180px
  h.run("holdPlace('a',()=>{})");
  assert.equal(scrolls.length, 0, '沒有位移就不捲');
  h.context.__move = () => { top += 180 };
  h.run("holdPlace('a',()=>__move())");
  assert.equal(JSON.stringify(scrolls), JSON.stringify([{ top: 180, behavior: 'instant' }]),'卡掉到下面多少，就捲下去多少，這張卡留在原處');
  // 不在畫面內的卡不補償（沒有東西需要留在原處）
  top = 2000;
  h.run("holdPlace('a',()=>__move())");
  assert.equal(scrolls.length, 1);
  // 沒有對應卡牆資料（網址直開）
  h.run("holdPlace('zzz',()=>{})");
  h.run('holdPlace(null,()=>{})');
  assert.equal(scrolls.length, 1);
  assert.match(ui, /openCard=async function[^]*?if\(!\$\('modal'\)\.classList\.contains\('open'\)\)holdPlace\(id,\(\)=>\$\('modal'\)\.classList\.add\('open'\)\)/, '開啟時量');
  assert.match(ui, /window\.closeCardDetail=function\(\)\{\s*holdPlace\(activeDetailCardId,\(\)=>\{\$\('modal'\)\.classList\.remove\('open'\)\}\)/, '關閉時量');
});

test('卡牆標記：目前開著的那張有 aria-current，上一張／下一張的位置與可用狀態跟著換', () => {
  const attrs = new Map(), hits = ['a', 'b', 'c'].map(id => ({ dataset: { cardOpen: id }, setAttribute: (name, value) => attrs.set(id, `${name}=${value}`), removeAttribute: () => attrs.delete(id) }));
  const buttons = [{ disabled: true }, { disabled: true }];
  const h = harness({ fetch: () => deferred().promise, tiles: () => hits });
  h.context.document.querySelectorAll = selector => (selector === '#cards .card-open-hit' ? hits : selector === '#modal [data-card-step]' ? buttons : []);
  h.run("currentCardRows=[{id:'a'},{id:'b'},{id:'c'}];activeDetailCardId='b';syncWall()");
  assert.equal(h.byId.get('detailPos').textContent, '2 / 3');
  assert.deepEqual([...attrs], [['b', 'aria-current=true']], '只有 b 標示目前');
  assert.deepEqual(buttons.map(button => button.disabled), [false, false]);
  h.run("currentCardRows=[{id:'a'}];activeDetailCardId='a';syncWall()");
  assert.deepEqual(buttons.map(button => button.disabled), [true, true], '只有一張卡就沒有上一張／下一張');
  h.run("activeDetailCardId=null;syncWall()");
  assert.equal(h.byId.get('detailPos').textContent, '');
  assert.equal(attrs.size, 0, '關閉後標記全部拿掉');
});

test('桌機（≥1000px）是側板、其餘全螢幕：模式由寬度決定，切換時 aria-modal 跟著換', () => {
  for (const [mode, expected] of [['panel', 'panel'], ['page', 'page']]) {
    const h = harness({ fetch: () => deferred().promise, mode });
    assert.equal(h.run('window.detailMode()'), expected);
    assert.equal(h.byId.get('modal').dataset.mode, expected);
  }
  assert.match(css, /@media \(min-width:1000px\)\{\s*html\.look-clean #modal\.open\{display:block;position:fixed;/, '側板用 position:fixed 釘在頂欄下方右側');
  assert.match(css, /@media \(max-width:999px\)\{\s*html\.look-clean #modal\.open\{padding:0;place-items:stretch/);
  assert.match(css, /body\[data-side\]:has\(#modal\.open\) #main\{max-width:calc\(var\(--shell-max\) - var\(--side-w\) - var\(--panel-w\)\);margin-right:var\(--panel-w\)\}/, '卡牆讓出側板的寬度');
  assert.match(css, /grid-template-columns:repeat\(auto-fill,minmax\(140px,1fr\)\)/, '欄數自動變少');
  assert.match(css, /--panel-w:clamp\(360px,34vw,440px\)/);
  assert.match(ui, /panelQuery\?\.addEventListener\?\.\('change',syncDetailMode\)/, '視窗跨過 1000px 時即時切換模式');
});

test('動作偏好：reduced-motion／暫停動態時詳細頁不做動畫', () => {
  assert.match(ui, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\|\|document\.documentElement\.hasAttribute\('data-cs-paused'\)\?'auto':'smooth'/, '跳到價格區塊不平滑捲動');
});
