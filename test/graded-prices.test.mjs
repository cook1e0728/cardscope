import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { gradedQuery, pickGradedCard, summarizeGrades, gradeLabel, createGradedPrices } from '../providers/graded-prices.mjs';

const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('../price-timeline.js', import.meta.url), 'utf8'), sandbox);
const { PriceTimeline: T } = sandbox.window;

const grade = (count, median) => ({ count, medianPrice: median, minPrice: median / 2, maxPrice: median * 2, lastSaleDate: '2026-11-02T04:30:05.000Z', smartMarketPrice: { price: median, confidence: 'medium' } });
const jpCard = { name: 'Charizard ex - 201/165', setName: 'SV2a: Pokemon Card 151', cardNumber: '201/165', ebay: { salesByGrade: { psa10: grade(702, 574), psa9: grade(127, 335), psa1: grade(1, 5) } } };

test('graded query only accepts exact identifiers', () => {
  assert.deepEqual(gradedQuery({ tcgPlayerId: '517045' }).params, { tcgPlayerId: '517045' });
  assert.deepEqual(gradedQuery({ set: 'SV2a', number: '201' }).params, { language: 'japanese', set: 'SV2a', search: '201' });
  assert.equal(gradedQuery({ set: 'SV2a' }), null);
  assert.equal(gradedQuery({ tcgPlayerId: 'abc', set: 'a b', number: '1' }), null);
});

test('japanese match needs one result with the same set code and number', () => {
  const q = gradedQuery({ set: 'sv2a', number: '201' });
  assert.equal(pickGradedCard({ data: [jpCard], metadata: { total: 1 } }, q), jpCard);
  assert.equal(pickGradedCard({ data: [jpCard], metadata: { total: 3 } }, q), null);
  assert.equal(pickGradedCard({ data: [{ ...jpCard, setName: 'SV4a: Shiny Treasure ex' }], metadata: { total: 1 } }, q), null);
  assert.equal(pickGradedCard({ data: [jpCard], metadata: { total: 1 } }, gradedQuery({ set: 'SV2a', number: '20' })), null);
  assert.equal(pickGradedCard({ data: [{ ...jpCard, cardNumber: '009/165' }], metadata: { total: 1 } }, gradedQuery({ set: 'SV2a', number: '009' })).cardNumber, '009/165');
  const en = gradedQuery({ tcgPlayerId: '517045' });
  assert.equal(pickGradedCard({ data: { tcgPlayerId: 517045 } }, en).tcgPlayerId, 517045);
  assert.equal(pickGradedCard({ data: { tcgPlayerId: 1 } }, en), null);
});

test('grades are summarized in a fixed order with TWD', () => {
  assert.equal(gradeLabel('bgs9_5'), 'BGS 9.5');
  const rows = summarizeGrades(jpCard, 32);
  assert.deepEqual(rows.map(row => row.grade), ['PSA 10', 'PSA 9']);
  assert.equal(rows[0].medianTwd, 18368);
  assert.equal(rows[0].count, 702);
});

test('lookup caches, spends at most the daily limit and sends limit=1', async () => {
  const urls = [];
  const fetchFn = async url => { urls.push(url); return { ok: true, json: async () => ({ data: [jpCard], metadata: { total: 1 } }) }; };
  const lookup = createGradedPrices({ apiKey: 'k', fetchFn, dailyLimit: 2, now: () => Date.parse('2026-11-03T00:00:00Z') });
  assert.equal((await lookup({ set: 'SV2a', number: '201' }, 32)).status, 'ok');
  assert.equal((await lookup({ set: 'sv2a', number: '201' }, 32)).status, 'ok');
  assert.equal(urls.length, 1);
  assert.match(urls[0], /limit=1/);
  assert.equal((await lookup({ set: 'SV2a', number: '9' })).status, 'no-match');
  assert.equal((await lookup({ set: 'SV2a', number: '8' })).status, 'daily-limit');
  assert.equal((await createGradedPrices({ apiKey: '', fetchFn })({ tcgPlayerId: '1' })).status, 'not-configured');
});

test('client picks one unambiguous identifier', () => {
  const tp = id => ({ market: 'TCGplayer', idProduct: id });
  assert.equal(T.gradedQuery({}, { records: [tp(5), tp(5), { market: 'Cardmarket', idProduct: 9 }] }), 'tcgPlayerId=5');
  assert.equal(T.gradedQuery({}, { records: [tp(5), tp(6)] }), null);
  const jp = { region: 'JP', localSetCode: 'SV2a', localCardNumber: '201' };
  assert.equal(T.gradedQuery({ printings: [jp, { ...jp }] }, { records: [] }), 'set=SV2a&number=201');
  assert.equal(T.gradedQuery({ printings: [jp, { ...jp, localSetCode: 'SV4a' }] }, null), null);
});

test('client markup labels the source and escapes text', () => {
  const html = T.gradedMarkup({ status: 'ok', name: '<b>x</b>', setName: 'SV2a', grades: summarizeGrades(jpCard, 32) });
  assert.match(html, /第三方彙整，未驗證/);
  assert.match(html, /NT\$18,368/);
  assert.match(T.gradedMarkup({ status: 'ok', name: 'x', grades: [{ grade: 'BGS 10', count: 1, medianUsd: 10000, medianTwd: 1 }] }), /筆數少/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(T.gradedMarkup({ status: 'no-match' }), /不顯示價格/);
  assert.equal(T.gradedMarkup({ status: 'not-configured' }), '');
});
