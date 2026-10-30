import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { catalogEventsFrom, marketEventsFor, mergeMarketEvents } from '../providers/market-events.mjs';
import { parseTcgdexPricing } from '../providers/tcgdex-pricing.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const row = over => ({ game_id: 'yugioh', region: 'US', release_date: '2026-11-12', name_en: '遊戲王系列｜Magnificent Maestros', source_url: 'https://ygoprodeck.com/api-guide/', ...over });

test('catalog rows become events with their source; rows without a date, name or https source drop out', () => {
  assert.deepEqual(catalogEventsFrom([row()]), [{ date: '2026-11-12', game: 'yugioh', title: '美版 新系列發售：Magnificent Maestros', source: 'ygoprodeck.com', url: 'https://ygoprodeck.com/api-guide/' }]);
  for (const bad of [{ release_date: null }, { name_en: '' }, { source_url: 'http://x.test/' }, { source_url: 'javascript:alert(1)' }, { source_url: null }]) assert.equal(catalogEventsFrom([row(bad)]).length, 0);
});

test('events merge without duplicates in date order, and manual events filter by game and window', () => {
  const a = { game: 'g', date: '2026-10-02', title: 'a' }, b = { game: 'g', date: '2026-10-01', title: 'b' };
  assert.deepEqual(mergeMarketEvents([a, b], [a]), [b, a]);
  const now = Date.UTC(2026, 9, 30);
  assert.equal(marketEventsFor('pokemon', '2026-10-01', now).length, 2);
  assert.equal(marketEventsFor(null, '2026-10-25', now).length, 1);
  assert.equal(marketEventsFor('yugioh', '2026-10-01', now).length, 0);
  assert.equal(marketEventsFor('pokemon', '2026-10-01', Date.UTC(2026, 8, 1)).length, 0);
});

test('home list puts upcoming first, then newest past, up to the limit', async () => {
  const sandbox = { window: {} };
  vm.runInNewContext(await readFile(new URL('../market-events.js', import.meta.url), 'utf8'), sandbox);
  const dates = list => plain(list.map(event => event.date));
  const events = ['2026-10-01', '2026-11-06', '2026-10-24', '2026-11-01'].map(date => ({ date }));
  assert.deepEqual(dates(sandbox.window.MarketEvents.arrange(events, '2026-10-30')), ['2026-11-01', '2026-11-06', '2026-10-24', '2026-10-01']);
  assert.equal(sandbox.window.MarketEvents.arrange(events, '2026-10-30', 2).length, 2);
});

test('Cardmarket averages ride only on the market record', () => {
  const records = parseTcgdexPricing({ id: 'x-1', pricing: { cardmarket: { updated: '2026-10-30T10:00:00Z', unit: 'EUR', trend: 114, low: 18, avg1: 31, avg7: 70.45, avg30: 70.95 } } }, 'x-1', { language: 'en' });
  const market = records.find(r => r.priceType === 'market'), listing = records.find(r => r.priceType === 'listing');
  assert.equal(market.avg30, 70.95);
  assert.equal(market.avg7, 70.45);
  assert.equal(market.avg1, undefined);
  assert.equal(listing.avg30, undefined);
});
