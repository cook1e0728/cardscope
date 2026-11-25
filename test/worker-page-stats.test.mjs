import test from 'node:test';
import assert from 'node:assert/strict';

// Render 停用後，頁面開啟數與最熱卡改由 Worker 記：每次開啟一筆 page_stats_add／card_hot_add，只送種類或卡號。
test('Worker counts page opens (bots apart, fetch() and HEAD not counted) without sending IP or user agent', async () => {
  const { createWorkerHandler } = await import('../worker/index.mjs');
  const rpcs = [];
  const fetchFn = async (input, init = {}) => {
    const url = new URL(input.url || input);
    if (url.pathname.startsWith('/rest/v1/rpc/')) { rpcs.push({ rpc: url.pathname.slice(13), body: JSON.parse(init.body), raw: init.body }); return new Response('null'); }
    throw new Error('origin down');
  };
  const handler = createWorkerHandler({ fetchFn, edgeCache: null });
  const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_KEY: 'k' };
  const waits = [];
  const ctx = { waitUntil: p => waits.push(p) };
  const open = (path, headers = {}, method = 'GET') => handler.fetch(new Request(`https://cardseektcg.com${path}`, { method, headers: { 'cf-connecting-ip': '203.0.113.9', ...headers } }), env, ctx);
  await open('/?game=pokemon', { 'sec-fetch-dest': 'document', 'user-agent': 'Mozilla/5.0' });
  await open('/?card=pokemon-x-1', { 'user-agent': 'Googlebot/2.1' });
  await open('/', { 'sec-fetch-dest': 'empty' });
  await open('/', {}, 'HEAD');
  await Promise.all(waits);
  assert.deepEqual(rpcs.map(r => [r.rpc, r.body.p_counts]), [['page_stats_add', { game: 1 }], ['page_stats_add', { bot: 1 }]]);
  assert.match(rpcs[0].body.p_day, /^\d{4}-\d{2}-\d{2}$/);
  for (const r of rpcs) assert.doesNotMatch(r.raw, /203\.0\.113\.9|Mozilla|Googlebot/);
});

test('read-api counts a card open only for ?open=1 from a person, on a cache hit too', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../providers/read-api.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(cached\) \{ recordCardOpen\(request, url, tail, ctx\); return cached; \}/);
  assert.match(src, /recordCardOpen\(request, url, card\.id, ctx\);/);
  assert.match(src, /url\.searchParams\.get\('open'\) !== '1' \|\| isBot\(/);
});
