import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTcgdexPricing, dropStaleTcgdexPricing, parseTcgdexPricing, tcgdexCardUrl } from '../providers/tcgdex-pricing.mjs';
import { catalogCollectionAllowed, sourcePolicyForProvider } from '../providers/source-policy.mjs';

const NOW = Date.parse('2026-10-11T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = ms => new Date(ms).toISOString();

// Shape taken from a live call to https://api.tcgdex.net/v2/ja/cards/SV6a-039 (2026-10-11).
const cardmarket = (over = {}) => ({ updated: iso(NOW - DAY), unit: 'EUR', idProduct: 773788, avg: 0.28, low: 0.03, trend: 0.2, avg1: 0.15, avg7: 0.18, avg30: 0.25, 'avg-holo': null, 'low-holo': null, 'trend-holo': 0, ...over });
const sv6a039 = (over = {}) => ({ id: 'SV6a-039', localId: '039', name: 'モモワロウex', variants_detailed: [{ type: 'holo', size: 'standard', thirdParty: { cardmarket: 773788, tcgplayer: 566290 }, variantId: 'jr7oetx1mqug9', pricing: { cardmarket: cardmarket(over), tcgplayer: null } }] });
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('trend becomes the market price and low the listing price, per variant, with the update time and Cardmarket product', () => {
  const card = sv6a039();
  card.variants_detailed.push({ type: 'reverse', pricing: { cardmarket: cardmarket({ idProduct: 773789, trend: 0.35, low: 0.1, updated: iso(NOW - 2 * DAY) }), tcgplayer: null } });
  const records = parseTcgdexPricing(card, 'SV6a-039');
  assert.deepEqual(records.map(r => [r.variant, r.priceType, r.amount, r.idProduct]), [['holo', 'market', 0.2, 773788], ['holo', 'listing', 0.03, 773788], ['reverse', 'market', 0.35, 773789], ['reverse', 'listing', 0.1, 773789]]);
  assert.equal(records[0].provider, 'tcgdex');
  assert.equal(records[0].market, 'Cardmarket');
  assert.equal(records[0].currency, 'EUR');
  assert.equal(records[0].providerCardId, 'SV6a-039');
  assert.equal(records[0].observedAt, iso(NOW - DAY));
  assert.equal(records[0].sourceUrl, 'https://api.tcgdex.net/v2/ja/cards/SV6a-039');
  assert.equal(records.some(r => 'avg' in r || r.amount === 0.28), false, 'avg fields are never exposed');
});

test('missing, zero, non-EUR and undated prices produce no record', () => {
  assert.deepEqual(parseTcgdexPricing({ id: 'X-1' }), []);
  assert.deepEqual(parseTcgdexPricing({ id: 'X-1', variants_detailed: [{ type: 'normal', pricing: { cardmarket: null, tcgplayer: null } }] }), []);
  assert.deepEqual(parseTcgdexPricing(sv6a039({ trend: 0, low: null })), []);
  assert.deepEqual(parseTcgdexPricing(sv6a039({ unit: 'USD' })), []);
  assert.deepEqual(parseTcgdexPricing(sv6a039({ updated: 'not-a-date' })), []);
  assert.deepEqual(parseTcgdexPricing(sv6a039({ trend: 0.5, low: null })).map(r => r.priceType), ['market']);
});

test('records older than 7 days are dropped, exactly 7 days still counts', () => {
  const records = parseTcgdexPricing(sv6a039({ updated: iso(NOW - 7 * DAY - 1000) }), 'SV6a-039');
  assert.equal(records.length, 2);
  assert.deepEqual(dropStaleTcgdexPricing(records, { now: NOW }), []);
  assert.equal(dropStaleTcgdexPricing(parseTcgdexPricing(sv6a039({ updated: iso(NOW - 7 * DAY) }), 'SV6a-039'), { now: NOW }).length, 2);
});

test('the fetch is cached for 24 hours, and a record that goes stale inside the cache window is dropped on read', async () => {
  let clock = NOW, calls = 0, lastUrl = null, lastOptions = null;
  const fetchPricing = createTcgdexPricing({ now: () => clock, fetch: async (url, options) => { calls++; lastUrl = String(url); lastOptions = options; return jsonResponse(sv6a039({ updated: iso(NOW - 6.5 * DAY) })); } });
  assert.equal((await fetchPricing('SV6a-039')).length, 2);
  assert.equal(lastUrl, 'https://api.tcgdex.net/v2/ja/cards/SV6a-039');
  assert.ok(lastOptions.signal instanceof AbortSignal, 'the request has a timeout');
  clock = NOW + 12 * DAY / 24;
  assert.equal((await fetchPricing('SV6a-039')).length, 2);
  assert.equal(calls, 1, 'second call is served from memory');
  clock = NOW + 18 * 60 * 60 * 1000;
  assert.deepEqual(await fetchPricing('SV6a-039'), [], 'the data is now 7.25 days old: still cached, but not shown');
  assert.equal(calls, 1);
  clock = NOW + DAY + 1000;
  await fetchPricing('SV6a-039');
  assert.equal(calls, 2, 'the cache expires after 24 hours');
});

test('an unknown card (404) is cached as empty', async () => {
  let calls = 0;
  const fetchPricing = createTcgdexPricing({ now: () => NOW, fetch: async () => { calls++; return jsonResponse({ error: 'not found' }, 404); } });
  assert.deepEqual(await fetchPricing('ZZ-999'), []);
  assert.deepEqual(await fetchPricing('ZZ-999'), []);
  assert.equal(calls, 1);
});

test('a failed lookup throws and is not cached, so the next call retries', async () => {
  let calls = 0;
  const outcomes = [() => jsonResponse({}, 500), () => { throw new Error('socket hang up'); }, () => jsonResponse(sv6a039())];
  const fetchPricing = createTcgdexPricing({ now: () => NOW, fetch: async () => outcomes[calls++]() });
  await assert.rejects(fetchPricing('SV6a-039'), /TCGDEX_PRICING_500/);
  await assert.rejects(fetchPricing('SV6a-039'), /socket hang up/);
  assert.equal((await fetchPricing('SV6a-039')).length, 2);
  assert.equal(calls, 3);
  assert.equal((await fetchPricing('SV6a-039')).length, 2);
  assert.equal(calls, 3);
});

test('concurrent requests for one card share a single upstream call', async () => {
  let calls = 0;
  const fetchPricing = createTcgdexPricing({ now: () => NOW, fetch: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 20)); return jsonResponse(sv6a039()); } });
  const results = await Promise.all([fetchPricing('SV6a-039'), fetchPricing('SV6a-039'), fetchPricing('SV6a-039')]);
  assert.deepEqual(results.map(r => r.length), [2, 2, 2]);
  assert.equal(calls, 1);
});

test('ids that could escape the endpoint path are refused without a request', async () => {
  let calls = 0;
  const fetchPricing = createTcgdexPricing({ now: () => NOW, fetch: async () => { calls++; return jsonResponse(sv6a039()); } });
  for (const id of ['', null, undefined, '../cards/x', 'SV6a-039/../..', 'a b', 'SV6a-039?x=1']) assert.deepEqual(await fetchPricing(id), []);
  assert.equal(calls, 0);
  assert.equal(tcgdexCardUrl('SV6a-039'), 'https://api.tcgdex.net/v2/ja/cards/SV6a-039');
});

test('the source registry lists tcgdex-pricing as an enabled, risk-accepted market API', () => {
  const policy = sourcePolicyForProvider('tcgdexPricing');
  assert.equal(policy.id, 'tcgdex-pricing');
  assert.equal(policy.kind, 'market-api');
  assert.equal(policy.region, 'EU');
  assert.equal(policy.metadataCollection, 'risk-accepted');
  assert.equal(policy.imagePolicy, 'not-collected');
  assert.equal(policy.attributionRequired, true);
  assert.equal(policy.refreshHours, 24);
  assert.equal(catalogCollectionAllowed('tcgdexPricing'), true);
});

// --- /api/cards/:id/market over HTTP, with Supabase and every outside host replaced by fixtures ---

async function listenOnFreePort(httpServer) {
  await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(0, '127.0.0.1', resolve); });
  return httpServer.address().port;
}
const close = httpServer => new Promise(resolve => httpServer.close(resolve));

function ygoprodeckBody(names) {
  return { data: names.map((name, index) => ({ id: 1000 + index, name, type: 'Normal Monster', card_images: [{ image_url_small: 'https://example.invalid/x.jpg' }], card_prices: [{ cardmarket_price: '1.50', tcgplayer_price: '2.00', ebay_price: '3', amazon_price: '4', coolstuffinc_price: '5' }] })) };
}

test('market endpoint: tcgdex-ja Pokemon cards get NT$-converted Cardmarket prices; other cards and non-exact Yu-Gi-Oh! names get none', async () => {
  const printing = (cardId, source, providerId) => ({ id: cardId, cardId, seriesId: 's', region: 'JP', language: 'ja-JP', localSetCode: 'SV6a', localCardNumber: '039', rarity: 'RR', imageUrl: null, imageRehostRequired: false, source, providerId, metadata: {} });
  const base = { canonicalId: null, seriesId: 's', officialCardNumber: '039', rarity: 'RR', nameEn: null, nameKo: null, aliases: [], metadata: {} };
  const cards = {
    'pokemon-tcgdex-ja-sv6a-039': { ...base, id: 'pokemon-tcgdex-ja-sv6a-039', game: 'pokemon', nameZh: '桃歹郎ex', nameJa: 'モモワロウex', printings: [printing('pokemon-tcgdex-ja-sv6a-039', 'tcgdex-ja', 'SV6a-039')] },
    'pokemon-official-ja-x': { ...base, id: 'pokemon-official-ja-x', game: 'pokemon', nameZh: null, nameJa: '官方匯入', printings: [printing('pokemon-official-ja-x', 'pokemon-card-official-jp', 'abc123')] },
    'yugioh-dm': { ...base, id: 'yugioh-dm', game: 'yugioh', nameZh: '黑魔導', nameJa: null, nameEn: 'Dark Magician', printings: [] },
    'yugioh-bewd': { ...base, id: 'yugioh-bewd', game: 'yugioh', nameZh: '青眼白龍', nameJa: null, nameEn: 'blue-eyes white dragon', printings: [] }
  };
  const mockSupabase = createServer((req, res) => {
    const url = new URL(req.url, 'http://mock-supabase'), table = url.pathname.split('/').at(-1);
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      let body = [];
      if (table === 'get_card_detail') {
        const card = cards[JSON.parse(raw || '{}').p_id];
        body = { cards: card ? [card] : [], series: [], games: [{ id: card?.game || 'pokemon', nameZh: card?.game === 'yugioh' ? '遊戲王' : '寶可夢' }] };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  const supabasePort = await listenOnFreePort(mockSupabase), appPortProbe = createServer(), appPort = await listenOnFreePort(appPortProbe);
  await close(appPortProbe);
  const dir = await mkdtemp(join(tmpdir(), 'cardscope-tcgdex-'));
  const preload = join(dir, 'stub-fetch.mjs');
  const fixtures = [
    ['api.tcgdex.net/v2/ja/cards/SV6a-039', 200, sv6a039({ updated: new Date(Date.now() - DAY).toISOString() })],
    ['db.ygoprodeck.com/api/v7/cardinfo.php?fname=Dark+Magician&', 200, ygoprodeckBody(['Dark Magician Girl', 'Dark Magician of Chaos'])],
    ['db.ygoprodeck.com/api/v7/cardinfo.php?fname=blue-eyes+white+dragon&', 200, ygoprodeckBody(['Blue-Eyes Ultimate Dragon', 'Blue-Eyes White Dragon'])],
    ['open.er-api.com', 200, { result: 'success', time_last_update_utc: 'Fri, 09 Oct 2026 00:02:31 +0000', rates: { TWD: 1, JPY: 4.8, USD: 0.031, EUR: 0.0275 } }]
  ];
  await writeFile(preload, `const real=globalThis.fetch,fixtures=${JSON.stringify(fixtures)};globalThis.fetch=async(input,options)=>{const url=String(input?.url||input);for(const [key,status,body] of fixtures)if(url.includes(key))return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});if(/^https?:\\/\\/(?!127\\.0\\.0\\.1)/.test(url))return new Response('{}',{status:599});return real(input,options)};`);
  let app;
  try {
    app = spawn(process.execPath, ['--import', pathToFileURL(preload).href, 'server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(appPort), SUPABASE_URL: `http://127.0.0.1:${supabasePort}`, SUPABASE_SERVICE_KEY: 'local-fixture-key', CATALOG_SYNC_ON_START: 'false', CARD_IMAGE_CACHE_ON_START: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`market fixture start timeout: ${output}`)), 8000);
      app.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`market fixture exited (${code ?? signal}): ${output}`)); });
      const onData = chunk => { output += String(chunk); if (output.includes('CardScope is running')) { clearTimeout(timer); resolve(); } };
      app.stdout.on('data', onData); app.stderr.on('data', onData);
    });
    const market = async id => { const response = await fetch(`http://127.0.0.1:${appPort}/api/cards/${id}/market`); assert.equal(response.status, 200); return (await response.json()).data; };

    const pokemon = await market('pokemon-tcgdex-ja-sv6a-039');
    assert.deepEqual(pokemon.sources.map(s => [s.source, s.status]).sort(), [['tcgdex', 'ok'], ['yuyutei', 'ok']]);
    const tcgdex = pokemon.records.filter(r => r.provider === 'tcgdex');
    assert.deepEqual(tcgdex.map(r => [r.priceType, r.amount, r.currency, r.variant, r.market]), [['market', 0.2, 'EUR', 'holo', 'Cardmarket'], ['listing', 0.03, 'EUR', 'holo', 'Cardmarket']]);
    assert.equal(tcgdex[0].priceTwd, Math.round(0.2 / 0.0275), 'EUR converted with the ExchangeRate-API rate');
    assert.equal(tcgdex[0].sourceUrl, 'https://api.tcgdex.net/v2/ja/cards/SV6a-039');
    assert.equal(tcgdex[0].idProduct, 773788);
    assert.equal(pokemon.meta.exchangeRates.source, 'ExchangeRate-API');
    assert.equal(pokemon.meta.exchangeRates.updatedAt, '2026-10-09');
    assert.equal(pokemon.meta.priceTypes.market, '平台參考價');

    const official = await market('pokemon-official-ja-x');
    assert.deepEqual(official.sources.map(s => s.source), ['yuyutei'], 'no TCGdex lookup without a tcgdex-ja printing');
    assert.deepEqual(official.records, []);

    const noExact = await market('yugioh-dm');
    assert.deepEqual(noExact.records, [], 'no exact-name match: no price, and never the first search result');

    const exact = await market('yugioh-bewd');
    assert.deepEqual(exact.records.map(r => [r.market, r.amount, r.currency, r.scope]), [['Cardmarket', 1.5, 'EUR', 'cross-printing-lowest'], ['TCGplayer', 2, 'USD', 'cross-printing-lowest']]);
    assert.equal(exact.records[0].cardName, 'Blue-Eyes White Dragon');
    assert.equal(exact.records[0].priceTwd, Math.round(1.5 / 0.0275));
  } finally {
    if (app && app.exitCode === null && app.signalCode === null) await new Promise(resolve => { app.once('exit', resolve); app.kill(); });
    await close(mockSupabase);
    await rm(dir, { recursive: true, force: true });
  }
});
