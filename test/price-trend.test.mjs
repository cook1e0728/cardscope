import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { encodeShard, shardOf, shortDigest } from '../providers/price-archive.mjs';

// ADR 0042: reference-price trend. Front-end SVG builder (pure functions) and GET /api/cards/:id/price-history over HTTP with a fake Supabase.

const chartSource = await readFile(new URL('../price-history-chart.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(chartSource, sandbox);
const { PriceTrend } = sandbox.window;
const pt = (date, amountTwd, amount = amountTwd / 35) => ({ date, amount, amountTwd });
const line = (over = {}) => ({ cardId: 'card-jp', region: 'JP', provider: 'cardmarket', variant: 'holo', currency: 'EUR', points: [pt('2026-09-01', 100), pt('2026-09-20', 140), pt('2026-10-10', 120)], ...over });
const options = { regionLabel: region => ({ JP: '日版', US: '美版' }[region] || region), variantLabel: variant => ({ holo: '閃卡 Holo' }[variant] || variant), width: 600, id: 'pt-test' };

test('chart section: no records, one point and unavailable each get their own text', () => {
  const none = PriceTrend.sectionHtml({ series: [], meta: {} }, options);
  assert.match(none, /參考價走勢（Cardmarket／TCGplayer，換算新台幣）/);
  assert.match(none, /尚未有參考價紀錄/);
  assert.doesNotMatch(none, /<svg/);
  const one = PriceTrend.sectionHtml({ series: [line({ points: [pt('2026-10-01', 100)] })], meta: {} }, options);
  assert.match(one, /已開始記錄（自 2026-10-01），累積兩筆以上才畫走勢/);
  assert.doesNotMatch(one, /<svg/);
  const down = PriceTrend.sectionHtml({ series: [], meta: { unavailable: 'x' } }, options);
  assert.match(down, /暫時無法讀取/);
  assert.match(PriceTrend.sectionHtml(null, options), /暫時無法讀取/);
  assert.match(none, /不是成交價或台灣行情/);
});

test('chart section: two or more points draw a step line with title, description, legend and a text table', () => {
  const html = PriceTrend.sectionHtml({ series: [line()], meta: {} }, options);
  assert.match(html, /<svg class="pt-chart" role="img"/);
  assert.match(html, /<title id="pt-test-t">參考價走勢圖/);
  assert.match(html, /aria-label="參考價走勢圖/);
  assert.match(html, /<desc id="pt-test-d">新台幣，2026-09-01 至 2026-10-10。日版 · Cardmarket · 閃卡 Holo：2026-09-01 NT\$ 100，2026-10-10 NT\$ 120/);
  const path = html.match(/<path class="pt-line pt-d0" d="([^"]+)"/)[1];
  assert.match(path, /^M[\d.]+ [\d.]+H[\d.]+V[\d.]+H[\d.]+V[\d.]+$/, 'horizontal then vertical: the previous value carries to the next point');
  assert.equal((html.match(/<svg class="pt-chart"[^]*?<\/svg>/)[0].match(/<circle class="pt-mark"/g) || []).length, 3, 'one marker per record, with a hover title');
  assert.match(html, /<title>日版 · Cardmarket · 閃卡 Holo｜2026-09-20｜NT\$ 140<\/title>/);
  assert.match(html, /<ul class="pt-legend"[^]*日版 · Cardmarket · 閃卡 Holo/);
  assert.match(html, /<table class="pt-table"[^]*<th scope="row">日版 · Cardmarket · 閃卡 Holo<\/th><td>2026-09-01<br><b>NT\$ 100<\/b><\/td><td>2026-10-10<br><b>NT\$ 120<\/b><\/td><td>EUR 3\.43<\/td>/);
  assert.doesNotMatch(html, /animate|transition/);
});

test('chart: up to three lines, told apart by dash and marker shape rather than colour alone; the rest are counted', () => {
  const four = ['a', 'b', 'c', 'd'].map(id => line({ cardId: `card-${id}`, variant: id }));
  const plan = PriceTrend.plan({ series: four }, options);
  assert.equal(plan.lines.length, 3);
  assert.equal(plan.omitted, 1);
  const html = PriceTrend.sectionHtml({ series: four }, options);
  assert.match(html, /另有 1 條線未畫出/);
  assert.match(html, /class="pt-line pt-d0"/);
  assert.match(html, /class="pt-line pt-d1"[^>]*stroke-dasharray="7 4"/);
  assert.match(html, /class="pt-line pt-d2"[^>]*stroke-dasharray="2 4"/);
  assert.match(html, /<rect class="pt-mark"/);
  assert.match(html, /<polygon class="pt-mark"/);
  assert.equal((html.match(/<li><svg class="pt-key/g) || []).length, 3, 'legend has one key per drawn line');
  assert.doesNotMatch(html, /pt-d3/);
});

test('chart: lines of different cards or versions never merge; identical labels get the card id', () => {
  const same = [line({ cardId: 'card-jp' }), line({ cardId: 'card-jp-2' }), line({ cardId: 'card-us', region: 'US', provider: 'tcgplayer', variant: 'holofoil' })];
  const plan = PriceTrend.plan({ series: same }, options);
  assert.deepEqual(Array.from(plan.lines, l => l.label), ['日版 · Cardmarket · 閃卡 Holo（card-jp）', '日版 · Cardmarket · 閃卡 Holo（card-jp-2）', '美版 · TCGplayer · holofoil']);
});

test('chart: points without an NT$ value are dropped, one-point lines are noted, and a single usable point does not draw', () => {
  const noRate = line({ points: [{ date: '2026-09-01', amount: 5, amountTwd: null }, pt('2026-10-01', 100)] });
  const html = PriceTrend.sectionHtml({ series: [noRate, line({ cardId: 'card-x' })], meta: {} }, options);
  assert.equal((html.match(/<path class="pt-line/g) || []).length, 1);
  assert.match(html, /另有 1 條線只有一筆紀錄/);
});

test('chart: same-value and narrow charts still produce valid geometry', () => {
  const flat = line({ points: [pt('2026-09-01', 100), pt('2026-09-08', 100)] });
  const svg = PriceTrend.chartSvg(PriceTrend.plan({ series: [flat] }, options).lines, { width: 320, id: 'n' });
  assert.match(svg, /viewBox="0 0 320 250"/, 'the viewBox equals the container width, so 12px text stays 12px on a phone');
  assert.doesNotMatch(svg, /NaN|Infinity/);
  assert.equal((svg.match(/text-anchor="middle"/g) || []).length, 0, 'narrow charts keep only the two end dates');
  assert.equal(PriceTrend.chartSvg([], {}), '');
});

test('chart: labels, ids and dates from the API are escaped', () => {
  const evil = line({ cardId: '"><img src=x onerror=alert(1)>', region: '<b>JP</b>', provider: '<script>', variant: '"x"' });
  const html = PriceTrend.sectionHtml({ series: [evil, { ...evil }] , meta: {} }, { width: 500, id: '"><x' });
  assert.doesNotMatch(html, /<img|<script|<b>JP|onerror=alert\(1\)>/);
  assert.match(html, /&lt;script&gt;/);
});

// --- GET /api/cards/:id/price-history over HTTP, with a fake Supabase and a stubbed exchange-rate host ---

async function listenOnFreePort(httpServer) {
  await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(0, '127.0.0.1', resolve); });
  return httpServer.address().port;
}
const close = httpServer => new Promise(resolve => httpServer.close(resolve));
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = n => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

test('price-history endpoint: groups per card, source and variant, keeps 180 days, converts at today\'s rate, caches an hour and degrades to unavailable', async () => {
  const printing = (cardId, region, over = {}) => ({ id: cardId, cardId, seriesId: 's', region, language: region === 'US' ? 'en-US' : 'ja-JP', localSetCode: 'SV6a', localCardNumber: '039', rarity: 'RR', imageUrl: null, imageRehostRequired: false, source: 'tcgdex-ja', providerId: 'SV6a-039', metadata: {}, ...over });
  const base = { canonicalId: null, seriesId: 's', officialCardNumber: '039', rarity: 'RR', nameEn: null, nameKo: null, aliases: [], metadata: {}, game: 'pokemon', nameZh: '桃歹郎ex', nameJa: 'モモワロウex' };
  const cards = {
    'card-jp': { ...base, id: 'card-jp', printings: [printing('card-jp', 'JP'), printing('card-us', 'US', { source: 'pokemontcg' })] },
    'card-empty': { ...base, id: 'card-empty', printings: [printing('card-empty', 'JP')] },
    'card-down': { ...base, id: 'card-down', printings: [printing('card-down', 'JP')] },
    'card-recent': { ...base, id: 'card-recent', printings: [printing('card-recent', 'JP')] }
  };
  const snapshotRows = [
    { card_id: 'card-jp', provider: 'cardmarket', variant: 'holo', currency: 'EUR', snapshot_date: daysAgo(10), amount: 5.5 },
    { card_id: 'card-jp', provider: 'cardmarket', variant: 'reverse', currency: 'EUR', snapshot_date: daysAgo(10), amount: 2 },
    { card_id: 'card-us', provider: 'tcgplayer', variant: 'holofoil', currency: 'USD', snapshot_date: daysAgo(30), amount: 10 },
    { card_id: 'card-us', provider: 'tcgplayer', variant: 'holofoil', currency: 'USD', snapshot_date: daysAgo(3), amount: 12 },
    { card_id: 'card-us', provider: 'tcgplayer', variant: 'holofoil', currency: 'USD', snapshot_date: daysAgo(2), amount: 13 },
    { card_id: 'card-recent', provider: 'cardmarket', variant: 'holo', currency: 'EUR', snapshot_date: daysAgo(3), amount: 7 }
  ];
  const snapshotQueries = [];
  // ADR 0046: the 100-day-old row lives in the (mock) private Storage bucket, not in the table; the response must be the same as before the archive existed.
  const archivedRow = { card_id: 'card-jp', provider: 'cardmarket', variant: 'holo', currency: 'EUR', snapshot_date: daysAgo(100), amount: 4 };
  const archiveMonth = archivedRow.snapshot_date.slice(0, 7), archiveShard = shardOf('card-jp');
  const archiveShardFile = await encodeShard(archiveMonth, archiveShard, [archivedRow]);
  const archiveFiles = new Map([
    ['v1/manifest.json', Buffer.from(JSON.stringify({ v: 1, months: { [archiveMonth]: { [String(archiveShard).padStart(2, '0')]: { n: 1, d: shortDigest(archiveShardFile.digest) } } } }))],
    [`v1/${archiveMonth}/${String(archiveShard).padStart(2, '0')}.json.gz`, archiveShardFile.gz]
  ]);
  let storageDown = false;
  const storageRequests = [];
  const mockSupabase = createServer((req, res) => {
    const url = new URL(req.url, 'http://mock-supabase'), table = url.pathname.split('/').at(-1);
    if (url.pathname.startsWith('/storage/v1/object/authenticated/price-archive/')) {
      storageRequests.push(url.pathname);
      const file = archiveFiles.get(url.pathname.slice('/storage/v1/object/authenticated/price-archive/'.length));
      if (storageDown) { res.writeHead(500); return res.end('storage down'); }
      if (!file) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"statusCode":"404","error":"not_found"}'); }
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(file);
    }
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      let status = 200, body = [];
      if (table === 'get_card_detail') {
        const card = cards[JSON.parse(raw || '{}').p_id];
        body = { cards: card ? [card] : [], series: [], games: [{ id: 'pokemon', nameZh: '寶可夢' }] };
      } else if (table === 'price_snapshots') {
        snapshotQueries.push(url.searchParams);
        const ids = (url.searchParams.get('card_id') || '').replace(/^in\.\(|\)$/g, '').split(',').map(x => x.replaceAll('"', '')), from = url.searchParams.get('snapshot_date').slice(4);
        if (ids.includes('card-down')) { status = 500; body = { message: 'boom' }; }
        else if (Number(url.searchParams.get('offset') || 0) === 0) body = snapshotRows.filter(r => ids.includes(r.card_id) && r.snapshot_date >= from);
      }
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  const supabasePort = await listenOnFreePort(mockSupabase), probe = createServer(), appPort = await listenOnFreePort(probe);
  await close(probe);
  const dir = await mkdtemp(join(tmpdir(), 'cardscope-price-trend-')), preload = join(dir, 'stub-fetch.mjs');
  const fixtures = [['open.er-api.com', 200, { result: 'success', time_last_update_utc: 'Fri, 09 Oct 2026 00:02:31 +0000', rates: { TWD: 1, JPY: 4.8, USD: 0.03125, EUR: 0.025 } }]];
  await writeFile(preload, `const real=globalThis.fetch,fixtures=${JSON.stringify(fixtures)};globalThis.fetch=async(input,options)=>{const url=String(input?.url||input);for(const [key,status,body] of fixtures)if(url.includes(key))return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});if(/^https?:\\/\\/(?!127\\.0\\.0\\.1)/.test(url))return new Response('{}',{status:599});return real(input,options)};`);
  let app;
  try {
    app = spawn(process.execPath, ['--import', pathToFileURL(preload).href, 'server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(appPort), SUPABASE_URL: `http://127.0.0.1:${supabasePort}`, SUPABASE_SERVICE_KEY: 'local-fixture-key', CATALOG_SYNC_ON_START: 'false', CARD_IMAGE_CACHE_ON_START: 'false', PRICE_SNAPSHOT_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`price-history fixture start timeout: ${output}`)), 8000);
      app.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`price-history fixture exited (${code ?? signal}): ${output}`)); });
      const onData = chunk => { output += String(chunk); if (output.includes('CardScope is running')) { clearTimeout(timer); resolve(); } };
      app.stdout.on('data', onData); app.stderr.on('data', onData);
    });
    const get = async id => { const response = await fetch(`http://127.0.0.1:${appPort}/api/cards/${id}/price-history`); return { status: response.status, body: await response.json() }; };

    // The archive being unreachable degrades to the database rows (the last 30 days), says so, and is not cached for the full hour.
    storageDown = true;
    const recent = await get('card-recent');
    assert.equal(recent.status, 200);
    assert.deepEqual(recent.body.series.map(s => s.points.length), [1]);
    assert.equal(recent.body.meta.archiveUnavailable, true);
    assert.equal(recent.body.meta.unavailable, undefined);

    storageDown = false;
    storageRequests.length = 0;
    snapshotQueries.length = 0;

    const first = await get('card-jp');
    assert.equal(first.status, 200);
    const { series, meta } = first.body;
    assert.deepEqual(series.map(s => [s.cardId, s.region, s.provider, s.variant, s.currency, s.points.length]), [['card-jp', 'JP', 'cardmarket', 'holo', 'EUR', 2], ['card-jp', 'JP', 'cardmarket', 'reverse', 'EUR', 1], ['card-us', 'US', 'tcgplayer', 'holofoil', 'USD', 3]], 'the requested card first, then more points first; versions and cards stay separate lines');
    assert.deepEqual(series[0].points.map(p => [p.date, p.amount, p.amountTwd]), [[daysAgo(100), 4, 160], [daysAgo(10), 5.5, 220]], 'EUR at 1/0.025 = 40 NT$ per EUR (today\'s rate)');
    assert.deepEqual(series[2].points.map(p => p.amountTwd), [320, 384, 416], 'USD at 32 NT$');
    assert.equal(meta.exchangeRates.source, 'ExchangeRate-API');
    assert.match(meta.note, /今日匯率/);
    assert.match(meta.note, /不是成交價或台灣行情/);
    assert.equal(meta.windowDays, 180);
    assert.equal(meta.from, daysAgo(180));
    assert.ok(Date.parse(meta.generatedAt) > Date.now() - 60000);
    assert.equal(snapshotQueries.length, 1);
    assert.equal(snapshotQueries[0].get('card_id'), 'in.("card-jp","card-us")', 'the requested card and the printings of the same work layer');
    assert.equal(snapshotQueries[0].get('snapshot_date'), `gte.${daysAgo(180)}`);
    assert.equal(series.some(s => s.points.some(p => p.date < daysAgo(180))), false);

    const again = await get('card-jp');
    assert.deepEqual(again.body, first.body);
    assert.equal(snapshotQueries.length, 1, 'cached for an hour');
    assert.equal(meta.archiveUnavailable, undefined);
    assert.ok(storageRequests.some(p => p.endsWith('/v1/manifest.json')) && storageRequests.some(p => p.endsWith(`/${archiveMonth}/${String(archiveShard).padStart(2, '0')}.json.gz`)), 'the archived month was read');
    assert.equal(storageRequests.length, 2, 'one manifest and one shard file for this request, nothing else');

    const empty = await get('card-empty');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.series, []);
    assert.equal(empty.body.meta.unavailable, undefined);

    const down = await get('card-down');
    assert.equal(down.status, 200, 'a failing database never breaks the detail page');
    assert.deepEqual(down.body.series, []);
    assert.ok(down.body.meta.unavailable);
    const before = snapshotQueries.length;
    await get('card-down');
    assert.equal(snapshotQueries.length, before + 1, 'failures are not cached');

    assert.equal((await get('card-missing')).status, 404);
  } finally {
    if (app && app.exitCode === null && app.signalCode === null) await new Promise(resolve => { app.once('exit', resolve); app.kill(); });
    await close(mockSupabase);
    await rm(dir, { recursive: true, force: true });
  }
});

test('detail page wiring: the trend panel holds the slot that loads only when the 走勢 tab is opened', async () => {
  const [ui, html] = await Promise.all(['../ui-enhancements.js', '../index.html'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  assert.match(ui, /detailPanel\('trend',true,`<div class="price-trend" data-price-trend="\$\{e\(id\)\}"><\/div>`\)/);
  assert.match(ui, /\[data-detail-tab="trend"\]/);
  assert.doesNotMatch(ui.match(/detailPanel\('market',true,[^]*?\$\{detailPanel\('trend'/)[0], /data-price-trend/, 'the price panel no longer carries the trend');
  assert.match(ui, /tab\.addEventListener\('click',\(\)=>window\.PriceTrend\.load\(slot/);
  assert.ok(html.indexOf('/price-history-chart.js') > 0 && html.indexOf('/price-history-chart.js') < html.indexOf('/ui-enhancements.js'));
  assert.doesNotMatch(ui.match(/openCard=async function[^]*?window\.openCard=openCard/)[0], /price-history'/, 'the detail request itself never asks for the trend');
});
