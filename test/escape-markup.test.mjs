import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// A3：外部字串（卡名、系列名、稀有度、來源、網址…）進入 innerHTML 前都要跳脫。
// 把 <img src=x onerror=1>"'& 塞進每個畫標記的函式，輸出不得出現未跳脫的標記或跳出屬性。
const HOSTILE = '<img src=x onerror=1>"\'&';
const ESCAPED = '&lt;img src=x onerror=1&gt;&quot;&#39;&amp;';
const HOSTILE_URL = 'https://example.test/"><img src=x onerror=1>.png';
const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const [html, ui, band, timeline, movers, events, store, navigator] = await Promise.all(['index.html', 'ui-enhancements.js', 'series-band.js', 'price-timeline.js', 'price-movers.js', 'market-events.js', 'collection-store.js', 'series-navigator.js'].map(read));
const appSource = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n').split('async function init()')[0];

function assertSafe(markup, label) {
  const text = String(markup);
  assert.ok(text.length > 0, `${label}: no markup produced`);
  assert.ok(!text.includes('<img src=x'), `${label}: raw <img src=x in output`);
  assert.ok(!text.includes('onerror=1>'), `${label}: unescaped onerror=1> in output`);
  assert.ok(!/=\s*"[^"<>]*"\s*>?<img src=x/.test(text), `${label}: attribute breakout`);
}

// 最小假 DOM：節點記下 innerHTML；deep=true 時 querySelector 一律回傳（同一個）子節點，讓依賴子節點的繪製函式跑得下去。
function makeDom({ deep = false, localStore = {} } = {}) {
  const byId = new Map(), store = new Map(Object.entries(localStore)), timers = [];
  const node = (id = '') => {
    const kids = new Map(), listeners = {};
    const n = {
      id, value: 'all', innerHTML: '', textContent: '', style: { setProperty() {} }, dataset: {}, children: [], hidden: false, disabled: false, isConnected: true, open: false, parentElement: { style: { setProperty() {} }, classList: { contains: () => true, toggle() {}, add() {}, remove() {} }, querySelector: () => ({}), querySelectorAll: () => [] },
      classList: { toggle() {}, add() {}, remove() {}, contains() { return false } },
      append(...items) { this.children.push(...items) }, prepend() {}, before() {}, after() {}, remove() {}, insertAdjacentElement() {}, appendChild(child) { return child },
      setAttribute() {}, removeAttribute() {}, focus() {}, click() {}, scrollIntoView() {}, closest() { return null }, contains() { return false }, replaceChildren() {},
      getBoundingClientRect() { return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 } },
      addEventListener(type, handler) { (listeners[type] ||= []).push(handler) }, removeEventListener() {},
      fire(type, event = {}) { (listeners[type] || []).forEach(handler => handler(event)) },
      querySelectorAll() { return [] },
      querySelector(selector) { if (!deep) return null; if (!kids.has(selector)) kids.set(selector, node()); return kids.get(selector) }
    };
    if (id) byId.set(id, n);
    return n;
  };
  for (const id of ['browseRegion', 'channels', 'productCategories', 'series', 'selectedProduct', 'cardsTitle', 'cardsMeta', 'cardTools', 'cards', 'loadMore', 'filterSummary', 'rarityFilter', 'priceFilter', 'cardSort', 'notice', 'modal', 'detail', 'status']) node(id);
  const body = node('body'), head = node('head');
  const document = { body, head, title: '', activeElement: null, getElementById: id => byId.get(id) || null, createElement: () => node(), createElementNS: () => node(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  return { document, node, byId, store, timers };
}

// index.html 的主程式＋ui-enhancements.js（可選 collection-store.js）放進假 DOM 執行，之後用 run() 呼叫其中的函式。
function harness({ fetch = async () => ({ ok: true, json: async () => ({}) }), localStore, withStore = false, deep = false } = {}) {
  const dom = makeDom({ localStore, deep });
  const context = vm.createContext({
    document: dom.document, console, fetch, matchMedia: () => ({ matches: false }), setTimeout: fn => { dom.timers.push(fn); return dom.timers.length }, clearTimeout() {}, Blob, URL, URLSearchParams,
    localStorage: { getItem: key => dom.store.get(key) ?? null, setItem: (key, value) => dom.store.set(key, String(value)) }, addEventListener() {}, innerWidth: 1200, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, confirm: () => true, location: { origin: 'http://localhost', search: '' }
  });
  context.window = context;
  if (withStore) vm.runInContext(store, context);
  vm.runInContext(appSource, context);
  vm.runInContext(ui, context);
  return { ...dom, context, run: code => vm.runInContext(code, context) };
}

const hostileCard = (over = {}) => ({
  id: HOSTILE, canonicalId: HOSTILE, game: 'pokemon', region: 'JP', language: 'ja',
  nameZh: HOSTILE, nameJa: `${HOSTILE}ja`, nameEn: `${HOSTILE}en`, officialCardNumber: HOSTILE, rarity: HOSTILE, imageUrl: HOSTILE_URL, fallbackImageUrls: [HOSTILE_URL],
  series: { id: 'hostile-series', nameZh: HOSTILE, officialCode: HOSTILE, region: 'JP' },
  metadata: { variantName: HOSTILE, effectText: HOSTILE, effectTextZh: HOSTILE, nameZhBasis: HOSTILE, officialListing: HOSTILE },
  referencePrice: { amount: 5, amountTwd: 160, currency: 'EUR', source: HOSTILE, variant: HOSTILE, observedAt: HOSTILE, changePct: 5, changeFrom: HOSTILE },
  printings: [{ id: 1, cardId: HOSTILE, region: HOSTILE, language: HOSTILE, localSetCode: HOSTILE, localCardNumber: HOSTILE, rarity: HOSTILE, source: HOSTILE, sourceUrl: HOSTILE_URL, imageUrl: HOSTILE_URL, updatedAt: HOSTILE, seriesId: 'hostile-series', metadata: { variantName: HOSTILE, rarityBeforeOfficial: { rarity: HOSTILE } } }],
  ...over
});

test('card tile (grid, list and rarity-group views) escapes every external string', () => {
  const h = harness();
  h.run(`C={games:[{id:'pokemon',nameZh:${JSON.stringify(HOSTILE)}}],series:[{id:'hostile-series',nameZh:${JSON.stringify(HOSTILE)},officialCode:${JSON.stringify(HOSTILE)}}],cards:[]};game='pokemon'`);
  for (const mode of ['grid', 'list']) {
    h.run(`cardViewMode='${mode}'`);
    const markup = h.run(`cardMarkup(${JSON.stringify(hostileCard())})`);
    assertSafe(markup, `cardMarkup ${mode}`);
    assert.ok(markup.includes(ESCAPED), `${mode}: the name is shown, escaped`);
  }
  h.run("cardViewMode='rarity'");
  assertSafe(h.run(`renderCardRows([${JSON.stringify(hostileCard())}])`), 'rarity groups');
  assertSafe(h.run('renderCardEmpty()') + h.run(`missingImageMarkup(${JSON.stringify(HOSTILE)})`), 'empty states');
});

test('card detail view escapes names, numbers, sources, links, prices and reports', async () => {
  const card = hostileCard(), market = { records: [{ provider: HOSTILE, priceType: HOSTILE, currency: HOSTILE, amount: 5, priceTwd: 100, market: HOSTILE, observedAt: HOSTILE, variant: HOSTILE, region: HOSTILE, setCode: HOSTILE, rarity: HOSTILE, sourceUrl: HOSTILE_URL }], meta: { warning: HOSTILE, priceTypes: { [HOSTILE]: HOSTILE }, exchangeRates: { source: HOSTILE, updatedAt: HOSTILE } } };
  const fetch = async url => ({ ok: true, json: async () => /\/market$/.test(url) ? { data: market } : /reports/.test(url) ? { data: { reports: [{ platform: HOSTILE, currency: HOSTILE, price: 1 }] } } : { data: card } });
  // deep：價格區塊（[data-price-body]）是階段 4 起市場資料回來後才填的子節點，假 DOM 把它當同一個子節點，一併檢查
  const h = harness({ fetch, deep: true });
  h.run(`C={games:[{id:'pokemon',nameZh:${JSON.stringify(HOSTILE)}}],series:[{id:'hostile-series',nameZh:${JSON.stringify(HOSTILE)},officialCode:${JSON.stringify(HOSTILE)},region:'JP'}],cards:[]};game='pokemon'`);
  await h.run('openCard("x")');
  const detail = h.byId.get('detail').innerHTML + h.byId.get('detail').querySelector('[data-price-body]').innerHTML;
  assertSafe(detail, 'detail');
  assert.ok(detail.includes(ESCAPED));
  assert.ok(!detail.includes(`href="${HOSTILE_URL}`) && !detail.includes('href="https://example.test/"'), 'the source link cannot break out of href');
  // 沒有 https 的來源網址不會變成連結
  const plain = hostileCard({ printings: [{ ...card.printings[0], sourceUrl: 'javascript:alert(1)' }] });
  const h2 = harness({ deep: true, fetch: async url => ({ ok: true, json: async () => /\/market$/.test(url) ? { data: { records: [], meta: {} } } : /reports/.test(url) ? { data: { reports: [] } } : { data: plain } }) });
  await h2.run('openCard("x")');
  assert.ok(!/href="javascript:/i.test(h2.byId.get('detail').innerHTML));
});

test('detail failure message and loading text keep the error text escaped', async () => {
  const h = harness({ deep: true, fetch: async () => ({ ok: false, json: async () => ({ error: HOSTILE }) }) });
  await h.run('openCard("x")');
  assertSafe(h.byId.get('detail').innerHTML, 'detail error');
});

test('search suggestions escape names, numbers, rarity and the suggestion text', async () => {
  const card = hostileCard();
  const dom = makeDom();
  const input = dom.node('q'), parent = dom.node('searchBox');
  input.parentElement = parent; input.dataset = {}; dom.document.activeElement = input;
  const list = [];
  dom.document.createElement = () => { const n = dom.node(); list.push(n); return n; };
  dom.document.head.appendChild = () => {};
  dom.document.body.appendChild = () => {};
  dom.node('heroQ');
  const fetch = async () => ({ ok: true, json: async () => ({ data: [card], meta: { total: 20, parsed: { name: HOSTILE, rarities: [HOSTILE] }, suggestion: { q: HOSTILE, reason: HOSTILE } } }) });
  const context = vm.createContext({
    document: dom.document, console, fetch, matchMedia: () => ({ matches: false }), setTimeout: fn => { fn(); return 1; }, clearTimeout() {}, Blob, URL, URLSearchParams, AbortController,
    localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, innerWidth: 1200, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, confirm: () => true, location: { origin: 'http://localhost', search: '' }
  });
  context.window = context;
  vm.runInContext(appSource, context);
  vm.runInContext(ui, context);
  vm.runInContext(`C={games:[{id:'pokemon',nameZh:${JSON.stringify(HOSTILE)}}],series:[],cards:[]}`, context);
  input.value = HOSTILE;
  input.fire('input', { isComposing: false });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const lists = list.filter(n => n.innerHTML.includes('<li'));
  assert.ok(lists.length > 0, 'the suggestion list was drawn');
  for (const n of lists) assertSafe(n.innerHTML, 'search suggestions');
  assert.ok(lists.some(n => n.innerHTML.includes(ESCAPED)));
});

test('the collection page escapes saved card snapshots (they also come from imported backup files)', () => {
  const meta = { v: 1, id: 'h1', game: 'pokemon', nameZh: HOSTILE, nameEn: HOSTILE, officialCardNumber: HOSTILE, rarity: HOSTILE, region: HOSTILE, version: HOSTILE, image: HOSTILE_URL, note: HOSTILE, finish: HOSTILE, seriesId: HOSTILE, choices: [{ cardId: HOSTILE, region: HOSTILE, set: HOSTILE, number: HOSTILE, rarity: HOSTILE, variant: HOSTILE }], ambiguous: true };
  const h = harness({ withStore: true, localStore: { 'cardscope-watchlist': JSON.stringify({ h1: 2 }), 'cardscope-watchlist-meta': JSON.stringify({ h1: meta }) } });
  h.run(`C={games:[],series:[],cards:[]};game='all'`);
  for (const id of ['cardsSection', 'sideColl', 'collExtras', 'collManage', 'collManageBtn', 'collMenu', 'collSummary', 'collImportHost', 'collStatus', 'collSeries']) h.node(id);
  h.byId.get('body').dataset.view = 'collection';
  h.run('collectionUi.filter.game="pokemon";collectionUi.prices={h1:[{provider:"cardmarket",currency:' + JSON.stringify(HOSTILE) + ',amount:1,amountTwd:30,snapshotDate:' + JSON.stringify(HOSTILE) + ',variant:' + JSON.stringify(HOSTILE) + '}]};collectionUi.pricesState="ready";collectionUi.progress=' + JSON.stringify(HOSTILE));
  h.run('renderCollectionPage()');
  for (const [id, label] of [['cards', 'wall'], ['sideColl', 'side list'], ['collSummary', 'summary'], ['collImportHost', 'import preview']]) assertSafe(h.byId.get(id).innerHTML || 'x', label);
  assert.ok(h.byId.get('cards').innerHTML.includes(ESCAPED), 'the wall shows the saved names, escaped');
  assert.ok(h.byId.get('sideColl').innerHTML.includes(ESCAPED), 'the side list shows the saved series, escaped');
  assertSafe(h.run('collectionEditorHtml("h1")'), 'side panel editor (note, version and choices)');
  assert.ok(h.run('collectionEditorHtml("h1")').includes(ESCAPED));
  assertSafe(h.run('valueHtml(collectionValuation())'), 'reference total detail');
  assertSafe(h.run('rowPriceHtml(collectionItems()[0],collectionValuation())'), 'price lines in the side panel');
  assertSafe(h.run('collectionSeriesHtml()') || 'x', 'series progress');
});

test('series band (tabs, tiles, selected-series box, home preview) escapes series and region text', () => {
  const row = (over = {}) => ({ id: HOSTILE, game: 'pokemon', region: 'JP', officialCode: HOSTILE, nameZh: HOSTILE, nameJa: HOSTILE, nameEn: HOSTILE, imageUrl: HOSTILE_URL, releaseDate: '2026-01-01', productType: HOSTILE, ...over });
  const dom = makeDom({ deep: true });
  dom.node('gameContext'); const bandNode = dom.node('seriesBand'); dom.node('homeLatest');
  const context = vm.createContext({ fetch: () => new Promise(() => {}), document: dom.document, window: {}, localStorage: { getItem: () => null, setItem() {} }, console, Intl, Date, CSS: { escape: String }, matchMedia: () => ({ matches: false }), addEventListener() {}, requestAnimationFrame: () => 0, setTimeout() { return 1 }, clearTimeout() {}, Event: class {}, URL, URLSearchParams });
  context.window = context;
  const rows = [row(), row({ id: 's2', region: 'TW' }), row({ id: 's3', region: 'JP' })].map(item => JSON.stringify(item)).join(',');
  const product = JSON.stringify(row({ id: 'p1', imageKind: 'sealed-product', seriesId: HOSTILE, catalogCategory: '原盒' }));
  vm.runInContext(`var game='pokemon',C={games:[],series:[${rows}],cards:[]},P=[${product}],browse={rows:[],seriesId:'',product:null},cardFilters={rarity:"all"},series=function(){},G=()=>({}),rn=r=>r,openProduct=async()=>{},scrollBelowHeader=()=>{};`, context);
  const categorySource = appSource.slice(appSource.indexOf('const PRODUCT_CATEGORY_DEFINITIONS'), appSource.indexOf('\n', appSource.indexOf('const productMatchesCategory')));
  vm.runInContext(categorySource, context);
  vm.runInContext(navigator, context);
  vm.runInContext(band, context);
  vm.runInContext('window.renderSeriesBand();window.renderHomeLatest()', context);
  assertSafe(bandNode.innerHTML, 'series band (tabs and regions)');
  const rail = bandNode.querySelector('.series-band-rail');
  assertSafe(rail.innerHTML, 'series band tiles');
  assert.ok(rail.innerHTML.includes(ESCAPED), 'tile names are shown, escaped');
  assertSafe(dom.byId.get('homeLatest').querySelector('.rail, .series-band-rail')?.innerHTML || dom.byId.get('homeLatest').innerHTML || 'x', 'home latest');
});

test('price movers escape names, series codes and image urls', async () => {
  const row = (over = {}) => ({ cardId: HOSTILE, name: HOSTILE, nameJa: HOSTILE, cardNumber: HOSTILE, seriesCode: HOSTILE, seriesName: HOSTILE, imageUrl: HOSTILE_URL, currency: HOSTILE, changePercent: 250, from: { date: HOSTILE, amount: 5, amountTwd: 100 }, to: { date: HOSTILE, amount: 20, amountTwd: 400 }, ...over });
  const root = { fetch: async () => ({ ok: true, json: async () => ({ data: { up: [row()], down: [row({ changePercent: -50 })] }, meta: { windowDays: HOSTILE, minAmount: HOSTILE, note: HOSTILE } }) }) };
  // 來源、觀測時間、範圍都收在 ⓘ 裡；ⓘ 的標記由 ui-actions.js 產生，所以用真的那一份
  vm.runInNewContext(await read('ui-actions.js'), { window: root, document: { addEventListener() {} }, Object });
  vm.runInNewContext(movers, { window: root, ...root });
  const section = { hidden: true, innerHTML: '', classList: { add() {} } };
  await root.renderPriceMovers(section);
  assertSafe(section.innerHTML, 'price movers');
  assert.ok(section.innerHTML.includes(ESCAPED));
});

test('market events escape titles, sources and links, and only https links are drawn', async () => {
  const section = { hidden: true, innerHTML: '' };
  const window = { document: { getElementById: () => section, body: { dataset: { view: 'market', game: 'all' } } }, fetch: async () => ({ ok: true, json: async () => ({ data: [{ date: '2099-01-02', game: HOSTILE, title: HOSTILE, source: HOSTILE, url: 'https://example.test/"><img src=x onerror=1>' }, { date: '2099-01-01', game: 'pokemon', title: HOSTILE, source: HOSTILE, url: 'javascript:alert(1)' }], meta: { note: HOSTILE } }) }) };
  vm.runInNewContext(events, { window });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assertSafe(section.innerHTML, 'market events');
  assert.ok(section.innerHTML.includes(ESCAPED));
  assert.ok(!/href="javascript:/i.test(section.innerHTML), 'non-https links are dropped');
});

test('price timeline (graded table, comparison, events, records) escapes labels and sources', async () => {
  const sandbox = { window: {} };
  vm.runInNewContext(timeline, sandbox);
  const T = sandbox.window.PriceTimeline;
  assertSafe(T.gradedMarkup({ status: 'ok', name: HOSTILE, setName: HOSTILE, grades: [{ grade: HOSTILE, medianTwd: 100, medianUsd: 3, count: 1, minUsd: 1, maxUsd: 5, lastSaleDate: '2026-10-01' }] }), 'graded table');
  assertSafe(T.gradedMarkup({ status: HOSTILE }) || '<p>none</p>', 'graded status');
  // 價格分頁本體：假 DOM（任何子節點都存在）＋ 帶惡意字串的歷史資料，收集所有被寫入的 innerHTML。
  const writes = [];
  const make = () => new Proxy({ dataset: {}, style: {}, children: [], isConnected: true, classList: { add() {}, remove() {}, toggle() {} }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 300 }) }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'querySelector') return () => (target.__kid ||= make());
      if (key === 'querySelectorAll') return () => [];
      return () => undefined;
    },
    set(target, key, value) { if (key === 'innerHTML') writes.push(String(value)); target[key] = value; return true; }
  });
  const root = { window: null, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, performance: { now: () => 0 }, matchMedia: () => ({ matches: true }), localStorage: { getItem: () => '1' } };
  root.window = root;
  vm.runInNewContext(timeline, root);
  const day = (date, twd) => ({ date, amount: twd / 36, amountTwd: twd, observedAt: `${date}T01:00:00Z` });
  const line = { cardId: 'c', region: 'US', provider: 'cardmarket', variant: HOSTILE, currency: 'EUR', points: [day('2026-10-16', 3000), day('2026-10-19', 3100), day('2026-10-20', 2900), day('2026-10-24', 3500)] };
  const history = { series: [line, { ...line, variant: HOSTILE + '2', points: line.points.map(p => ({ ...p, amountTwd: p.amountTwd + 100 })) }], meta: { events: [{ date: '2026-10-19', title: HOSTILE, source: HOSTILE, url: HOSTILE_URL }, { date: '2026-10-20', title: HOSTILE, source: HOSTILE, url: 'javascript:alert(1)' }] } };
  const market = { records: [{ priceType: 'listing', market: 'Cardmarket', provider: 'cardmarket', variant: HOSTILE, cardId: 'c', amount: 20, priceTwd: 700, cardName: HOSTILE, currency: 'EUR', observedAt: '2026-10-24T01:00:00Z', sourceUrl: HOSTILE_URL }] };
  const slot = make();
  slot.dataset.priceTrend = 'c';
  await root.PriceTimeline.load(slot, { market, image: HOSTILE_URL, cardNumber: HOSTILE, details: null, variantLabel: variant => variant, regionLabel: region => region || '', fetchFn: async () => ({ ok: true, json: async () => history }) });
  assert.ok(writes.length > 3, 'the timeline drew its panels');
  assertSafe(writes.join('\n'), 'price timeline');
  assert.ok(!writes.join('\n').includes('javascript:alert'), 'only https event links are listed');
});

test('look showcase builds its cards with textContent, never innerHTML', () => {
  const showcase = readFileSyncOnce('look-showcase.js');
  assert.ok(showcase.length > 0);
  const sinks = [...showcase.matchAll(/(\w+(?:\.\w+)*)\.innerHTML\s*=\s*(`[^`]*`|'[^']*')/g)];
  assert.ok(sinks.every(([, , value]) => !value.includes('${') || /ZONE\.[wh]|\$\{[a-z]\}/.test(value)), 'look-showcase.js only writes fixed SVG markup through innerHTML');
  assert.ok(/const el=\(tag,cls,text\)=>\{[^}]*textContent=text/.test(showcase), 'text goes through textContent');
});
import { readFileSync } from 'node:fs';
function readFileSyncOnce(name) { return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'); }

// B1：請求還在跑時卡牆只能是骨架；「兔子還在尋找卡片」只在收到 0 張的回應之後才出現（晚到的 cards(currentCardRows,true) 不能蓋掉骨架）。
test('card wall keeps the loading skeleton while a request is in flight and shows the empty state only after an empty response', () => {
  const h = harness();
  h.run(`C={games:[],series:[],cards:[]};game='pokemon'`);
  const host = h.byId.get('cards');
  host.innerHTML = '<div class="skeleton">loading</div>';
  h.run("cardDisplayState='loading';currentCardRows=[]");
  h.run('cards([])');
  h.run('cards(currentCardRows,true)');
  assert.equal(host.innerHTML, '<div class="skeleton">loading</div>', 'an empty list during loading paints nothing');
  assert.equal(h.run('cardDisplayState'), 'loading');
  h.run("cardDisplayState='ready'");
  h.run('cards([])');
  assert.ok(host.innerHTML.includes('兔子還在尋找卡片'), 'an empty response shows the empty state');
  // 有卡片的回應：直接畫卡並離開 loading
  host.innerHTML = '<div class="skeleton">loading</div>';
  h.run("cardDisplayState='loading'");
  h.run(`cards([${JSON.stringify(hostileCard())}])`);
  assert.ok(host.innerHTML.includes('card-tile') || host.innerHTML.includes('data-card-open'), 'real rows replace the skeleton');
  assert.equal(h.run('cardDisplayState'), 'ready');
});
