import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSetsByCode, matchSetPrices, matchSetImages, createTcgapiPricing } from '../providers/tcgapi-pricing.mjs';

test('set codes: name prefix before the colon, duplicate codes are dropped', () => {
  const map = mapSetsByCode([
    { id: 1, name: 'M6a: MEGA Expansion 30th Celebration' },
    { id: 2, name: 'MF: Deck Espeon' }, { id: 3, name: 'MF: Deck Umbreon' },
    { id: 4, name: 'No code here' }, { id: '5', name: 'X1: bad id' }
  ]);
  assert.deepEqual([...map], [['m6a', 1]]);
});

test('card match: leading number, unique on both sides, positive market price only', () => {
  const ours = [{ id: 'a', number: '001/103' }, { id: 'b', number: '002' }, { id: 'c', number: '003' }, { id: 'd', number: '004' }, { id: 'd2', number: '004' }, { id: 'e', number: '005' }];
  const rows = [
    { number: '001/103', printing: 'Holofoil', market_price: 4.567, market_price_as_of: '2026-11-02', product_type: 'Cards' },
    { number: '002/103', market_price: 1 }, { number: '002/103', market_price: 2 },
    { number: '003/103', market_price: 0 },
    { number: '004/103', market_price: 3 },
    { number: '005/103', market_price: 9, product_type: 'Sealed Products' }
  ];
  assert.deepEqual(matchSetPrices(ours, rows), [{ cardId: 'a', amount: 4.57, printing: 'holofoil', asOf: '2026-11-02' }]);
});

test('daily run: writes USD tcgapi rows for mapped series and stops at the request budget', async () => {
  const calls = [], writes = [];
  const db = async (path, init) => {
    if (path === '/rpc/image_tcgapi_targets') return [];
    if (path.startsWith('/rpc/')) return [{ official_code: 'M6a', cards: [{ id: 'a', number: '001' }] }, { official_code: 'ZZ', cards: [] }, { official_code: 'M6a', cards: [{ id: 'a', number: '001' }] }];
    writes.push(JSON.parse(init.body)); return null;
  };
  const fetchFn = async url => {
    calls.push(url);
    const body = url.includes('/sets?') ? { data: [{ id: 9, name: 'M6a: x' }], meta: { has_more: false } } : { data: [{ number: '001/179', printing: 'Holofoil', market_price: 3 }], meta: { has_more: false }, rate_limit: { daily_remaining: 90 } };
    return { ok: true, status: 200, json: async () => body };
  };
  const pricing = createTcgapiPricing({ apiKey: 'k', db, fetchFn, now: () => new Date('2026-11-03T05:00:00Z'), dailyRequests: 2, gapMs: 0, log: { log() {}, error() {} } });
  const result = await pricing.runOnce();
  assert.equal(calls.length, 2, '第三次請求超過額度，不送出');
  assert.equal(result.stoppedBy, 'daily-budget');
  assert.equal(result.unmapped, 1);
  assert.deepEqual(writes, [[{ card_id: 'a', provider: 'tcgplayer', variant: 'tcgapi-holofoil', currency: 'USD', snapshot_date: '2026-11-03', amount: 3, observed_at: null }]]);
  assert.deepEqual(await createTcgapiPricing({ db }).runOnce(), { skipped: 'not-configured' });
});

test('image match: one image per card number, same image across printings is fine, only TCGplayer product images', () => {
  const img = id => `https://product-images.tcgplayer.com/fit-in/400x400/${id}.jpg`;
  const ours = [{ id: 'a', canonicalId: 'ca', number: '063' }, { id: 'b', number: '064' }, { id: 'c', number: '065' }, { id: 'd', number: '066' }];
  const rows = [
    { number: '063/051', printing: 'Normal', image_url: img(1) }, { number: '063/051', printing: 'Holofoil', image_url: img(1) },
    { number: '064/051', image_url: img(2) }, { number: '064/051', image_url: img(3) },
    { number: '065/051', image_url: 'https://example.com/x.jpg' },
    { number: '066/051', image_url: img(4), product_type: 'Sealed Products' }
  ];
  const out = matchSetImages(ours, rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].card_id, 'a');
  assert.equal(out[0].canonical_id, 'ca');
  assert.equal(out[0].source, 'tcgplayer');
  assert.equal(out[0].image_url, img(1));
  assert.equal(out[0].source_url, 'https://www.tcgplayer.com/product/1');
});

test('daily run: missing images are filled before prices, then not again for 7 days', async () => {
  const writes = [];
  let clock = new Date('2026-11-03T05:00:00Z').getTime();
  const db = async (path, init) => {
    if (path === '/rpc/image_tcgapi_targets') return [{ official_code: 'SM3N', cards: [{ id: 'x', canonicalId: 'x', number: '063' }] }];
    if (path.startsWith('/rpc/')) return [];
    writes.push(path); return null;
  };
  const fetchFn = async url => ({ ok: true, status: 200, json: async () => url.includes('/sets?') ? { data: [{ id: 7, name: 'SM3N: x' }], meta: {} } : { data: [{ number: '063/051', image_url: 'https://product-images.tcgplayer.com/fit-in/400x400/571888.jpg' }], meta: {} } });
  const pricing = createTcgapiPricing({ apiKey: 'k', db, fetchFn, now: () => new Date(clock), gapMs: 0, log: { log() {}, error() {} } });
  assert.equal((await pricing.runOnce()).images, 1);
  assert.deepEqual(writes, ['/card_images']);
  clock += 24 * 60 * 60 * 1000;
  assert.equal((await pricing.runOnce()).imageSeries, 0, '隔天不再查缺圖');
});
