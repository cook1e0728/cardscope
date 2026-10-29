import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

// Strict script CSP: no 'unsafe-inline' in script-src, no inline event-handler attributes anywhere, inline <script> blocks allowed by SHA-256 only.
const root = new URL('../', import.meta.url);
const FETCH_BAD_PORTS = new Set([1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,5060,5061,6000,6566,6665,6666,6667,6668,6669,6697,10080]);
async function freePort() {
  for (;;) {
    const probe = createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    const { port } = probe.address();
    await new Promise(resolve => probe.close(resolve));
    if (!FETCH_BAD_PORTS.has(port)) return port;
  }
}
async function withServer(run) {
  const keys = ['PORT', 'CATALOG_SYNC_ON_START', 'CATALOG_WARM_ON_START', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'], previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let app;
  try {
    Object.assign(process.env, { PORT: String(await freePort()), CATALOG_SYNC_ON_START: 'false', CATALOG_WARM_ON_START: 'false' });
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
    ({ server: app } = await import('../server.mjs?csp-strict'));
    if (!app.listening) await new Promise(resolve => app.once('listening', resolve));
    return await run('http://127.0.0.1:' + app.address().port);
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    if (app?.listening) await new Promise(resolve => app.close(resolve));
  }
}
const executableScripts = html => [...html.matchAll(/<script(?![^>]*\s(?:src|type)=)[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const hashOf = code => `'sha256-${createHash('sha256').update(code).digest('base64')}'`;

test('every served page: script-src has no unsafe-inline, script-src-attr is none, and each executable inline script is allowed by its hash', async () => {
  await withServer(async base => {
    for (const path of ['/', '/index.html', '/?game=pokemon', '/?game=dragonball-fw&view=about', '/?game=pokemon&card=no-such-card', '/?game=pokemon&series=no-such-series', '/no-such-page']) {
      const response = await fetch(base + path), csp = response.headers.get('content-security-policy'), body = await response.text();
      const directive = name => csp.split(';').map(part => part.trim()).find(part => part.startsWith(name + ' ')) ?? '';
      assert.doesNotMatch(directive('script-src'), /unsafe-inline|unsafe-eval|nonce-/, path);
      assert.equal(directive('script-src-attr'), "script-src-attr 'none'", path);
      assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/, path);
      assert.match(directive('script-src'), /^script-src 'self'/, path);
      for (const code of executableScripts(body)) assert.ok(directive('script-src').includes(hashOf(code)), `${path}: inline script ${code.slice(0, 40)} is not in script-src`);
      if (path !== '/no-such-page') assert.ok(executableScripts(body).length >= 3, path);
      else assert.equal(executableScripts(body).length, 0, 'the 404 page has no script');
      // JSON-LD is a data block: it is not executed and is not governed by script-src, so it is not hashed.
      assert.ok(!directive('script-src').includes(hashOf('{')), path);
    }
    // the hashes come from the file itself: editing index.html changes them, nothing to keep in sync by hand
    const csp = (await fetch(base + '/')).headers.get('content-security-policy'), html = await readFile(new URL('index.html', root), 'utf8');
    assert.equal(executableScripts(html).length, (csp.match(/'sha256-/g) || []).length);
    // the other directives are unchanged
    assert.match(csp, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
    assert.match(csp, /img-src [^;]*https:\/\/www\.dbs-cardgame\.com/);
    assert.match(csp, /frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'$/);
  });
});

test('no served source has an inline event-handler attribute, a javascript: URL, eval or a string timer', async () => {
  const files = ['index.html', 'sw.js', 'server.mjs', 'providers/seo.mjs', ...(await readdir(root)).filter(name => /^[a-z0-9-]+\.(?:js|html)$/.test(name))];
  for (const file of new Set(files)) {
    const text = await readFile(new URL(file, root), 'utf8');
    assert.doesNotMatch(text, /[\s"'`]on[a-z]+\s*=\s*\\?["']/, `${file}: inline event-handler attribute (use data-do / data-img-error, see ui-actions.js)`);
    assert.doesNotMatch(text, /javascript:/i, `${file}: javascript: URL`);
    assert.doesNotMatch(text, /\beval\s*\(|new Function\s*\(|set(?:Timeout|Interval)\(\s*['"`]/, `${file}: string-evaluated code`);
  }
});

// A tiny DOM stand-in: addEventListener records the listeners, and `dispatch` runs them the way a capture/bubble listener on document would.
function fakeDocument() {
  const listeners = [];
  return { listeners, addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture: Boolean(capture) }), dispatch: (type, event) => listeners.filter(l => l.type === type).forEach(l => l.fn(event)) };
}

test('ui-actions.js: data-do clicks reach the current window function; unknown actions and non-functions are ignored; image errors are handled in the capture phase', async () => {
  const document = fakeDocument(), calls = [], timers = [], window = { choose: id => calls.push(['choose', id]), openCard: id => calls.push(['openCard', id]), openProduct: id => calls.push(['openProduct', id]), chooseProductCategory: id => calls.push(['cat', id]), alert: () => calls.push(['BAD']) };
  vm.runInContext(await readFile(new URL('ui-actions.js', root), 'utf8'), vm.createContext({ document, window, setTimeout: (fn, ms) => timers.push([fn, ms]), Object }));
  const click = (action, arg) => document.dispatch('click', { target: { closest: selector => selector === '[data-do]' ? { dataset: { do: action, arg } } : null } });
  click('choose', 'pokemon'); click('openCard', 'a:b'); click('openProduct', 'p1'); click('chooseProductCategory', 'box');
  click('alert', 'x'); click('constructor', 'x'); click('missingFn', 'x');
  document.dispatch('click', { target: { closest: () => null } });
  assert.deepEqual(calls, [['choose', 'pokemon'], ['openCard', 'a:b'], ['openProduct', 'p1'], ['cat', 'box']]);
  window.choose = id => calls.push(['wrapped', id]); click('choose', 'x');
  assert.deepEqual(calls.at(-1), ['wrapped', 'x'], 'looked up at click time, so the navigation-state wrapper runs');
  assert.ok(document.listeners.filter(l => l.type === 'error').every(l => l.capture), 'error does not bubble: needs capture');

  const fail = img => document.dispatch('error', { target: img });
  let removed = 0;
  const remove = { dataset: { imgError: 'remove' }, remove: () => removed++ };
  fail(remove); assert.equal(removed, 1);
  const display = { dataset: { imgError: 'swap-display' }, style: {}, nextElementSibling: { style: {} } };
  fail(display); assert.deepEqual([display.style.display, display.nextElementSibling.style.display], ['none', 'grid']);
  const hidden = { dataset: { imgError: 'swap-hidden' }, nextElementSibling: { hidden: true } };
  fail(hidden); assert.deepEqual([hidden.hidden, hidden.nextElementSibling.hidden], [true, false]);
  // series tiles: retry once after 1.5 s with retry=1, then become the code tile
  const classes = new Set(), tile = { dataset: { imgError: 'retry-type' }, src: 'https://x/a.png', parentElement: { classList: { add: name => classes.add(name) } }, remove: () => { tile.gone = true; } };
  fail(tile); assert.deepEqual([tile.dataset.retried, timers.length, timers[0][1], tile.gone], ['1', 1, 1500, undefined]);
  timers[0][0](); assert.equal(tile.src, 'https://x/a.png?retry=1');
  fail(tile); assert.deepEqual([classes.has('is-type'), tile.gone, timers.length], [true, true, 1]);
  const withQuery = { dataset: { imgError: 'retry-type' }, src: 'https://x/api/images/a?url=u' }; fail(withQuery); timers.at(-1)[0](); assert.equal(withQuery.src, 'https://x/api/images/a?url=u&retry=1');
  // images without a kind, window-level errors and unknown kinds do nothing
  assert.doesNotThrow(() => { fail({ dataset: {} }); fail({}); fail(undefined); fail({ dataset: { imgError: 'toString' } }); document.dispatch('error', {}); });
});

test('card images: the first failure waits 1.5 s and retries with retry=1, then the fallbacks, then 圖片待補; a load clears the hidden state', async () => {
  const ui = await readFile(new URL('ui-enhancements.js', root), 'utf8'), start = ui.indexOf('function cardImageFailed'), end = ui.indexOf('function resilientImage');
  const document = fakeDocument(), timers = [], sandbox = vm.createContext({ document, setTimeout: (fn, ms) => timers.push([fn, ms]), JSON, e: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;'), displayImageUrl: url => url, missingImageMarkup: () => '<span>none</span>' });
  vm.runInContext(ui.slice(start, end), sandbox);
  vm.runInContext(ui.slice(end, ui.indexOf('function installViewToggle')), sandbox);
  const markup = vm.runInContext("resilientImage('https://asia.pokemon-card.com/tw/card-img/a.png','測試卡','待補',{fallbacks:['/jp.png','/jp2.png']})", sandbox);
  assert.doesNotMatch(markup, /\son[a-z]+=/);
  assert.match(markup, /data-img-error="card"/);
  assert.match(markup, /^<img /);
  const fail = img => document.dispatch('error', { target: img }), settle = img => document.dispatch('load', { target: img });
  const sample = { hidden: false };
  const img = { dataset: { imgError: 'card', fallbacks: JSON.stringify(['/jp.png', '/jp2.png']) }, src: 'https://asia.pokemon-card.com/tw/card-img/a.png', style: {}, hidden: false, nextElementSibling: { hidden: true }, parentElement: { querySelector: () => sample } };
  fail(img);
  assert.equal(img.dataset.retried, '1');
  assert.equal(img.src, 'https://asia.pokemon-card.com/tw/card-img/a.png', 'not swapped yet: it waits first');
  assert.deepEqual([timers.length, timers[0][1], img.style.visibility], [1, 1500, 'hidden']);
  timers[0][0]();
  assert.equal(img.src, 'https://asia.pokemon-card.com/tw/card-img/a.png?retry=1');
  settle(img); assert.equal(img.style.visibility, '', 'a successful load shows the image again');
  fail(img); assert.equal(img.src, '/jp.png', 'the retry failed too: the fallback list takes over'); assert.equal(timers.length, 1, 'no second retry');
  fail(img); assert.equal(img.src, '/jp2.png');
  fail(img); assert.deepEqual([img.hidden, img.nextElementSibling.hidden, sample.hidden], [true, false, true], 'everything failed: 圖片待補 is shown and the SAMPLE mark is hidden');
  const withQuery = { dataset: { imgError: 'card' }, src: 'https://x/api/images/onepiece?url=a', style: {}, nextElementSibling: { hidden: true }, parentElement: { querySelector: () => null } };
  fail(withQuery); timers.at(-1)[0](); assert.equal(withQuery.src, 'https://x/api/images/onepiece?url=a&retry=1');
  const other = { dataset: {}, style: { visibility: 'hidden' } }; settle(other); fail(other); assert.equal(other.style.visibility, 'hidden', 'other images are left alone');
});

test('the Yuyu-tei buyback lookup passes the card number literally (the old backslash escaping never matched numbers with . _ %)', async () => {
  const server = await readFile(new URL('server.mjs', root), 'utf8'), body = server.slice(server.indexOf('async function yuyuteiMarket'), server.indexOf('\n', server.indexOf('async function yuyuteiMarket')));
  assert.match(body, /card_number:`eq\.\$\{card\.officialCardNumber\}`/);
  assert.doesNotMatch(body, /esc\(|replace\(\/\[\\\\/);
});
