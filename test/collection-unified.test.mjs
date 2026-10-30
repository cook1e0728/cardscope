import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 收藏統一（數量就是收藏）、詳細頁收錄版本與收藏按鈕、手機快速入口的導覽格。純函式從原始碼切出來放進 vm。
const ui = readFileSync(new URL('../ui-enhancements.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('../collection-store.js', import.meta.url), 'utf8');
const win = {};
new Function('window', storeSource)(win);
const CS = win.CollectionStore;
const between = (from, to) => { const start = ui.indexOf(from), end = ui.indexOf(to, start); assert.ok(start >= 0 && end > start, `${from} … ${to}`); return ui.slice(start, end); };
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function collection({ stored = {}, legacy = [], watchlist = {}, confirmAnswer = true, failWrites = false } = {}) {
  const storage = new Map(Object.entries(stored)), asked = [];
  const sandbox = vm.createContext({
    CS, watchlist, watchlistMeta: {}, legacyFavoriteIds: legacy, renderedCards: new Map(), currentCardRows: [], asked,
    uiLocal: { get: (key, fallback) => storage.get(key) || fallback, set: (key, value) => { if (failWrites) return false; storage.set(key, value); return true; } },
    name: card => card.nameZh, cards() {}, renderDetailCollect() {}, showCollectionToast() {}, allKnownCards: () => [], cardSnapshot: (card, key) => ({ id: key, nameZh: card.nameZh }),
    confirm: message => { asked.push(message); return confirmAnswer; }
  });
  const load = () => vm.runInContext([between('// 數量就是收藏', 'function allKnownCards'), between('function persistCollection', 'const cardscopeBaseFilteredCards'), between('// ☆ 與詳細頁的按鈕共用', 'function showCollectionToast'), between('function setWatchQuantity', 'function watchlistEntries'), between('// 「我的收藏」= 數量 > 0', 'function renderWatchlistSummary')].join('\n'), sandbox);
  load();
  return { sandbox, storage, run: code => vm.runInContext(code, sandbox) };
}

test('migration: old stars become quantity 1 once, counts stay, the old keys are kept, a failed write is retried next load', () => {
  const stored = { 'cardscope-favorites': '["a","b"]' };
  const first = collection({ stored, legacy: ['a', 'b'], watchlist: { b: 3 } });
  assert.deepEqual(JSON.parse(first.storage.get('cardscope-watchlist')), { b: 3, a: 1 });
  assert.equal(first.storage.get('cardscope-collection-unified'), '1');
  assert.equal(first.storage.get('cardscope-favorites'), '["a","b"]', 'the old star list is left untouched as a backup');
  assert.equal(first.run('watchQuantity("a")'), 1);
  assert.equal(first.run('watchQuantity("b")'), 3);

  const again = collection({ stored: { ...Object.fromEntries(first.storage) }, legacy: ['a', 'b', 'z'], watchlist: { b: 3 } });
  assert.equal(again.run('watchQuantity("z")'), 0, 'already migrated: the old list is not read again, so a removed card does not come back');

  const failing = collection({ legacy: ['a'], failWrites: true });
  assert.equal(failing.run('watchQuantity("a")'), 1, 'still shown for this visit');
  assert.equal(failing.storage.has('cardscope-collection-unified'), false, 'not marked done, so the next load tries again');
});

test('star and ± share one number: add -> 1, remove asks first, ± never goes below the confirm', () => {
  const c = collection({ legacy: [], watchlist: {} });
  c.sandbox.renderedCards.set('a', { nameZh: '皮卡丘' });
  assert.equal(c.run('isFavorite("a")'), false);
  c.run('toggleFavorite("a")');
  assert.equal(c.run('watchQuantity("a")'), 1, 'an empty star sets the quantity to 1');
  assert.equal(c.run('isFavorite("a")'), true);
  c.run('stepWatchQuantity("a",1)');
  assert.equal(c.run('watchQuantity("a")'), 2);
  c.run('stepWatchQuantity("a",-1)');
  assert.equal(c.run('watchQuantity("a")'), 1);
  assert.equal(c.sandbox.asked.length, 0, 'no question while the card stays in the collection');
  c.sandbox.confirm = () => { c.sandbox.asked.push('declined'); return false; };
  c.run('toggleFavorite("a")');
  c.run('stepWatchQuantity("a",-1)');
  assert.equal(c.run('watchQuantity("a")'), 1, 'declining keeps the card');
  assert.equal(c.sandbox.asked.length, 2);
  c.sandbox.confirm = message => { c.sandbox.asked.push(message); return true; };
  c.run('stepWatchQuantity("a",-1)');
  assert.equal(c.run('watchQuantity("a")'), 0, '1 -> 0 is a removal and was confirmed');
  assert.match(c.sandbox.asked.at(-1), /皮卡丘/);
  assert.equal(c.run('"a" in watchlistMeta'), false, 'removing also drops the saved condition and note');
  assert.equal(c.run('stepWatchQuantity("never",-1)'), undefined, 'a card that is not collected stays that way');
  assert.equal(c.run('watchQuantity("never")'), 0);
});

test('one count everywhere: 款數 and 張數 come from quantity only, so the filter button and the collection window agree', () => {
  const c = collection({ legacy: [], watchlist: { a: 2, b: 1, c: 'x', d: 0 } });
  assert.deepEqual(JSON.parse(c.run('JSON.stringify(collectionIds())')), ['a', 'b']);
  assert.equal(c.run('collectionTotal()'), 3);
  assert.doesNotMatch(ui, /favoriteIds/, 'no second star list is kept');
  assert.match(ui, /control\.textContent=`只看我的收藏（\$\{collectionIds\(\)\.length\}）`/);
  assert.match(ui, /filteredCards=function\(rows\)\{const result=cardscopeBaseFilteredCards\(rows\);const owned=favoritesOnly\?result\.filter\(card=>isFavorite\(entryKey\(card\)\)\)/);
  assert.match(ui, /function collectionItems\(\)\{return CS\.itemsFromLegacy\(\[\],watchlist,watchlistMeta\)\.filter\(item=>item\.quantity>0\)\}/);
  assert.match(ui, /const quantity=CS\.collectedQuantity\(item\);if\(quantity>0\)watchlist\[item\.id\]=quantity/, 'importing an old star-only backup gives quantity 1');
});

test('collection window: region names follow the game, and the meaningless 最近瀏覽系列 stat is replaced by 涵蓋遊戲', () => {
  assert.match(ui, /rn\(meta\.region,meta\.game\)/);
  assert.match(ui, /choiceLabels\(meta\.choices\|\|\[\],meta\.game\)/);
  assert.match(ui, /bindPriceTrend\(c\.game,m\)/);
  assert.doesNotMatch(ui, /最近瀏覽系列|collStatRecent|recentSeriesCount/);
  const c = collection({ watchlist: { a: 1, b: 2, c: 1 } });
  c.sandbox.watchlistMeta = { a: { game: 'pokemon' }, b: { game: 'onepiece' }, c: {} };
  vm.runInContext(between('function collectionGameCount', 'function refreshCollectionValue'), c.sandbox);
  assert.equal(c.run('collectionGameCount()'), 2, 'cards without a known game are not counted');
  assert.match(ui, /function shownFinish\(item\)\{return item\.finish\|\|CS\.soleFinish\(/, 'a card with one price version shows it as the default 版本 (display only)');
});

// --- detail page: 收錄版本
const lnSource = html.match(/ln=l=>.*?(?=,original=)/)[0];
const detail = vm.createContext({
  e: esc, C: { series: [
    { id: 'pokemon-official-tw-m4', nameZh: '忍者飛旋', officialCode: 'M4', region: 'TW' },
    { id: 'pokemon-tcgdex-ja-m4', nameJa: 'ニンジャスピナー', officialCode: 'M4', region: 'JP' }
  ] },
  rn: (r, g) => r === 'TW' && (g?.id || g) === 'onepiece' ? '亞洲日文版' : ({ TW: '台版', JP: '日版', US: '美版' }[r] || r),
  cardGameId: card => typeof card?.game === 'object' ? card.game.id : card?.game,
  DETAIL_SOURCE_NAMES: {}
});
vm.runInContext(`${lnSource};\n${between('function cardNumberLabel', 'function cardPriceLabel')}\n${between('// 系列名要跟隨', '// 分頁')}\n${between('// 收錄版本列', '// 詳細頁的收藏按鈕')}`, detail);
const run = code => vm.runInContext(code, detail);

test('收錄版本: One Piece Taiwan printings read 日文, not 繁體中文; other games keep the stored language', () => {
  assert.equal(run(`printingLanguage({region:'TW',language:'zh-Hant-TW'},'onepiece')`), '日文');
  assert.equal(run(`printingLanguage({region:'ASIA',language:'en'},'onepiece')`), '英文');
  assert.equal(run(`printingLanguage({region:'TW',language:'zh-TW'},'pokemon')`), '繁體中文');
  assert.equal(run(`printingLanguage({region:'JP',language:'ja-JP'},'pokemon')`), '日文');
});

test('收錄版本: _p1／_r2 parallel cards are labelled 異圖 N, ordinary printings are not', () => {
  assert.equal(run(`parallelLabel({imageUrl:'https://asia-tc.onepiece-cardgame.com/images/cardlist/card/EB01-001_p1.png?261007',cardId:'x'},'onepiece')`), '異圖 1');
  assert.equal(run(`parallelLabel({imageUrl:'https://a/b/OP01-001_r2.png',cardId:'x'},'onepiece')`), '異圖 2');
  assert.equal(run(`parallelLabel({imageUrl:null,cardId:'onepiece-official-eb01-001-p2'},'onepiece')`), '異圖 2', 'no image: the card id suffix is used for One Piece');
  assert.equal(run(`parallelLabel({imageUrl:'https://a/b/EB01-001.png?261007',cardId:'onepiece-official-eb01-001'},'onepiece')`), '');
  assert.equal(run(`parallelLabel({imageUrl:null,cardId:'pokemon-promo-p1'},'pokemon')`), '', 'a card id suffix means nothing outside One Piece');
  assert.match(ui, /parallelLabel\(p,cardGameId\(c\)\)\?` · <span class="badge">/);
});

test('收錄版本: the series name follows the displayed printing, never the Taiwan one for a Japanese card', () => {
  const tw = { id: 'pokemon-official-tw-m4', nameZh: '忍者飛旋', officialCode: 'M4', region: 'TW' };
  const jp = { seriesId: 'pokemon-tcgdex-ja-m4', region: 'JP', localSetCode: 'M4' };
  const out = run(`detailInfoMeta(${JSON.stringify({ game: 'pokemon', series: tw })},[],${JSON.stringify(jp)})`);
  assert.match(out, /ニンジャスピナー（日版・M4）/);
  assert.doesNotMatch(out, /忍者飛旋|台版/);
  assert.match(run(`detailInfoMeta(${JSON.stringify({ game: 'pokemon', series: tw })},[],${JSON.stringify({ seriesId: tw.id, region: 'TW' })})`), /忍者飛旋（台版・M4）/);
  const unknown = run(`detailInfoMeta(${JSON.stringify({ game: 'pokemon', series: tw })},[],${JSON.stringify({ seriesId: 'not-in-catalog', region: 'JP', localSetCode: 'M4' })})`);
  assert.match(unknown, /系列待補（日版・M4）/, 'a series the catalog cannot name is said to be missing, not replaced by the Taiwan name');
  assert.doesNotMatch(unknown, /忍者飛旋/);
  assert.match(run(`detailInfoMeta(${JSON.stringify({ game: 'onepiece', series: { id: 's', nameZh: '補充包', region: 'ASIA' } })},[],${JSON.stringify({ seriesId: 's', region: 'ASIA' })})`), /補充包（亞洲英文版|ASIA/);
});

test('收錄版本: Yu-Gi-Oh! shows the printed number first with the passcode as secondary; "unspecified" sets say 系列未標示', () => {
  const card = { game: 'yugioh', officialCardNumber: '1280391' };
  const out = run(`detailNumber(${JSON.stringify(card)},{localCardNumber:'BETB-EN060'})`);
  assert.match(out, /^BETB-EN060 <small class="meta" title="[^"]*">密碼 1280391<\/small>$/);
  assert.equal(run(`detailNumber(${JSON.stringify(card)},{localCardNumber:'1280391'})`), '1280391', 'when the printing only knows the passcode there is nothing else to show');
  assert.equal(run(`detailNumber(${JSON.stringify({ game: 'pokemon', officialCardNumber: '039/165' })},{localCardNumber:'039'})`), '039/165', 'other games keep the official number');
  assert.equal(run(`detailNumber(${JSON.stringify({ game: 'yugioh', officialCardNumber: 'QCCU-JP002' })},{localCardNumber:'QCCU-JP002'})`), 'QCCU-JP002');
  assert.equal(run(`setCodeText('unspecified')`), '');
  assert.equal(run(`setCodeText('SV6a')`), 'SV6a');
  assert.match(ui, /setCodeText\(p\.localSetCode\)\|\|'系列未標示'/);
  assert.match(ui, /<dt>卡號<\/dt><dd>\$\{detailNumber\(c,selectedPrinting\)\}/);
});

// --- detail page: 收藏按鈕
test('詳細頁收藏按鈕: 加入收藏 / 已收藏 ×N with ± , sharing the grid quantity, 44px targets', () => {
  const c = collection({ watchlist: {} });
  const slot = { dataset: { detailCollect: 'k1' }, innerHTML: '', contains: () => false, querySelector: () => null };
  Object.assign(c.sandbox, { document: { querySelector: () => slot, activeElement: null } });
  vm.runInContext(between('function renderDetailCollect', 'openCard=async function'), c.sandbox);
  c.run('renderDetailCollect()');
  assert.match(slot.innerHTML, /data-collect-act="toggle" aria-pressed="false">☆ 加入收藏</);
  assert.doesNotMatch(slot.innerHTML, /data-collect-act="inc"/);
  const click = act => slot.onclick({ target: { closest: () => ({ dataset: { collectAct: act } }) } });
  click('toggle');
  assert.equal(c.run('watchQuantity("k1")'), 1);
  assert.match(slot.innerHTML, /aria-pressed="true"[^>]*>★ 已收藏 ×1</);
  click('inc');
  assert.match(slot.innerHTML, /已收藏 ×2/);
  click('dec');
  click('dec');
  assert.equal(c.run('watchQuantity("k1")'), 0, 'the last − removes after the same confirm as the star');
  assert.match(slot.innerHTML, /☆ 加入收藏/);
  assert.match(ui, /<h2>\$\{e\(name\(c\)\)\}<\/h2><div class="detail-collect" data-detail-collect="\$\{e\(collectKey\)\}"/, 'right under the card name');
  assert.match(ui, /\.detail-collect button\{min-width:44px;min-height:44px/);
});

// --- phone quick grid
test('手機快速入口: 10 tiles fill two rows of five; the tour is reached from 重看導覽, not a filler tile', () => {
  assert.doesNotMatch(ui, /label:'遊戲王日文'/);
  assert.doesNotMatch(ui, /label:'新手導覽'/);
  const items = ui.slice(ui.indexOf('const items=['), ui.indexOf('];', ui.indexOf('const items=[')));
  assert.equal((items.match(/\{game:'/g) || []).length, 10);
  assert.match(readFileSync(new URL('../look-showcase.js', import.meta.url), 'utf8'), /重看導覽/);
  assert.match(ui, /label:'遊戲王美版'/, 'the US tile stays');
});
