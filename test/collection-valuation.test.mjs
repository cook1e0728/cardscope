import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REFERENCE_MAX_IDS, REFERENCE_ROW_LIMIT, buildReferencePrices, referenceQueryParams, validateReferenceRequest } from '../providers/collection-valuation.mjs';

// ADR 0045: POST /api/prices/reference. Pure request validation and "latest row per provider+variant", then over HTTP with a fake Supabase.

test('request validation: strict shape, at most 100 string ids, no stray keys, no control characters', () => {
  assert.deepEqual(validateReferenceRequest({ cardIds: ['a', 'b', 'a'] }).ids, ['a', 'b'], 'deduplicated, input order kept');
  assert.equal(validateReferenceRequest({ cardIds: Array.from({ length: REFERENCE_MAX_IDS }, (_, i) => `c${i}`) }).ids.length, 100);
  for (const bad of [null, undefined, [], 'x', 5, {}, { cardIds: [] }, { cardIds: 'a' }, { cardIds: { 0: 'a' } }, { cardIds: [1] }, { cardIds: [''] }, { cardIds: [null] }, { cardIds: [['a']] },
    { cardIds: ['a'], extra: 1 }, { cardIds: ['x'.repeat(129)] }, { cardIds: ['a\nb'] }, { cardIds: ['a"b'] }, { cardIds: ['a\\b'] }, { cardIds: Array.from({ length: 101 }, (_, i) => `c${i}`) }]) {
    assert.ok(validateReferenceRequest(bad).error, `rejects ${JSON.stringify(bad)?.slice(0, 40)}`);
  }
  assert.deepEqual(validateReferenceRequest({ cardIds: ['pokemon-jp-sv6a-039', "o'brien (x),y"] }).ids.length, 2, 'ids PostgREST would need quoted are fine inside the quoted list');
});

test('query: one request filtered by card_id, newest first, bounded', () => {
  const params = referenceQueryParams(['a', 'b']);
  assert.equal(params.card_id, 'in.("a","b")');
  assert.equal(params.order, 'snapshot_date.desc');
  assert.equal(params.limit, String(REFERENCE_ROW_LIMIT));
  assert.equal(params.select, 'card_id,provider,variant,currency,snapshot_date,amount');
});

test('latest row per card+provider+variant, TWD conversion, cards without rows get an empty list, bad rows are ignored', () => {
  const fx = { rates: { TWD: 1, EUR: 40, USD: 32 }, updatedAt: '2026-10-19', source: 'ExchangeRate-API' };
  const amountToTwd = (amount, currency, rates) => Math.round(Number(amount) * rates.rates[currency]);
  const rows = [
    { card_id: 'a', provider: 'cardmarket', variant: 'holo', currency: 'EUR', snapshot_date: '2026-10-01', amount: '4.00' },
    { card_id: 'a', provider: 'cardmarket', variant: 'holo', currency: 'EUR', snapshot_date: '2026-10-15', amount: '5.50' },
    { card_id: 'a', provider: 'cardmarket', variant: 'reverse', currency: 'EUR', snapshot_date: '2026-10-10', amount: 2 },
    { card_id: 'a', provider: 'tcgplayer', variant: 'holofoil', currency: 'USD', snapshot_date: '2026-10-12', amount: 10 },
    { card_id: 'b', provider: 'tcgplayer', variant: '', currency: 'USD', snapshot_date: '2026-10-05', amount: 3 },
    { card_id: 'a', provider: 'ebay', variant: '', currency: 'USD', snapshot_date: '2026-10-19', amount: 99 },
    { card_id: 'a', provider: 'cardmarket', variant: 'x', currency: 'EUR', snapshot_date: 'garbage', amount: 1 },
    { card_id: 'a', provider: 'cardmarket', variant: 'y', currency: 'EUR', snapshot_date: '2026-10-19', amount: -5 },
    { card_id: 'zzz', provider: 'cardmarket', variant: '', currency: 'EUR', snapshot_date: '2026-10-19', amount: 5 }
  ];
  const out = buildReferencePrices(rows, ['a', 'b', 'c'], { fx, amountToTwd, now: Date.parse('2026-10-19T00:00:00Z') });
  assert.deepEqual(out.cards.map(c => c.cardId), ['a', 'b', 'c']);
  assert.deepEqual(out.cards[0].prices, [
    { provider: 'cardmarket', variant: 'holo', currency: 'EUR', amount: 5.5, amountTwd: 220, snapshotDate: '2026-10-15' },
    { provider: 'cardmarket', variant: 'reverse', currency: 'EUR', amount: 2, amountTwd: 80, snapshotDate: '2026-10-10', stale: true },
    { provider: 'tcgplayer', variant: 'holofoil', currency: 'USD', amount: 10, amountTwd: 320, snapshotDate: '2026-10-12' }
  ]);
  assert.deepEqual(out.cards[1].prices, [{ provider: 'tcgplayer', variant: '', currency: 'USD', amount: 3, amountTwd: 96, snapshotDate: '2026-10-05', stale: true }], 'older than 7 days: still returned, flagged so the front end shows 已過期 and leaves it out of the total');
  assert.deepEqual(out.cards[2].prices, [], 'no snapshot: the front end shows 未計入');
  assert.equal(out.meta.truncated, false);
  assert.match(out.meta.note, /Cardmarket／TCGplayer 的平台參考價/);
  assert.match(out.meta.note, /超過 7 天的標「已過期」/);
  assert.match(buildReferencePrices([rows[0]], ['a'], { fx, amountToTwd, now: Date.parse('2026-10-19T00:00:00Z') }).meta.note, /為 Cardmarket 的平台參考價/, 'only the sources that have data are named');
  const edge = id => buildReferencePrices([{ card_id: 'a', provider: 'cardmarket', variant: '', currency: 'EUR', snapshot_date: id, amount: 1 }], ['a'], { fx, amountToTwd, now: Date.parse('2026-10-19T00:00:00Z') }).cards[0].prices[0];
  assert.equal(edge('2026-10-12').stale, undefined, 'exactly 7 days is still fresh, as on the detail page');
  assert.equal(edge('2026-10-11').stale, true);
  assert.equal(out.meta.exchangeRates.source, 'ExchangeRate-API');
  assert.match(out.meta.note, /不是成交價/);
  assert.equal(buildReferencePrices(new Array(REFERENCE_ROW_LIMIT).fill({}), ['a'], { fx, amountToTwd }).meta.truncated, true);
});

async function listenOnFreePort(httpServer) {
  await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(0, '127.0.0.1', resolve); });
  return httpServer.address().port;
}
const close = httpServer => new Promise(resolve => httpServer.close(resolve));

test('POST /api/prices/reference over HTTP: validation errors, one database query, TWD conversion, 502 on database failure, no external TCGdex call', async () => {
  const snapshotRows = [
    { card_id: 'card-jp', provider: 'cardmarket', variant: 'holo', currency: 'EUR', snapshot_date: '2026-10-10', amount: 4 },
    { card_id: 'card-jp', provider: 'cardmarket', variant: 'holo', currency: 'EUR', snapshot_date: '2026-10-17', amount: 5.5 },
    { card_id: 'card-us', provider: 'tcgplayer', variant: 'holofoil', currency: 'USD', snapshot_date: '2026-10-18', amount: 12 }
  ];
  const snapshotQueries = [];
  const mockSupabase = createServer((req, res) => {
    const url = new URL(req.url, 'http://mock-supabase'), table = url.pathname.split('/').at(-1);
    req.resume();
    req.on('end', () => {
      let status = 200, body = [];
      if (table === 'price_snapshots') {
        snapshotQueries.push(url.searchParams);
        const ids = (url.searchParams.get('card_id') || '').replace(/^in\.\(|\)$/g, '').split(',').map(x => x.replaceAll('"', ''));
        if (ids.includes('card-down')) { status = 500; body = { message: 'boom' }; } else body = snapshotRows.filter(r => ids.includes(r.card_id));
      }
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  const supabasePort = await listenOnFreePort(mockSupabase), probe = createServer(), appPort = await listenOnFreePort(probe);
  await close(probe);
  const dir = await mkdtemp(join(tmpdir(), 'cardscope-reference-')), preload = join(dir, 'stub-fetch.mjs');
  const fixtures = [['open.er-api.com', 200, { result: 'success', time_last_update_utc: 'Fri, 09 Oct 2026 00:02:31 +0000', rates: { TWD: 1, JPY: 4.8, USD: 0.03125, EUR: 0.025 } }]];
  await writeFile(preload, `const real=globalThis.fetch,fixtures=${JSON.stringify(fixtures)};globalThis.fetch=async(input,options)=>{const url=String(input?.url||input);if(url.includes('tcgdex'))throw new Error('external TCGdex call: '+url);for(const [key,status,body] of fixtures)if(url.includes(key))return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});return real(input,options)};`);
  let app;
  try {
    app = spawn(process.execPath, ['--import', pathToFileURL(preload).href, 'server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(appPort), SUPABASE_URL: `http://127.0.0.1:${supabasePort}`, SUPABASE_SERVICE_KEY: 'local-fixture-key', CATALOG_SYNC_ON_START: 'false', CARD_IMAGE_CACHE_ON_START: 'false', PRICE_SNAPSHOT_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`reference fixture start timeout: ${output}`)), 8000);
      app.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`reference fixture exited (${code ?? signal}): ${output}`)); });
      const onData = chunk => { output += String(chunk); if (output.includes('CardScope is running')) { clearTimeout(timer); resolve(); } };
      app.stdout.on('data', onData); app.stderr.on('data', onData);
    });
    const post = async (body, raw) => { const response = await fetch(`http://127.0.0.1:${appPort}/api/prices/reference`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };

    const ok = await post({ cardIds: ['card-jp', 'card-us', 'card-none'] });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.data.cards.map(c => [c.cardId, c.prices.map(p => [p.provider, p.variant, p.amount, p.amountTwd, p.snapshotDate])]), [
      ['card-jp', [['cardmarket', 'holo', 5.5, 220, '2026-10-17']]],
      ['card-us', [['tcgplayer', 'holofoil', 12, 384, '2026-10-18']]],
      ['card-none', []]
    ]);
    assert.equal(ok.body.data.meta.exchangeRates.source, 'ExchangeRate-API');
    assert.equal(snapshotQueries.length, 1, 'one indexed query for the whole batch');
    assert.equal(snapshotQueries[0].get('card_id'), 'in.("card-jp","card-us","card-none")');

    const before = snapshotQueries.length;
    for (const bad of [{ cardIds: [] }, { cardIds: [1] }, { cardIds: Array.from({ length: 101 }, (_, i) => `c${i}`) }, { cardIds: ['a'], x: 1 }, []]) assert.equal((await post(bad)).status, 400);
    assert.equal((await post(null, '{not json')).status, 400);
    assert.equal(snapshotQueries.length, before, 'invalid requests never reach the database');

    const down = await post({ cardIds: ['card-down'] });
    assert.equal(down.status, 502);
    assert.ok(down.body.error);
    const get = await fetch(`http://127.0.0.1:${appPort}/api/prices/reference`);
    assert.notEqual(get.status, 200, 'GET is not served');
  } finally {
    if (app && app.exitCode === null && app.signalCode === null) await new Promise(resolve => { app.once('exit', resolve); app.kill(); });
    await close(mockSupabase);
    await rm(dir, { recursive: true, force: true });
  }
});
