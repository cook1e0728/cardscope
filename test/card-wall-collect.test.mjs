import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// 重新設計 v2 階段 3：卡牆的卡片三行、收藏一個動作、只重畫那一張卡、收藏狀態沿用舊的 localStorage 鍵。
// index.html 主程式＋ui-enhancements.js 放進最小假 DOM 執行，再呼叫其中的函式。
const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const [html, ui] = await Promise.all(['index.html', 'ui-enhancements.js'].map(read));
const appSource = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n').split('async function init()')[0];
const HOSTILE = '<img src=x onerror=1>"\'&';
const ESCAPED = '&lt;img src=x onerror=1&gt;&quot;&#39;&amp;';

function harness(initialStore = {}) {
  const nodes = new Map(), created = [];
  const classList = { toggle() {}, add() {}, remove() {}, contains() { return false } };
  const node = (id = '') => {
    const value = { id, value: 'all', innerHTML: '', textContent: '', style: {}, classList, children: [], dataset: {}, disabled: false, hidden: false,
      append(...items) { this.children.push(...items) }, prepend() {}, before() {}, after() {}, insertAdjacentElement() {}, setAttribute() {}, querySelectorAll() { return [] }, querySelector() { return null }, scrollIntoView() {}, closest() { return null }, click() {}, remove() {} };
    created.push(value); if (id) nodes.set(id, value); return value;
  };
  for (const id of ['browseRegion', 'channels', 'productCategories', 'series', 'selectedProduct', 'cardsTitle', 'cardsMeta', 'cardTools', 'cards', 'loadMore', 'filterSummary', 'rarityFilter', 'priceFilter', 'cardSort', 'notice', 'modal', 'detail', 'status']) node(id);
  const body = node('body'), head = node('head'), store = new Map(Object.entries(initialStore));
  const document = { body, head, getElementById: id => nodes.get(id) || created.find(item => item.id === id) || null, createElement: () => node(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, activeElement: null };
  const context = vm.createContext({ document, window: {}, console, fetch: async () => ({ ok: true, json: async () => ({ data: [], meta: { hasMore: false } }) }), localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) }, matchMedia: () => ({ matches: false }), setTimeout: () => 0, clearTimeout() {}, confirm: () => true, Blob, URL, URLSearchParams });
  context.window = context;
  vm.runInContext(appSource, context);
  vm.runInContext(ui, context);
  return { run: code => vm.runInContext(code, context), context, document, store };
}

const pikachu = { id: 'c1', game: 'pokemon', nameZh: '皮卡丘', officialCardNumber: 'SV-001/190', rarity: 'SAR', region: 'JP', seriesId: 's1', printings: [{ id: 'p1', region: 'JP', seriesId: 's1', localCardNumber: 'SV-001/190', rarity: 'SAR' }] };
const setup = h => h.run(`C={games:[{id:'pokemon',nameZh:'寶可夢'},{id:'onepiece',nameZh:'航海王'}],series:[{id:'s1',game:'pokemon',nameZh:'朱／紫系列',officialCode:'SV',region:'JP'}],cards:[]};activeSearch=null;browse={rows:[],offset:0,seriesId:'s1',product:null,hasMore:false,loading:false,total:0};`);

test('a card is three lines: name, number plus rarity, price; game, series and version labels only appear on a mixed wall', () => {
  const h = harness(); setup(h);
  h.run("wallMixed=false;browse.seriesId=''");
  const single = h.run(`cardMarkup(${JSON.stringify({ ...pikachu, referencePrice: { amount: 12, amountTwd: 400, currency: 'EUR', source: 'cardmarket', variant: '', observedAt: '2026-11-12T00:00:00Z', snapshotDate: '2026-11-12', changePct: 2.5, changeFrom: '2026-11-05', changeBase: 11.7 } })})`);
  assert.doesNotMatch(single, /card-ctx|ip-badge|card-series|card-versions|class="badge"/, 'one series page repeats nothing the page already says');
  assert.match(single, /<h3>皮卡丘<\/h3><div class="meta"><span class="card-no">SV-001\/190<\/span>.*<span class="card-rarity"[^>]*>.*SAR.*<\/div><div class="card-pricing">/, 'name, then number plus rarity, then the price block');
  assert.doesNotMatch(single, /class="art"[^>]*>.*data-favorite-id.*<\/div><h3>/, 'the collect control is not on the art');
  const bare = h.run(`cardMarkup(${JSON.stringify(pikachu)})`);
  assert.doesNotMatch(bare, /card-pricing/, 'no price block when there is no price');
  h.run('wallMixed=true');
  const mixed = h.run(`cardMarkup(${JSON.stringify(pikachu)})`);
  assert.match(mixed, /class="card card-mixed"/);
  assert.match(mixed, /<div class="card-ctx"><span class="badge ip-badge">寶可夢<\/span>.*朱／紫系列.*日版/s, 'game, series and version on a mixed wall');
  h.run("cardViewMode='list'");
  assert.doesNotMatch(h.run(`(wallMixed=false,cardMarkup(${JSON.stringify(pikachu)}))`), /ip-badge|card-series/, 'list mode follows the same rule');
  assert.match(h.run(`(wallMixed=true,cardMarkup(${JSON.stringify(pikachu)}))`), /ip-badge/);
});

test('mixed wall: search results, or loaded cards from different games, series or versions; one series page is never mixed', () => {
  const h = harness(); setup(h);
  h.run("browse.seriesId=''");
  const rows = list => JSON.stringify(list);
  const same = [pikachu, { ...pikachu, id: 'c2' }];
  assert.equal(h.run(`wallIsMixed(${rows(same)})`), false, 'same game, series and version');
  assert.equal(h.run(`wallIsMixed(${rows([pikachu, { ...pikachu, id: 'c3', seriesId: 's2', printings: [{ region: 'JP', seriesId: 's2' }] }])})`), true, 'two series');
  assert.equal(h.run(`wallIsMixed(${rows([pikachu, { ...pikachu, id: 'c4', game: 'onepiece' }])})`), true, 'two games');
  assert.equal(h.run(`wallIsMixed(${rows([pikachu, { ...pikachu, id: 'c5', region: 'TW', printings: [{ region: 'TW', seriesId: 's1' }] }])})`), true, 'Japanese and Taiwanese versions');
  assert.equal(h.run(`wallIsMixed(${rows([])})`), false);
  h.run("activeSearch={q:'皮卡丘'}");
  assert.equal(h.run(`wallIsMixed(${rows(same)})`), true, 'every search result wall is mixed, even when the hits share a series');
  h.run("activeSearch=null;browse.seriesId='s1'");
  assert.equal(h.run(`wallIsMixed(${rows([pikachu, { ...pikachu, id: 'c4', game: 'onepiece' }])})`), false, 'inside a series the page already names it');
});

test('collect is one action: ☆ adds one, "− N ＋" steps, the last − cancels, the label names the card and the count', () => {
  const h = harness(); setup(h);
  const bare = h.run(`cardActionsMarkup(${JSON.stringify(pikachu)})`);
  assert.match(bare, /^<div class="card-actions" data-action="card-actions" data-card-key="c1"><button type="button" class="favorite-toggle" data-action="favorite" data-favorite-id="c1" aria-pressed="false" aria-label="加入我的收藏：皮卡丘（目前 0 張）"/);
  assert.doesNotMatch(bare, /data-watch-/, 'not collected: only the star');
  h.run("setWatchQuantity('c1',2)");
  const owned = h.run(`cardActionsMarkup(${JSON.stringify(pikachu)})`);
  assert.match(owned, /<div class="watchlist-inline" data-action="watchlist" role="group" aria-label="皮卡丘，已收藏 2 張">/);
  assert.match(owned, /data-watch-decrement="c1" aria-label="減少一張：皮卡丘（目前 2 張）">−<\/button><span class="watch-quantity" data-watch-quantity="c1">2<\/span><button type="button" data-watch-increment="c1" aria-label="增加一張：皮卡丘（目前 2 張）">＋<\/button>/);
  assert.doesNotMatch(owned, /favorite-toggle/, 'collected: the star is replaced by the stepper');
  h.run("setWatchQuantity('c1',1)");
  assert.match(h.run(`cardActionsMarkup(${JSON.stringify(pikachu)})`), /aria-label="取消收藏：皮卡丘（目前 1 張）">−</, 'at 1 the − says it cancels');
  // behaviour through the real handlers
  h.run("setWatchQuantity('c1',0)");
  h.run("toggleFavorite('c1')"); assert.equal(h.run("watchQuantity('c1')"), 1, 'one press adds one copy');
  h.run("stepWatchQuantity('c1',1)"); h.run("stepWatchQuantity('c1',1)"); assert.equal(h.run("watchQuantity('c1')"), 3);
  h.run("stepWatchQuantity('c1',-1)"); assert.equal(h.run("watchQuantity('c1')"), 2);
  h.run("confirm=()=>true;stepWatchQuantity('c1',-1);stepWatchQuantity('c1',-1)");
  assert.equal(h.run("watchQuantity('c1')"), 0, 'going to 0 cancels');
  assert.equal(h.run("'c1' in watchlist"), false);
});

test('cancelling asks only when something would be lost: a condition, version or note, or more than one copy', () => {
  const h = harness(); setup(h);
  h.run("asked=[];confirm=message=>{asked.push(message);return false}");
  h.run("setWatchQuantity('plain',1);toggleFavorite('plain')");
  assert.equal(h.run("watchQuantity('plain')"), 0, 'a bare single copy is cancelled in one press');
  assert.equal(h.run('asked.length'), 0);
  for (const field of ['condition', 'finish', 'note']) {
    h.run(`setWatchQuantity('k-${field}',1);watchlistMeta['k-${field}']={...watchlistMeta['k-${field}'],${field}:'x'}`);
    h.run(`stepWatchQuantity('k-${field}',-1)`);
    assert.equal(h.run(`watchQuantity('k-${field}')`), 1, `${field}: declined, so the card stays`);
  }
  h.run("setWatchQuantity('multi',2);toggleFavorite('multi')");
  assert.equal(h.run('asked.length'), 4, 'three saved fields and one multi-copy card each asked once');
  assert.equal(h.run("watchQuantity('multi')"), 2);
  h.run("confirm=()=>true;stepWatchQuantity('k-note',-1)");
  assert.equal(h.run("watchQuantity('k-note')"), 0, 'confirmed: cancelled');
  assert.equal(h.run("'k-note' in watchlistMeta"), false, 'and the saved note goes with it');
});

test('a quantity change repaints only that card\'s collect area; the whole wall is rebuilt only when a filter makes the card enter or leave it', () => {
  const h = harness(); setup(h);
  const replaced = [], focus = [];
  const box = key => { const article = { classList: { toggle: (name, on) => replaced.push(`${key}:${name}:${on}`) }, querySelectorAll: () => [] }, fresh = { querySelector: selector => ({ focus: () => focus.push(selector) }), parentElement: article };
    const el = { dataset: { cardKey: key }, contains: () => false, closest: () => article, remove: () => replaced.push(`${key}:removed`), insertAdjacentHTML: (where, markup) => replaced.push(`${key}:${where}:${markup}`), get nextElementSibling() { return fresh } };
    return el; };
  const boxes = [box('c1'), box('c2')];
  h.document.querySelectorAll = selector => selector === '#cards .card-actions' ? boxes : [];
  h.run("wallCalls=0;cards=()=>{wallCalls++};favoritesOnly=false;missingOnly=false;currentCardRows=[]");
  h.run(`renderedCards.set('c1',${JSON.stringify(pikachu)});renderedCards.set('c2',${JSON.stringify({ ...pikachu, id: 'c2' })})`);
  h.run("setWatchQuantity('c1',1)");
  assert.equal(h.run('wallCalls'), 0, 'no full re-render on a plain add');
  assert.ok(replaced.some(line => line.startsWith('c1:afterend:<div class="card-actions"') && line.includes('data-card-key="c1"')), 'that card got its new collect area');
  assert.ok(replaced.includes('c1:removed') && replaced.includes('c1:is-owned:true'), 'the old area is removed and the card is marked owned');
  assert.equal(replaced.some(line => line.startsWith('c2:')), false, 'other cards are not touched');
  h.run("setWatchQuantity('c1',2)");
  assert.equal(h.run('wallCalls'), 0);
  h.run("setWatchQuantity('c1',0)");
  assert.equal(h.run('wallCalls'), 0, 'cancelling on an unfiltered wall also stays local');
  assert.ok(replaced.includes('c1:is-owned:false'));
  // 已收藏 filter: adding or cancelling changes which cards belong on the wall, so it re-renders (once)
  h.run("favoritesOnly=true");
  h.run("setWatchQuantity('c2',1)");
  assert.equal(h.run('wallCalls'), 1, 'with 已收藏 on, a card entering the collection is a wall change');
  h.run("setWatchQuantity('c2',3)");
  assert.equal(h.run('wallCalls'), 1, 'but a quantity change inside the wall is still local');
  h.run("confirm=()=>true;setWatchQuantity('c2',0)");
  assert.equal(h.run('wallCalls'), 2, 'leaving the filtered wall re-renders');
  assert.match(ui, /function repaintCollected\(key,previous,next\)\{[\s\S]*?\n  if\(\(favoritesOnly\|\|missingOnlyActive\(\)\)&&\(previous===0\|\|next===0\)\)\{cards\(currentCardRows,true\)/);
});

test('the collect area is replaced in place and focus returns to the same kind of button; the change is announced', () => {
  assert.match(ui, /const active=box\.contains\(document\.activeElement\)\?document\.activeElement:null/);
  assert.match(ui, /if\(active\)\(next>0\?fresh\.querySelector\(role\):fresh\.querySelector\('\[data-favorite-id\]'\)\)\?\.focus\(\{preventScroll:true\}\)/, 'after the last − the star takes the focus');
  assert.match(ui, /live\.setAttribute\('role','status'\);live\.setAttribute\('aria-live','polite'\)/);
});

test('collection state keeps using the stored 已收藏 switch: cardscope-favorites-only is read at load and written on change, 還缺 is not remembered', () => {
  assert.equal(harness({ 'cardscope-favorites-only': '1' }).run('favoritesOnly'), true, 'an old stored 1 still opens on 已收藏');
  assert.equal(harness({ 'cardscope-favorites-only': '0' }).run('favoritesOnly'), false);
  assert.equal(harness().run('favoritesOnly'), false);
  const h = harness(); setup(h);
  h.run("cardCalls=0;cards=()=>{cardCalls++};currentCardRows=[];browse.seriesId='s1'");
  h.run("setCollectionState('owned')");
  assert.equal(h.store.get('cardscope-favorites-only'), '1');
  assert.deepEqual(JSON.parse(h.run('JSON.stringify([favoritesOnly,missingOnly])')), [true, false]);
  h.run("setCollectionState('missing')");
  assert.equal(h.store.get('cardscope-favorites-only'), '0', 'the three states are exclusive, and 還缺 reads back as 全部 next visit');
  assert.deepEqual(JSON.parse(h.run('JSON.stringify([favoritesOnly,missingOnly,missingOnlySeries])')), [false, true, 's1']);
  h.run("setCollectionState('all')");
  assert.equal(h.store.get('cardscope-favorites-only'), '0');
  assert.deepEqual(JSON.parse(h.run('JSON.stringify([favoritesOnly,missingOnly])')), [false, false]);
  assert.equal(h.run('cardCalls'), 3);
  assert.doesNotMatch(ui, /cardscope-missing/, 'no new storage key');
});

test('card and collect markup escape the card name, series, version, rarity and game', () => {
  const h = harness();
  h.run(`C={games:[{id:'pokemon',nameZh:${JSON.stringify(HOSTILE)}}],series:[{id:'s1',game:'pokemon',nameZh:${JSON.stringify(HOSTILE)},officialCode:'SV',region:'JP'}],cards:[]};activeSearch={q:'x'};wallMixed=true;`);
  const hostile = { ...pikachu, nameZh: HOSTILE, nameEn: HOSTILE, officialCardNumber: HOSTILE, rarity: HOSTILE, printings: [{ ...pikachu.printings[0], rarity: HOSTILE }] };
  for (const quantity of [0, 3]) {
    h.run(`Object.keys(watchlist).forEach(key=>delete watchlist[key]);${quantity ? `watchlist['c1']=${quantity};` : ''}`);
    for (const mode of ['grid', 'list']) {
      h.run(`cardViewMode='${mode}'`);
      const out = h.run(`cardMarkup(${JSON.stringify(hostile)})`);
      assert.ok(out.includes(ESCAPED), `${mode}/${quantity}: the hostile text is shown escaped`);
      assert.ok(!out.includes('<img src=x') && !out.includes('onerror=1>'), `${mode}/${quantity}: no raw markup`);
      assert.ok(!/=\s*"[^"<>]*"\s*>?<img src=x/.test(out), `${mode}/${quantity}: no attribute breakout`);
    }
  }
});
