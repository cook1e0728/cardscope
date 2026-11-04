import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheYugiohImages } from '../providers/image-cache.mjs';

// 美版快取圖只能寫到 YGOPRODeck 的版本：日版版本（yugioh-neuron）有自己的官方圖，不能被蓋掉
async function run(db) {
  const saved = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'test-key';
  globalThis.fetch = async url => String(url).startsWith('https://images.ygoprodeck.com/')
    ? new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    : new Response('{}', { status: 200 });
  try { return await cacheYugiohImages(db, { concurrency: 1 }); } finally {
    globalThis.fetch = saved.fetch;
    for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_SERVICE_KEY', saved.key]]) value === undefined ? delete process.env[name] : (process.env[name] = value);
  }
}
const mockDb = ({ cached = [], missing = [] }) => {
  const patches = [];
  const db = async (path, options = {}) => {
    if (options.method === 'PATCH') { patches.push(decodeURIComponent(path)); return null; }
    if (options.method) return null;
    if (path.startsWith('/tcg_cards')) return [{ id: 'yugioh-ygoprodeck-1', provider_id: '1' }];
    if (path.startsWith('/card_images')) return cached;
    if (path.startsWith('/tcg_printings')) return missing;
    return [];
  };
  return { db, patches };
};

test('新快取美版圖時只更新 YGOPRODeck 的版本，不碰日版版本', async () => {
  const { db, patches } = mockDb({});
  const stats = await run(db);
  assert.equal(stats.written, 1);
  assert.deepEqual(patches, ['/tcg_printings?card_id=eq.yugioh-ygoprodeck-1&source=eq.ygoprodeck']);
});

test('還原已快取的美版圖時只更新 YGOPRODeck 的版本，不碰日版版本', async () => {
  const { db, patches } = mockDb({ cached: [{ card_id: 'yugioh-ygoprodeck-1', image_url: 'https://example.supabase.co/x.jpg' }], missing: [{ card_id: 'yugioh-ygoprodeck-1' }] });
  const stats = await run(db);
  assert.equal(stats.written, 1);
  assert.deepEqual(patches, ['/tcg_printings?card_id=eq.yugioh-ygoprodeck-1&source=eq.ygoprodeck']);
});
