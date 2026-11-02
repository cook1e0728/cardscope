import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../price-timeline.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const { PriceTimeline: T } = sandbox.window;
const plain = value => JSON.parse(JSON.stringify(value));
const pt = (date, amountTwd) => ({ date, amount: amountTwd / 36, amountTwd });
const line = (over = {}) => ({ cardId: 'c', region: 'US', provider: 'cardmarket', variant: 'normal', currency: 'EUR', points: [pt('2026-10-16', 3263), pt('2026-10-19', 3038), pt('2026-10-20', 2917)], ...over });

test('days without a record hold the previous price and say so', () => {
  const [one] = T.model({ series: [line()] }, {});
  assert.deepEqual(plain(one.days.map(d => d.twd)), [3263, 3263, 3263, 3038, 2917]);
  assert.deepEqual(plain(one.days.map(d => d.fresh)), [true, false, false, true, true]);
});

test('a live price newer than the last snapshot joins the line; an older one does not', () => {
  const live = observedAt => ({ records: [{ priceType: 'market', market: 'Cardmarket', variant: 'normal', cardId: 'c', amount: 50, priceTwd: 1800, observedAt }] });
  assert.equal(T.model({ series: [line()] }, live('2026-10-22T01:00:00Z'))[0].days.at(-1).twd, 1800);
  assert.equal(T.model({ series: [line()] }, live('2026-10-10T01:00:00Z'))[0].days.at(-1).twd, 2917);
});

test('identical versions become one choice, different ones stay apart, stopped sources drop out', () => {
  const lines = T.model({ series: [line(), line({ variant: 'reverse' }), line({ variant: 'holo', points: [pt('2026-10-16', 900), pt('2026-10-20', 800)] }), line({ provider: 'tcgplayer', currency: 'USD', points: [pt('2026-10-01', 7000), pt('2026-10-02', 7100)] })] }, {}, {});
  assert.deepEqual(plain(lines.map(l => l.label)), ['normal／reverse', 'holo']);
});

test('a tiny lowest price is not shown or compared; a real gap is flagged', () => {
  const market = amount => ({ records: [{ priceType: 'listing', market: 'Cardmarket', variant: 'normal', cardId: 'c', amount, priceTwd: Math.round(amount * 36) }] });
  const tiny = T.model({ series: [line()] }, market(0.02))[0];
  assert.equal(tiny.low, null);
  assert.equal(tiny.gap, 0);
  const real = T.model({ series: [line()] }, market(20))[0];
  assert.equal(real.low, 720);
  assert.equal(real.gap, 4);
});

test('compare text and highlights are plain and correct', () => {
  const [one] = T.model({ series: [line()] }, {});
  assert.equal(T.compareText(one.days[0], one.days[4]).text, '比 10-16 便宜 NT$ 346（↓ 11%）');
  assert.equal(T.compareText(one.days[0], one.days[0]).text, '這是 10-16 的起點');
  assert.equal(T.compareText(one.days[1], one.days[2]).tone, 'flat');
  assert.deepEqual(plain(T.highlights(one.days, 0).map(h => h.index)), [3, 0, 4]);
  assert.deepEqual(plain(T.highlights([{ time: 0, twd: 5 }, { time: 864e5, twd: 5 }], 0)), []);
  assert.equal(T.rangeOptions(5).length, 0);
  assert.deepEqual(plain(T.rangeOptions(14).map(r => r.days)), [7, 0]);
});

test('no usable points means no lines, and the code never writes unescaped labels', () => {
  assert.equal(T.model({ series: [{ ...line(), points: [{ date: 'x', amountTwd: null }] }] }, {}).length, 0);
  assert.match(source, /\$\{esc\(item\.label\)\}/);
  assert.doesNotMatch(source, /\son[a-z]+=/);
});

test('chart text helpers show the full date, Taipei time and ticks at both ends', () => {
  assert.equal(T.dayText(Date.UTC(2026, 9, 30)), '2026-10-30（五）');
  assert.equal(T.sourceTime('2026-10-29T22:54:33Z'), '10-30 06:54');
  assert.equal(T.sourceTime(null), '');
  assert.deepEqual(plain(T.dateTicks(0, 10, 3)), [0, 5, 10]);
  assert.deepEqual(plain(T.dateTicks(0, 1, 5)), [0, 1]);
});

test('events: in range can be jumped to, later ones are upcoming, others and non-https links drop out', () => {
  const [one] = T.model({ series: [line()] }, {});
  const url = 'https://example.com/a';
  const items = T.eventsIn([{ date: '2026-10-19', url }, { date: '2026-11-06', url }, { date: '2026-10-01', url }, { date: '2026-10-20', url: 'javascript:alert(1)' }], one.days, 0);
  assert.deepEqual(plain(items.map(item => [item.date, item.index])), [['2026-10-19', 3], ['2026-11-06', -1]]);
  assert.equal(T.eventsIn([{ date: '2026-10-16', url }], one.days, 2).length, 0);
});

test('a live price uses its Taipei date', () => {
  const market = { records: [{ priceType: 'market', market: 'Cardmarket', variant: 'normal', cardId: 'c', amount: 50, priceTwd: 1800, observedAt: '2026-10-29T22:54:33Z' }] };
  assert.equal(T.dayText(T.model({ series: [line()] }, market)[0].days.at(-1).time), '2026-10-30（五）');
});

test('current price compares with the 30-day average in plain words', () => {
  assert.equal(T.versusAverage(100, null), '');
  assert.equal(T.versusAverage(102, 100), '和近 30 天平均差不多');
  assert.match(T.versusAverage(161, 100), /貴 61%/);
  assert.equal(T.versusAverage(80, 100), '比近 30 天平均便宜 20%');
  const market = { records: [{ priceType: 'market', market: 'Cardmarket', variant: 'normal', cardId: 'c', amount: 50, priceTwd: 1800, avg7: 40, avg30: 0.01, observedAt: '2026-10-22T01:00:00Z' }] };
  const [one] = T.model({ series: [line()] }, market);
  assert.equal(one.avg7, 1440);
  assert.equal(one.avg30, null);
});

test('the entrance sweep stays short; pressing play is slower but bounded', () => {
  assert.equal(T.sweepMs(5, true), 700);
  assert.equal(T.sweepMs(180, true), 1600);
  assert.equal(T.sweepMs(2, false), 1800);
  assert.equal(T.sweepMs(18, false), 4320);
  assert.equal(T.sweepMs(180, false), 6000);
});

const day = (date, twd) => ({ time: Date.parse(`${date}T00:00:00Z`), twd });

test('weekly bars start on Monday and monthly bars on the 1st; open, high, low and close come from the days', () => {
  const days = [day('2026-10-17', 10), day('2026-10-18', 8), day('2026-10-19', 9), day('2026-10-20', 30), day('2026-11-01', 20)];
  const weeks = plain(T.periodBars(days, 'week'));
  assert.deepEqual(weeks.map(b => b.key), ['2026-10-12', '2026-10-19', '2026-10-26']);
  assert.deepEqual([weeks[0].open, weeks[0].high, weeks[0].low, weeks[0].close], [10, 10, 8, 8]);
  assert.deepEqual(plain(T.periodBars(days, 'month').map(b => [b.key, b.close])), [['2026-10', 30], ['2026-11', 20]]);
});

test('the moving average stays empty until it has enough days', () => {
  assert.deepEqual(plain(T.movingAverage([10, 20, 30, 40].map(twd => ({ twd })), 3)), [null, null, 20, 30]);
});

test('only a threefold move between two records raises the thin-trading warning, and the largest one wins', () => {
  const points = values => values.map((twd, i) => ({ time: i, twd }));
  assert.equal(T.biggestJump(points([100, 200, 299])), null);
  assert.deepEqual(plain(T.biggestJump(points([100, 400, 90, 80]))), { ratio: 400 / 90, time: 2, from: 400, to: 90 });
});

test('price records read newest first and state the change from the previous record', () => {
  const rows = plain(T.recordRows([{ time: Date.UTC(2026, 9, 16), twd: 100, amount: 2.5 }, { time: Date.UTC(2026, 9, 20), twd: 50, amount: 1.25, observedAt: '2026-10-19T22:54:00Z' }], 'EUR'));
  assert.deepEqual(rows.map(r => r.original), ['€1.25', '€2.50']);
  assert.equal(rows[0].change, '−NT$ 50（−50%）');
  assert.equal(rows[0].observed, '10-20 06:54');
  assert.equal(rows[1].change, '第一筆');
});

test('a platform that stopped updating is listed apart and named in the conclusion', () => {
  const summary = plain(T.platformSummary({ series: [line(), line({ provider: 'tcgplayer', variant: 'holo', currency: 'USD', points: [pt('2026-10-01', 7000)] })] }, { variantLabel: v => v }));
  assert.deepEqual(summary.recent.map(r => r.market), ['Cardmarket']);
  assert.deepEqual(summary.stale.map(r => r.label), ['holo']);
  assert.equal(summary.text, '目前只有 Cardmarket 是近期價格，TCGplayer 停在 10-01，不能直接比。');
  assert.equal(plain(T.platformSummary({ series: [line({ variant: '' })] })).recent[0].label, '版本未標示');
});

test('search links encode the card name', () => {
  assert.equal(T.searchUrl('cardmarket', 'Mr. Mime & Co'), 'https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=Mr.%20Mime%20%26%20Co');
  assert.match(T.searchUrl('tcgplayer', 'Espeon'), /^https:\/\/www\.tcgplayer\.com\/search\/pokemon\/product\?q=Espeon$/);
});

test('the platform comparison uses the live price, the same as the chart', () => {
  const market = { records: [{ priceType: 'market', market: 'Cardmarket', variant: '', amount: 3, priceTwd: 90, observedAt: '2026-10-20T00:00:00Z' }] };
  const summary = plain(T.platformSummary({ series: [line({ variant: '', points: [pt('2026-10-01', 70)] })] }, { market }));
  assert.equal(summary.recent[0].twd, 'NT$ 90');
  assert.equal(summary.recent[0].original, '€3.00');
});

test('the graded link searches eBay sold listings for the card and number', () => {
  assert.equal(T.gradedSearchUrl('Espeon', '48'), 'https://www.ebay.com/sch/i.html?_nkw=Espeon%2048%20PSA%2010&LH_Sold=1&LH_Complete=1');
  assert.match(T.gradedSearchUrl('Espeon', ''), /_nkw=Espeon%20PSA%2010&/);
});
