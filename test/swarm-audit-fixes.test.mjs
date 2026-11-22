import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const FETCH_BAD_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);

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
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', CATALOG_SYNC_ON_START: 'false', CATALOG_WARM_ON_START: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`server start timeout: ${out}`)), 8000);
      child.once('exit', (code, sig) => { clearTimeout(timer); reject(new Error(`server exited (${code ?? sig}): ${out}`)); });
      child.stdout.on('data', chunk => { out += String(chunk); if (out.includes('CardScope is running')) { clearTimeout(timer); resolve(); } });
      child.stderr.on('data', chunk => { out += String(chunk); });
    });
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    }
  }
}

// ---- FIX-03：getCard 次要 physicalCardId / printing 查找與 derivedPrinting.id ----
test('FIX-03: /api/catalog sets derivedPrinting.id, /api/cards/:physicalId resolves 200, and cardOpenId falls back to p.cardId', async () => {
  await withServer(async base => {
    const catalogRes = await fetch(`${base}/api/catalog`);
    assert.equal(catalogRes.status, 200);
    const catalog = (await catalogRes.json()).data;
    const charizard = catalog.cards.find(card => card.id === 'pokemon-charizard-base-set-4');
    assert.ok(charizard);
    assert.equal(charizard.printings[0].id, 'pokemon-charizard-base1-4-us', 'derivedPrinting carries id matching physical id');
    assert.equal(charizard.referencePrintingId, 'pokemon-charizard-base1-4-us');

    const byPhysical = await fetch(`${base}/api/cards/pokemon-charizard-base1-4-us`);
    assert.equal(byPhysical.status, 200, 'secondary physical card id resolves via getCard');
    const cardBody = (await byPhysical.json()).data;
    assert.equal(cardBody.id, 'pokemon-charizard-base-set-4');
    assert.ok(cardBody.physicalCardIds.includes('pokemon-charizard-base1-4-us'));
  });

  const ui = await readFile(new URL('ui-enhancements.js', root), 'utf8');
  const line = ui.match(/const cardOpenId=[^\n]+/)[0];
  const fn = vm.runInNewContext(`${line}; cardOpenId`, {});
  assert.equal(fn({ id: 'canon-1', referencePrintingId: 'phys-2', printings: [{ cardId: 'phys-1' }, { cardId: 'phys-2' }] }), 'phys-2');
  assert.equal(fn({ id: 'canon-1', referencePrintingId: 'p-1', printings: [{ id: 'p-1', cardId: 'phys-1' }] }), 'phys-1');
});

// ---- FIX-10：navigation-state.js 初次載入 hash 捲動與 restoring 期間 SPA 點擊排隊 ----
function createNavigationTestEnv({ search = '', hash = '', historyState = null, onChoose } = {}) {
  const location = {
    origin: 'http://localhost', pathname: '/', search, hash,
    get href() { return this.origin + this.pathname + this.search + this.hash; }
  };
  const nodes = new Map(), documentListeners = new Map(), historyCalls = [], scrollToCalls = [], scrollBelowCalls = [];
  const makeNode = id => {
    const classes = new Set();
    const el = {
      id, value: '', style: {}, dataset: {},
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
      addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null,
      after() {}, append() {}, prepend() {}, setAttribute() {}, removeAttribute() {},
      focus(opts) { this.focused = true; this.focusOpts = opts; },
      scrollIntoView() { this.scrolledIntoView = true; }
    };
    nodes.set(id, el);
    return el;
  };
  for (const id of ['browseRegion', 'priceFilter', 'cardSort', 'q', 'modal', 'close', 'detail', 'cardZoom', 'main', 'rights', 'sources']) makeNode(id);
  const applyUrl = url => {
    const u = new URL(url, location.origin);
    location.pathname = u.pathname; location.search = u.search; location.hash = u.hash;
  };
  const history = {
    state: historyState,
    replaceState(state, _title, url) { this.state = state; historyCalls.push({ method: 'replace', url }); applyUrl(url); },
    pushState(state, _title, url) { this.state = state; historyCalls.push({ method: 'push', url }); applyUrl(url); },
    back() { historyCalls.push({ method: 'back' }); }
  };
  const document = {
    body: { dataset: { view: '' } },
    getElementById: id => nodes.get(id) || null,
    querySelector: () => null,
    createElement: () => makeNode(`created-${nodes.size}`),
    addEventListener: (type, fn, capture) => {
      const list = documentListeners.get(type) || [];
      list.push({ fn, capture: Boolean(capture) });
      documentListeners.set(type, list);
    }
  };
  const context = vm.createContext({
    document, history, location, URL, URLSearchParams, console, setTimeout, clearTimeout,
    requestAnimationFrame: cb => { cb(); return 1; },
    window: null, C: { games: [{ id: 'pokemon', nameZh: '寶可夢' }], series: [] },
    game: 'all', browse: { seriesId: '', offset: 0, loading: false, hasMore: false },
    cardFilters: { rarity: 'all', price: 'all', sort: 'number-asc' },
    chooseCalls: []
  });
  context.window = context;
  context.scrollTo = opts => scrollToCalls.push({ ...opts });
  context.scrollBelowHeader = el => scrollBelowCalls.push(el.id);
  context.addEventListener = () => {};
  vm.runInContext("let siteView = '';", context);
  context.choose = async id => {
    context.chooseCalls.push(id);
    context.game = id;
    const sv = vm.runInContext('siteView', context);
    document.body.dataset.view = id === 'all' ? (['about', 'privacy', 'collection', 'market'].includes(sv) ? sv : 'landing') : 'game';
    if (onChoose) await onChoose(id);
  };
  return { context, nodes, location, historyCalls, scrollToCalls, scrollBelowCalls, documentListeners, flush: () => new Promise(r => setTimeout(r, 0)) };
}

test('FIX-10a: initial restore() with location.hash scrolls to anchor instead of forcing top:0, and tolerates malformed URI', async () => {
  const navSource = await readFile(new URL('navigation-state.js', root), 'utf8');
  const env = createNavigationTestEnv({ search: '?view=privacy', hash: '#rights', historyState: null });
  vm.runInContext(navSource, env.context);
  await env.flush();
  assert.deepEqual(env.scrollBelowCalls, ['rights']);
  assert.equal(env.scrollToCalls.length, 0, 'must not overwrite anchor scroll with scrollTo(0)');
  assert.equal(env.nodes.get('rights').focused, true);
  assert.equal(env.nodes.get('rights').tabIndex, -1);

  const badHashEnv = createNavigationTestEnv({ search: '?view=privacy', hash: '#%E0%A4%A', historyState: null });
  assert.doesNotThrow(() => vm.runInContext(navSource, badHashEnv.context));
  await badHashEnv.flush();
  assert.deepEqual(badHashEnv.scrollToCalls, [{ top: 0, behavior: 'auto' }]);
});

test('FIX-10b: a[data-spa] clicks during restoring===true queue the latest target and navigate once restore finishes', async () => {
  const navSource = await readFile(new URL('navigation-state.js', root), 'utf8');
  let releaseFirstChoose;
  const firstGate = new Promise(resolve => { releaseFirstChoose = resolve; });
  let chooseCount = 0;
  const env = createNavigationTestEnv({
    search: '', hash: '', historyState: null,
    onChoose: async () => {
      chooseCount++;
      if (chooseCount === 1) await firstGate;
    }
  });
  vm.runInContext(navSource, env.context);
  await env.flush(); // initial restore is now awaiting firstGate inside choose()

  const clickLink = href => {
    const link = { getAttribute: attr => (attr === 'href' ? href : null) };
    const event = {
      type: 'click', button: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      target: { closest: sel => (sel === 'a[data-spa]' ? link : null) }
    };
    for (const h of env.documentListeners.get('click') || []) h.fn(event);
    return event;
  };

  const firstClick = clickLink('/?view=about');
  const secondClick = clickLink('/?view=privacy#rights');
  assert.equal(firstClick.defaultPrevented, true);
  assert.equal(secondClick.defaultPrevented, true);
  assert.equal(env.historyCalls.filter(c => c.method === 'push').length, 0, 'does not push while restoring===true');

  releaseFirstChoose();
  await env.flush();
  await env.flush();

  const pushes = env.historyCalls.filter(c => c.method === 'push');
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].url, '/?view=privacy#rights', 'latest queued click wins');
  assert.equal(env.location.search, '?view=privacy');
  assert.equal(env.location.hash, '#rights');
  assert.ok(env.scrollBelowCalls.includes('rights'));
  assert.equal(env.nodes.get('rights').focused, true);
});

// ---- FIX-12：ui-actions.js retry-type 隱藏破圖與載入還原 ----
test('FIX-12: retry-type hides broken image before retry and restores visibility on capture load', async () => {
  const actionsSource = await readFile(new URL('ui-actions.js', root), 'utf8');
  const listeners = [], timers = [];
  const document = {
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture: Boolean(capture) })
  };
  vm.runInNewContext(actionsSource, { document, window: {}, Object, innerWidth: 375, setTimeout: (fn, ms) => timers.push([fn, ms]) });
  const loadListeners = listeners.filter(l => l.type === 'load');
  assert.equal(loadListeners.length, 1);
  assert.equal(loadListeners[0].capture, true);

  const dispatch = (type, target) => listeners.filter(l => l.type === type).forEach(l => l.fn({ target }));
  const img = { dataset: { imgError: 'retry-type' }, src: 'https://x/set.png', style: {} };
  dispatch('error', img);
  assert.equal(img.dataset.retried, '1');
  assert.equal(img.style.visibility, 'hidden');
  assert.equal(timers.length, 1);
  timers[0][0]();
  assert.equal(img.src, 'https://x/set.png?retry=1');

  dispatch('load', img);
  assert.equal(img.style.visibility, '');

  const other = { dataset: { imgError: 'card' }, style: { visibility: 'hidden' } };
  dispatch('load', other);
  assert.equal(other.style.visibility, 'hidden', 'non retry-type images are left untouched');

  const noStyle = { dataset: { imgError: 'retry-type' }, src: 'https://x/nostyle.png' };
  assert.doesNotThrow(() => { dispatch('error', noStyle); dispatch('load', noStyle); });
});

// ---- FIX-19 (JS) & CSS 修復要點靜態守護（FIX-01/04/14/15/16/18/19/20） ----
test('FIX-19 (JS): version row omits separator dot when p.localCardNumber is empty', async () => {
  const ui = await readFile(new URL('ui-enhancements.js', root), 'utf8');
  assert.match(ui, /\$\{p\.localCardNumber\?`<span class="ver-seg"> · \$\{e\(p\.localCardNumber\)\}<\/span>`:''\}/);
  assert.doesNotMatch(ui, /<span class="ver-seg"> · \$\{e\(p\.localCardNumber\)\}<\/span><span class="ver-seg">\$\{parallelLabel/);
});

test('CSS static guards: FIX-01, FIX-04, FIX-14, FIX-15, FIX-16, FIX-18, FIX-19, FIX-20', async () => {
  const [v2, effects, showcase] = await Promise.all([
    readFile(new URL('look-v2.css', root), 'utf8'),
    readFile(new URL('look-effects.css', root), 'utf8'),
    readFile(new URL('look-showcase.css', root), 'utf8')
  ]);

  // FIX-01: IDs separated from shared class :is(...) and .version-switch explicitly block/100%
  assert.match(v2, /:is\(\.cards-mode,[^)]*\.version-switch[^)]*\),\s*html\.look-clean body\[data-view\] :is\(#downloadWatchlist,#copyReportTemplate\)/);
  const sharedRule = v2.match(/html\.look-clean body\[data-view\] :is\(\.cards-mode,[^)]+\)/)?.[0] || '';
  assert.doesNotMatch(sharedRule, /#downloadWatchlist|#copyReportTemplate/);
  assert.match(v2, /html\.look-clean body\[data-view\] #detail \.dpanel-versions \.version-switch\{display:block;width:100%;/);

  // FIX-04: phone search results shows .side-sheet-btn
  assert.match(v2, /body\[data-side="results"\] \.side-sheet-btn,body\[data-view="game"\] \.side-sheet-btn\{display:flex\}/);

  // FIX-14: landing brand focus outline, >=44px detail price targets, and keyboard-focused .fx-pre reveal
  assert.match(v2, /body\[data-view="landing"\] header\.top :is\(\.nav button,a\.brand\):focus-visible\{outline-color:#F6F1E6\}/);
  assert.match(v2, /body\[data-view="landing"\] header\.top a\.brand:focus-visible\{outline-style:solid;outline-width:2px;/);
  assert.match(v2, /\.ebay-title\{display:flex;align-items:center;min-height:var\(--btn-h\)/);
  assert.match(v2, /\.pov-jump\{[^}]*justify-content:flex-end;min-width:var\(--btn-h\);min-height:44px/);
  assert.match(v2, /\.ptl-seg-btn\{min-height:var\(--btn-h\)/);
  assert.match(effects, /html:not\(\[data-cs-paused\]\) \.fx-pre:is\(:focus-visible,:focus-within\)\{opacity:1;translate:none\}/);

  // FIX-15: paused/reduced animations, placeholder/input/footer contrast, and paused ScrollTimeline
  assert.match(v2, /@media \(prefers-reduced-motion:reduce\)\{\s*html\.look-clean body\[data-view\] \*\{transition-duration:\.01ms!important;animation-duration:\.01ms!important;animation-iteration-count:1!important\}/);
  assert.match(v2, /html\[data-cs-paused\] body\[data-view\] \*\{transition-duration:\.01ms!important;animation-duration:\.01ms!important;animation-iteration-count:1!important\}/);
  assert.match(v2, /#sideNav \.series-band-filter::placeholder\{color:var\(--v2-ink-2\);opacity:1\}/);
  assert.match(v2, /\.sync-input\{[^}]*border:1\.5px solid #857D6E;[^}]*background:var\(--v2-page\)/);
  assert.match(v2, /\.brand-footer[^}]*\.foot-legal summary[^}]*color:var\(--v2-ink-2\)/);
  assert.match(showcase, /html\.look-clean:not\(\[data-cs-paused\]\) :is\(body\[data-view="landing"\] \.channels/);

  // FIX-16: pov table cell wrapping and non-breaking header unit
  assert.match(v2, /\.pov \.ptl-table td:first-child\{word-break:keep-all;overflow-wrap:break-word\}/);
  assert.match(v2, /\.pov \.pov-th-sub\{display:block;white-space:nowrap\}/);

  // FIX-18: 1000-1199px top bar brand min-width aligned with --s3 gap
  assert.match(v2, /@media \(min-width:1000px\) and \(max-width:1199px\)\{\s*html\.look-clean body\[data-side\] header\.top \.bar>\.brand\{min-width:calc\(var\(--side-w\) \+ var\(--s6\) - var\(--s3\) - var\(--s3\)\)\}/);

  // FIX-19: toast repositioned while modal open, and summary disclosure affordance without @keyframes
  assert.match(v2, /body:has\(#modal\.open\) \.brand-collection-toast\{top:calc\(var\(--side-top,66px\) \+ 12px\);bottom:auto;right:22px\}/);
  assert.match(v2, /body:has\(#modal\.open\) \.brand-collection-toast\{top:60px;bottom:auto;right:12px\}/);
  assert.match(v2, /\.ptl-details>summary,html\.look-clean \.coll-import details>summary\{min-height:var\(--btn-h\);display:flex;align-items:center;justify-content:space-between/);
  assert.match(v2, /\.ptl-details>summary::after,html\.look-clean \.coll-import details>summary::after\{content:"展開 ▾"/);
  assert.match(v2, /\.ptl-details\[open\]>summary::after,html\.look-clean \.coll-import details\[open\]>summary::after\{content:"收合 ▴"\}/);

  // FIX-20 & FIX-15 phone landing bg: <=760px tail block
  const phoneTail = v2.slice(v2.lastIndexOf('@media (max-width:760px){'));
  assert.match(phoneTail, /body\[data-view="landing"\]\{background:var\(--v2-page\)\}/);
  assert.match(phoneTail, /body\[data-view="collection"\] #cardTools\{flex-direction:column;align-items:stretch\}/);
  assert.match(phoneTail, /body\[data-view="collection"\] \.coll-manage\{order:0;align-self:flex-end\}/);
  assert.match(phoneTail, /body\[data-view="collection"\] #cardControls\{flex:0 0 auto;width:100%\}/);
});
