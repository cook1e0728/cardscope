import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.PORT = '0';
process.env.CATALOG_SYNC_ON_START = 'false';
process.env.CATALOG_WARM_ON_START = 'false';
const { buildPriceMovers, server } = await import('../server.mjs?price-movers');
test.after(async () => {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('price movers split by direction, convert to TWD and skip broken rows', () => {
  const fx = { rates: { EUR: 35 } };
  const row = { direction: 'up', card_id: 'pokemon-a', variant: 'normal', currency: 'EUR', from_date: '2026-10-16', from_amount: '10.00', to_date: '2026-10-29', to_amount: '15.00', change_percent: '50.0', name_zh: null, name_ja: 'ピカチュウ', card_number: '001', series_code: 'SV1', series_name: '系列', image_url: null };
  const body = buildPriceMovers([row, { ...row, direction: 'down', card_id: 'pokemon-b', to_amount: '5.00', change_percent: '-50.0' }, { ...row, card_id: null }], fx, Date.UTC(2026, 9, 30));
  assert.equal(body.data.up.length, 1);
  assert.equal(body.data.down.length, 1);
  assert.equal(body.data.up[0].name, 'ピカチュウ');
  assert.deepEqual(body.data.up[0].from, { date: '2026-10-16', amount: 10, amountTwd: 350 });
  assert.equal(body.data.down[0].to.amountTwd, 175);
  assert.match(body.meta.note, /不是成交價/);
});

test('movers markup uses delegated actions and the migration stays service-role only', async () => {
  const js = await readFile(new URL('../price-movers.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /\son[a-z]+=/);
  assert.match(js, /data-do="openCard"/);
  const sql = await readFile(new URL('../supabase/migrations/20261031090000_price_movers.sql', import.meta.url), 'utf8');
  assert.match(sql, /revoke all on function public\.price_movers\(integer, numeric, integer\) from public, anon, authenticated/);
});

test('cards sharing a Cardmarket product leave the movers and get a note on the detail page', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261031100000_price_product_links.sql', import.meta.url), 'utf8');
  assert.match(sql, /l\.card_id not in \(select public\.price_products_shared\(null\)\)/);
  assert.match(sql, /coalesce\(cb\.canonical_id, cb\.id\) <> coalesce\(ca\.canonical_id, ca\.id\)/, 'the same card under two catalog rows is not a shared product');
  assert.match(sql, /alter table public\.price_product_links enable row level security/);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /meta\.sharedPriceCardIds\?\.length/);
});
