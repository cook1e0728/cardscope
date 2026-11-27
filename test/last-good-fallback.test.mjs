import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadApi } from '../providers/read-api.mjs';

const row = { direction: 'up', card_id: 'pokemon-a', currency: 'EUR', from_date: '2026-11-10', from_amount: '10', to_date: '2026-11-24', to_amount: '15', change_percent: '50', name_ja: 'ピカチュウ', card_number: '001' };

function setup() {
  let clock = Date.UTC(2026, 10, 27);
  let dbUp = true;
  let dbCalls = 0;
  const store = new Map();
  let writes = 0;
  const env = {
    SUPABASE_URL: 'https://main.test', SUPABASE_SERVICE_KEY: 'k',
    SNAPSHOT_KV: {
      async get(key) { return store.get(key) ?? null; },
      async put(key, value) { writes++; store.set(key, value); }
    }
  };
  const fetchFn = async url => {
    if (String(url).includes('/rpc/price_movers')) {
      dbCalls++;
      if (!dbUp) return new Response('{"message":"canceling statement due to statement timeout"}', { status: 500 });
      return new Response(JSON.stringify([row]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('nope', { status: 503 });
  };
  const api = createReadApi({ env, fetchFn, now: () => clock, edgeCache: null });
  const get = () => api.handle('price-movers', new Request('https://cardseektcg.com/api/price-movers'), new URL('https://cardseektcg.com/api/price-movers'), null, env);
  return {
    get, store,
    get writes() { return writes; }, get dbCalls() { return dbCalls; },
    down() { dbUp = false; }, advance(ms) { clock += ms; },
    fresh() { return createReadApi({ env, fetchFn, now: () => clock, edgeCache: null }); },
    env
  };
}

test('成功的漲跌榜存進 KV；資料庫失敗時回傳上一份，不回 502', async () => {
  const s = setup();
  const ok = await s.get();
  assert.equal(ok.status, 200);
  assert.equal(s.writes, 1);
  const saved = JSON.parse(s.store.get('lastgood:v1:price-movers'));
  assert.equal(JSON.parse(saved.body).data.up[0].cardId, 'pokemon-a');

  // 新的 isolate（沒有記憶體快取）遇到資料庫失敗
  s.down();
  const api = s.fresh();
  const call = () => api.handle('price-movers', new Request('https://cardseektcg.com/api/price-movers'), new URL('https://cardseektcg.com/api/price-movers'), null, s.env);
  const before = s.dbCalls;
  const res = await call();
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('X-CardSeek-Stale'));
  assert.equal((await res.json()).data.up[0].cardId, 'pokemon-a');
  assert.equal(s.dbCalls, before + 1);

  // 5 分鐘內再來，不再等資料庫
  const again = await call();
  assert.equal(again.status, 200);
  assert.equal(s.dbCalls, before + 1);
});

test('KV 寫入有節流：6 小時內不重寫', async () => {
  const s = setup();
  await s.get();
  s.advance(2 * 3600 * 1000);
  await s.fresh().handle('price-movers', new Request('https://cardseektcg.com/api/price-movers'), new URL('https://cardseektcg.com/api/price-movers'), null, s.env);
  assert.equal(s.writes, 1);
  s.advance(5 * 3600 * 1000);
  await s.fresh().handle('price-movers', new Request('https://cardseektcg.com/api/price-movers'), new URL('https://cardseektcg.com/api/price-movers'), null, s.env);
  assert.equal(s.writes, 2);
});

test('沒有上一份時照樣回 502；帶篩選的請求不走 KV', async () => {
  const s = setup();
  s.down();
  assert.equal((await s.get()).status, 502);
  assert.equal(s.writes, 0);
  const api = s.fresh();
  const url = new URL('https://cardseektcg.com/api/price-movers?x=1');
  await api.handle('price-movers', new Request(url), url, null, s.env);
  assert.equal([...s.store.keys()].length, 0);
});
