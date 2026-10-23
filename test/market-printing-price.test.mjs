import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { matchYgoprodeckSet } from '../providers/ygoprodeck.mjs';

// Market data names the printing it belongs to; Yu-Gi-Oh! shows only a per-printing set price; collection totals skip prices older than 7 days.

const [html, ui, storeSource] = await Promise.all(['../index.html', '../ui-enhancements.js', '../collection-store.js'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const slice = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to));

const set = (setCode, rarity, rarityCode, price) => ({ setName: 'S', setCode, rarity, rarityCode, setPriceUsd: price });
const sets = [set('LOB-EN001', 'Ultra Rare', '(UR)', 12.34), set('LOB-EN001', 'Secret Rare', '(ScR)', 45), set('LOB-EN002', 'Common', '(C)', null), set('SDK-001', 'Ultra Rare', '(UR)', 3), set('LOB-JP001', 'Ultra Rare', '(UR)', 9.99)];

test('YGOPRODeck set price: exact set code + rarity (name or code), never a guess', () => {
  assert.equal(matchYgoprodeckSet(sets, { number: 'LOB-EN001', rarity: 'Ultra Rare' }).setPriceUsd, 12.34);
  assert.equal(matchYgoprodeckSet(sets, { number: 'lob-en001', rarity: 'UR' }).setPriceUsd, 12.34, 'code case and rarity abbreviation are folded');
  assert.equal(matchYgoprodeckSet(sets, { number: 'LOB-EN001', rarity: 'Secret Rare' }).setPriceUsd, 45);
  assert.equal(matchYgoprodeckSet(sets, { number: 'LOB-EN001', rarity: 'Common' }), null, 'rarity YGOPRODeck does not list for that code');
  assert.equal(matchYgoprodeckSet(sets, { number: 'LOB-EN001' }), null, 'unknown rarity with two listed rarities: ambiguous');
  assert.equal(matchYgoprodeckSet(sets, { number: 'SDK-001' }).setPriceUsd, 3, 'unknown rarity is fine when the code has one entry');
  assert.equal(matchYgoprodeckSet(sets, { number: 'LOB-EN002', rarity: 'Common' }), null, 'no price (0 in the source) means none');
  assert.equal(matchYgoprodeckSet(sets, { number: 'QCCU-JP002', rarity: 'QCSE' }), null);
  assert.equal(matchYgoprodeckSet(sets, { number: '', rarity: 'UR' }), null);
  assert.equal(matchYgoprodeckSet(undefined, { number: 'LOB-EN001' }), null);
  assert.equal(matchYgoprodeckSet([set('A-1', 'Rare', '(R)', 1), set('A-1', 'Rare', '(R)', 2)], { number: 'A-1', rarity: 'Rare' }), null, 'same code and rarity with different prices: not guessed');
});

test('market rows name the printing they belong to, and an empty list says there is no price for this version', () => {
  const context = vm.createContext({ e: escapeHtml, rn: region => ({ JP: '日版', US: '美版' }[region] || region), ln: language => language });
  vm.runInContext(slice(html, 'const MARKET_VARIANTS=', 'async function openCard'), context);
  const meta = { priceTypes: { market: '平台參考價' }, exchangeRates: { source: 'ExchangeRate-API', updatedAt: '2026-10-23' } };
  const base = { priceType: 'market', currency: 'USD', amount: 12.34, priceTwd: 400, observedAt: '2026-10-23T00:00:00.000Z' };
  const out = context.marketBlock({ meta, records: [
    { ...base, provider: 'ygoprodeck', market: 'YGOPRODeck', region: 'US', setCode: 'LOB-EN001', rarity: 'Ultra Rare', scope: 'printing-set-price' },
    { ...base, provider: 'tcgdex', market: 'Cardmarket', currency: 'EUR', region: 'JP', language: 'ja-JP', variant: 'holo', sourceUrl: 'https://api.tcgdex.net/v2/ja/cards/SV6a-039' },
    { ...base, provider: 'tcgdex', market: 'Cardmarket', language: 'en-US' },
    { ...base, provider: 'x', market: 'X' }
  ] });
  assert.match(out, /來源：YGOPRODeck[^]*對應版本：美版（LOB-EN001 Ultra Rare）/);
  assert.match(out, /此版本（YGOPRODeck set price）/);
  assert.doesNotMatch(out, /跨版本最低/);
  assert.match(out, /來源：Cardmarket[^]*對應版本：日版/);
  assert.match(out, /對應版本：en-US/, 'no region: the language stands in');
  assert.match(out, /對應版本：未標示/, 'neither: said so, not guessed');
  assert.match(out, /YGOPRODeck 參考價為美元計價、來源平台未標示，不是成交價/);
  assert.doesNotMatch(out, /TCGplayer/, 'only the sources present are named');
  assert.match(context.marketBlock({ meta, records: [] }), /目前沒有這個版本的可靠價格/);
});

test('collection rows: a price older than 7 days is shown as 已過期 and left out of the total', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(storeSource, context);
  const CS = context.window.CollectionStore;
  const items = [{ id: 'fresh', quantity: 2, condition: '', finish: '' }, { id: 'old', quantity: 1, condition: '', finish: '' }, { id: 'mixed', quantity: 1, condition: '', finish: '' }];
  const price = (provider, snapshotDate, amountTwd, extra = {}) => ({ provider, variant: '', currency: provider === 'cardmarket' ? 'EUR' : 'USD', amount: 1, amountTwd, snapshotDate, ...extra });
  const sandbox = vm.createContext({ CS, e: escapeHtml, watchlistMeta: {}, collectionItems: () => items,
    collectionUi: { pricesState: 'ready', prices: { fresh: [price('cardmarket', '2026-10-22', 100)], old: [price('cardmarket', '2026-10-01', 500, { stale: true })], mixed: [price('cardmarket', '2026-10-22', 50), price('tcgplayer', '2026-10-01', 900, { stale: true })] } },
    COLLECTION_REASONS: { none: '尚無參考價快照' } });
  vm.runInContext(slice(ui, 'function collectionValuation', 'function valueHtml'), sandbox);
  const valuation = sandbox.collectionValuation();
  assert.equal(valuation.byProvider.cardmarket.twd, 100 * 2 + 50, 'stale rows are not summed');
  assert.equal(valuation.byProvider.tcgplayer, undefined);
  assert.equal(valuation.counted, 2);
  assert.deepEqual([...valuation.uncounted.map(x => x.id)], ['old']);
  const row = id => sandbox.rowPriceHtml(items.find(item => item.id === id), valuation);
  assert.match(row('old'), /未計入：參考價已過期（超過 7 天）[^]*2026-10-01 · <b>已過期<\/b>，不計入/, 'only a stale price: not counted, and the date and 已過期 are shown');
  assert.match(row('fresh'), /2026-10-22/);
  assert.doesNotMatch(row('fresh'), /已過期/);
  assert.match(row('mixed'), /Cardmarket 參考價[^]*2026-10-22[^]*TCGplayer 參考價[^]*2026-10-01 · <b>已過期<\/b>/, 'fresh counted, stale listed beside it');
});
