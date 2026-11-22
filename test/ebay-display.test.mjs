import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// P2 eBay 掛牌顯示、P3 鑑定卡成交區整理（price-timeline.js 的瀏覽器端）。
const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('../price-timeline.js', import.meta.url), 'utf8'), sandbox);
const T = sandbox.window.PriceTimeline;
const item = (n, extra = {}) => ({ itemId: String(n), title: `Pikachu ex ${n}/165 NM`, price: { value: String(n * 10), currency: 'USD' }, shipping: { value: '4.5', currency: 'USD' }, condition: 'Near Mint or Better', seller: `seller_${n}`, image: `https://i.ebayimg.com/images/g/${n}/s-l225.jpg`, itemWebUrl: `https://www.ebay.com/itm/${n}`, itemEndDate: '2999-01-01T00:00:00.000Z', ...extra });

test('lists at most five listings in the API order and never re-sorts by price', () => {
  const html = T.ebayMarkup({ status: 'ok', items: [item(9), item(1), item(5), item(3), item(7), item(2), item(4)] });
  assert.deepEqual([...html.matchAll(/href="https:\/\/www\.ebay\.com\/itm\/(\d+)"/g)].map(m => m[1]), ['9', '1', '5', '3', '7']);
});

test('each listing shows image, full title, price and shipping apart, condition, seller and a safe link', () => {
  const html = T.ebayMarkup({ status: 'ok', items: [item(1), item(2, { shipping: null, image: null, condition: null, seller: null }), item(3, { shipping: { value: '0.00', currency: 'USD' } })] });
  assert.match(html, /<img class="ebay-img" src="https:\/\/i\.ebayimg\.com\/images\/g\/1\/s-l225\.jpg" alt="" width="64" height="64" loading="lazy"/);
  assert.match(html, /Pikachu ex 1\/165 NM/);
  assert.match(html, /<b class="ebay-price">US\$10\.00<\/b><span class="ebay-ship">運費 US\$4\.50<\/span>/);
  assert.match(html, /<span class="ebay-ship">運費另計<\/span>/);
  assert.match(html, /<span class="ebay-ship">免運費<\/span>/);
  assert.match(html, /狀態：Near Mint or Better/);
  assert.match(html, /賣家：seller_1/);
  assert.equal(html.match(/<img /g).length, 2, 'no image, no <img>');
  for (const link of html.match(/<a [^>]*>/g)) assert.match(link, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /\son\w+=|style=/i);
});

test('the block says it is a listing price, links the user agreement, and labels eBay in text', () => {
  const html = T.ebayMarkup({ status: 'ok', items: [item(1)] });
  assert.match(html, /<h4>eBay 現售掛牌價<\/h4>/);
  assert.match(html, /現售掛牌，不是成交價；依 eBay 搜尋結果，不保證就是這張卡/);
  assert.match(html, /href="https:\/\/www\.ebay\.com\/help\/policies\/member-behaviour-policies\/user-agreement\?id=4259"/);
  assert.match(html, /<span class="ebay-word">eBay<\/span>/);
});

test('links and images must be https on an eBay host; ended or unpriced listings are skipped', () => {
  const bad = [
    item(1, { itemWebUrl: 'http://www.ebay.com/itm/1' }), item(2, { itemWebUrl: 'https://evil.test/itm/2' }), item(3, { itemWebUrl: 'https://www.ebay.com.evil.test/itm/3' }),
    item(4, { itemWebUrl: 'https://www.ebay.com@evil.test/itm/4' }), item(5, { itemWebUrl: 'https://www.ebay.com:8443/itm/5' }), item(6, { itemEndDate: '2020-01-01T00:00:00.000Z' }), item(7, { price: null }),
    item(8, { image: 'https://evil.test/a.jpg' }), item(9, { image: 'http://i.ebayimg.com/a.jpg' }), item(10, { image: 'https://ebayimg.com.evil.test/a.jpg' })
  ];
  const html = T.ebayMarkup({ status: 'ok', items: bad });
  assert.deepEqual([...html.matchAll(/href="https:\/\/www\.ebay\.com\/itm\/(\d+)"/g)].map(m => m[1]), ['8', '9', '10']);
  assert.doesNotMatch(html, /evil\.test|<img /);
});

test('statuses without listings show one sentence, and a failed read says so', () => {
  assert.match(T.ebayMarkup({ status: 'no-match', items: [] }), /目前沒有對得上這張卡的掛牌/);
  assert.match(T.ebayMarkup({ status: 'ok', items: [item(1, { itemWebUrl: 'https://evil.test/' })] }), /目前沒有對得上這張卡的掛牌/);
  assert.match(T.ebayMarkup({ status: 'limited', items: [] }), /查詢次數已用完/);
  assert.match(T.ebayMarkup({ status: 'not-configured', items: [] }), /沒有開放/);
  assert.match(T.ebayMarkup(undefined), /暫時讀不到/);
  assert.doesNotMatch(T.ebayMarkup({ status: 'no-match', items: [] }), /<ol/);
});

test('loadEbay queries by English name and card number only, once, and skips cards it cannot query', async () => {
  const urls = [], slot = { dataset: {}, innerHTML: '', isConnected: true };
  const fetchFn = async url => { urls.push(url); return { ok: true, status: 200, json: async () => ({ data: { status: 'ok', items: [item(1)] } }) }; };
  const card = { nameEn: 'Pikachu ex', printings: [{ localCardNumber: '025/165' }] };
  await T.loadEbay(slot, { card, fetchFn });
  await T.loadEbay(slot, { card, fetchFn });
  assert.deepEqual(urls, ['/api/ebay-listings?name=Pikachu%20ex&number=025%2F165']);
  assert.match(slot.innerHTML, /ebay-item/);
  for (const bad of [{ printings: [{ localCardNumber: '1' }] }, { nameEn: 'Pikachu', printings: [] }, { nameEn: 'Pikachu <b>', printings: [{ localCardNumber: '1' }] }, { nameEn: 'Luffy', officialCardNumber: 'OP05-060' }]) {
    const other = { dataset: {}, innerHTML: '', isConnected: true };
    await T.loadEbay(other, { card: bad, fetchFn });
    assert.equal(other.innerHTML, '');
  }
  assert.equal(urls.length, 1, 'no request for unqueryable cards');
});

test('loadEbay hides the block on 400 and shows a short message on any other failure', async () => {
  const card = { nameEn: 'Pikachu', officialCardNumber: '25' };
  const run = async fetchFn => { const slot = { dataset: {}, innerHTML: '', isConnected: true }; await T.loadEbay(slot, { card, fetchFn }); return slot.innerHTML; };
  assert.equal(await run(async () => ({ ok: false, status: 400 })), '');
  assert.match(await run(async () => ({ ok: false, status: 502 })), /暫時讀不到/);
  assert.match(await run(async () => { throw new Error('offline'); }), /暫時讀不到/);
  assert.match(await run(async () => ({ ok: true, status: 200, json: async () => ({ data: { status: 'no-match', items: [] } }) })), /目前沒有對得上這張卡的掛牌/);
});

test('P3: the graded block is titled as eBay graded sales (never just sales), and cards without a source say so', async () => {
  const title = 'eBay 鑑定卡成交價（第三方彙整，未驗證）';
  assert.match(T.gradedMarkup({ status: 'ok', name: 'x', grades: [{ grade: 'PSA 10', count: 5, medianUsd: 10, medianTwd: 300 }] }), new RegExp(`<h4>${title.replace(/[()（）]/g, '\\$&')}</h4>`));
  assert.match(T.gradedMarkup({ status: 'no-sales' }), /鑑定卡成交價（第三方彙整，未驗證）/);
  const none = { dataset: {}, innerHTML: '', isConnected: true };
  await T.loadGraded(none, { card: { nameEn: 'Luffy', printings: [] }, market: { records: [] }, fetchFn: async () => { throw new Error('no request'); } });
  assert.match(none.innerHTML, /鑑定卡成交價[\s\S]*目前沒有成交資料來源[\s\S]*到 SNKRDUNK 查看/, 'sold block, then SNKRDUNK link underneath');
  const off = { dataset: {}, innerHTML: '', isConnected: true };
  await T.loadGraded(off, { card: { nameJa: 'リザードンex', printings: [{ region: 'JP', localSetCode: 'SV2a', localCardNumber: '201' }] }, market: { records: [] }, fetchFn: async () => ({ ok: true, json: async () => ({ data: { status: 'not-configured' } }) }) });
  assert.match(off.innerHTML, /目前沒有成交資料來源/);
  const down = { dataset: {}, innerHTML: '', isConnected: true };
  await T.loadGraded(down, { card: { nameJa: 'リザードンex', printings: [{ region: 'JP', localSetCode: 'SV2a', localCardNumber: '201' }] }, market: { records: [] }, fetchFn: async () => ({ ok: false }) });
  assert.match(down.innerHTML, /暫時讀不到/);
});

import { buildPageCsp } from '../providers/http-security.mjs';

test('the CSP lets the listing thumbnails load from eBay and nothing else new', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.ok(server.includes("from './providers/http-security.mjs'") && server.includes('buildPageCsp'));
  const img = buildPageCsp([]).match(/img-src ([^;]*);/)[1];
  assert.match(img, /https:\/\/i\.ebayimg\.com(\s|$)/);
  assert.doesNotMatch(img, /\*\.ebayimg|\*\.ebay\.com|ebaystatic/);
});

test('bindPriceTrend puts the eBay block right above the graded block, inside the same lazy trigger', async () => {
  const ui = await readFile(new URL('../ui-enhancements.js', import.meta.url), 'utf8');
  assert.match(ui, /graded\.before\(ebay\);window\.PriceTimeline\.loadEbay\?\.\(ebay,\{card,onState:/);
  assert.ok(ui.indexOf('graded.before(ebay)') > ui.indexOf("slot.dataset.loaded='1'") && ui.indexOf('graded.before(ebay)') < ui.indexOf('PriceTimeline.load(slot'));
});
