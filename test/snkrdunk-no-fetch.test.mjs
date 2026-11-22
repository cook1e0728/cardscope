import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';

// SNKRDUNK 的規約禁止擷取、我們也還沒拿到書面授權：站上只能有一個瀏覽器端組出來的外連網址，任何程式都不可以對它發請求。
const root = new URL('../', import.meta.url);
const SKIP_DIRS = new Set(['node_modules', 'docs', 'test', '.git', '.claude', '.wrangler']);
const ONLY_URL_BUILDER = 'price-timeline.js';

async function* sourceFiles(dir = root, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const nextPrefix = `${prefix}${entry.name}/`;
      if (!SKIP_DIRS.has(entry.name) && nextPrefix !== 'worker/public/') yield* sourceFiles(new URL(`${entry.name}/`, dir), nextPrefix);
    }
    else if (/\.(m?js)$/.test(entry.name)) yield { path: `${prefix}${entry.name}`, text: await readFile(new URL(entry.name, dir), 'utf8') };
  }
}

test('no script or server file requests snkrdunk.com; only the front-end link builder names the host', async () => {
  const hits = [];
  let scanned = 0;
  for await (const { path, text } of sourceFiles()) {
    scanned++;
    // 任何形式的主機名稱都擋：完整網址、拆開串接的 'snkrdunk' + '.com'
    const mentions = text.match(/snkrdunk\s*['"`]?\s*\+?\s*['"`]?\s*\.\s*com/gi) || [];
    if (mentions.length && path !== ONLY_URL_BUILDER) hits.push(`${path}: names the snkrdunk host`);
    // 就算在白名單檔案裡，主機名稱也只能出現在組外連網址的那一處，不能在 fetch／request 一類的呼叫附近
    if (path === ONLY_URL_BUILDER) {
      assert.equal(mentions.length, 1, 'the host appears exactly once (the outbound link template)');
      assert.match(text, /`https:\/\/snkrdunk\.com\/search\?keywords=\$\{encodeURIComponent\(/);
      assert.doesNotMatch(text, /(?:fetch|request|get|open|sendBeacon|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\([^)]*snkrdunk/i);
      assert.doesNotMatch(text, /snkrdunk[^;\n]*\b(?:fetch|sendBeacon|XMLHttpRequest)\b/i);
    }
  }
  assert.ok(scanned > 20, `scanned ${scanned} source files`);
  assert.deepEqual(hits, []);
});

test('the disabled snkrdunk provider stub stays disabled, and the registry keeps it link-only and permission-pending', async () => {
  const registry = await readFile(new URL('providers/registry.mjs', root), 'utf8');
  assert.match(registry, /snkrdunk:\s*\{[^}]*enabled:false/);
  const server = await readFile(new URL('server.mjs', root), 'utf8');
  assert.match(server, /snkrdunk:\{enabled:false/);
  const { sources, imageDisplayPolicies } = JSON.parse(await readFile(new URL('data/source-registry.json', root), 'utf8'));
  const entry = sources.find(source => source.id === 'snkrdunk');
  assert.ok(entry, 'registered');
  assert.equal(entry.access, 'link-only');
  assert.equal(entry.metadataCollection, 'permission-pending');
  assert.equal(entry.collectionEnabled, false);
  assert.equal(entry.runtimeProvider, null);
  assert.equal(entry.imagePolicy, 'not-collected');
  assert.equal(imageDisplayPolicies.snkrdunk, 'external-only');
});

const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('price-timeline.js', root), 'utf8'), sandbox);
const T = sandbox.window.PriceTimeline;

test('the SNKRDUNK link uses the Japanese name first, then English, plus the card number', () => {
  const card = { nameJa: 'リザードンex', nameEn: 'Charizard ex', printings: [{ localCardNumber: '201' }] };
  assert.equal(T.snkrdunkUrl(card), `https://snkrdunk.com/search?keywords=${encodeURIComponent('リザードンex 201')}`);
  assert.equal(T.snkrdunkUrl({ nameEn: 'Charizard ex' }, 'SV2a 201'), 'https://snkrdunk.com/search?keywords=Charizard%20ex%20SV2a%20201');
  assert.equal(T.snkrdunkUrl({ nameJa: 'ルフィ', officialCardNumber: 'OP05-060' }), `https://snkrdunk.com/search?keywords=${encodeURIComponent('ルフィ OP05-060')}`);
  assert.equal(T.snkrdunkUrl({ nameJa: 'ピカチュウ' }), `https://snkrdunk.com/search?keywords=${encodeURIComponent('ピカチュウ')}`);
  assert.equal(T.snkrdunkUrl({ printings: [{ localCardNumber: '201' }] }), null, 'a card number alone is not a usable search');
  assert.equal(T.snkrdunkUrl(null), null);
});

test('the SNKRDUNK link text is encoded and escaped, opens a new tab safely, and carries no handler attribute', () => {
  const hostile = `"><img src=x onerror=alert(1)>&`;
  const html = T.snkrdunkMarkup({ nameJa: hostile }, '1"2');
  assert.match(html, /<a class="ptl-ext-link" href="https:\/\/snkrdunk\.com\/search\?keywords=[A-Za-z0-9%._~!*'()-]+" target="_blank" rel="noopener noreferrer">到 SNKRDUNK 查看/);
  assert.doesNotMatch(html, /<img|\son\w+=|javascript:/i);
  assert.equal(T.snkrdunkMarkup({}), '');
  assert.match(html, /沒有取得它的資料授權/, 'says it is a link only, no price shown');
});

test('loadSnkrdunk fills an empty price slot once and never overwrites a loaded one', () => {
  const slot = { dataset: {}, innerHTML: '' };
  T.loadSnkrdunk(slot, { card: { nameJa: 'ピカチュウ' } });
  assert.match(slot.innerHTML, /到 SNKRDUNK 查看/);
  slot.innerHTML = 'graded';
  T.loadSnkrdunk(slot, { card: { nameJa: 'ピカチュウ' } });
  assert.equal(slot.innerHTML, 'graded');
});

test('loadGraded without a graded query still shows the link and sends no request', async () => {
  const slot = { dataset: {}, innerHTML: '', isConnected: true };
  let calls = 0;
  await T.loadGraded(slot, { card: { nameEn: 'Luffy', printings: [] }, market: { records: [] }, fetchFn: async () => { calls++; return { ok: false }; } });
  assert.equal(calls, 0);
  assert.match(slot.innerHTML, /href="https:\/\/snkrdunk\.com\/search\?keywords=Luffy"/);
});

test('loadGraded with a graded query appends the SNKRDUNK link after the graded block', async () => {
  const slot = { dataset: {}, innerHTML: '', isConnected: true };
  const body = { data: { status: 'no-sales' } };
  await T.loadGraded(slot, { card: { nameJa: 'リザードンex', printings: [{ region: 'JP', localSetCode: 'SV2a', localCardNumber: '201' }] }, market: { records: [] }, fetchFn: async () => ({ ok: true, json: async () => body }) });
  assert.match(slot.innerHTML, /鑑定卡成交價[\s\S]*到 SNKRDUNK 查看/);
});

test('C1-C4 pages: sources table lists eBay as planned and SNKRDUNK as link-only; footer, rights and no ads', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const sources = html.match(/<section class="info-page" id="sources"[\s\S]*?<\/section>/)[0];
  const tables = sources.match(/<table class="source-table">[\s\S]*?<\/table>/g);
  assert.equal(tables.length, 2);
  assert.match(tables[1], /<th scope="row">UNION ARENA<\/th>/);
  assert.match(tables[1], /<th scope="row">eBay 現售掛牌價<\/th>[\s\S]*已上線（詳細頁）/);
  assert.match(tables[1], /<th scope="row">SNKRDUNK（日本）<\/th>[\s\S]*僅外連/);
  assert.doesNotMatch(tables[1], /已向|已申請|申請中/, '授權信寄出前，頁面不寫已申請');
  const rights = html.match(/<section class="info-page" id="rights"[\s\S]*?<\/section>/)[0];
  assert.match(rights, /<h2 id="rightsTitle">權利人聯絡與移除流程<\/h2>/);
  assert.match(rights, /<a href="mailto:contact@cardseektcg.com">/);
  assert.match(rights, /href="\/\.well-known\/security\.txt"/);
  assert.doesNotMatch(rights + sources, /\son\w+=|javascript:|<script|TODO|example\.invalid|〈/i);
  const footer = html.match(/<footer class="brand-footer">[\s\S]*?<\/footer>/)[0];
  assert.match(footer, /<a href="https:\/\/www\.dbs-cardgame\.com\/fw\/asia-tc\/">七龍珠超 Fusion World<\/a>/);
  assert.match(footer, /<a href="https:\/\/www\.unionarena-tcg\.com\/jp\/">UNION ARENA<\/a>/);
  // 全站不放廣告與聯盟連結
  const timeline = await readFile(new URL('price-timeline.js', root), 'utf8');
  assert.doesNotMatch(html + timeline, /[?&](?:campid|mkcid|mkrid|toolid|customid|aff\w*|ref=)\b|affiliate|partnerize|rakuten/i);
});
