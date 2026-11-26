import test from 'node:test';
import assert from 'node:assert/strict';
import { ebayQuery, titleHasNumber, normalizeCardNumber, summarizeListing, createEbayListings } from '../providers/ebay-listings.mjs';

const item = (over = {}) => ({
  itemId: 'v1|123|0', title: 'Pokemon Pikachu 025/165 SV2a 151 NM', price: { value: '4.50', currency: 'USD' }, condition: 'Near Mint or Better',
  seller: { username: 'card_shop' }, image: { imageUrl: 'https://i.ebayimg.com/images/g/abc/s-l225.jpg' }, itemWebUrl: 'https://www.ebay.com/itm/123',
  shippingOptions: [{ shippingCost: { value: '1.25', currency: 'USD' } }], ...over
});
const search = items => ({ ok: true, status: 200, json: async () => ({ itemSummaries: items }) });
const tokenOk = (expires = 7200) => ({ ok: true, status: 200, json: async () => ({ access_token: 'T', expires_in: expires }) });
const clock = (iso = '2026-11-17T00:00:00Z') => { let t = Date.parse(iso); const now = () => t; now.add = ms => { t += ms; }; return now; };
function make(overrides = {}, searchItems = [item()]) {
  const calls = [];
  const fetchFn = async (url, opts = {}) => { calls.push({ url: String(url), opts }); return String(url).includes('oauth2') ? tokenOk() : search(searchItems); };
  return { calls, lookup: createEbayListings({ clientId: 'id', clientSecret: 'secret', fetchFn, ...overrides }) };
}

test('query joins name, set and number and rejects unsafe input', () => {
  const q = ebayQuery({ name: 'Pikachu', set: 'SV2a', number: '025/165' });
  assert.equal(q.params.q, 'Pikachu SV2a 025/165');
  assert.equal(q.params.category_ids, '183454');
  assert.equal(q.params.filter, 'buyingOptions:{FIXED_PRICE}');
  assert.equal(ebayQuery({ name: 'Pikachu', number: '25' }).params.q, 'Pikachu 25');
  for (const bad of [{ name: '', number: '1' }, { name: 'Pikachu' }, { name: 'a<b', number: '1' }, { name: 'Pikachu', set: 'a b', number: '1' }, { name: 'Pikachu', number: '1;2' }, { name: 'x'.repeat(61), number: '1' }]) assert.equal(ebayQuery(bad), null);
});

test('the title must contain the card number, with zeros normalized', () => {
  assert.equal(normalizeCardNumber('025/165'), '25/165');
  assert.equal(titleHasNumber('Pikachu 25/165', '025/165'), true);
  assert.equal(titleHasNumber('Pikachu 025/165', '25/165'), true);
  assert.equal(titleHasNumber('Pikachu 025/165', '25'), true);
  assert.equal(titleHasNumber('Pikachu 025/193', '25/165'), false);
  assert.equal(titleHasNumber('Pikachu 25th anniversary', '25'), false);
  assert.equal(titleHasNumber('Pikachu PSA 10', '10'), false);
  assert.equal(titleHasNumber('Pikachu SV025', 'SV025'), true);
  assert.equal(titleHasNumber('Pikachu no number', '25/165'), false);
});

test('listings without the card number are dropped and eBay order is kept', async () => {
  const { lookup } = make({}, [item({ itemId: 'a', title: 'Pikachu 25/165' }), item({ itemId: 'wrong', title: 'Pikachu 58/102' }), item({ itemId: 'b', title: 'Pikachu 025/165 holo' })]);
  const result = await lookup({ name: 'Pikachu', set: 'SV2a', number: '25/165' });
  assert.deepEqual(result.items.map(i => i.itemId), ['a', 'b']);
  assert.equal(result.status, 'ok');
  const none = await make({}, [item({ title: 'Raichu 26/165' })]).lookup({ name: 'Pikachu', number: '25/165' });
  assert.deepEqual([none.status, none.items], ['no-match', []]);
});

test('output keeps only the fields the display needs', async () => {
  const { lookup } = make();
  const [row] = (await lookup({ name: 'Pikachu', set: 'SV2a', number: '25' })).items;
  assert.deepEqual(row, {
    itemId: 'v1|123|0', title: 'Pokemon Pikachu 025/165 SV2a 151 NM', price: { value: '4.50', currency: 'USD' }, shipping: { value: '1.25', currency: 'USD' },
    condition: 'Near Mint or Better', seller: 'card_shop', image: 'https://i.ebayimg.com/images/g/abc/s-l225.jpg', itemWebUrl: 'https://www.ebay.com/itm/123', itemEndDate: null
  });
});

test('links and images outside the eBay allowlist are dropped', () => {
  assert.equal(summarizeListing(item({ itemWebUrl: 'http://www.ebay.com/itm/1' })), null);
  assert.equal(summarizeListing(item({ itemWebUrl: 'https://evil.com/itm/1' })), null);
  assert.equal(summarizeListing(item({ itemWebUrl: 'https://ebay.com.evil.com/itm/1' })), null);
  assert.equal(summarizeListing(item({ itemWebUrl: 'https://user:pw@www.ebay.com/itm/1' })), null);
  assert.equal(summarizeListing(item({ itemWebUrl: 'javascript:alert(1)' })), null);
  assert.equal(summarizeListing(item({ image: { imageUrl: 'https://evil.com/a.jpg' } })).image, null);
  assert.equal(summarizeListing(item({ image: { imageUrl: 'http://i.ebayimg.com/a.jpg' } })).image, null);
  assert.equal(summarizeListing(item({ price: { value: 'abc', currency: 'USD' } })), null);
});

test('missing keys return an empty enabled:false result without calling eBay', async () => {
  const calls = [];
  const lookup = createEbayListings({ clientId: '', clientSecret: '', fetchFn: async url => { calls.push(url); } });
  assert.deepEqual(await lookup({ name: 'Pikachu', number: '25' }), { status: 'not-configured', enabled: false, limited: false, items: [] });
  assert.equal(calls.length, 0);
});

test('daily limit counts searches, resets on the Taipei date, and cache hits are free', async () => {
  const now = clock('2026-11-17T15:00:00Z'); // 23:00 in Taipei
  const { lookup, calls } = make({ dailyLimit: 2, now });
  const ask = n => lookup({ name: `Pikachu${n}`, number: '25' });
  assert.equal((await ask(1)).status, 'ok');
  assert.equal((await ask(1)).status, 'ok');
  assert.equal((await ask(2)).status, 'ok');
  assert.equal(calls.filter(c => c.url.includes('/search')).length, 2);
  const limited = await ask(3);
  assert.deepEqual([limited.status, limited.limited, limited.items], ['limited', true, []]);
  assert.equal((await ask(1)).status, 'ok'); // still cached
  now.add(61 * 60 * 1000); // 00:01 next day in Taipei
  assert.equal((await ask(3)).status, 'ok');
});

test('upstream errors throw a bare status code, never the response body', async () => {
  const fetchFn = async url => String(url).includes('oauth2') ? tokenOk() : { ok: false, status: 500, json: async () => ({ secret: 'LEAK' }), text: async () => 'LEAK' };
  const lookup = createEbayListings({ clientId: 'id', clientSecret: 'secret', fetchFn });
  await assert.rejects(lookup({ name: 'Pikachu', number: '25' }), error => error.message === 'EBAY_SEARCH_500' && !/LEAK/.test(error.message));
  const badToken = createEbayListings({ clientId: 'id', clientSecret: 'secret', fetchFn: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
  await assert.rejects(badToken({ name: 'Pikachu', number: '25' }), /EBAY_TOKEN_401/);
});

test('token is reused until 60 seconds before it expires', async () => {
  const now = clock();
  const { lookup, calls } = make({ now });
  const tokens = () => calls.filter(c => c.url.includes('oauth2')).length;
  await lookup({ name: 'Pikachu', number: '1' });
  await lookup({ name: 'Pikachu', number: '2' });
  assert.equal(tokens(), 1);
  const first = calls.find(c => c.url.includes('/search'));
  assert.equal(first.opts.headers.Authorization, 'Bearer T');
  assert.equal(first.opts.headers['X-EBAY-C-MARKETPLACE-ID'], 'EBAY_US');
  now.add(7200e3 - 59e3);
  await lookup({ name: 'Pikachu', number: '3' });
  assert.equal(tokens(), 2);
});

test('results are cached for an hour and the cache is bounded', async () => {
  const now = clock();
  const { lookup, calls } = make({ now, maxEntries: 2 });
  const searches = () => calls.filter(c => c.url.includes('/search')).length;
  await lookup({ name: 'Pikachu', number: '1' });
  await lookup({ name: 'Pikachu', number: '1' });
  assert.equal(searches(), 1);
  now.add(3600e3 + 1);
  await lookup({ name: 'Pikachu', number: '1' });
  assert.equal(searches(), 2);
  await lookup({ name: 'Pikachu', number: '2' });
  await lookup({ name: 'Pikachu', number: '3' }); // evicts number 1
  await lookup({ name: 'Pikachu', number: '1' });
  assert.equal(searches(), 5);
});

test('graded listings (PSA/BGS/CGC/SGC/ARS + grade) are excluded and eBay order is kept', async () => {
  const { pickListings } = await import('../providers/ebay-listings.mjs');
  const item = (id, title) => ({ itemId: id, title, price: { value: '5.00', currency: 'USD' }, itemWebUrl: 'https://www.ebay.com/itm/' + id });
  const titles = ['Charizard 125/197 NM', 'PSA 10 Charizard 125/197', 'Charizard 125/197 BGS 9.5', 'ARS10 Charizard 125/197', 'Charizard 125/197 LP'];
  const out = pickListings({ itemSummaries: titles.map((t, i) => item(String(i), t)) }, '125/197');
  assert.deepEqual(out.map(x => x.title), ['Charizard 125/197 NM', 'Charizard 125/197 LP']);
});

test('全字母卡號（30th 夢幻 R/RGB）：標題要有 R/RGB，或同時有 #R 與 RGB；其他卡號規則不變', () => {
  assert.ok(ebayQuery({ name: 'Mew', number: 'R/RGB' }));
  assert.equal(ebayQuery({ name: 'Mew', number: 'R' }), null, '只有字母沒有稀有度不查');
  assert.equal(titleHasNumber('Mew R/RGB Expansion Pack 30th Celebration M6a', 'R/RGB'), true);
  assert.equal(titleHasNumber('Mew R / RGB 30th', 'R/RGB'), true);
  assert.equal(titleHasNumber('Mew 2026 Pokemon 30th Celebration RGB RARE #G/RGB', 'G/RGB'), true);
  assert.equal(titleHasNumber('Mew 30th Celebration RGB Rare #B', 'B/RGB'), true);
  assert.equal(titleHasNumber('Mew G/RGB Expansion Pack 30th Celebration', 'R/RGB'), false);
  assert.equal(titleHasNumber('Mew ex 151 R', 'R/RGB'), false);
});
