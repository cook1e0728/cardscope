import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PORT = '0';
process.env.CATALOG_SYNC_ON_START = 'false';
process.env.CATALOG_WARM_ON_START = 'false';
const { browseCache, cachedBrowseRows, server } = await import('../server.mjs?memory-bounds');
test.after(async () => {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

// Render's free instance has 512 MB (about 255 MB of Node heap); the browse cache must never pin a whole game's rows (OOM crash loop 2026-10-15/16).
test('browse cache shares a whole-game row list with waiting callers but does not keep it', async () => {
  browseCache.clear();
  const big = Array.from({ length: 6000 }, (_, index) => ({ id: index }));
  let loads = 0;
  const [first, second] = await Promise.all([cachedBrowseRows('cards:big', async () => { loads++; return big; }), cachedBrowseRows('cards:big', async () => { loads++; return big; })]);
  assert.equal(first, big);
  assert.equal(second, big);
  assert.equal(loads, 1, 'a load in flight is still shared');
  assert.equal(browseCache.has('cards:big'), false, 'a list over the row cap is dropped once loaded');
});

test('browse cache still keeps a page-sized result for its TTL', async () => {
  browseCache.clear();
  let loads = 0;
  const loader = async () => { loads++; return Array.from({ length: 100 }, (_, index) => ({ id: index })); };
  await cachedBrowseRows('page:1', loader);
  await cachedBrowseRows('page:1', loader);
  assert.equal(loads, 1);
  assert.equal(browseCache.has('page:1'), true);
});

test('browse cache drops expired entries (and their rows) on the next miss and stays within 400 keys', async () => {
  browseCache.clear();
  await cachedBrowseRows('stale', async () => [{ id: 1 }]);
  browseCache.get('stale').expiresAt = Date.now() - 1;
  await cachedBrowseRows('fresh', async () => [{ id: 2 }]);
  assert.equal(browseCache.has('stale'), false, 'an expired entry no longer pins its rows');
  assert.equal(browseCache.has('fresh'), true);
  for (let index = 0; index < 450; index++) await cachedBrowseRows(`bulk:${index}`, async () => [index]);
  assert.ok(browseCache.size <= 400);
});

test('browse cache forgets a failed load so the next call retries', async () => {
  browseCache.clear();
  await assert.rejects(cachedBrowseRows('broken', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(browseCache.has('broken'), false);
  assert.deepEqual(await cachedBrowseRows('broken', async () => [1]), [1]);
});

test('browse cache also stays within a byte budget, dropping the oldest results first', async () => {
  browseCache.clear();
  for (const key of ['page:a', 'page:b', 'page:c']) await cachedBrowseRows(key, async () => ({ cards: [{ blob: 'x'.repeat(10 * 1024 * 1024) }] }));
  assert.equal(browseCache.has('page:a'), false, 'the oldest result is dropped once the budget is exceeded');
  assert.equal(browseCache.has('page:c'), true, 'the newest result is kept');
  browseCache.clear();
});
