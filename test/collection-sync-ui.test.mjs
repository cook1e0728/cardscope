import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Y4: the cloud-sync engine and dialog in ui-enhancements.js. The engine block is cut out of the source and run in a vm, one sandbox per "device"
// (own localStorage, own clock-driven timers), all talking to one fake cloud that applies the server's rules (CollectionStore.normalizeSyncEntry + mergeSync, revision lock).
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const ui = read('ui-enhancements.js'), css = read('look-v2.css');
const win = { crypto: globalThis.crypto };
new Function('window', read('collection-store.js'))(win);
const CS = win.CollectionStore;
const between = (from, to) => { const start = ui.indexOf(from), end = ui.indexOf(to, start); assert.ok(start >= 0 && end > start, `${from} … ${to}`); return ui.slice(start, end); };
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const ENGINE = [between('function persistCollection', '// 舊 ☆ 清單只在'), between('// 把 items 寫回三個既有 localStorage 鍵', '// 舊資料搬移'), between('// ── 雲端同步（docs/NEXT_PHASE_PLAN.md Y4）──', '// ── 雲端同步結束 ──')].join('\n');

function fakeCloud() {
  const cloud = { row: null, googleRow: null, calls: [], down: false, force: null, authUrl: 'https://ip2.example.supabase.co', token: 'access-tok-1', refreshToken: 'refresh-tok-1', email: 'trainer@gmail.com' };
  cloud.fetch = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const u = String(url), action = u.split('/').pop(), request = body ? JSON.parse(body) : {};
    cloud.calls.push({ url: u, method, headers, action, request });
    if (cloud.down) throw new TypeError('fetch failed');
    const reply = (status, data, error = '') => ({ status, ok: status >= 200 && status < 300, json: async () => (status >= 200 && status < 300 ? { data } : { error }) });
    if (cloud.force) return reply(cloud.force, null, 'forced');
    if (u === '/api/auth/config') return reply(200, { url: cloud.authUrl });
    if (u === '/api/auth/exchange') {
      if (!request.code || !request.verifier) return reply(400, null, 'bad pkce');
      return reply(200, { accessToken: cloud.token, refreshToken: cloud.refreshToken, expiresAt: Math.floor(Date.now() / 1000) + 3600, email: cloud.email });
    }
    if (u === '/api/auth/refresh') {
      if (request.refreshToken !== cloud.refreshToken) return reply(401, null, 'expired');
      cloud.token = 'access-tok-refreshed';
      return reply(200, { accessToken: cloud.token, refreshToken: cloud.refreshToken, expiresAt: Math.floor(Date.now() / 1000) + 3600, email: cloud.email });
    }
    if (u === '/api/auth/logout') return { status: 204, ok: true, json: async () => null };
    const isGoogle = Boolean(headers?.Authorization);
    if (isGoogle && headers.Authorization !== `Bearer ${cloud.token}`) return reply(401, null, 'bad token');
    const keys = Object.keys(request).sort().join(), code = isGoogle ? 'GOOGLE' : CS.normalizeSyncCode(request.code);
    const expectedKeys = isGoogle ? (action === 'push' ? 'items,revision' : '') : (action === 'push' ? 'code,items,revision' : 'code');
    if (keys !== expectedKeys || !code) return reply(400, null, 'bad request');
    const slot = isGoogle ? 'googleRow' : 'row';
    if (action === 'pull') return reply(200, { items: cloud[slot]?.items || [], revision: cloud[slot]?.revision || 0, updatedAt: null });
    if (action === 'delete') { cloud[slot] = null; return reply(200, { deleted: true }); }
    const rows = request.items.map(CS.normalizeSyncEntry);
    if (rows.some(row => !row)) return reply(400, null, 'bad entry');
    if (request.revision === 0 ? cloud[slot] : cloud[slot]?.revision !== request.revision) return reply(409, null, 'conflict');
    cloud[slot] = { items: CS.mergeSync([], rows), revision: request.revision + 1, code };
    return reply(200, { revision: cloud[slot].revision, updatedAt: null });
  };
  return cloud;
}

function device(cloud, clock, { online = true, stored = {}, session = {}, search = '' } = {}) {
  const storage = new Map(Object.entries(stored)), sessionStore = new Map(Object.entries(session)), timers = new Map(), statuses = [], watchlist = {}, watchlistMeta = {};
  let nextTimer = 1;
  const loc = { origin: 'https://cardseektcg.com', pathname: '/', search, hash: '', href: `https://cardseektcg.com/${search}`, assign(url) { this.href = url; } };
  const hist = { state: null, replaceState(s, _t, url) { this.state = s; const u = new URL(url, loc.origin); loc.pathname = u.pathname; loc.search = u.search; loc.hash = u.hash; loc.href = u.href; } };
  const sandbox = {
    CS, watchlist, watchlistMeta, e: esc, $: () => null, window: { crypto: globalThis.crypto }, crypto: globalThis.crypto, TextEncoder, Uint8Array, btoa: globalThis.btoa, URLSearchParams,
    location: loc, history: hist,
    navigator: { onLine: online }, AbortController,
    localStorage: { removeItem: key => storage.delete(key) },
    sessionStorage: { getItem: key => sessionStore.get(key) || null, setItem: (key, val) => sessionStore.set(key, String(val)), removeItem: key => sessionStore.delete(key) },
    document: { addEventListener() {}, visibilityState: 'visible' },
    uiLocal: { get: (key, fallback) => storage.get(key) || fallback, set: (key, value) => { storage.set(key, value); return true; } },
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    Date: class extends Date { static now() { return clock.t; } },
    fetch: (...args) => cloud.fetch(...args),
    refreshGrid() {}, inCollectionView: () => false, collectionStatus: text => statuses.push(text), collectionUi: { pricesState: 'ready', filter: { game: '', series: '' } }, resolveCollection: async () => false, loadCollectionPrices: async () => {}, rerenderCollection() {},
    collectionItems: () => CS.itemsFromLegacy([], watchlist, watchlistMeta).filter(item => item.quantity > 0)
  };
  vm.createContext(sandbox);
  const run = code => vm.runInContext(code, sandbox);
  run(`let syncState=null;\n${ENGINE}`);
  const api = {
    sandbox, storage, sessionStore, loc, hist, timers, statuses, watchlist, run,
    qty(id, count, meta = {}) { clock.t += 1000; run(`(()=>{const id=${JSON.stringify(id)};if(${count})watchlist[id]=${count};else delete watchlist[id];Object.assign(watchlistMeta[id]=watchlistMeta[id]||{id},${JSON.stringify(meta)});persistCollection()})()`); },
    idle: async () => { while (run('syncUi.busy') || run('syncUi.authBusy')) await new Promise(resolve => setImmediate(resolve)); },
    now: async () => { clock.t += 1000; await run('syncNow()'); },
    fire() { const due = [...timers.entries()]; timers.clear(); due.forEach(([, timer]) => timer.fn()); return due.map(([, timer]) => timer.ms); },
    state: () => run('syncState'), auth: () => run('authState'), ui: () => run('syncUi'),
    counts: () => Object.fromEntries(Object.entries(watchlist).sort())
  };
  return api;
}
const world = () => ({ cloud: fakeCloud(), clock: { t: Date.now() } });
const code = d => d.state().code;

test('engine: enabling makes a code that passes the server rule; code lives only in localStorage and never in a URL or header', async () => {
  const { cloud, clock } = world(), a = device(cloud, clock);
  a.qty('c1', 2); a.qty('c2', 1);
  assert.equal(a.state(), null, 'nothing is stamped or stored while sync is off');
  assert.equal(a.storage.has('cardscope-sync'), false);
  await a.run('startSync("")'); await a.idle();
  const stored = JSON.parse(a.storage.get('cardscope-sync'));
  assert.equal(CS.normalizeSyncCode(stored.code), stored.code); assert.equal(stored.code.length, 28);
  assert.equal(stored.revision, 1); assert.equal(stored.dirty, false);
  assert.deepEqual(Object.keys(stored.records).sort(), ['c1', 'c2']);
  assert.equal(cloud.row.revision, 1);
  assert.deepEqual(cloud.row.items.map(row => [row.id, row.quantity]), [['c1', 2], ['c2', 1]]);
  for (const call of cloud.calls) {
    assert.equal(call.method, 'POST'); assert.match(call.url, /^\/api\/sync\/(pull|push)$/, 'no query string, no code in the path');
    assert.ok(!JSON.stringify(call.headers).includes(stored.code), 'not in headers either');
  }
  assert.deepEqual([...a.storage].filter(([, value]) => value.includes(stored.code)).map(([key]) => key), ['cardscope-sync'], 'only this one key holds the code');
  assert.equal(a.ui().status, 'ok');
});

test('engine: stamping is by content — a real edit, a removal (tombstone) and a re-add stamp; a meta-only write does not; remote applies are not stamped', async () => {
  const { cloud, clock } = world(), a = device(cloud, clock);
  a.qty('c1', 2); await a.run('startSync("")'); await a.idle(); a.fire();
  const records = () => JSON.parse(a.storage.get('cardscope-sync')).records, before = records().c1[1];
  a.qty('c1', 2, { seriesId: 's9', game: 'pokemon' });
  assert.equal(records().c1[1], before, 'seriesId/game hints are not a user change');
  assert.equal(a.state().dirty, false);
  assert.deepEqual(a.fire(), [], 'no sync scheduled for a non-change');
  a.qty('c1', 3);
  assert.ok(records().c1[1] > before, 'quantity change is stamped'); assert.equal(a.state().dirty, true);
  assert.deepEqual(a.fire(), [3000], 'a sync is scheduled about 3 seconds later');
  await a.idle();
  a.qty('c1', 0);
  assert.deepEqual([records().c1[2]], [1], 'removal leaves a tombstone'); assert.equal(records().c1[1], clock.t);
  a.qty('c1', 1);
  assert.deepEqual([records().c1[2]], [0], 're-adding clears the tombstone'); a.fire(); await a.idle();
});

test('two devices: join pulls the cloud copy (cloud wins on a conflict, local-only cards are kept), edits and deletions travel both ways', async () => {
  const { cloud, clock } = world(), a = device(cloud, clock), b = device(cloud, clock);
  a.qty('c1', 2); a.qty('c2', 1);
  await a.run('startSync("")'); await a.idle();
  b.qty('c1', 7); b.qty('c9', 4); // c1 differs from the cloud, c9 exists only on B
  await b.run(`startSync(${JSON.stringify(CS.formatSyncCode(code(a)).toLowerCase())})`); await b.idle(); // grouped, lower case: still accepted
  assert.deepEqual(b.counts(), { c1: 2, c2: 1, c9: 4 }, 'B took the cloud quantity for c1 and keeps its own c9');
  assert.deepEqual(cloud.row.items.map(row => [row.id, row.quantity]), [['c1', 2], ['c2', 1], ['c9', 4]], 'the merged copy went back up');
  await a.now(); await a.idle();
  assert.deepEqual(a.counts(), { c1: 2, c2: 1, c9: 4 }, 'A picked up c9');

  b.qty('c2', 5); b.fire(); await b.idle();
  await a.run('syncIfStale(true)'); await a.idle();
  assert.equal(a.counts().c2, 5, 'an edit on B reaches A');

  a.qty('c1', 0); a.fire(); await a.idle();
  await b.run('syncIfStale(true)'); await b.idle();
  assert.equal('c1' in b.counts(), false, 'a deletion on A removes the card on B');
  assert.equal(cloud.row.items.find(row => row.id === 'c1').deleted, true, 'the cloud keeps the tombstone');
});

test('engine: a 409 (someone else wrote first) pulls, merges and pushes again; both edits survive', async () => {
  const { cloud, clock } = world(), a = device(cloud, clock), b = device(cloud, clock);
  a.qty('c1', 1); a.qty('c2', 1);
  await a.run('startSync("")'); await a.idle();
  await b.run(`startSync(${JSON.stringify(code(a))})`); await b.idle();
  a.qty('c1', 4); b.qty('c2', 6);
  a.fire(); await a.idle(); // A writes first: revision moves on
  const revisionBefore = cloud.row.revision, calls = cloud.calls.length;
  b.fire(); await b.idle(); // B still holds the old revision
  const actions = cloud.calls.slice(calls).map(call => `${call.action}:${call.request.revision ?? ''}`);
  assert.deepEqual(actions, [`push:${revisionBefore - 1}`, 'pull:', `push:${revisionBefore}`], 'fast push → 409 → pull → push at the new revision');
  assert.deepEqual(b.counts(), { c1: 4, c2: 6 });
  assert.deepEqual(cloud.row.items.map(row => [row.id, row.quantity]), [['c1', 4], ['c2', 6]]);
  assert.equal(b.state().dirty, false); assert.equal(b.ui().status, 'ok');
});

test('engine: offline, server failures and 429 only show a status; the collection is untouched and a retry is scheduled', async () => {
  const { cloud, clock } = world(), a = device(cloud, clock);
  a.qty('c1', 2); await a.run('startSync("")'); await a.idle(); a.fire();
  a.qty('c1', 3);
  cloud.down = true; a.fire(); await a.idle();
  assert.equal(a.ui().status, 'error'); assert.match(a.ui().text, /同步服務暫時連不上/);
  assert.deepEqual(a.counts(), { c1: 3 }, 'local data is exactly what the user left'); assert.equal(a.state().dirty, true);
  assert.deepEqual([...a.timers.values()].map(timer => timer.ms), [60000], 'retry in a minute');
  cloud.down = false; cloud.force = 429; await a.run('syncNow()'); await a.idle();
  assert.match(a.ui().text, /同步太頻繁/); assert.deepEqual([...a.timers.values()].map(timer => timer.ms), [65000], 'a rate limit waits a little longer');
  cloud.force = 503; await a.run('syncNow()'); await a.idle(); assert.match(a.ui().text, /還沒有開放/);
  cloud.force = null; await a.run('syncNow()'); await a.idle();
  assert.equal(a.ui().status, 'ok'); assert.equal(cloud.row.items[0].quantity, 3, 'the edit made while failing went up once the service came back');
  assert.equal(a.state().dirty, false);
  a.sandbox.navigator.onLine = false; a.qty('c1', 8); a.fire(); await a.idle();
  assert.equal(a.ui().status, 'offline'); assert.equal(a.counts().c1, 8);
  a.sandbox.navigator.onLine = true; await a.run('syncIfStale(true)'); await a.idle();
  assert.equal(cloud.row.items[0].quantity, 8);
});

test('join: a bad code or a code with no cloud copy does not turn sync on and does not touch the collection', async () => {
  const { cloud, clock } = world(), a = device(cloud, clock);
  a.qty('c1', 2);
  await a.run('startSync("short")'); assert.equal(a.state(), null); assert.equal(cloud.calls.length, 0, 'a malformed code never reaches the network');
  await a.run(`startSync(${JSON.stringify('K3M9T7Q2XB4V8ZD6N1HW5RPJ0C')})`);
  assert.equal(a.state(), null); assert.equal(a.storage.has('cardscope-sync'), false); assert.deepEqual(a.counts(), { c1: 2 });
  assert.equal(cloud.calls.length, 1); assert.equal(cloud.calls[0].action, 'pull');
  cloud.down = true; await a.run(`startSync(${JSON.stringify('K3M9T7Q2XB4V8ZD6N1HW5RPJ0C')})`); assert.equal(a.state(), null);
});

test('stop keeps the cloud copy and the collection; delete removes the cloud copy, and other devices notice and stop', async () => {
  const { cloud, clock } = world(), a = device(cloud, clock), b = device(cloud, clock), c = device(cloud, clock);
  a.qty('c1', 2); await a.run('startSync("")'); await a.idle();
  await b.run(`startSync(${JSON.stringify(code(a))})`); await b.idle();
  await c.run(`startSync(${JSON.stringify(code(a))})`); await c.idle();
  await c.run('stopSync("x")');
  assert.equal(c.state(), null); assert.equal(c.storage.has('cardscope-sync'), false); assert.deepEqual(c.counts(), { c1: 2 }); assert.ok(cloud.row, 'stop does not touch the cloud');
  const gone = code(a);
  await a.run('deleteCloud()');
  assert.equal(cloud.row, null); assert.equal(a.state(), null); assert.equal(a.storage.has('cardscope-sync'), false); assert.deepEqual(a.counts(), { c1: 2 });
  assert.deepEqual(cloud.calls.at(-1).request, { code: gone }, 'the delete request carries only the code');
  await b.run('syncIfStale(true)'); await b.idle();
  assert.equal(b.state(), null, 'B sees the cloud copy is gone and stops'); assert.deepEqual(b.counts(), { c1: 2 }); assert.equal(cloud.row, null, 'B does not recreate it');
  // a failing delete keeps everything
  const d = device(cloud, clock); d.qty('x', 1); await d.run('startSync("")'); await d.idle();
  cloud.force = 502; await d.run('deleteCloud()');
  assert.ok(d.state(), 'still enabled'); assert.ok(cloud.row, 'cloud copy not deleted'); assert.match(d.ui().notice, /沒有刪除/);
});

test('state survives a reload: the same localStorage restores the code, records and dirty flag, and a dirty state syncs about 3 seconds after load', async () => {
  const { cloud, clock } = world(), a = device(cloud, clock);
  a.qty('c1', 2); await a.run('startSync("")'); await a.idle(); a.fire();
  cloud.down = true; a.qty('c1', 5); a.fire(); await a.idle();
  const again = device(cloud, clock, { stored: { 'cardscope-sync': a.storage.get('cardscope-sync') } });
  assert.equal(again.state().code, code(a)); assert.equal(again.state().dirty, true);
  assert.deepEqual(again.fire(), [3000]);
  assert.equal(JSON.parse(JSON.stringify(again.state().records)).c1[2], 0);
  // a corrupt record is dropped, never thrown on
  again.storage.set('cardscope-sync', '{"code":"nope"}'); assert.equal(again.run('readSyncState()'), null);
  again.storage.set('cardscope-sync', '{not json'); assert.equal(again.run('readSyncState()'), null);
});

test('dialog markup: states, Google primary button, sync-code details disclosure, grouped code, aria, confirmations, and nothing inline (strict CSP)', async () => {
  const { cloud, clock } = world(), a = device(cloud, clock);
  const off = a.run('syncDialogHtml()');
  assert.match(off, /data-sync-google><svg class="sync-google-icon"[\s\S]*?<span>用 Google 登入，自動同步<\/span><\/button>/);
  assert.match(off, /<details class="sync-alt"><summary><span>不想登入？改用同步碼<\/span><svg class="sync-chevron"/);
  assert.match(off, /data-sync-start>開啟雲端同步（產生同步碼）</); assert.match(off, /data-sync-join/); assert.match(off, /<label for="syncJoinCode">/);
  assert.match(off, /同步碼就是密碼/); assert.match(off, /180 天/);
  await a.run('startSync("")'); await a.idle();
  const on = a.run('syncDialogHtml()'), grouped = CS.formatSyncCode(code(a));
  assert.ok(on.includes(`>${grouped}</div>`), 'the code is shown grouped in blocks of four');
  assert.match(grouped, /^([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/);
  assert.match(on, /id="syncCode" role="textbox" aria-readonly="true"/); assert.match(on, /data-sync-copy/); assert.match(on, /data-sync-now/);
  assert.match(on, /data-sync-stop/); assert.match(on, /data-sync-delete/); assert.match(on, /id="syncState" role="status" aria-live="polite"/);
  for (const html of [off, on]) {
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'no inline event handlers'); assert.doesNotMatch(html, /\sstyle\s*=/i); assert.doesNotMatch(html, /javascript:/i);
    for (const button of html.match(/<button[^>]*>/g)) assert.match(button, /type="(button|submit)"/);
  }
  a.run('syncUi.confirm="delete"');
  const del = a.run('syncDialogHtml()');
  assert.match(del, /aria-labelledby="syncConfirmTitle"/); assert.match(del, /刪除雲端資料？/); assert.match(del, /data-sync-confirm="delete"/); assert.match(del, /data-sync-cancel/);
  assert.doesNotMatch(del, /data-sync-now/, 'while confirming, the other actions are out of the way');
  a.run('syncUi.confirm="stop"');
  const stop = a.run('syncDialogHtml()');
  assert.match(stop, /停止同步？/); assert.match(stop, /雲端資料不會刪/); assert.match(stop, /data-sync-confirm="stop"/);
  a.run('syncUi.confirm="";syncUi.notice="<img src=x onerror=1>"');
  assert.doesNotMatch(a.run('syncDialogHtml()'), /<img/, 'notices are escaped');
});

test('Google login flow: PKCE verifier in sessionStorage, redirect strips ?code= via replaceState, verifier is deleted once used, local & sync-code items merge into Google, logout clears tokens', async () => {
  const { cloud, clock } = world(), a = device(cloud, clock);
  a.qty('c1', 2);
  // Start with a sync code first so we also test upgrading from sync-code to Google
  await a.run('startSync("")'); await a.idle();
  assert.equal(cloud.row.items[0].quantity, 2);

  // User clicks "用 Google 登入": verifier stored in sessionStorage, navigated to Supabase authorize URL with S256 challenge
  await a.run('startGoogleLogin()');
  const verifier = a.sessionStore.get('cardscope-pkce');
  assert.ok(verifier && verifier.length >= 43, 'PKCE verifier stored in sessionStorage');
  assert.match(a.loc.href, /^https:\/\/ip2\.example\.supabase\.co\/auth\/v1\/authorize\?/);
  assert.match(a.loc.href, /provider=google/);
  assert.match(a.loc.href, /code_challenge_method=s256/);

  // Simulate returning from Google OAuth with ?view=collection&code=oauth-code-xyz on a device that had sync-code enabled + its own local c2
  const b = device(cloud, clock, {
    stored: {
      'cardscope-sync': a.storage.get('cardscope-sync'),
      'cardscope-watchlist': a.storage.get('cardscope-watchlist'),
      'cardscope-watchlist-meta': a.storage.get('cardscope-watchlist-meta')
    },
    session: { 'cardscope-pkce': verifier }
  });
  b.run("Object.assign(watchlist,JSON.parse(uiLocal.get('cardscope-watchlist','{}')));Object.assign(watchlistMeta,JSON.parse(uiLocal.get('cardscope-watchlist-meta','{}')))");
  b.qty('c2', 4); // local card added on B before redirect completes
  b.loc.search = '?view=collection&code=oauth-code-xyz';
  await b.run('completeGoogleRedirect()');
  await b.idle();
  assert.equal(b.loc.search, '?view=collection', '?code= was stripped from the URL by history.replaceState');
  assert.equal(b.sessionStore.has('cardscope-pkce'), false, 'PKCE verifier was deleted right after exchange');
  assert.equal(b.state().google, true);
  assert.equal('code' in b.state(), false, 'sync code is disabled after upgrading to Google');
  assert.equal(b.auth().email, 'trainer@gmail.com');
  assert.deepEqual(b.counts(), { c1: 2, c2: 4 }, 'sync-code cloud items (c1) and local items (c2) both merged into Google');
  assert.deepEqual(cloud.googleRow.items.map(r => [r.id, r.quantity]), [['c1', 2], ['c2', 4]]);

  const gHtml = b.run('syncDialogHtml()');
  assert.match(gHtml, /已用 trainer@gmail\.com 登入・已同步/);
  assert.match(gHtml, /data-sync-stop>登出</);
  assert.match(gHtml, /data-sync-delete>刪除雲端資料</);
  assert.match(b.run('collectionSyncMeta()'), /^Google 雲端同步・已同步/);

  // Token refresh on 401
  cloud.token = 'different-server-token'; // forces a 401 on the first attempt, then /api/auth/refresh rotates to 'access-tok-refreshed'
  b.qty('c2', 5); b.fire(); await b.idle();
  assert.equal(b.auth().accessToken, 'access-tok-refreshed');
  assert.equal(cloud.googleRow.items.find(r => r.id === 'c2').quantity, 5);

  // Logout clears authState and syncState, leaves local collection intact
  await b.run('logoutGoogle()');
  assert.equal(b.state(), null);
  assert.equal(b.auth(), null);
  assert.equal(b.storage.has('cardscope-auth'), false);
  assert.equal(b.storage.has('cardscope-sync'), false);
  assert.deepEqual(b.counts(), { c1: 2, c2: 5 }, 'local collection stays after logout');
  assert.equal(b.run('collectionSyncMeta()'), '未登入・只存在這台裝置');
});

test('wiring: the 管理 menu item opens the dialog, persistCollection stamps, the page open/visible/online triggers exist, and the dialog never uses inline script', () => {
  assert.match(ui, /data-coll-sync title="用同步碼在多台裝置同步收藏">雲端同步<\/button>/);
  assert.match(ui, /else if\('collSync' in item\.dataset\)openSyncDialog\(\);/);
  assert.match(ui, /function persistCollection\(\)\{if\(typeof stampSync==='function'\)stampSync\(\);/);
  assert.match(between('function enterCollectionPage', '// ── 雲端同步（docs'), /syncIfStale\(\);/, 'opening the collection page syncs');
  assert.match(ui, /document\.addEventListener\?\.\('visibilitychange',\(\)=>\{if\(document\.visibilityState==='visible'\)syncIfStale\(\)\}\)/);
  assert.match(ui, /window\.addEventListener\?\.\('online',\(\)=>syncIfStale\(true\)\)/);
  assert.match(ui, /dialog\.showModal\(\)/); assert.match(ui, /setTimeout\(syncNow,error\?\.status===429/);
  const block = between('// ── 雲端同步（docs/NEXT_PHASE_PLAN.md Y4）──', '// ── 雲端同步結束 ──');
  assert.doesNotMatch(block, /innerHTML\s*=\s*[^;]*\bon[a-z]+=/i); assert.doesNotMatch(block, /eval\(|new Function|document\.write/);
  assert.doesNotMatch(block, /console\./, 'the code is never logged');
  for (const selector of ['.sync-dialog', '.sync-dialog::backdrop', '.sync-code', '.sync-btn', '.sync-confirm', '.sync-alt']) assert.ok(css.includes(selector), selector);
  assert.match(css, /\.sync-btn\{[^}]*min-height:var\(--btn-h\)/); assert.match(css, /\.sync-dialog\{width:min\(480px,calc\(100vw - 32px\)\)/);
});

test('legacy cloud {favorite:true, quantity:0} merges and pushes back with HTTP 200 (no 400)', async () => {
  const { cloud, clock } = world(), b = device(cloud, clock);
  const joinCode = 'K3M9T7Q2XB4V8ZD6N1HW5RPJ0C';
  cloud.row = {
    code: joinCode,
    revision: 1,
    items: [{ id: 'c-old', canonicalId: '', favorite: true, quantity: 0, condition: '', finish: '', note: '', updatedAt: new Date(clock.t - 5000).toISOString() }]
  };
  b.qty('c2', 3);
  await b.run(`startSync(${JSON.stringify(joinCode)})`);
  await b.idle();
  assert.deepEqual(b.counts(), { 'c-old': 1, c2: 3 });
  assert.equal(cloud.row.revision, 2);
  assert.equal(cloud.row.items.find(row => row.id === 'c-old').quantity, 1);
  assert.equal(cloud.row.items.find(row => row.id === 'c-old').favorite, false);
  assert.equal(b.ui().status, 'ok');
});

test('auth refresh 502 or network disconnect does not log the user out (preserves authState and syncState)', async () => {
  const { cloud, clock } = world(), b = device(cloud, clock);
  b.qty('c1', 2);
  await b.run('enableGoogleSync({ accessToken: "access-tok-1", refreshToken: "refresh-tok-1", expiresAt: Math.floor(Date.now() / 1000) + 3600, email: "trainer@gmail.com" })');
  await b.idle();
  assert.equal(b.state().google, true);

  const origFetch = cloud.fetch;
  let refreshMode = '502';
  cloud.fetch = async (url, opts) => {
    if (String(url) === '/api/auth/refresh') {
      if (refreshMode === 'down') throw new TypeError('fetch failed');
      return { status: 502, ok: false, json: async () => ({ error: 'bad gateway' }) };
    }
    return origFetch(url, opts);
  };
  cloud.token = 'server-rotated'; // triggers 401 -> refresh
  b.qty('c1', 5);
  b.fire();
  await b.idle();
  assert.ok(b.auth(), '502 refresh preserves authState');
  assert.equal(b.auth().accessToken, 'access-tok-1');
  assert.ok(b.state()?.google, '502 refresh preserves syncState');
  assert.equal(b.ui().status, 'error');

  refreshMode = 'down';
  await b.run('syncNow()');
  await b.idle();
  assert.ok(b.auth(), 'network disconnect on refresh preserves authState');
  assert.ok(b.state()?.google, 'network disconnect on refresh preserves syncState');
  assert.equal(b.ui().status, 'error');

  cloud.fetch = origFetch;
  await b.run('syncNow()');
  await b.idle();
  assert.equal(b.auth().accessToken, 'access-tok-refreshed');
  assert.equal(cloud.googleRow.items.find(row => row.id === 'c1').quantity, 5);
});

test('enableGoogleSync without sync-code stamps known Google cloud entries at 0; hadCode pull failure aborts switch', async () => {
  const { cloud, clock } = world();
  const cloudAt = new Date(clock.t - 5000).toISOString();
  cloud.googleRow = {
    code: 'GOOGLE',
    revision: 3,
    items: [
      { id: 'c1', canonicalId: '', favorite: false, quantity: 9, condition: '', finish: '', note: '', updatedAt: cloudAt },
      { id: 'c-del', deleted: true, updatedAt: cloudAt }
    ]
  };
  const b = device(cloud, clock);
  b.qty('c1', 2);
  b.qty('c-del', 1);
  b.qty('c-local', 4);
  clock.t += 10000;
  const switched = await b.run('enableGoogleSync({ accessToken: "access-tok-1", refreshToken: "refresh-tok-1", expiresAt: Math.floor(Date.now() / 1000) + 3600, email: "trainer@gmail.com" })');
  await b.idle();
  assert.equal(switched, true);
  assert.equal(b.counts().c1, 9, 'known Google cloud item wins over local copy via timestamp 0');
  assert.equal('c-del' in b.counts(), false, 'known Google cloud tombstone is not resurrected');
  assert.equal(b.counts()['c-local'], 4, 'local-only card survives');

  const a = device(cloud, clock);
  a.qty('x1', 1);
  await a.run('startSync("")');
  await a.idle();
  const oldCode = code(a);
  cloud.force = 503;
  const aborted = await a.run('enableGoogleSync({ accessToken: "access-tok-1", refreshToken: "refresh-tok-1", expiresAt: Math.floor(Date.now() / 1000) + 3600, email: "trainer@gmail.com" })');
  assert.equal(aborted, false);
  assert.equal(a.state().code, oldCode, 'sync-code state stays intact when hadCode pull fails');
  assert.equal(a.auth(), null);
  assert.equal(a.storage.has('cardscope-auth'), false);
  assert.match(a.ui().notice, /尚未切換為 Google 登入/);
});

test('startSync("") does not persist sync code when server returns 503', async () => {
  const { cloud, clock } = world(), a = device(cloud, clock);
  a.qty('c1', 2);
  cloud.force = 503;
  await a.run('startSync("")');
  assert.equal(a.state(), null);
  assert.equal(a.storage.has('cardscope-sync'), false);
  assert.deepEqual(a.counts(), { c1: 2 });
  assert.match(a.ui().notice, /沒有開放.*沒有開啟同步/);
});

test('OAuth ?error=access_denied strips URL params, clears PKCE verifier, and keeps syncUi.notice until openSyncDialog()', () => {
  const { cloud, clock } = world();
  const nodes = new Map();
  const storage = new Map(), sessionStore = new Map([['cardscope-pkce', 'pkce-verifier-123']]), watchlist = {}, watchlistMeta = {};
  const loc = { origin: 'https://cardseektcg.com', pathname: '/', search: '?view=collection&error=access_denied&error_description=User+denied', hash: '', href: 'https://cardseektcg.com/?view=collection&error=access_denied&error_description=User+denied', assign(u) { this.href = u; } };
  const hist = { state: null, replaceState(s, _t, u) { this.state = s; const parsed = new URL(u, loc.origin); loc.pathname = parsed.pathname; loc.search = parsed.search; loc.hash = parsed.hash; loc.href = parsed.href; } };
  const makeDialog = tag => {
    const listeners = new Map();
    return {
      tagName: tag.toUpperCase(), id: '', className: '', open: false, innerHTML: '',
      setAttribute() {}, removeAttribute() {},
      addEventListener(type, fn) { listeners.set(type, fn); },
      showModal() { this.open = true; },
      close() { this.open = false; listeners.get('close')?.(); },
      querySelector() { return null; }
    };
  };
  const sandbox = {
    CS, watchlist, watchlistMeta, e: esc, $: id => nodes.get(id) || null, window: { crypto: globalThis.crypto }, crypto: globalThis.crypto, TextEncoder, Uint8Array, btoa: globalThis.btoa, URLSearchParams,
    location: loc, history: hist, navigator: { onLine: true }, AbortController,
    localStorage: { removeItem: key => storage.delete(key) },
    sessionStorage: { getItem: key => sessionStore.get(key) || null, setItem: (key, val) => sessionStore.set(key, String(val)), removeItem: key => sessionStore.delete(key) },
    document: { addEventListener() {}, visibilityState: 'visible', body: { append(el) { if (el.id) nodes.set(el.id, el); } }, createElement: makeDialog },
    uiLocal: { get: (key, fallback) => storage.get(key) || fallback, set: (key, value) => { storage.set(key, value); return true; } },
    setTimeout, clearTimeout, Date: class extends Date { static now() { return clock.t; } },
    fetch: (...args) => cloud.fetch(...args),
    refreshGrid() {}, inCollectionView: () => false, collectionStatus() {}, collectionUi: { pricesState: 'ready', filter: { game: '', series: '' } }, resolveCollection: async () => false, loadCollectionPrices: async () => {}, rerenderCollection() {},
    collectionItems: () => []
  };
  vm.createContext(sandbox);
  vm.runInContext(`let syncState=null;\n${ENGINE}`, sandbox);
  assert.equal(loc.search, '?view=collection');
  assert.equal(sessionStore.has('cardscope-pkce'), false);
  assert.equal(vm.runInContext('syncUi.notice', sandbox), '已取消 Google 登入，本機收藏不受影響。');
  vm.runInContext('openSyncDialog()', sandbox);
  assert.equal(vm.runInContext('syncUi.notice', sandbox), '已取消 Google 登入，本機收藏不受影響。', 'openSyncDialog keeps notice visible');
  assert.match(nodes.get('syncDialog').innerHTML, /已取消 Google 登入，本機收藏不受影響。/);
  vm.runInContext('closeSyncDialog()', sandbox);
  assert.equal(vm.runInContext('syncUi.notice', sandbox), '');
});

test('deleteCloud revokes the refreshed token after a 401 retry', async () => {
  const { cloud, clock } = world(), a = device(cloud, clock);
  a.qty('c1', 2);
  await a.run('enableGoogleSync({ accessToken: "access-tok-1", refreshToken: "refresh-tok-1", expiresAt: Math.floor(Date.now() / 1000) + 3600, email: "trainer@gmail.com" })');
  await a.idle();
  cloud.token = 'different-server-token';
  await a.run('deleteCloud()');
  assert.equal(cloud.googleRow, null);
  assert.equal(a.state(), null);
  assert.equal(a.auth(), null);
  const logoutCall = cloud.calls.findLast(call => call.url === '/api/auth/logout');
  assert.ok(logoutCall);
  assert.equal(logoutCall.headers.Authorization, 'Bearer access-tok-refreshed');
});
