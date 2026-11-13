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

test('a card with only an English name shows that name, not its number', async () => {
  const row = { direction: 'up', card_id: 'pokemon-x', currency: 'EUR', from_date: '2026-10-16', from_amount: '10', to_date: '2026-10-29', to_amount: '30', change_percent: '200', name_zh: null, name_ja: null, name_en: 'Dark Exeggutor', card_number: '33' };
  assert.equal(buildPriceMovers([row], { rates: { EUR: 35 } }).data.up[0].name, 'Dark Exeggutor');
  const sql = await readFile(new URL('../supabase/migrations/20261108090000_price_movers_name_en.sql', import.meta.url), 'utf8');
  assert.match(sql, /image_url text, name_en text\)/);
  assert.match(sql, /grant execute on function public\.price_movers\(integer, numeric, integer\) to service_role/);
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

test('漲跌榜第一次讀取失敗（例如部署後 502）會再試一次；兩次都失敗就清掉，下次再請求', async () => {
  const {default: vm} = await import('node:vm');
  const {readFile} = await import('node:fs/promises');
  const source = await readFile(new URL('../price-movers.js', import.meta.url), 'utf8');
  const replies = [{ok: false, status: 502}, {ok: true, json: async () => ({data: {up: [1], down: []}})}];
  let calls = 0;
  const window = {fetch: async () => replies[Math.min(calls++, replies.length - 1)]};
  vm.runInNewContext(source, {window, fetch: window.fetch, setTimeout: fn => fn()});
  const body = await window.priceMoversShared.request();
  assert.equal(calls, 2);
  assert.deepEqual(body.data.up, [1]);

  calls = 0;
  const failing = {fetch: async () => { calls++; throw new Error('offline'); }};
  vm.runInNewContext(source, {window: failing, fetch: failing.fetch, setTimeout: fn => fn()});
  assert.equal(await failing.priceMoversShared.request(), null);
  assert.equal(calls, 2);
  await failing.priceMoversShared.request();
  assert.equal(calls, 4, '失敗後不留著壞掉的結果，下一次會重新請求');
});
