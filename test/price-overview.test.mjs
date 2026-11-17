import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// P5「各平台價格」總覽（price-timeline.js 的 overviewMarkup 與 ui-enhancements.js 的接線）。
const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('../price-timeline.js', import.meta.url), 'utf8'), sandbox);
const T = sandbox.window.PriceTimeline;
const ui = await readFile(new URL('../ui-enhancements.js', import.meta.url), 'utf8');
const T0 = Date.UTC(2026, 10, 10);
const platforms = {
  text: 'Cardmarket 和 TCGplayer 都有近期價格，但市場不同，只能當參考。',
  recent: [
    { provider: 'cardmarket', market: 'Cardmarket', label: '歐版 · 普通版', twd: 'NT$ 120', original: '€3.50', time: T0, url: 'https://www.cardmarket.com/en/Pokemon/Products/Singles/x' },
    { provider: 'tcgplayer', market: 'TCGplayer', label: '美版 · Holofoil', twd: 'NT$ 150', original: 'US$4.80', time: T0, url: null }
  ],
  stale: []
};
const card = { nameJa: 'ピカチュウex', officialCardNumber: '025/165' };
const plain = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the table names each price nature with NT$, original currency and update date', () => {
  const html = T.overviewMarkup({ platforms, ebay: 'yes', graded: 'yes', card, searchName: 'Pikachu ex' });
  assert.match(html, /<h4 id="pov-title">各平台價格<\/h4>/);
  assert.match(html, /<b>Cardmarket 參考價<\/b> 歐版 · 普通版/);
  assert.match(html, /<b>TCGplayer 市價<\/b> 美版 · Holofoil/);
  assert.match(html, /<b>NT\$ 120<\/b><br><small>€3\.50・11-10 更新<\/small><\/td>/);
  assert.match(html, /href="https:\/\/www\.cardmarket\.com\/en\/Pokemon\/Products\/Singles\/x"/);
  assert.match(html, /到 TCGplayer 搜尋這張/, 'a row without a product page falls back to search');
  assert.equal(html.match(/<table/g).length, 1, 'one table only');
});

test('the other sources come after the table in the order eBay listings, eBay graded sales, SNKRDUNK, with presence and a jump only', () => {
  const html = T.overviewMarkup({ platforms, ebay: 'yes', graded: 'no', card });
  const order = ['eBay 現售掛牌', 'eBay 鑑定卡成交價', 'SNKRDUNK'].map(name => html.indexOf(`<span class="pov-name">${name}</span>`));
  assert.ok(order[0] > html.indexOf('</table>') && order[0] < order[1] && order[1] < order[2], order.join());
  assert.match(html, /<b class="pov-state pov-yes">有<\/b><a class="pov-jump" href="#ebay-listings" data-jump="ebay-listings">看掛牌<\/a>/);
  assert.match(html, /<b class="pov-state pov-no">沒有<\/b><a class="pov-jump" href="#graded-prices" data-jump="graded-prices">看成交<\/a>/);
  assert.match(html, /href="https:\/\/snkrdunk\.com\/search\?keywords=[^"]+" target="_blank" rel="noopener noreferrer">到 SNKRDUNK 查看/);
  const rows = html.slice(html.indexOf('<ul class="pov-list">'));
  assert.doesNotMatch(plain(rows), /US\$|NT\$|\d{2,}/, 'no eBay price or count is copied into the overview');
});

test('cards without Cardmarket or TCGplayer data say so and still list the other sources', () => {
  const html = T.overviewMarkup({ platforms: { text: '', recent: [], stale: [] }, ebay: 'no', graded: 'no', card });
  assert.match(html, /沒有參考價/);
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /eBay 現售掛牌[\s\S]*eBay 鑑定卡成交價[\s\S]*SNKRDUNK/);
});

test('loading, unreadable and only-stale states are told apart', () => {
  assert.match(T.overviewMarkup({ card }), /正在讀取價格紀錄[\s\S]*讀取中…[\s\S]*讀取中…/);
  assert.doesNotMatch(T.overviewMarkup({ card }), /pov-jump" href="#/, 'no jump while a section is still loading');
  assert.match(T.overviewMarkup({ platforms: null, ebay: 'error', graded: 'error', card }), /暫時讀不到價格紀錄[\s\S]*<b class="pov-state pov-no">查不到<\/b><a class="pov-jump" href="#ebay-listings"/);
  const old = { text: '', recent: [], stale: [{ provider: 'tcgplayer', market: 'TCGplayer', label: '美版', twd: 'NT$ 90', original: 'US$2.80', time: T0 - 40 * 86400000, url: null }] };
  const html = T.overviewMarkup({ platforms: old, ebay: 'na', graded: 'no', card, searchName: 'Pikachu' });
  assert.match(html, /沒有近期參考價[\s\S]*過期的舊紀錄[\s\S]*TCGplayer 美版：NT\$ 90/);
  assert.match(html, /<b class="pov-state pov-no">不查詢<\/b><\/li>/, 'an unqueryable eBay row has no jump');
});

test('a card with no name has no SNKRDUNK link and the overview escapes every text', () => {
  const html = T.overviewMarkup({ platforms: { text: '<i>x</i>', recent: [{ provider: 'cardmarket', market: 'Cardmarket', label: '<script>1</script>', twd: 'NT$ 1', original: '', time: T0, url: 'https://evil.example/"onmouseover="x' }], stale: [] }, ebay: 'yes', graded: 'yes', card: {} });
  assert.doesNotMatch(html, /<script|<i>/);
  assert.match(html, /<span class="pov-name">SNKRDUNK<\/span><b class="pov-state pov-no">沒有<\/b>/);
  assert.doesNotMatch(html, /\son\w+=|style=/i);
  for (const link of html.match(/<a [^>]*href="https[^>]*>/g)) assert.match(link, /target="_blank" rel="noopener noreferrer"/);
});

test('ebayState and gradedState fold each section outcome into presence', () => {
  assert.equal(T.ebayState({ status: 'ok', items: [{ title: 'x', itemWebUrl: 'https://www.ebay.com/itm/1', price: { value: '1', currency: 'USD' } }] }), 'yes');
  assert.equal(T.ebayState({ status: 'ok', items: [] }), 'no');
  assert.equal(T.ebayState({ status: 'no-match' }), 'no');
  assert.equal(T.ebayState({ status: 'limited' }), 'error');
  assert.equal(T.gradedState({ status: 'ok' }), 'yes');
  assert.equal(T.gradedState({ status: 'no-sales' }), 'no');
  assert.equal(T.gradedState({ status: 'not-configured' }), 'no');
  assert.equal(T.gradedState({ status: 'daily-limit' }), 'error');
});

test('loadEbay and loadGraded report their outcome through onState', async () => {
  const slot = () => ({ dataset: {}, innerHTML: '', isConnected: true }), ok = data => async () => ({ ok: true, status: 200, json: async () => ({ data }) });
  const seen = async run => { const out = []; await run(state => out.push(state)); return out; };
  const pika = { nameEn: 'Pikachu', officialCardNumber: '25' };
  assert.deepEqual(await seen(onState => T.loadEbay(slot(), { card: pika, fetchFn: ok({ status: 'no-match' }), onState })), ['no']);
  assert.deepEqual(await seen(onState => T.loadEbay(slot(), { card: pika, fetchFn: async () => { throw new Error('x'); }, onState })), ['error']);
  assert.deepEqual(await seen(onState => T.loadEbay(slot(), { card: pika, fetchFn: async () => ({ ok: false, status: 400 }), onState })), ['na']);
  assert.deepEqual(await seen(onState => T.loadEbay(slot(), { card: { nameEn: 'Luffy' }, fetchFn: ok({}), onState })), ['na'], 'unqueryable card');
  const jp = { nameJa: 'リザードンex', printings: [{ region: 'JP', localSetCode: 'SV2a', localCardNumber: '201' }] };
  assert.deepEqual(await seen(onState => T.loadGraded(slot(), { card: jp, market: { records: [] }, fetchFn: ok({ status: 'no-sales' }), onState })), ['no']);
  assert.deepEqual(await seen(onState => T.loadGraded(slot(), { card: jp, market: { records: [] }, fetchFn: async () => ({ ok: false }), onState })), ['error']);
  assert.deepEqual(await seen(onState => T.loadGraded(slot(), { card: { nameEn: 'Luffy', printings: [] }, market: { records: [] }, fetchFn: ok({}), onState })), ['no'], 'no graded query');
});

test('load reports the platform summary to the overview, including unreadable and empty histories', async () => {
  const run = async fetchFn => { const got = [], slot = { dataset: { priceTrend: 'c1' }, innerHTML: '', isConnected: true }; await T.load(slot, { fetchFn, onPlatforms: payload => got.push(payload) }); return got; };
  assert.deepEqual(JSON.parse(JSON.stringify(await run(async () => ({ ok: false })))), [{ platforms: null }]);
  const empty = await run(async () => ({ ok: true, json: async () => ({ series: [], meta: {} }) }));
  assert.equal(empty.length, 1);
  assert.equal(empty[0].platforms.recent.length, 0);
});

test('the side panel puts the overview on top, with anchored sections and no second comparison table', () => {
  const body = ui.slice(ui.indexOf('body.innerHTML=`<div class="price-overview"'), ui.indexOf('body.innerHTML=`<div class="price-overview"') + 400);
  assert.ok(body.indexOf('data-price-overview') >= 0 && body.indexOf('data-price-overview') < body.indexOf('dpanel-trend'));
  assert.match(body, /id="graded-prices" data-graded-prices/);
  assert.match(ui, /ebay\.id='ebay-listings'/);
  assert.match(ui, /onPlatforms:paint/);
  assert.match(ui, /loadGraded\?\.\(.*\{market,card,onState:onGraded\}\)/);
  assert.doesNotMatch(T.platformsBlock({ text: 't', recent: platforms.recent, stale: [] }, ''), /各平台比價/);
});
