import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodeShard, shardOf, shortDigest } from '../providers/price-archive.mjs';

// ADR 0042: reference-price trend. GET /api/cards/:id/price-history over HTTP with a fake Supabase.

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
    assert.match(meta.note, /Cardmarket／TCGplayer 的平台參考價/, 'the fixture has both sources');
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

test('detail page wiring: the price panel holds the slot that loads only when the 價格 tab is opened', async () => {
  const [ui, html] = await Promise.all(['../ui-enhancements.js', '../index.html'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  assert.match(ui, /detailPanel\('market',true,`<div class="price-trend" data-price-trend="\$\{e\(id\)\}"><\/div>/);
  assert.match(ui, /\[data-detail-tab="market"\]/);
  assert.match(ui, /tab\.addEventListener\('click',\(\)=>\{[^]*?window\.PriceTimeline\.load\(slot/);
  assert.ok(html.indexOf('/price-timeline.js') > 0 && html.indexOf('/price-timeline.js') < html.indexOf('/ui-enhancements.js'));
  assert.doesNotMatch(ui.match(/openCard=async function[^]*?window\.openCard=openCard/)[0], /price-history'/, 'the detail request itself never asks for the trend');
});
