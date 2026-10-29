import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import vm from 'node:vm';

// 卡牆參考價（寶可夢）、價格排序、價格分頁的跨版本對照表（migration 20261024090000）。
// The imported server module listens at once: give it a free port, and shut it down at the end.
const freePortProbe = createServer();
await new Promise(resolve => freePortProbe.listen(0, '127.0.0.1', resolve));
process.env.PORT = String(freePortProbe.address().port);
await new Promise(resolve => freePortProbe.close(resolve));
process.env.CATALOG_WARM_ON_START = 'false';
process.env.CATALOG_SYNC_ON_START = 'false';
const { buildBrowsePage, buildPrintingIndex, buildVersionPrices, normalizeBrowseSort, referencePriceFromRow, server: importedServer } = await import('../server.mjs');
after(() => new Promise(resolve => importedServer.listening ? importedServer.close(resolve) : resolve()));

const [migration, html, ui, server] = await Promise.all(['../supabase/migrations/20261024090000_price_reference_browse.sql', '../index.html', '../ui-enhancements.js', '../server.mjs'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const slice = (source, from, to) => { const start = source.indexOf(from), end = source.indexOf(to, start + from.length); assert.ok(start >= 0 && end > start, `${from} … ${to}`); return source.slice(start, end); };

test('migration: only new functions, Cardmarket EUR within 7 days, service role only, nothing existing is touched', () => {
  const created = [...migration.matchAll(/create or replace function public\.(\w+)/g)].map(match => match[1]);
  assert.deepEqual(created, ['price_reference_best', 'browse_cards_json', 'browse_cards_priced']);
  assert.doesNotMatch(migration, /create (unique )?index|create table|alter table|drop |insert |update |delete /i, '不新增資料表或索引，也不改資料');
  assert.match(migration, /s\.provider = 'cardmarket'/);
  assert.match(migration, /s\.snapshot_date >= current_date - 7/);
  assert.match(migration, /order by s\.card_id, s\.variant, s\.snapshot_date desc/, '每個 variant 取最新一列');
  for (const name of created) assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;\\s*grant execute on function public\\.${name}\\([^)]*\\) to service_role;`), name);
  assert.match(migration, /browse_keys_fresh\(p_game\)/, '世代鍵新鮮才走 mat，否則退回即時版本（與 browse_cards_filtered 相同的護欄）');
  assert.match(migration, /'unmapped'/, '稀有度對照表缺值時回報，伺服器重建後重試');
});

test('migration 20261030150000: reference window widened to 14 days, still latest-per-variant, same signature and grants, nothing else touched', async () => {
  const windowMigration = await readFile(new URL('../supabase/migrations/20261030150000_price_reference_window.sql', import.meta.url), 'utf8');
  assert.deepEqual([...windowMigration.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/g)].map(match => [match[1], match[2]]), [['price_reference_best', 'p_ids text[] default null']]);
  assert.doesNotMatch(windowMigration, /create (unique )?index|create table|alter table|drop |insert |update |delete /i);
  assert.equal([...windowMigration.matchAll(/snapshot_date >= current_date - 14/g)].length, 2, '兩個分支（指定 id、整張表）都用 14 天');
  assert.doesNotMatch(windowMigration, /current_date - 7/);
  assert.equal([...windowMigration.matchAll(/m\.provider = 'cardmarket'/g)].length, 2);
  assert.match(windowMigration, /max\(m\.snapshot_date\)/, '每個 variant 取最新一列（先找最新日期再用主鍵回表）');
  assert.match(windowMigration, /case l\.variant when 'normal' then 0 when '' then 1 when 'holo' then 2 when 'reverse' then 3 else 4 end/, 'variant 優先序不變');
  assert.match(windowMigration, /revoke all on function public\.price_reference_best\(text\[\]\) from public, anon, authenticated;\s*grant execute on function public\.price_reference_best\(text\[\]\) to service_role;/);
});

test('only Pokemon may sort by price; every other game keeps number order', () => {
  assert.equal(normalizeBrowseSort('price-desc', 'pokemon'), 'price-desc');
  assert.equal(normalizeBrowseSort('PRICE-ASC', 'pokemon'), 'price-asc');
  for (const game of ['onepiece', 'yugioh', 'haikyuu', 'dragonball-fw', null]) assert.equal(normalizeBrowseSort('price-desc', game), 'number-asc', String(game));
  assert.equal(normalizeBrowseSort('name-asc', 'onepiece'), 'name-asc');
  assert.equal(normalizeBrowseSort('bogus', 'pokemon'), 'number-asc');
});

test('price order inside a series: priced cards first in either direction, no price last, ties by number', () => {
  const cards = [['c3', '003', 5], ['c1', '001', null], ['c2', '002', 20], ['c4', '004', 5], ['c5', '005', undefined], ['c6', '006', 0.5]].map(([id, number, price]) => ({ id, game: 'pokemon', officialCardNumber: number, rarity: 'C', price }));
  const rows = cards.map(({ price, ...card }) => card), priceByCard = new Map(cards.filter(card => card.price != null).map(card => [card.id, card.price]));
  const order = sort => buildBrowsePage(rows, { sort, priceByCard, printingByCard: buildPrintingIndex([]) }).data.map(card => card.id);
  assert.deepEqual(order('price-desc'), ['c2', 'c3', 'c4', 'c6', 'c1', 'c5']);
  assert.deepEqual(order('price-asc'), ['c6', 'c3', 'c4', 'c2', 'c1', 'c5']);
  assert.deepEqual(buildBrowsePage(rows, { sort: 'price-desc' }).data.map(card => card.id), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], '沒有任何價格資料時就是編號順序');
});

test('referencePrice rows: Cardmarket EUR, positive amounts only, never a zero or a guess', () => {
  const row = { card_id: 'c1', variant: 'holo', currency: 'EUR', amount: '12.30', snapshot_date: '2026-10-22', observed_at: '2026-10-22T22:54:32.744+00:00' };
  assert.deepEqual(referencePriceFromRow(row), { amount: 12.3, currency: 'EUR', source: 'cardmarket', variant: 'holo', observedAt: '2026-10-22T22:54:32.744+00:00', snapshotDate: '2026-10-22' });
  assert.equal(referencePriceFromRow({ ...row, observed_at: null }).observedAt, '2026-10-22T00:00:00.000Z', '沒有來源時間就用快照日期');
  for (const bad of [{ amount: 0 }, { amount: null }, { amount: 'x' }, { amount: -1 }, { currency: 'USD' }, { snapshot_date: null }, { card_id: '' }]) assert.equal(referencePriceFromRow({ ...row, ...bad }), null, JSON.stringify(bad));
});

const printing = (cardId, region, extra = {}) => ({ cardId, region, language: { JP: 'ja-JP', TW: 'zh-TW', US: 'en-US' }[region], localSetCode: 'S1', localCardNumber: '001', ...extra });
const live = (region, extra = {}) => ({ provider: 'tcgdex', market: 'Cardmarket', priceType: 'market', variant: 'holo', currency: 'EUR', amount: 10, priceTwd: 360, observedAt: '2026-10-22T00:00:00.000Z', region, ...extra });
const snapshotCard = (cardId, prices) => ({ cardId, prices });
const snap = (provider, variant, amount, extra = {}) => ({ provider, variant, currency: provider === 'cardmarket' ? 'EUR' : 'USD', amount, amountTwd: Math.round(amount * 36), snapshotDate: '2026-10-21', ...extra });

test('version price table: every row belongs to its own printing, nothing is ranked or added up', () => {
  const card = { id: 'k-jp', printings: [printing('k-us', 'US'), printing('k-tw', 'TW'), printing('k-jp', 'JP')] };
  const versions = buildVersionPrices(card, [live('JP', { amount: 99 }), live('US', { amount: 5 }), { ...live('JP'), provider: 'yuyutei', market: 'JP', priceType: 'buyback', currency: 'JPY', amount: 800, variant: undefined }], [], { fx: null });
  assert.deepEqual(versions.map(version => version.region), ['JP', 'TW', 'US'], '版本固定依 日、台、美 排序，不依價格');
  assert.deepEqual(versions.map(version => version.prices.length), [2, 0, 1], '台版沒有價格就是空陣列，介面寫「目前沒有可靠價格」');
  assert.deepEqual(versions[0].prices.map(price => price.source), ['Cardmarket', '遊々亭'], '同一版本的不同來源各佔一列，不合併');
  assert.deepEqual(versions[0].prices.map(price => price.priceType), ['market', 'buyback']);
  assert.equal(versions[2].prices[0].amount, 5);
  assert.ok(!('cheapest' in versions[0]) && !JSON.stringify(versions).includes('total'), '沒有最便宜或加總欄位');
});

test('version price table: two printings in one region never share live prices; snapshots stay with their own printing', () => {
  const card = { id: 'k1', printings: [printing('k1', 'JP', { localCardNumber: '001' }), printing('k2', 'JP', { localCardNumber: '002', metadata: { variantName: '版本 2' } }), printing('k3', 'US')] };
  const versions = buildVersionPrices(card, [live('JP', { amount: 77 }), live('US', { amount: 5 })], [snapshotCard('k1', [snap('cardmarket', 'holo', 11)]), snapshotCard('k2', [snap('cardmarket', 'normal', 3)]), snapshotCard('k3', [])], { fx: null });
  const byId = Object.fromEntries(versions.map(version => [version.cardId, version]));
  assert.deepEqual(byId.k1.prices.map(price => [price.amount, price.origin]), [[11, 'snapshot']], '同地區兩個 printing：即時行情不掛，只用各自的快照');
  assert.deepEqual(byId.k2.prices.map(price => [price.amount, price.variant]), [[3, 'normal']]);
  assert.equal(byId.k2.variantName, '版本 2');
  assert.deepEqual(byId.k3.prices.map(price => [price.amount, price.origin]), [[5, 'market']], '美版只有一個 printing，即時行情屬於它');
});

test('version price table: a snapshot only fills what the live record does not cover, and a stale one is dropped', () => {
  const card = { id: 'k1', printings: [printing('k1', 'JP'), printing('k2', 'US')] };
  const versions = buildVersionPrices(card, [live('JP', { amount: 10, variant: 'holo' })], [
    snapshotCard('k1', [snap('cardmarket', 'holo', 9.5), snap('cardmarket', 'reverse', 4), snap('tcgplayer', 'holofoil', 8, { stale: true })]),
    snapshotCard('k2', [snap('cardmarket', '', 2, { stale: true })])
  ], { fx: null });
  assert.deepEqual(versions[0].prices.map(price => [price.source, price.variant, price.amount, price.origin]), [['Cardmarket', 'holo', 10, 'market'], ['Cardmarket', 'reverse', 4, 'snapshot']], '同平台同 variant 只留即時的一筆；過期的 TCGplayer 不顯示');
  assert.deepEqual(versions[1].prices, [], '過期快照等於沒有價格');
});

test('version price table: a card with no printing list still gets one row from the card itself', () => {
  const versions = buildVersionPrices({ id: 'solo', region: 'JP', language: 'ja-JP', officialCardNumber: '007' }, [live('JP')], [], { fx: null });
  assert.equal(versions.length, 1);
  assert.equal(versions[0].localCardNumber, '007');
  assert.equal(versions[0].prices.length, 1);
});

// ---------------------------------------------------------------- the server, with a mock database

const BAD_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);
const close = httpServer => new Promise(resolve => httpServer.close(resolve));
async function listenEphemeral(httpServer) {
  for (;;) {
    await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(0, '127.0.0.1', resolve); });
    const { port } = httpServer.address();
    if (!BAD_PORTS.has(port)) return port;
    await close(httpServer);
  }
}
const cardRow = (id, number, game = 'pokemon') => ({ id, canonicalId: id, game, seriesId: `${game}-s1`, officialCardNumber: number, rarity: 'C', nameZh: `卡${number}`, nameJa: null, nameEn: `Card ${number}`, nameKo: null, aliases: [], metadata: {}, printings: [{ id: `p-${id}`, cardId: id, seriesId: `${game}-s1`, region: 'JP', language: 'ja-JP', localSetCode: 'S1', localCardNumber: number, rarity: 'C', imageUrl: null, imageRehostRequired: false }], images: [] });

async function withServer(handlers, run) {
  const calls = [];
  const mock = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://mock'), name = url.pathname.replace('/rest/v1/rpc/', ''), args = body ? JSON.parse(body) : {};
      calls.push({ name, args });
      const handler = handlers[name];
      const answer = handler ? handler(args) : { status: 404, body: { message: 'PGRST202 no such function' } };
      res.writeHead(answer.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer.body ?? answer));
    });
  });
  const mockPort = await listenEphemeral(mock), probe = createServer(), appPort = await listenEphemeral(probe);
  await close(probe);
  const app = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(appPort), SUPABASE_URL: `http://127.0.0.1:${mockPort}`, SUPABASE_SERVICE_KEY: 'fixture-key', CATALOG_WARM_ON_START: 'false', CATALOG_SYNC_ON_START: 'false', CARD_IMAGE_CACHE_ON_START: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`server start timeout: ${output}`)), 8000);
      app.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited (${code}): ${output}`)); });
      app.stdout.on('data', chunk => { output += chunk; if (output.includes('CardScope is running')) { clearTimeout(timer); resolve(); } });
      app.stderr.on('data', chunk => { output += chunk; });
    });
    return await run({ get: async path => { const response = await fetch(`http://127.0.0.1:${appPort}${path}`); return { status: response.status, json: await response.json() }; }, calls });
  } finally {
    app.kill();
    await close(mock);
  }
}

const pageRpc = cards => () => ({ cards, total: cards.length });
const priceRow = (id, amount, extra = {}) => ({ card_id: id, variant: '', currency: 'EUR', amount, snapshot_date: '2026-10-22', observed_at: '2026-10-22T22:00:00+00:00', ...extra });

test('browse: Pokemon cards carry referencePrice from one price lookup per page; cards without a snapshot carry none', async () => {
  const cards = [cardRow('p1', '001'), cardRow('p2', '002'), cardRow('p3', '003')];
  await withServer({ browse_cards_page: pageRpc(cards), price_reference_best: () => [priceRow('p1', 12.3, { variant: 'holo' }), priceRow('p3', 0)] }, async ({ get, calls }) => {
    const { status, json } = await get('/api/cards?game=pokemon&limit=60');
    assert.equal(status, 200);
    const byId = Object.fromEntries(json.data.map(card => [card.id, card]));
    assert.deepEqual(byId.p1.referencePrice, { amount: 12.3, currency: 'EUR', source: 'cardmarket', variant: 'holo', observedAt: '2026-10-22T22:00:00+00:00', snapshotDate: '2026-10-22' });
    assert.ok(!('referencePrice' in byId.p2), '沒有快照就沒有欄位');
    assert.ok(!('referencePrice' in byId.p3), '金額 0 不顯示');
    const lookups = calls.filter(call => call.name === 'price_reference_best');
    assert.equal(lookups.length, 1, '一頁只查一次');
    assert.deepEqual(lookups[0].args.p_ids, ['p1', 'p2', 'p3']);
    await get('/api/cards?game=pokemon&limit=60');
    assert.equal(calls.filter(call => call.name === 'price_reference_best').length, 1, '同一頁再要一次走快取');
  });
});

test('browse: a failing price lookup never fails the page', async () => {
  await withServer({ browse_cards_page: pageRpc([cardRow('p1', '001')]), price_reference_best: () => ({ status: 500, body: { message: 'boom' } }) }, async ({ get }) => {
    const { status, json } = await get('/api/cards?game=pokemon');
    assert.equal(status, 200);
    assert.equal(json.data.length, 1);
    assert.ok(!('referencePrice' in json.data[0]));
  });
});

test('browse: other games never ask for a price and a price sort falls back to number order', async () => {
  await withServer({ browse_cards_page: pageRpc([cardRow('o1', 'OP01-001', 'onepiece')]), price_reference_best: () => [priceRow('o1', 5)] }, async ({ get, calls }) => {
    const { json } = await get('/api/cards?game=onepiece&sort=price-desc');
    assert.equal(json.meta.sort, 'number-asc');
    assert.ok(!('referencePrice' in json.data[0]));
    assert.equal(calls.filter(call => call.name === 'price_reference_best' || call.name === 'browse_cards_priced').length, 0);
  });
});

test('browse: Pokemon price sort runs in the database, keeps the region and rarity filters, and falls back to number order when it fails', async () => {
  const sorted = [cardRow('p9', '009'), cardRow('p2', '002')], numbered = [cardRow('p1', '001'), cardRow('p2', '002')];
  let failPriced = false;
  const handlers = {
    browse_rarity_values: () => ['SAR', 'C'],
    browse_cards_priced: () => failPriced ? { status: 500, body: { message: 'timeout' } } : { cards: sorted, total: 56273, priced: 14917, unmapped: false },
    browse_cards_filtered: () => ({ cards: numbered, total: 2, unmapped: false }),
    browse_cards_facets: () => ({ rarity: { C: 2 }, region: { JP: 2 }, language: { 'ja-JP': 2 }, unmapped: false }),
    price_reference_best: () => [priceRow('p9', 5550), priceRow('p2', 3)]
  };
  await withServer(handlers, async ({ get, calls }) => {
    const desc = await get('/api/cards?game=pokemon&sort=price-desc&region=JP&limit=2&offset=0');
    assert.equal(desc.status, 200);
    assert.deepEqual(desc.json.data.map(card => card.id), ['p9', 'p2'], '資料庫給的順序原樣送出');
    assert.equal(desc.json.meta.sort, 'price-desc');
    assert.equal(desc.json.meta.total, 56273);
    assert.deepEqual(desc.json.data.map(card => card.referencePrice?.amount), [5550, 3]);
    const priced = calls.find(call => call.name === 'browse_cards_priced').args;
    assert.deepEqual([priced.p_game, priced.p_region, priced.p_token, priced.p_desc, priced.p_limit, priced.p_offset], ['pokemon', 'JP', null, true, 2, 0]);
    assert.ok(Array.isArray(priced.p_rmap), '稀有度對照表照 browse_cards_filtered 的方式傳入');
    await get('/api/cards?game=pokemon&sort=price-asc&rarity=SAR&limit=2');
    const asc = calls.filter(call => call.name === 'browse_cards_priced').at(-1).args;
    assert.equal(asc.p_desc, false);
    assert.equal(asc.p_token, 'SAR');
    failPriced = true;
    const fallback = await get('/api/cards?game=pokemon&sort=price-desc&region=JP&limit=2&offset=60');
    assert.equal(fallback.status, 200, '價格排序失敗時退回編號順序，不是 502');
    assert.deepEqual(fallback.json.data.map(card => card.id), ['p1', 'p2']);
    assert.equal(calls.filter(call => call.name === 'browse_cards_filtered').at(-1).args.p_sort, 'number-asc');
  });
});

test('browse: a price sort inside a series sorts the series here, from one price lookup', async () => {
  const cards = [cardRow('a', '001'), cardRow('b', '002'), cardRow('c', '003')];
  const rpc = { printings: cards.flatMap(card => card.printings), cards: cards.map(({ printings, images, ...card }) => card), images: [] };
  await withServer({ browse_series_cards: () => rpc, price_reference_best: () => [priceRow('a', 1), priceRow('c', 40)] }, async ({ get, calls }) => {
    const desc = await get('/api/cards?game=pokemon&series=pokemon-s1&sort=price-desc');
    assert.deepEqual(desc.json.data.map(card => card.id), ['c', 'a', 'b'], '有價格的在前，沒有價格的在最後');
    const asc = await get('/api/cards?game=pokemon&series=pokemon-s1&sort=price-asc');
    assert.deepEqual(asc.json.data.map(card => card.id), ['a', 'c', 'b']);
    assert.equal(calls.filter(call => call.name === 'price_reference_best').length, 1, '整個系列只查一次價格（之後走快取）');
  });
});

// ---------------------------------------------------------------- the pages

const harness = () => {
  const context = vm.createContext({ e: esc, rn: region => ({ JP: '日版', TW: '台版', US: '美版' }[region] || region), ln: language => ({ 'ja-JP': '日文', 'zh-TW': '繁中', 'en-US': '英文' }[language] || language), cardGameId: card => typeof card?.game === 'object' ? card.game.id : card?.game, MARKET_VARIANTS: { holo: '閃卡 Holo', reverse: '逆閃 Reverse' }, marketDate: value => value ? String(value).slice(0, 10).replaceAll('-', '/') : '' });
  vm.runInContext(`${slice(ui, 'const REFERENCE_SOURCE_NAMES=', 'function cardGameLabel')}\nconst setCodeText=value=>String(value||'');const printingLanguage=(p)=>ln(p?.language);\n${slice(ui, 'function versionPriceTable', '// 收錄版本列')}`, context);
  return context;
};

test('card wall badge: source and price kind are spelled out, the observation date is in the tooltip, and no price shows nothing', () => {
  const context = harness();
  const card = { id: 'p1', game: 'pokemon', referencePrice: { amount: 12.3, currency: 'EUR', source: 'cardmarket', variant: 'holo', observedAt: '2026-10-22T22:00:00Z' } };
  const out = vm.runInContext(`cardReferenceMarkup(${JSON.stringify(card)},'p1')`, context);
  assert.match(out, /Cardmarket 參考<\/span> <span class="cr-amount">€12\.30<\/span>/);
  assert.match(out, /aria-label="Cardmarket 參考 €12\.30，/);
  assert.match(out, /class="card-reference-tip" aria-hidden="true">Cardmarket 平台參考價（閃卡 Holo），觀測 2026\/10\/22；不是成交價或台灣行情<\/small>/, '滑過、聚焦或按住時顯示的提示');
  assert.match(out, /data-card-open="p1"/, '點價格也開啟詳細頁');
  for (const bad of [{ ...card, referencePrice: undefined }, { ...card, game: 'onepiece' }, { ...card, referencePrice: { ...card.referencePrice, amount: 0 } }, { ...card, referencePrice: { ...card.referencePrice, currency: 'USD' } }])
    assert.equal(vm.runInContext(`cardReferenceMarkup(${JSON.stringify(bad)},'p1')`, context), '', JSON.stringify(bad.referencePrice));
  assert.match(ui, /referenceMarkup/, 'cardMarkup 的格狀與清單兩種版面都用它');
  assert.equal([...ui.matchAll(/\$\{referenceMarkup/g)].length, 2);
});

test('sort menu: Pokemon gets a reference-price sort, other games keep the buyback wording and need the buyback list', () => {
  const run = (game, hasPrices) => {
    const options = ['number-asc', 'price-asc', 'price-desc'].map(value => ({ value, hidden: true, disabled: true, textContent: '' })), sort = { options, value: 'price-desc' };
    const filter = { closest: () => ({ hidden: true }) }, note = { hidden: false }, cardFilters = { price: 'all', sort: 'price-desc' };
    const context = vm.createContext({ game, verifiedPrices: { size: hasPrices ? 3 : 0 }, cardFilters, $: id => ({ priceFilter: filter, cardSort: sort, priceNote: note })[id] });
    vm.runInContext(slice(html, 'function syncPriceControls()', 'function clearProduct'), context);
    vm.runInContext('syncPriceControls()', context);
    return { options, cardFilters, note };
  };
  const pokemon = run('pokemon', false);
  assert.deepEqual(pokemon.options.slice(1).map(option => [option.hidden, option.disabled]), [[false, false], [false, false]]);
  assert.equal(pokemon.options[2].textContent, '參考價從高到低');
  assert.equal(pokemon.cardFilters.sort, 'price-desc', '寶可夢沒有買取價清單也不重設排序');
  assert.equal(pokemon.note.hidden, true);
  const onepiece = run('onepiece', false);
  assert.deepEqual(onepiece.options.slice(1).map(option => option.disabled), [true, true]);
  assert.equal(onepiece.cardFilters.sort, 'number-asc');
  const yugioh = run('yugioh', true);
  assert.equal(yugioh.options[1].disabled, false);
  assert.match(yugioh.options[1].textContent, /^買取價從低到高$/);
});

test('client sort: Pokemon cards sort by the server reference price, unpriced last, other games by the buyback list', () => {
  const context = vm.createContext({ game: 'pokemon', priceFor: c => c.buyback ? { price: c.buyback } : null });
  vm.runInContext(slice(html, 'const sortPrice=', 'function filteredCards'), context);
  const cards = [{ game: 'pokemon', id: 'a', referencePrice: { amount: 5 } }, { game: 'pokemon', id: 'b' }, { game: 'pokemon', id: 'c', referencePrice: { amount: 50 } }];
  const price = card => vm.runInContext(`sortPrice(${JSON.stringify(card)})`, context), sorted = direction => [...cards].sort((a, b) => direction === 'asc' ? (price(a) ?? Infinity) - (price(b) ?? Infinity) : (price(b) ?? -Infinity) - (price(a) ?? -Infinity)).map(card => card.id);
  assert.deepEqual(sorted('desc'), ['c', 'a', 'b']);
  assert.deepEqual(sorted('asc'), ['a', 'c', 'b']);
  assert.equal(price({ game: 'onepiece', buyback: 700 }), 700);
  assert.ok(html.includes("sort==='price-asc'?(sortPrice(a)??Infinity)-(sortPrice(b)??Infinity):sort==='price-desc'?(sortPrice(b)??-Infinity)-(sortPrice(a)??-Infinity)"), 'filteredCards uses sortPrice');
});

test('version table markup: columns, a plain "no reliable price" row, scrolls inside its own box', () => {
  const context = harness();
  const market = { meta: { priceTypes: { market: '平台參考價', buyback: '店家買取／回收' } }, versions: [
    { cardId: 'k-jp', region: 'JP', language: 'ja-JP', localSetCode: 'S1', localCardNumber: '001', prices: [{ source: 'Cardmarket', priceType: 'market', variant: 'holo', currency: 'EUR', amount: 10, amountTwd: 360, observedAt: '2026-10-22T00:00:00.000Z', origin: 'snapshot' }, { source: '遊々亭', priceType: 'buyback', variant: '', currency: 'JPY', amount: 800, amountTwd: null, observedAt: '2026-10-21T00:00:00.000Z', origin: 'market' }] },
    { cardId: 'k-tw', region: 'TW', language: 'zh-TW', localSetCode: 'S1', localCardNumber: '001', prices: [] }
  ] };
  context.market = market;
  const out = vm.runInContext(`versionPriceTable(market,'pokemon','k-jp')`, context);
  for (const heading of ['版本', '來源', '價格種類', '原幣', '新台幣', '觀測日期']) assert.match(out, new RegExp(`<th scope="col">${heading}</th>`));
  assert.match(out, /EUR 10\.00/);
  assert.match(out, /NT\$ 360/);
  assert.match(out, /JPY 800<\/td><td>—<\/td>/, '沒有台幣換算就寫破折號，不補數字');
  assert.match(out, /<small>閃卡 Holo<\/small>/);
  assert.match(out, /每日快照/);
  assert.match(out, /目前顯示/);
  assert.match(out, /<td colspan="5" class="vp-none">目前沒有可靠價格<\/td>/);
  assert.match(out, /class="version-prices" role="region"[^>]*tabindex="0"/);
  assert.doesNotMatch(out, /最便宜|最低|合計|總計/, '只並列，不比較也不加總');
  assert.equal(vm.runInContext(`versionPriceTable({versions:[${JSON.stringify(market.versions[0])}]},'pokemon','k-jp')`, context), '', '只有一個版本不畫表');
  assert.equal(vm.runInContext(`versionPriceTable({},'pokemon','x')`, context), '');
  assert.match(ui, /\.version-prices\{max-width:100%;overflow-x:auto/);
  assert.match(ui, /\$\{versionPriceTable\(m,/);
  assert.match(server, /versions:buildVersionPrices\(card,records,await snapshotsPending,\{fx\}\)/);
});
