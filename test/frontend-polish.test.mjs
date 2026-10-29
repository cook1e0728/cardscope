import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// 2026-10-29 盤點前端收尾：台灣日期、網路錯誤白話、價格文案依 IP、收藏分批補快照、搜尋提示、放大檢視與方向鍵。
const [html, ui, band, nav, showcase] = await Promise.all(['index.html', 'ui-enhancements.js', 'series-band.js', 'navigation-state.js', 'look-showcase.js'].map(file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')));
const slice = (source, from, to) => { const start = source.indexOf(from), end = source.indexOf(to, start); assert.ok(start >= 0 && end > start, `${from} … ${to}`); return source.slice(start, end); };
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

test('taipeiDate follows Asia/Taipei: 00:30 Taipei on the 29th is still the 28th in UTC', () => {
  const window = {}, context = vm.createContext({ window, Intl, Date });
  vm.runInContext(slice(band, 'const taipeiDate=', 'const today='), context);
  const RealDate = Date, at = iso => { const fixed = new RealDate(iso).getTime(); return class extends RealDate { static now() { return fixed; } }; };
  context.Date = at('2026-10-28T16:30:00Z');
  assert.equal(window.taipeiDate(), '2026-10-29');
  assert.equal(window.taipeiDate(30), '2026-09-29');
  context.Date = at('2026-10-29T15:59:00Z');
  assert.equal(window.taipeiDate(), '2026-10-29');
  assert.match(band, /const today=\(\)=>taipeiDate\(\)/);
  assert.doesNotMatch(ui, /new Date\(\)\.toISOString\(\)\.slice\(0,10\)/, 'no UTC date left in the UI file');
});

test('failText: browser network errors become plain Chinese; backend messages stay', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(slice(html, 'function failText', 'window.failText'), context);
  const text = (prefix, error) => vm.runInContext(`failText(${JSON.stringify(prefix)},err)`, Object.assign(context, { err: error }));
  assert.equal(text('載入失敗：', new TypeError('Failed to fetch')), '連線失敗，請稍後再試');
  assert.equal(text('搜尋失敗：', Object.assign(new Error('x'), { name: 'SyntaxError' })), '連線失敗，請稍後再試');
  assert.equal(text('載入失敗：', new Error('不支援的版本地區')), '載入失敗：不支援的版本地區');
});

test('price copy: games without a price source say so; Pokemon summary says Cardmarket EUR reference', () => {
  const context = vm.createContext({ e: esc, rn: r => r, ln: l => l, game: 'pokemon' });
  vm.runInContext(slice(html, 'function priceScopeNote', 'window.priceScopeNote'), context);
  vm.runInContext(slice(html, 'function noPriceSource', 'function marketBlock'), context);
  vm.runInContext(slice(html, 'function marketBlock', 'async function openCard').replace(/^[^]*?(?=function marketBlock)/, ''), context);
  assert.match(vm.runInContext('priceScopeNote()', context), /Cardmarket 歐元參考價，不是台灣買取價/);
  context.game = 'onepiece';
  assert.match(vm.runInContext('priceScopeNote()', context), /價格僅採可驗證買取資料/);
  assert.equal(vm.runInContext("noPriceSource('onepiece')&&noPriceSource({id:'haikyuu'})&&noPriceSource('dragonball-fw')&&!noPriceSource('pokemon')&&!noPriceSource('yugioh')&&!noPriceSource(undefined)", context), true);
  assert.match(vm.runInContext("marketBlock({records:[],meta:{}},'onepiece')", context), /尚未接入價格來源/);
  assert.match(vm.runInContext("marketBlock({records:[],meta:{}},'pokemon')", context), /目前沒有這個版本的可靠價格/);
});

test('resolveCollection fills the whole collection in batches of 200 and does not loop on temporary failures', async () => {
  const total = 450, ids = Array.from({ length: total }, (_, i) => `c${i}`), calls = [];
  const watchlistMeta = {}, collectionUi = { failed: new Set(), progress: '' };
  const context = vm.createContext({ watchlistMeta, collectionUi, collectionItems: () => ids.map(id => ({ id })), collectionStatus() {}, persistCollection() {}, calls,
    resolveCollectionEntry: async key => { calls.push(key); if (key === 'c7') throw new Error('HTTP 503'); watchlistMeta[key] = { v: 1 }; } });
  vm.runInContext(slice(ui, 'async function resolveCollection()', 'async function loadCollectionPrices'), context);
  assert.equal(await vm.runInContext('resolveCollection()', context), true);
  assert.equal(calls.length, total, 'every pending card was tried exactly once (the failing one is not retried forever)');
  assert.equal(Object.keys(watchlistMeta).length, total - 1);
  assert.equal(await vm.runInContext('resolveCollection()', Object.assign(context, { calls: [] })), true, 'a later call retries the card that failed with a temporary error');
});

test('empty search: symbols-only hint is shown; suggestion reason codes are Chinese, unknown English codes are hidden', () => {
  const context = vm.createContext({ e: esc, G: () => ({}) });
  vm.runInContext(slice(html, 'const SUGGEST_REASONS', 'async function search('), context);
  const markup = meta => vm.runInContext(`emptySearchMarkup('x',${JSON.stringify(meta)})`, context);
  assert.match(markup({ hint: { kind: 'symbols-only', message: '請輸入卡名、卡號或系列名稱。' } }), /請輸入卡名、卡號或系列名稱。/);
  assert.match(markup({ suggestion: { q: 'OP05-001', reason: 'name-only' } }), /只搜卡名，不加稀有度或版本/);
  assert.match(markup({ suggestion: { q: 'a', reason: '去掉結尾的單一字母' } }), /去掉結尾的單一字母/);
  assert.doesNotMatch(markup({ suggestion: { q: 'a', reason: 'some-new-code' } }), /some-new-code/);
});

test('arrow keys do not change the card behind an open zoom view; landing nav and series URLs scroll to the wall', () => {
  assert.match(ui, /if\(\$\('cardZoom'\)\?\.classList\.contains\('open'\)\)return;if\(event\.key==='ArrowLeft'\)/);
  assert.match(nav, /const landOnSeries=[^;]*state\.series\|\|state\.rarity!=='all'[^;]*history\.state\?\.scrollY==null/);
  assert.match(nav, /if\(landOnSeries\)requestAnimationFrame\(\(\)=>window\.scrollBelowHeader\?\.\(node\('cardsTitle'\)\)\)/);
  assert.match(showcase, /dialog\.collection-dialog\[open\]'\)\?'collection'/, 'dock and top bar both mark 我的收藏 while the dialog is open');
});

test('filter summary: 稀有度待補 is only claimed when no rarity filter narrows the result', () => {
  assert.match(html, /selectedRarity==='all'\?Number\(state\.facets\?\.rarity\?\.unknown\)\|\|0:0/);
});
