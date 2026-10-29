import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 系列集卡進度、收藏匯出／匯入（JSON 與 CSV，先預覽再寫入）、卡圖第一次失敗先重試。純函式在 collection-store.js；畫面函式從 ui-enhancements.js 切出來放進 vm。
const ui = readFileSync(new URL('../ui-enhancements.js', import.meta.url), 'utf8');
const win = {};
new Function('window', readFileSync(new URL('../collection-store.js', import.meta.url), 'utf8'))(win);
const CS = win.CollectionStore;
const between = (from, to) => { const start = ui.indexOf(from), end = ui.indexOf(to, start); assert.ok(start >= 0 && end > start, `${from} … ${to}`); return ui.slice(start, end); };
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const file = (items, version = 2) => JSON.stringify({ app: 'cardscope-collection', version, exportedAt: '2026-10-23T00:00:00.000Z', items });
const own = (id, over = {}) => ({ id, canonicalId: '', favorite: false, quantity: 1, condition: '', finish: '', note: '', ...over });

test('import JSON: quantity 1–999 integers only, every rejected row says why, old star-only rows count as 1, nothing throws', () => {
  const out = CS.parseImport(file([
    { id: 'ok-1', quantity: 2, seriesId: 'pokemon-official-tw-m6', game: 'pokemon', region: 'TW' },
    { id: 'zero', quantity: 0 }, { id: 'big', quantity: 1000 }, { id: 'float', quantity: 1.5 }, { id: 'text', quantity: '3' }, { id: 'neg', quantity: -2 },
    { id: '', quantity: 1 }, { id: 'x'.repeat(129), quantity: 1 }, { id: '__proto__', quantity: 1 }, { id: 'bad-cond', quantity: 1, condition: 'MINT' }, { id: 'bad-note', quantity: 1, note: 'n'.repeat(201) },
    'junk', null, [], { id: 'star-only', favorite: true }
  ]));
  assert.equal(out.format, 'json');
  assert.deepEqual(out.items.map(item => [item.id, item.quantity]), [['ok-1', 2], ['star-only', 1]]);
  assert.deepEqual(out.items[0], { id: 'ok-1', canonicalId: '', favorite: false, quantity: 2, condition: '', finish: '', note: '', seriesId: 'pokemon-official-tw-m6', game: 'pokemon', region: 'TW' });
  assert.equal(out.problems.length, 13);
  assert.deepEqual(out.problems.slice(0, 5).map(p => p.index), [2, 3, 4, 5, 6]);
  assert.match(out.problems[0].reason, /數量必須是 1–999/);
  assert.match(out.problems.find(p => p.index === 9).reason, /不安全/);
  assert.match(out.problems.find(p => p.index === 12).reason, /不是物件/);
  // a malformed hint never costs the card
  assert.deepEqual(CS.parseImport(file([{ id: 'h', quantity: 1, seriesId: 5, game: 'bad game!', region: 'x'.repeat(50) }])).items[0], own('h'));
  // v1 files still import; an unknown version or app is refused as a whole
  assert.equal(CS.parseImport(file([{ id: 'v1', quantity: 1 }], 1)).items.length, 1);
  // a UTF-8 BOM in front (Notepad, Excel) must not break the JSON backup
  assert.equal(CS.parseImport('﻿' + file([{ id: 'bom', quantity: 2 }])).items[0].quantity, 2);
  for (const text of [file([], 3), JSON.stringify({ app: 'other', version: 2, items: [] }), '{ nope', '', '   ', JSON.stringify({ app: 'cardscope-collection', version: 2 })]) assert.ok(CS.parseImport(text).error, text.slice(0, 30));
  assert.equal(CS.parseImport(file([{ id: 'dup', quantity: 1 }, { id: 'dup', quantity: 5, note: 'n' }])).items[0].quantity, 5, 'the same card twice in one file keeps the larger quantity');
});

test('import limits: 2 MB of text, 10,000 rows (JSON and CSV), the merged collection is capped too', () => {
  assert.equal(CS.LIMITS.itemsMax, 10000);
  assert.equal(CS.LIMITS.fileMaxChars, 2 * 1024 * 1024);
  assert.ok(CS.parseImport('x'.repeat(CS.LIMITS.fileMaxChars + 1)).error);
  const many = n => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, quantity: 1 }));
  assert.ok(CS.parseImport(file(many(10001))).error);
  assert.equal(CS.parseImport(file(many(10000))).items.length, 10000);
  const csv = n => ['卡片 ID,數量', ...many(n).map(row => `${row.id},1`)].join('\r\n');
  assert.ok(CS.parseImport(csv(10001)).error);
  assert.equal(CS.parseImport(csv(10000)).items.length, 10000);
  // 10,000 compact export rows still fit under the import size limit
  const exported = JSON.stringify(CS.exportBackup(Array.from({ length: 10000 }, (_, i) => own(`pokemon-official-tw-m6-${String(i).padStart(5, '0')}`, { canonicalId: `pokemon-official-tw-m6-${String(i).padStart(5, '0')}`, seriesId: 'pokemon-official-tw-m6', game: 'pokemon', region: 'TW', quantity: 12, condition: 'NM' }))));
  assert.ok(exported.length < CS.LIMITS.fileMaxChars, `10,000 rows = ${exported.length} chars`);
  assert.equal(CS.parseImport(exported).items.length, 10000);
});

test('import CSV: reads the file the 下載清單 CSV button writes (BOM, quotes, formula guard, condition label), rejects bad rows with a reason', () => {
  const csvCell = new Function(`${between('function csvCell', 'function downloadWatchlistCsv')};return csvCell`)();
  const line = cells => cells.map(csvCell).join(',');
  const header = ['卡片 ID', '名稱', '原名', '官方卡號', '稀有度', '數量', '已驗證價格幣別', '已驗證單價', '已驗證小計', '品況', '版本', '備註', '作品層 ID', '系列 ID', '遊戲', '地區'];
  const text = `﻿${[line(header),
    line(['a-1', '赫拉克羅斯', '', '001', 'C', 4, '', '', '', '近全新 NM', 'holo', '=角落折痕, "ok"\n第二行', 'canon-1', 'pokemon-official-tw-m6', 'pokemon', 'TW']),
    line(['a-2', '名', '', '002', 'C', 1, '', '', '', '未指定', '', '', '', '', '', '']),
    line(['bad-qty', '名', '', '', '', 'abc', '', '', '', '', '', '', '', '', '', '']),
    line(['bad-cond', '名', '', '', '', 1, '', '', '', '傳說品相', '', '', '', '', '', '']),
    line(['zero', '名', '', '', '', 0, '', '', '', '', '', '', '', '', '', ''])].join('\r\n')}`;
  const out = CS.parseImport(text);
  assert.equal(out.format, 'csv');
  assert.equal(out.rows, 5);
  assert.deepEqual(out.items[0], { id: 'a-1', canonicalId: 'canon-1', favorite: false, quantity: 4, condition: 'NM', finish: 'holo', note: '=角落折痕, "ok" 第二行', seriesId: 'pokemon-official-tw-m6', game: 'pokemon', region: 'TW' }, 'the guard apostrophe is removed again, the line break in a note becomes a space');
  assert.deepEqual(out.items[1], own('a-2'));
  assert.deepEqual(out.problems.map(p => p.index), [3, 4, 5]);
  assert.match(out.problems[1].reason, /品況/);
  assert.match(CS.parseImport('a,b\n1,2').error, /不是 CardScope 匯出的 CSV/);
  assert.equal(CS.parseImport('卡片 ID,數量\nx,2\n\n\ny,3\n').items.length, 2, 'blank lines are ignored, LF-only files work');
  assert.deepEqual(CS.parseCsv('a,"b ""q"" c",\r\n"x\r\ny",z'), [['a', 'b "q" c', ''], ['x\r\ny', 'z']]);
});

test('import plan: merge keeps the larger quantity and never adds up, replace says what it removes, a second import changes nothing', () => {
  const mine = [own('a', { quantity: 3 }), own('b', { quantity: 1, note: 'mine' }), own('c')];
  const incoming = CS.parseImport(file([{ id: 'a', quantity: 2 }, { id: 'b', quantity: 5, note: 'theirs' }, { id: 'd', quantity: 7 }])).items;
  const merge = CS.planImport(mine, incoming);
  assert.deepEqual([merge.added, merge.updated, merge.unchanged, merge.removed], [1, 1, 1, 0]);
  const by = Object.fromEntries(merge.items.map(item => [item.id, item]));
  assert.equal(by.a.quantity, 3, 'the smaller imported number never lowers it');
  assert.equal(by.b.quantity, 5);
  assert.equal(by.b.note, 'mine', 'existing text wins');
  assert.equal(by.c.quantity, 1, 'cards missing from the file stay');
  const again = CS.planImport(merge.items, incoming);
  assert.deepEqual([again.added, again.updated, again.unchanged], [0, 0, 3], 'importing the same file twice never doubles anything');
  const replace = CS.planImport(mine, incoming, true);
  assert.deepEqual([replace.added, replace.updated, replace.removed, replace.items.length], [1, 2, 1, 3]);
  assert.deepEqual(replace.items.map(item => item.id), ['a', 'b', 'd']);
  assert.deepEqual(CS.planImport([], []).items, []);
});

test('export v2: version, time, id, quantity, finish, seriesId; empty fields left out; round trips through the importer', () => {
  const items = [own('a', { quantity: 4, condition: 'NM', finish: 'holo', note: '折痕', seriesId: 'pokemon-official-tw-m6', game: 'pokemon', region: 'TW', canonicalId: 'c-a' }), own('b')];
  const backup = CS.exportBackup(items, new Date('2026-10-23T01:02:03Z'));
  assert.equal(backup.version, 2);
  assert.equal(backup.exportedAt, '2026-10-23T01:02:03.000Z');
  assert.deepEqual(Object.keys(backup.items[1]), ['id', 'quantity'], 'a bare card has no empty strings or false flags');
  assert.deepEqual(backup.items[0], { id: 'a', canonicalId: 'c-a', quantity: 4, condition: 'NM', finish: 'holo', note: '折痕', seriesId: 'pokemon-official-tw-m6', game: 'pokemon', region: 'TW' });
  assert.deepEqual(CS.parseImport(JSON.stringify(backup)).items, items);
  // hints survive a merge and a legacy-storage round trip
  assert.equal(CS.mergeItems([own('a')], [items[0]]).items[0].seriesId, 'pokemon-official-tw-m6');
  assert.equal(CS.itemsFromLegacy([], { a: 2 }, { a: { seriesId: 's1', game: 'pokemon', region: 'JP' } })[0].seriesId, 's1');
  assert.equal('seriesId' in CS.itemsFromLegacy([], { a: 2 }, {})[0], false, 'old entries stay exactly as before');
});

test('series progress: owned counts cards (not copies) by stored seriesId or by the cards on the wall; percent never shows 100 before the end', () => {
  const items = [own('a', { seriesId: 's1', quantity: 4 }), own('b', { seriesId: 's1' }), own('legacy-1'), own('other', { seriesId: 's2' }), own('star', { favorite: true, quantity: 0, seriesId: 's1' })];
  assert.equal(CS.ownedInSeries(items, 's1'), 3, 'copies do not add up; an old star counts as owned');
  assert.equal(CS.ownedInSeries(items, 's1', ['legacy-1', 'nobody']), 4, 'an old entry without seriesId is matched through the cards on the wall');
  assert.equal(CS.ownedInSeries(items, 's1', ['a', 'a']), 3, 'never counted twice');
  assert.equal(CS.ownedInSeries(items, ''), 0);
  assert.deepEqual(CS.seriesProgress(3, 107), { owned: 3, total: 107, missing: 104, percent: 2 });
  assert.equal(CS.seriesProgress(106, 107).percent, 99);
  assert.equal(CS.seriesProgress(107, 107).percent, 100);
  assert.deepEqual(CS.seriesProgress(150, 107), { owned: 107, total: 107, missing: 0, percent: 100 }, 'more than the total (a filtered total) is capped');
  const many = Array.from({ length: 13 }, (_, i) => own(`k${i}`, { seriesId: `s${String(i).padStart(2, '0')}` })).concat([own('k-extra', { seriesId: 's00' })], [own('no-series')]);
  const top = CS.seriesBreakdown(many, 10);
  assert.equal(top.rows.length, 10);
  assert.equal(top.seriesCount, 13);
  assert.deepEqual([top.rows[0].seriesId, top.rows[0].owned], ['s00', 2], 'most cards first');
  assert.equal(top.unknown, 1);
});

function wall({ items = [], rows = [], total = 10, rarity = 'all', sid = 's1', hasMore = false, activeSearch = null } = {}) {
  const persisted = [], meta = {}, watch = {};
  items.forEach(item => { watch[item.id] = item.quantity; if (item.seriesId !== undefined || item.meta) meta[item.id] = { id: item.id, ...(item.seriesId ? { seriesId: item.seriesId } : {}) }; });
  const sandbox = vm.createContext({ CS, e: esc, $: id => sandbox.nodes[id] || null, nodes: {}, browse: { seriesId: sid, rows, total, hasMore }, game: 'pokemon', activeSearch, cardFilters: { rarity }, watchlistMeta: meta, persisted,
    watchQuantity: id => Number(watch[id]) > 0 ? Number(watch[id]) : 0, entryKey: card => String(card.id), persistCollection: () => { persisted.push(JSON.stringify(meta)); return true; },
    collectionItems: () => CS.itemsFromLegacy([], watch, meta).filter(item => item.quantity > 0) });
  vm.runInContext(between('// 系列集卡進度（圖鑑系列頁）', 'function renderWatchlistSummary'), sandbox);
  return { sandbox, meta, persisted, run: code => vm.runInContext(code, sandbox) };
}

test('series wall: progress needs the server total, only an unfiltered total is remembered, old entries are matched by the wall and get their seriesId saved', () => {
  const rows = ['a', 'b', 'c', 'legacy-1'].map(id => ({ id }));
  const w = wall({ items: [{ id: 'a', quantity: 2, seriesId: 's1' }, { id: 'legacy-1', quantity: 1, meta: true }, { id: 'elsewhere', quantity: 1, seriesId: 's2' }], rows });
  const p = JSON.parse(w.run('JSON.stringify(seriesProgressState())'));
  assert.deepEqual([p.owned, p.total, p.missing, p.percent], [2, 10, 8, 20]);
  assert.equal(w.meta['legacy-1'].seriesId, 's1', 'the series is saved on the old entry once it is seen on its wall');
  assert.equal(w.persisted.length, 1);
  w.run('seriesProgressState()');
  assert.equal(w.persisted.length, 1, 'saved once, not on every redraw');
  w.sandbox.nodes.seriesProgress = { hidden: true, innerHTML: '' };
  w.run('renderSeriesProgress()');
  const html = w.sandbox.nodes.seriesProgress.innerHTML;
  assert.equal(w.sandbox.nodes.seriesProgress.hidden, false);
  assert.match(html, /已收藏 2 \/ 共 10 張（20%）/);
  assert.match(html, /role="progressbar"[^>]*aria-valuemax="10"[^>]*aria-valuenow="2"/);
  assert.match(html, /id="missingOnly" class="favorites-filter" aria-pressed="false">只看缺的卡（8）/);

  // a rarity-filtered total is not the series total: nothing is remembered and nothing is shown until an unfiltered one is seen
  const filtered = wall({ rows, rarity: 'SR', total: 3 });
  assert.equal(filtered.run('seriesProgressState()'), null);
  filtered.sandbox.cardFilters.rarity = 'all';
  filtered.sandbox.browse.total = 10;
  assert.equal(filtered.run('seriesProgressState().total'), 10);
  filtered.sandbox.cardFilters.rarity = 'SR';
  filtered.sandbox.browse.total = 3;
  assert.equal(filtered.run('seriesProgressState().total'), 10, 'the remembered series total is used while filtering');
  // not a series wall: all-cards view, search results, nothing loaded yet
  assert.equal(wall({ sid: '', rows }).run('seriesProgressState()'), null);
  assert.equal(wall({ rows, activeSearch: { q: 'x' } }).run('seriesProgressState()'), null);
  assert.equal(wall({ rows: [], total: 0 }).run('seriesProgressState()'), null);
});

test('只看缺的卡: applies only to the series it was switched on in, hides collected cards, says rows that are not loaded yet are not covered', () => {
  const rows = ['a', 'b', 'c'].map(id => ({ id }));
  const w = wall({ items: [{ id: 'a', quantity: 1, seriesId: 's1' }], rows, hasMore: true });
  assert.equal(w.run('missingOnlyActive()'), false);
  w.run("missingOnly=true;missingOnlySeries='s1'");
  assert.equal(w.run('missingOnlyActive()'), true);
  w.sandbox.browse.seriesId = 's2';
  assert.equal(w.run('missingOnlyActive()'), false, 'another series starts with the switch off');
  w.sandbox.browse.seriesId = 's1';
  w.sandbox.nodes.seriesProgress = { hidden: true, innerHTML: '' };
  w.run('renderSeriesProgress()');
  assert.match(w.sandbox.nodes.seriesProgress.innerHTML, /aria-pressed="true"/);
  assert.match(w.sandbox.nodes.seriesProgress.innerHTML, /只篩選已載入的卡；還有卡沒載入/);
  // the card filter used by the wall
  assert.match(ui, /return missingOnlyActive\(\)\?owned\.filter\(card=>!isFavorite\(entryKey\(card\)\)\):owned/);
  assert.match(ui, /activateCardActions\(host\);renderFavoritesControl\(\);renderWatchlistSummary\(\);renderSeriesProgress\(\);/);
  assert.match(ui, /progress\.onclick=event=>\{if\(!event\.target\.closest\('#missingOnly'\)\)return;missingOnly=!missingOnlyActive\(\);missingOnlySeries=browse\.seriesId/);
  assert.match(ui, /seriesId:printing\?\.seriesId\|\|card\.seriesId\}/, 'a new collection entry stores its series when it is added');
});

function writer({ failWrites = false, watchlist = { a: 2 }, watchlistMeta = { a: { id: 'a', v: 1, seriesId: 's1', game: 'pokemon' } } } = {}) {
  const store = new Map(), status = [];
  const sandbox = vm.createContext({ CS, watchlist, watchlistMeta, status, collectionStatus: text => status.push(text),
    persistCollection: () => { if (failWrites) return false; store.set('w', JSON.stringify(watchlist)); store.set('m', JSON.stringify(watchlistMeta)); return true; } });
  vm.runInContext(between('function applyItems', '// 舊資料搬移'), sandbox);
  return { sandbox, store, run: code => vm.runInContext(code, sandbox) };
}

test('import writes in one go: a failed storage write puts the old collection back, a good one keeps the hints', () => {
  const failing = writer({ failWrites: true });
  assert.equal(failing.run("commitItems([{id:'x',quantity:5,condition:'',finish:'',note:'',canonicalId:''}])"), false);
  assert.deepEqual(JSON.parse(failing.run('JSON.stringify(watchlist)')), { a: 2 }, 'the old quantities are back in memory');
  assert.equal(JSON.parse(failing.run('JSON.stringify(watchlistMeta)')).a.seriesId, 's1', 'and the old snapshot too');
  assert.equal(failing.run("'x' in watchlist"), false);

  const good = writer();
  assert.equal(good.run("commitItems([{id:'a',quantity:2,condition:'NM',finish:'',note:'',canonicalId:'',seriesId:'s1',game:'pokemon',region:'TW'},{id:'n',quantity:1,condition:'',finish:'',note:'',canonicalId:'',seriesId:'s2'}])"), true);
  assert.deepEqual(JSON.parse(good.store.get('w')), { a: 2, n: 1 });
  const meta = JSON.parse(good.store.get('m'));
  assert.deepEqual([meta.a.v, meta.a.condition, meta.a.region, meta.n.seriesId, 'game' in meta.n], [1, 'NM', 'TW', 's2', false], 'the known snapshot stays; imported hints are added; no empty hint is written');
});

test('import dialog wiring: preview before writing, replace needs the checkbox and a second confirm, the old collection is never touched on a refused file', () => {
  assert.match(ui, /<p class="coll-import-counts" role="status"><b>將新增 \$\{plan\.added\} 筆、更新 \$\{plan\.updated\} 筆、略過 \$\{bad\.length\} 筆格式錯誤<\/b>/);
  assert.match(ui, /accept="application\/json,\.json,text\/csv,\.csv"/);
  assert.match(ui, /data-coll-replace/);
  assert.match(ui, /if\(pending\.replace&&!confirm\(`這會刪除目前的/);
  assert.match(ui, /if\(file\.size>CS\.LIMITS\.fileMaxChars\)\{collectionStatus\('沒有匯入：檔案過大（上限 2 MB）/);
  assert.match(ui, /const parsed=CS\.parseImport\(text\);\s*if\(parsed\.error\)\{collectionUi\.pending=null;renderCollection\(\);collectionStatus/);
  const importFlow = between('async function importCollectionFile', 'function onCollectionField');
  assert.doesNotMatch(importFlow.slice(0, importFlow.indexOf('async function confirmCollectionImport')), /applyItems|commitItems|persistCollection/, 'choosing a file only previews');
  assert.match(importFlow, /if\(!commitItems\(plan\.items\)\)return collectionStatus\('無法寫入瀏覽器儲存空間/);
  assert.match(ui, /系列 ID','遊戲','地區'/, 'CSV keeps its columns and adds the series ones at the end');
  assert.match(ui, /<h3>各系列進度/);
  assert.match(ui, /CS\.seriesBreakdown\(collectionItems\(\),10\)/);
});

test('card image: the first failure waits 1.5 s and retries the same URL with retry=1, only then the fallbacks, then 圖片待補', () => {
  const sandbox = vm.createContext({ e: esc, displayImageUrl: url => url, missingImageMarkup: () => '<span>none</span>' });
  vm.runInContext(between('function resilientImage', 'function installViewToggle'), sandbox);
  const markup = vm.runInContext("resilientImage('https://asia.pokemon-card.com/tw/card-img/a.png','測試卡','待補',{fallbacks:['/jp.png','/jp2.png']})", sandbox);
  const handler = markup.match(/onerror="([^"]*)"/)[1];
  assert.match(markup, /onload="this\.style\.visibility=''"/);
  const timers = [];
  const run = img => new Function('setTimeout', handler).call(img, (fn, ms) => timers.push([fn, ms]));
  const img = { src: 'https://asia.pokemon-card.com/tw/card-img/a.png', dataset: { fallbacks: JSON.stringify(['/jp.png', '/jp2.png']) }, style: {}, hidden: false, nextElementSibling: { hidden: true }, parentElement: { querySelector: () => null } };
  run(img);
  assert.equal(img.dataset.retried, '1');
  assert.equal(img.src, 'https://asia.pokemon-card.com/tw/card-img/a.png', 'not swapped yet: it waits first');
  assert.deepEqual([timers.length, timers[0][1]], [1, 1500]);
  assert.equal(img.style.visibility, 'hidden', 'no broken-image icon while waiting');
  timers[0][0]();
  assert.equal(img.src, 'https://asia.pokemon-card.com/tw/card-img/a.png?retry=1');
  run(img);
  assert.equal(img.src, '/jp.png', 'the retry failed too: the existing fallback list takes over');
  assert.equal(timers.length, 1, 'no second retry');
  run(img); run(img);
  assert.equal(img.src, '/jp2.png');
  assert.deepEqual([img.hidden, img.nextElementSibling.hidden], [true, false], 'everything failed: 圖片待補 is shown');
  // a URL that already has a query string gets &retry=1
  const withQuery = { ...img, src: 'https://x/api/images/onepiece?url=a', dataset: {}, hidden: false, style: {}, nextElementSibling: { hidden: true } };
  run(withQuery); timers.at(-1)[0]();
  assert.equal(withQuery.src, 'https://x/api/images/onepiece?url=a&retry=1');
});
