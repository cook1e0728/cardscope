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
